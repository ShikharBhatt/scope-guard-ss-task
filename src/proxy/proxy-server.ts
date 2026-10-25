import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import * as http from 'http';
import * as net from 'net';
import * as crypto from 'crypto';
import * as dns from 'dns/promises';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { ProxyService } from './proxy.service';
import { CryptoService } from '../identity/crypto.service';
import { PolicyRepository } from '../policy/policy.repository';
import { PolicyEvaluatorService } from '../policy/policy-evaluator.service';
import { AuditRepository } from '../audit/audit.repository';
import { TargetNormalizer } from '../policy/target-normalizer';
import { SsrfFilter } from './ssrf-filter';

@Injectable()
export class ProxyServer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ProxyServer.name);
  private server: http.Server | null = null;
  private readonly proxyPort: number;
  private readonly allowLocalMockTargets: boolean;

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly proxyService: ProxyService,
    private readonly cryptoService: CryptoService,
    private readonly policyRepository: PolicyRepository,
    private readonly policyEvaluator: PolicyEvaluatorService,
    private readonly auditRepository: AuditRepository,
  ) {
    this.proxyPort = this.configService.get('app.proxyPort', { infer: true }) ?? 3128;
    this.allowLocalMockTargets =
      this.configService.get('app.allowLocalMockTargets', { infer: true }) ?? false;
  }

  onApplicationBootstrap(): void {
    const serviceMode = process.env.SERVICE_MODE || 'all';
    if (serviceMode === 'api') {
      this.logger.log(`SERVICE_MODE=api: Egress proxy listener on port ${this.proxyPort} disabled.`);
      return;
    }
    this.startServer();
  }

  onApplicationShutdown(): void {
    this.stopServer();
  }

  startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.proxyService.handleProxyRequest(req, res).catch((err) => {
          this.logger.error('Unhandled error in forward proxy handler', err.stack);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal proxy error' }));
          }
        });
      });

      // Handle HTTPS CONNECT tunnels
      this.server.on('connect', (req, clientSocket, head) => {
        this.handleConnectTunnel(req, clientSocket as net.Socket, head).catch((err) => {
          this.logger.error('Unhandled error in CONNECT tunnel handler', err.stack);
          clientSocket.destroy();
        });
      });

      this.server.on('error', (err) => {
        this.logger.error(`Proxy server error on port ${this.proxyPort}`, err.stack);
        reject(err);
      });

      this.server.listen(this.proxyPort, () => {
        this.logger.log(`Scope Guard Egress Proxy listening on port ${this.proxyPort}`);
        resolve();
      });
    });
  }

  stopServer(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.logger.log('Scope Guard Egress Proxy server stopped');
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Handles HTTPS CONNECT tunnel requests.
   */
  private async handleConnectTunnel(
    req: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer,
  ): Promise<void> {
    const startTime = Date.now();
    const requestId = `req_${crypto.randomUUID()}`;
    const rawTarget = req.url || '';

    // 1. Worker Auth
    const workerToken = this.proxyService.extractWorkerToken(req);
    if (!workerToken) {
      clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
      clientSocket.end();
      return;
    }

    const secretHash = this.cryptoService.hashToken(workerToken);
    const workerAuth = await this.policyRepository.findByWorkerSecretHash(secretHash);
    if (!workerAuth) {
      clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
      clientSocket.end();
      return;
    }

    // 2. Parse Host and Port
    const parts = rawTarget.split(':');
    const rawHost = parts[0] || '';
    const port = parseInt(parts[1] || '443', 10);

    let destinationHost: string;
    try {
      destinationHost = TargetNormalizer.parseTarget(TargetNormalizer.normalize(rawHost)).host;
    } catch {
      clientSocket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      clientSocket.end();
      return;
    }

    const targetDestination = `${destinationHost}:${port}`;

    // 3. Evaluate Policy (Host + Port validation)
    const evaluation = this.policyEvaluator.evaluate(
      targetDestination,
      workerAuth.status,
      workerAuth.targets,
    );

    if (evaluation.decision === 'DENY') {
      try {
        await this.auditRepository.recordDecisionWithOutbox({
          tenantId: workerAuth.tenantId,
          engagementId: workerAuth.engagementId,
          requestId,
          method: 'CONNECT',
          target: targetDestination,
          decision: 'DENY',
          reason: evaluation.reason,
        });
      } catch {
        // Non-blocking fallback for pre-evaluation rejection logging
      }

      clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      clientSocket.end();
      return;
    }

    // 4. Pre-Forward Audit Persistence (Fail Closed)
    let auditRecordId: string;
    try {
      const recorded = await this.auditRepository.recordDecisionWithOutbox({
        tenantId: workerAuth.tenantId,
        engagementId: workerAuth.engagementId,
        requestId,
        method: 'CONNECT',
        target: targetDestination,
        decision: 'ALLOW',
        reason: evaluation.reason,
      });
      auditRecordId = recorded.auditRecordId;
    } catch {
      clientSocket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      clientSocket.end();
      return;
    }

    // 5. SSRF Check
    let resolvedIp: string;
    try {
      const dnsResult = await dns.lookup(destinationHost);
      resolvedIp = dnsResult.address;
    } catch {
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      clientSocket.end();
      return;
    }

    if (!SsrfFilter.isSafeDestinationIp(resolvedIp, this.allowLocalMockTargets)) {
      clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      clientSocket.end();
      return;
    }

    // 6. Establish TCP Tunnel
    const targetSocket = net.connect(port, resolvedIp, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) {
        targetSocket.write(head);
      }
      clientSocket.pipe(targetSocket);
      targetSocket.pipe(clientSocket);

      this.auditRepository
        .updateUpstreamOutcome(auditRecordId, 200, 'TUNNEL_ESTABLISHED', Date.now() - startTime)
        .catch(() => {});
    });

    targetSocket.on('error', () => {
      clientSocket.write('HTTP/1.1 504 Gateway Timeout\r\n\r\n');
      clientSocket.end();
    });

    clientSocket.on('error', () => {
      targetSocket.destroy();
    });
  }
}
