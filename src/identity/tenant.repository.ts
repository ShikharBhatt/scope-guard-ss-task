import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AuthenticatedTenant } from './identity.constants';

@Injectable()
export class TenantRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves an active tenant by the SHA-256 hash of their API key using Prisma.
   */
  async findActiveTenantByKeyHash(keyHash: string): Promise<AuthenticatedTenant | null> {
    const apiKey = await this.prisma.tenantApiKey.findFirst({
      where: {
        keyHash,
        revokedAt: null,
      },
      include: {
        tenant: true,
      },
    });

    if (!apiKey || !apiKey.tenant) {
      return null;
    }

    return {
      id: apiKey.tenant.id,
      name: apiKey.tenant.name,
      apiKeyId: apiKey.id,
    };
  }

  /**
   * Idempotently creates or updates a tenant (used for dev seeding & tests).
   */
  async upsertTenant(id: string, name: string): Promise<void> {
    await this.prisma.tenant.upsert({
      where: { id },
      update: { name },
      create: { id, name },
    });
  }

  /**
   * Inserts an API key for a tenant.
   */
  async createApiKey(id: string, tenantId: string, name: string, keyHash: string): Promise<void> {
    await this.prisma.tenantApiKey.upsert({
      where: { keyHash },
      update: {},
      create: {
        id,
        tenantId,
        name,
        keyHash,
      },
    });
  }
}
