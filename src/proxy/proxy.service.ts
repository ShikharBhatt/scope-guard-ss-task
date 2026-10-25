import { Injectable, Logger } from '@nestjs/common';
import { IncomingMessage, ServerResponse } from 'http';
import * as http from 'http';
import * as https from 'https';
import * as dns from 'dns/promises';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { CryptoService } from '../identity/crypto.service';
import { PolicyRepository } from '../policy/policy.repository';
import { PolicyEvaluatorService } from '../policy/policy-evaluator.service';
import { AuditRepository } from '../audit/audit.repository';
import { TargetNormalizer } from '../policy/target-normalizer';
import { SsrfFilter } from './ssrf-filter';
import { TokenBucketRateLimiter } from './rate-limiter.service';

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);
  private readonly allowLocalMockTargets: boolean;

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly cryptoService: CryptoService,
    private readonly policyRepository: PolicyRepository,
    private readonly policyEvaluator: PolicyEvaluatorService,
    private readonly auditRepository: AuditRepository,
    private readonly rateLimiter: TokenBucketRateLimiter,
  ) {
    this.allowLocalMockTargets =
      this.configService.get('app.allowLocalMockTargets', { infer: true }) ?? false;
  }

  /**
   * Extracts the worker bearer token from Proxy-Authorization or Authorization header.
   */
  extractWorkerToken(req: IncomingMessage): string | null {
    const header = req.headers['proxy-authorization'] || req.headers['authorization'];
    if (!header || typeof header !== 'string') {
      return null;
    }

    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return null;
    }

    return token.trim();
  }

  /**
   * Main forward proxy request processor.
   */
  async handleProxyRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const startTime = Date.now();
    const requestId =
      (req.headers['x-request-id'] as string) || `req_${crypto.randomUUID()}`;
    const method = req.method || 'GET';
    const rawUrl = req.url || '';

    // 1. Worker Authentication
    const workerToken = this.extractWorkerToken(req);
    if (!workerToken) {
      res.writeHead(407, {
        'Content-Type': 'application/json',
        'Proxy-Authenticate': 'Bearer error="missing_token"',
      });
      res.end(
        JSON.stringify({
          error: 'Proxy authentication required. Provide Bearer token in Proxy-Authorization header.',
        }),
      );
      return;
    }

    const secretHash = this.cryptoService.hashToken(workerToken);
    let workerAuth;
    try {
      workerAuth = await this.policyRepository.findByWorkerSecretHash(secretHash);
    } catch (dbErr) {
      this.logger.error('Database failure during worker lookup', (dbErr as Error).stack);
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Security boundary unavailable (policy store error)',
          reason: 'POLICY_UNAVAILABLE',
        }),
      );
      return;
    }

    if (!workerAuth) {
      res.writeHead(407, {
        'Content-Type': 'application/json',
        'Proxy-Authenticate': 'Bearer error="invalid_token"',
      });
      res.end(JSON.stringify({ error: 'Invalid or unknown worker credentials' }));
      return;
    }

    // 2. Parse & Normalize Destination (Host and Port)
    let targetHost: string;
    let targetPort: number;
    let targetDestination: string;
    let parsedUrl: URL;
    try {
      // Forward proxy requests usually supply absolute URI: "GET http://target/path HTTP/1.1"
      if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
        parsedUrl = new URL(rawUrl);
      } else {
        const hostHeader = req.headers.host || '';
        parsedUrl = new URL(`http://${hostHeader}${rawUrl}`);
      }
      targetPort = parsedUrl.port
        ? parseInt(parsedUrl.port, 10)
        : parsedUrl.protocol === 'https:'
          ? 443
          : 80;
      targetHost = TargetNormalizer.parseTarget(
        TargetNormalizer.normalize(parsedUrl.hostname),
      ).host;
      targetDestination = `${targetHost}:${targetPort}`;
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Invalid or unsupported target URL',
          reason: 'INVALID_TARGET',
        }),
      );
      return;
    }

    // 3. Evaluate Current Committed Policy (Host + Port validation)
    const evaluation = this.policyEvaluator.evaluate(
      targetDestination,
      workerAuth.status,
      workerAuth.targets,
    );

    // 4. Handle Policy Denial
    if (evaluation.decision === 'DENY') {
      try {
        await this.auditRepository.recordDecisionWithOutbox({
          tenantId: workerAuth.tenantId,
          engagementId: workerAuth.engagementId,
          requestId,
          method,
          target: targetDestination,
          decision: 'DENY',
          reason: evaluation.reason,
        });
      } catch (auditErr) {
        this.logger.warn(
          `Unable to record denial audit record due to database failure: ${(auditErr as Error).message}`,
        );
      }

      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Request denied by Scope Guard policy',
          decision: 'DENY',
          reason: evaluation.reason,
          target: targetDestination,
        }),
      );
      return;
    }

    // 5. Rate Limiting Check (Evaluated only after scope authorization)
    const rateLimit = this.rateLimiter.consume(workerAuth.engagementId, targetDestination);
    if (!rateLimit.allowed) {
      try {
        await this.auditRepository.recordDecisionWithOutbox({
          tenantId: workerAuth.tenantId,
          engagementId: workerAuth.engagementId,
          requestId,
          method,
          target: targetHost,
          decision: 'DENY',
          reason: 'RATE_LIMIT_EXCEEDED',
        });
      } catch {
        // Non-blocking fallback for rate limit rejection logging
      }

      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': String(rateLimit.retryAfterSeconds || 1),
      });
      res.end(
        JSON.stringify({
          error: 'Rate limit exceeded for target',
          decision: 'DENY',
          reason: 'RATE_LIMIT_EXCEEDED',
          target: targetHost,
          retryAfter: rateLimit.retryAfterSeconds,
        }),
      );
      return;
    }

    // 6. Pre-Forward Durable Audit (Fail Closed Guarantee)
    let auditRecordId: string;
    try {
      const recorded = await this.auditRepository.recordDecisionWithOutbox({
        tenantId: workerAuth.tenantId,
        engagementId: workerAuth.engagementId,
        requestId,
        method,
        target: targetDestination,
        decision: 'ALLOW',
        reason: evaluation.reason,
      });
      auditRecordId = recorded.auditRecordId;
    } catch (auditFailure) {
      this.logger.error(
        'Critical failure: unable to durably persist authorization decision before forward. Failing closed.',
        (auditFailure as Error).stack,
      );
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Security policy failed to commit audit record before forwarding. Request rejected.',
          reason: 'AUDIT_PERSISTENCE_FAILED',
        }),
      );
      return;
    }

    // 6. SSRF Protection & IP Resolution
    let resolvedIp: string;
    try {
      const dnsResult = await dns.lookup(parsedUrl.hostname);
      resolvedIp = dnsResult.address;
    } catch (dnsErr) {
      await this.auditRepository.updateUpstreamOutcome(
        auditRecordId,
        null,
        'DNS_RESOLUTION_FAILED',
        Date.now() - startTime,
      );
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `DNS lookup failed for ${parsedUrl.hostname}` }));
      return;
    }

    if (!SsrfFilter.isSafeDestinationIp(resolvedIp, this.allowLocalMockTargets)) {
      this.logger.warn(`SSRF Block: Denied connection to prohibited IP ${resolvedIp}`);
      await this.auditRepository.updateUpstreamOutcome(
        auditRecordId,
        403,
        'SSRF_BLOCKED',
        Date.now() - startTime,
      );
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Connection to private, loopback, or metadata address is prohibited',
          reason: 'SSRF_BLOCKED',
        }),
      );
      return;
    }

    // 7. Forward Request Upstream
    const upstreamProtocol = parsedUrl.protocol === 'https:' ? https : http;
    const upstreamPort =
      parsedUrl.port ? parseInt(parsedUrl.port, 10) : parsedUrl.protocol === 'https:' ? 443 : 80;

    // Filter hop-by-hop headers
    const forwardedHeaders = { ...req.headers };
    delete forwardedHeaders['proxy-authorization'];
    delete forwardedHeaders['proxy-connection'];
    forwardedHeaders.host = parsedUrl.host;

    const requestOptions: http.RequestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: upstreamPort,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: req.method,
      headers: forwardedHeaders,
      timeout: 15000,
    };

    return new Promise<void>((resolve) => {
      const upstreamReq = upstreamProtocol.request(requestOptions, (upstreamRes) => {
        const durationMs = Date.now() - startTime;
        const upstreamStatus = upstreamRes.statusCode ?? 502;

        // Update audit record with upstream outcome
        this.auditRepository
          .updateUpstreamOutcome(auditRecordId, upstreamStatus, 'UPSTREAM_SUCCESS', durationMs)
          .catch((err) => {
            this.logger.error('Failed to update audit upstream outcome', err.stack);
          });

        // Stream upstream response back to client (including 3xx redirects without auto-following)
        res.writeHead(upstreamStatus, upstreamRes.headers);
        upstreamRes.pipe(res);
        upstreamRes.on('end', () => resolve());
      });

      upstreamReq.on('timeout', () => {
        upstreamReq.destroy(new Error('Upstream connection timed out'));
      });

      upstreamReq.on('error', (err) => {
        const durationMs = Date.now() - startTime;
        this.logger.warn(`Upstream error for ${targetHost}: ${err.message}`);

        this.auditRepository
          .updateUpstreamOutcome(auditRecordId, 504, 'UPSTREAM_ERROR', durationMs)
          .catch(() => {});

        if (!res.headersSent) {
          res.writeHead(504, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Gateway timeout or upstream connection failed' }));
        }
        resolve();
      });

      // Pipe client request body to upstream
      req.pipe(upstreamReq);
    });
  }
}
