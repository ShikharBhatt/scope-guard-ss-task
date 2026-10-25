import { TokenBucketRateLimiter } from './rate-limiter.service';

describe('TokenBucketRateLimiter', () => {
  let limiter: TokenBucketRateLimiter;

  beforeEach(() => {
    limiter = new TokenBucketRateLimiter();
  });

  it('should allow initial requests within burst capacity', () => {
    const config = { capacity: 3, refillRatePerSecond: 1 };

    expect(limiter.consume('eng_1', 'api.test.com', config).allowed).toBe(true);
    expect(limiter.consume('eng_1', 'api.test.com', config).allowed).toBe(true);
    expect(limiter.consume('eng_1', 'api.test.com', config).allowed).toBe(true);

    // 4th request exceeds burst capacity
    const exceeded = limiter.consume('eng_1', 'api.test.com', config);
    expect(exceeded.allowed).toBe(false);
    expect(exceeded.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('should maintain independent buckets for different targets of the same engagement', () => {
    const config = { capacity: 1, refillRatePerSecond: 1 };

    // Consume target A
    expect(limiter.consume('eng_1', 'target-a.com', config).allowed).toBe(true);
    expect(limiter.consume('eng_1', 'target-a.com', config).allowed).toBe(false);

    // Target B should still have full allowance
    expect(limiter.consume('eng_1', 'target-b.com', config).allowed).toBe(true);
  });

  it('should maintain independent buckets for different engagements targeting the same host', () => {
    const config = { capacity: 1, refillRatePerSecond: 1 };

    // Consume engagement 1
    expect(limiter.consume('eng_1', 'shared.com', config).allowed).toBe(true);
    expect(limiter.consume('eng_1', 'shared.com', config).allowed).toBe(false);

    // Engagement 2 should still have its full allowance
    expect(limiter.consume('eng_2', 'shared.com', config).allowed).toBe(true);
  });
});

