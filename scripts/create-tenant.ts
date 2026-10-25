import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

async function main() {
  const args = process.argv.slice(2);
  const tenantName = args[0] || 'Acme Pentesting Partner';
  const tenantId = args[1] || `tenant_${crypto.randomUUID().slice(0, 8)}`;
  const rawApiKey = args[2] || `sg_tenant_${crypto.randomBytes(16).toString('hex')}`;

  const prisma = new PrismaClient();
  try {
    const keyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');
    const keyId = `key_${crypto.randomUUID().slice(0, 8)}`;

    await prisma.tenant.upsert({
      where: { id: tenantId },
      update: { name: tenantName },
      create: { id: tenantId, name: tenantName },
    });

    await prisma.tenantApiKey.upsert({
      where: { keyHash },
      update: {},
      create: {
        id: keyId,
        tenantId,
        name: `${tenantName} Primary Key`,
        keyHash,
      },
    });

    console.log('\n============================================================');
    console.log('            TENANT SUCCESSFULLY PROVISIONED                 ');
    console.log('============================================================');
    console.log(`Tenant ID:     ${tenantId}`);
    console.log(`Tenant Name:   ${tenantName}`);
    console.log(`API Key (RAW): ${rawApiKey}`);
    console.log(`Key Hash:      ${keyHash}`);
    console.log('============================================================');
    console.log('NOTE: Save this API Key now. Scope Guard only stores the SHA-256');
    console.log('hash at rest. The plaintext key cannot be recovered.\n');
    console.log('Usage Example:');
    console.log(`curl http://localhost:3000/api/v1/engagements \\`);
    console.log(`  -H "Authorization: Bearer ${rawApiKey}"\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Failed to create tenant:', err);
  process.exit(1);
});

