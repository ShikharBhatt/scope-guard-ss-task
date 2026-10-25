import { Injectable } from '@nestjs/common';

export interface TokenBucketConfig {
  capacity: number; // Maximum burst tokens
  refillRatePerSecond: number; // Sustained tokens added per second
}

interface BucketState {
  tokens: number;
  lastRefillTimestamp: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  remainingTokens: number;
}

@Injectable()
export class TokenBucketRateLimiter {
  private readonly buckets = new Map<string, BucketState>();
  private readonly defaultCapacity = 10;
  private readonly defaultRefillRate = 2; // 2 requests per second sustained

  /**
   * Evaluates and consumes 1 token for the bucket keyed by (engagementId, normalizedTarget).
   * Scope authorization must occur before calling this method.
   */
  consume(
    engagementId: string,
    normalizedTarget: string,
    config?: Partial<TokenBucketConfig>,
  ): RateLimitResult {
    const capacity = config?.capacity ?? this.defaultCapacity;
    const refillRate = config?.refillRatePerSecond ?? this.defaultRefillRate;

    const key = `${engagementId}:${normalizedTarget}`;
    const now = Date.now();

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        tokens: capacity,
        lastRefillTimestamp: now,
      };
      this.buckets.set(key, bucket);
    } else {
      // Refill tokens based on elapsed time
      const elapsedSeconds = (now - bucket.lastRefillTimestamp) / 1000;
      const refilledTokens = elapsedSeconds * refillRate;
      bucket.tokens = Math.min(capacity, bucket.tokens + refilledTokens);
      bucket.lastRefillTimestamp = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return {
        allowed: true,
        remainingTokens: Math.floor(bucket.tokens),
      };
    }

    // Rate limited
    const missingTokens = 1 - bucket.tokens;
    const retryAfterSeconds = Math.ceil(missingTokens / refillRate);

    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, retryAfterSeconds),
      remainingTokens: 0,
    };
  }

  /**
   * Resets all in-memory buckets (useful for testing).
   */
  reset(): void {
    this.buckets.clear();
  }
}

