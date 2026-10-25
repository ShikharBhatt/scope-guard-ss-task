import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  let service: CryptoService;

  beforeEach(() => {
    service = new CryptoService();
  });

  it('should generate high-entropy worker tokens with prefix', () => {
    const token1 = service.generateWorkerToken();
    const token2 = service.generateWorkerToken();

    expect(token1.startsWith('sg_worker_')).toBe(true);
    expect(token2.startsWith('sg_worker_')).toBe(true);
    expect(token1).not.toBe(token2);
    // Prefix 'sg_worker_' (10 chars) + 64 hex chars (32 bytes) = 74 chars
    expect(token1.length).toBe(74);
  });

  it('should generate high-entropy tenant API keys with prefix', () => {
    const key = service.generateTenantApiKey();

    expect(key.startsWith('sg_tenant_')).toBe(true);
    expect(key.length).toBe(74);
  });

  it('should compute deterministic SHA-256 hash', () => {
    const testSecret = 'sg_worker_0123456789abcdef';
    const hash1 = service.hashToken(testSecret);
    const hash2 = service.hashToken(testSecret);

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64); // 256 bits = 64 hex chars
  });

  it('should perform timing-safe equal comparison', () => {
    const hashA = service.hashToken('tokenA');
    const hashB = service.hashToken('tokenB');
    const hashACopy = service.hashToken('tokenA');

    expect(service.timingSafeEqual(hashA, hashACopy)).toBe(true);
    expect(service.timingSafeEqual(hashA, hashB)).toBe(false);
    expect(service.timingSafeEqual(hashA, 'short')).toBe(false);
  });
});

