import * as http from 'http';
import { AddressInfo } from 'net';
import { PassThrough } from 'stream';
import { ProxyService } from '../src/proxy/proxy.service';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../src/config/configuration';
import { CryptoService } from '../src/identity/crypto.service';
import { PolicyRepository } from '../src/policy/policy.repository';
import { PolicyEvaluatorService } from '../src/policy/policy-evaluator.service';
import { AuditRepository } from '../src/audit/audit.repository';
import { TokenBucketRateLimiter } from '../src/proxy/rate-limiter.service';

describe('Egress Proxy End-to-End with Local Mock Target', () => {
  let mockServer: http.Server;
  let mockPort: number;
  let mockReceivedCount = 0;
  let lastReceivedUrl = '';

  let proxyService: ProxyService;
  let mockPolicyRepo: Partial<PolicyRepository>;
  let mockAuditRepo: Partial<AuditRepository>;

  const workerSecret = 'sg_worker_e2e_secret_token_123456';
  const cryptoService = new CryptoService();
  const workerHash = cryptoService.hashToken(workerSecret);

  beforeAll(async () => {
    // Start local mock HTTP destination
    await new Promise<void>((resolve) => {
      mockServer = http.createServer((req, res) => {
        mockReceivedCount++;
        lastReceivedUrl = req.url || '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', mockReceived: true }));
      });
      mockServer.listen(0, '127.0.0.1', () => {
        mockPort = (mockServer.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      mockServer.close(() => resolve());
    });
  });

  beforeEach(() => {
    mockReceivedCount = 0;
    lastReceivedUrl = '';

    mockPolicyRepo = {
      findByWorkerSecretHash: jest.fn().mockImplementation((hash: string) => {
        if (hash === workerHash) {
          return Promise.resolve({
            engagementId: 'eng_e2e_01',
            tenantId: 'tenant_e2e_01',
            status: 'ACTIVE',
            targets: [
              { normalizedTarget: `127.0.0.1:${mockPort}`, effect: 'ALLOW' },
              { normalizedTarget: 'denied.target.local', effect: 'DENY' },
            ],
          });
        }
        return Promise.resolve(null);
      }),
    };

    mockAuditRepo = {
      recordDecisionWithOutbox: jest.fn().mockResolvedValue({
        auditRecordId: 'rec_e2e_01',
        eventId: 'evt_e2e_01',
      }),
      updateUpstreamOutcome: jest.fn().mockResolvedValue(undefined),
    };

    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'app.allowLocalMockTargets') return true; // permit local mock target
        return undefined;
      }),
    };

    proxyService = new ProxyService(
      mockConfigService as unknown as ConfigService<AppConfig, true>,
      cryptoService,
      mockPolicyRepo as PolicyRepository,
      new PolicyEvaluatorService(),
      mockAuditRepo as AuditRepository,
      new TokenBucketRateLimiter(),
    );
  });

  function createMockHttpRequest(
    url: string,
    headers: Record<string, string> = {
      'proxy-authorization': `Bearer ${workerSecret}`,
    },
  ) {
    const req = new PassThrough() as any;
    req.headers = headers;
    req.url = url;
    req.method = 'GET';
    req.end();

    const res = new PassThrough() as any;
    let statusCode = 200;
    let body = '';

    res.writeHead = jest.fn().mockImplementation((code: number) => {
      statusCode = code;
      res.headersSent = true;
      return res;
    });

    res.on('data', (chunk: any) => {
      body += chunk.toString();
    });

    return {
      req,
      res,
      getStatus: () => statusCode,
      getBody: () => body,
    };
  }

  it('proves allowed requests arrive at local mock target and pre-forward audit is recorded', async () => {
    const { req, res } = createMockHttpRequest(
      `http://127.0.0.1:${mockPort}/pentest/login`,
    );

    await proxyService.handleProxyRequest(req, res);

    expect(mockAuditRepo.recordDecisionWithOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'ALLOW',
        reason: 'IN_SCOPE',
        target: `127.0.0.1:${mockPort}`,
      }),
    );
    expect(mockReceivedCount).toBe(1);
    expect(lastReceivedUrl).toBe('/pentest/login');
  });

  it('proves out-of-scope requests do NOT reach mock target', async () => {
    const { req, res, getStatus } = createMockHttpRequest(
      `http://unauthorized.local:${mockPort}/login`,
    );

    await proxyService.handleProxyRequest(req, res);

    expect(getStatus()).toBe(403);
    expect(mockReceivedCount).toBe(0); // Mock target was NOT reached
    expect(mockAuditRepo.recordDecisionWithOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'DENY',
        reason: 'NO_ALLOW_RULE',
      }),
    );
  });

  it('proves denied targets do NOT reach mock target and DENY takes precedence', async () => {
    const { req, res, getStatus } = createMockHttpRequest(
      `http://denied.target.local:${mockPort}/admin`,
    );

    await proxyService.handleProxyRequest(req, res);

    expect(getStatus()).toBe(403);
    expect(mockReceivedCount).toBe(0);
    expect(mockAuditRepo.recordDecisionWithOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'DENY',
        reason: 'DENY_RULE_MATCHED',
      }),
    );
  });

  it('proves revoked engagement rejects subsequent requests immediately without reaching target', async () => {
    (mockPolicyRepo.findByWorkerSecretHash as jest.Mock).mockResolvedValueOnce({
      engagementId: 'eng_e2e_01',
      tenantId: 'tenant_e2e_01',
      status: 'REVOKED', // Revocation committed
      targets: [{ normalizedTarget: '127.0.0.1', effect: 'ALLOW' }],
    });

    const { req, res, getStatus } = createMockHttpRequest(`http://127.0.0.1:${mockPort}/login`);

    await proxyService.handleProxyRequest(req, res);

    expect(getStatus()).toBe(403);
    expect(mockReceivedCount).toBe(0);
    expect(mockAuditRepo.recordDecisionWithOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'DENY',
        reason: 'ENGAGEMENT_REVOKED',
      }),
    );
  });

  it('proves fail-closed behavior when database / audit persistence fails before forwarding', async () => {
    (mockAuditRepo.recordDecisionWithOutbox as jest.Mock).mockRejectedValueOnce(
      new Error('Database unavailable'),
    );

    const { req, res, getStatus } = createMockHttpRequest(`http://127.0.0.1:${mockPort}/test`);

    await proxyService.handleProxyRequest(req, res);

    expect(getStatus()).toBe(503);
    expect(mockReceivedCount).toBe(0); // Destination was NOT contacted!
  });
});
