import { PrismaClient } from '@prisma/client';
import { CryptoService } from '../identity/crypto.service';
import { TenantRepository } from '../identity/tenant.repository';
import { Logger } from '@nestjs/common';

// Tenant Alpha (Primary Demo Tenant)
export const DEMO_TENANT_ID = 'tenant_demo_01';
export const DEMO_TENANT_NAME = 'Acme Corp Pentesting (Tenant Alpha)';
export const DEMO_API_KEY_ID = 'key_demo_01';
export const DEMO_API_KEY_PLAIN = 'sg_tenant_demo_secret_key_12345';

// Tenant Beta (Secondary Demo Tenant for Cross-Tenant Isolation Testing)
export const DEMO_TENANT_B_ID = 'tenant_demo_02';
export const DEMO_TENANT_B_NAME = 'Cyberdyne Security (Tenant Beta)';
export const DEMO_API_KEY_B_ID = 'key_demo_02';
export const DEMO_API_KEY_B_PLAIN = 'sg_tenant_beta_secret_key_67890';

async function seed() {
  const logger = new Logger('DatabaseSeed');
  logger.warn('WARNING: Running development seed. This must NOT be run in production.');

  const prisma = new PrismaClient();

  try {
    const cryptoService = new CryptoService();
    const tenantRepo = new TenantRepository(prisma as any);

    // 1. Seed Tenant Alpha
    await tenantRepo.upsertTenant(DEMO_TENANT_ID, DEMO_TENANT_NAME);
    const keyHashA = cryptoService.hashToken(DEMO_API_KEY_PLAIN);
    await tenantRepo.createApiKey(DEMO_API_KEY_ID, DEMO_TENANT_ID, 'Tenant Alpha Primary Key', keyHashA);

    logger.log(`Tenant Alpha seeded: ${DEMO_TENANT_ID} (${DEMO_TENANT_NAME})`);
    logger.log(`Tenant Alpha API Key: ${DEMO_API_KEY_PLAIN}`);

    // 2. Seed Tenant Beta (for multi-tenant isolation verification)
    await tenantRepo.upsertTenant(DEMO_TENANT_B_ID, DEMO_TENANT_B_NAME);
    const keyHashB = cryptoService.hashToken(DEMO_API_KEY_B_PLAIN);
    await tenantRepo.createApiKey(DEMO_API_KEY_B_ID, DEMO_TENANT_B_ID, 'Tenant Beta Primary Key', keyHashB);

    logger.log(`Tenant Beta seeded:  ${DEMO_TENANT_B_ID} (${DEMO_TENANT_B_NAME})`);
    logger.log(`Tenant Beta API Key:  ${DEMO_API_KEY_B_PLAIN}`);

    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    logger.error('Failed to seed database:', (err as Error).stack);
    await prisma.$disconnect();
    process.exit(1);
  }
}

if (require.main === module) {
  seed();
}
