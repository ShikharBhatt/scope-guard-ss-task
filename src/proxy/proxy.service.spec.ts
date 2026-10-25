import { ProxyService } from './proxy.service';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { CryptoService } from '../identity/crypto.service';
import { PolicyRepository } from '../policy/policy.repository';
import { PolicyEvaluatorService } from '../policy/policy-evaluator.service';
import { AuditRepository } from '../audit/audit.repository';
import { IncomingMessage, ServerResponse } from 'http';

import { TokenBucketRateLimiter } from './rate-limiter.service';

describe('ProxyService', () => {
  let service: ProxyService;
  let mockConfigService: Partial<ConfigService<AppConfig, true>>;
  let cryptoService: CryptoService;
  let mockPolicyRepo: Partial<PolicyRepository>;
  let policyEvaluator: PolicyEvaluatorService;
  let mockAuditRepo: Partial<AuditRepository>;
  let rateLimiter: TokenBucketRateLimiter;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn().mockReturnValue(false), // allowLocalMockTargets = false (production mode)
    };
    cryptoService = new CryptoService();
    mockPolicyRepo = {
      findByWorkerSecretHash: jest.fn(),
    };
    policyEvaluator = new PolicyEvaluatorService();
    mockAuditRepo = {
      recordDecisionWithOutbox: jest.fn(),
      updateUpstreamOutcome: jest.fn(),
    };
    rateLimiter = new TokenBucketRateLimiter();

    service = new ProxyService(
      mockConfigService as unknown as ConfigService<AppConfig, true>,
      cryptoService,
      mockPolicyRepo as PolicyRepository,
      policyEvaluator,
      mockAuditRepo as AuditRepository,
      rateLimiter,
    );
  });

  function createMockHttp(
    headers: Record<string, string>,
    url: string = 'http://app.example.com/test',
    method: string = 'GET',
  ) {
    const req = {
      headers,
      url,
      method,
      pipe: jest.fn(),
    } as unknown as IncomingMessage;

    const res = {
      writeHead: jest.fn(),
      end: jest.fn(),
      headersSent: false,
    } as unknown as ServerResponse;

    return { req, res };
  }

  it('should return 407 when worker token is missing', async () => {
    const { req, res } = createMockHttp({});
    await service.handleProxyRequest(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(407, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith(expect.stringContaining('Proxy authentication required'));
  });

  it('should return 407 when worker credential is unknown or invalid', async () => {
    (mockPolicyRepo.findByWorkerSecretHash as jest.Mock).mockResolvedValue(null);

    const { req, res } = createMockHttp({
      'proxy-authorization': 'Bearer sg_worker_invalid',
    });
    await service.handleProxyRequest(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(407, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith(expect.stringContaining('Invalid or unknown'));
  });

  it('should return 403 when destination is out of scope', async () => {
    (mockPolicyRepo.findByWorkerSecretHash as jest.Mock).mockResolvedValue({
      engagementId: 'eng_1',
      tenantId: 'tenant_1',
      status: 'ACTIVE',
      targets: [{ normalizedTarget: 'allowed.example.com', effect: 'ALLOW' }],
    });

    const { req, res } = createMockHttp(
      { 'proxy-authorization': 'Bearer sg_worker_valid' },
      'http://forbidden.example.com/api',
    );

    await service.handleProxyRequest(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith(expect.stringContaining('NO_ALLOW_RULE'));
    expect(mockAuditRepo.recordDecisionWithOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'DENY',
        reason: 'NO_ALLOW_RULE',
      }),
    );
  });

  it('should fail closed with 503 if database fails to persist audit before forwarding allowed request', async () => {
    (mockPolicyRepo.findByWorkerSecretHash as jest.Mock).mockResolvedValue({
      engagementId: 'eng_1',
      tenantId: 'tenant_1',
      status: 'ACTIVE',
      targets: [{ normalizedTarget: 'allowed.example.com', effect: 'ALLOW' }],
    });

    // Simulate database crash during atomic audit & outbox commit
    (mockAuditRepo.recordDecisionWithOutbox as jest.Mock).mockRejectedValue(
      new Error('PostgreSQL connection terminated'),
    );

    const { req, res } = createMockHttp(
      { 'proxy-authorization': 'Bearer sg_worker_valid' },
      'http://allowed.example.com/api',
    );

    await service.handleProxyRequest(req, res);

    // Verifies FAIL-CLOSED: Request must NOT be forwarded!
    expect(res.writeHead).toHaveBeenCalledWith(503, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith(expect.stringContaining('AUDIT_PERSISTENCE_FAILED'));
  });
});
