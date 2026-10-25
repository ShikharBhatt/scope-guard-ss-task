import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { TENANT_TOKEN_PREFIX, WORKER_TOKEN_PREFIX } from './identity.constants';

@Injectable()
export class CryptoService {
  /**
   * Generates a high-entropy bearer token for a worker engagement (256 bits of entropy).
   */
  generateWorkerToken(): string {
    const randomHex = crypto.randomBytes(32).toString('hex');
    return `${WORKER_TOKEN_PREFIX}${randomHex}`;
  }

  /**
   * Generates a high-entropy API key for a tenant.
   */
  generateTenantApiKey(): string {
    const randomHex = crypto.randomBytes(32).toString('hex');
    return `${TENANT_TOKEN_PREFIX}${randomHex}`;
  }

  /**
   * Computes a SHA-256 digest of the secret token.
   */
  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
  }

  /**
   * Performs timing-safe comparison of two hash strings to prevent timing attacks.
   */
  timingSafeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');

    if (bufA.length !== bufB.length) {
      return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
  }
}

