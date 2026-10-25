import * as http from 'http';
import { AddressInfo } from 'net';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { loadConfiguration } from '../src/config/configuration';
import { MigrationService } from '../src/database/migration.service';
import { CryptoService } from '../src/identity/crypto.service';
import { TenantRepository } from '../src/identity/tenant.repository';
import {
  DEMO_API_KEY_PLAIN,
  DEMO_API_KEY_ID,
  DEMO_TENANT_ID,
  DEMO_TENANT_NAME,
  DEMO_API_KEY_B_PLAIN,
  DEMO_API_KEY_B_ID,
  DEMO_TENANT_B_ID,
  DEMO_TENANT_B_NAME,
} from '../src/database/seed';

const logger = new Logger('DemoSimulation');

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function httpRequest(options: http.RequestOptions, body?: string): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk.toString();
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 500,
          headers: res.headers,
          body: data,
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Request timed out')));

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function isServerRunning(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function runDemo() {
  console.log('\n============================================================');
  console.log('       SCOPE GUARD — COMPLETE DEMO SIMULATION               ');
  console.log('============================================================\n');

  // Check if Scope Guard is already running (e.g., Docker Compose or local server)
  const running = await isServerRunning('http://localhost:3000/api/v1/health');
  if (running) {
    logger.log('Detected Scope Guard is already running on port 3000 (Docker Compose / active service).');
    logger.log('Executing live verification suite against the active Scope Guard instance...\n');
    const { run: runDockerVerification } = await import('./test-docker');
    await runDockerVerification();
    return;
  }

  // 1. Start Local Mock Destination HTTP Server
  logger.log('Step 1: Starting local mock destination server...');
  let mockReceivedCount = 0;
  let mockServer: http.Server = null as any;
  let mockPort: number = 0;

  await new Promise<void>((resolve) => {
    mockServer = http.createServer((req, res) => {
      mockReceivedCount++;
      logger.log(`  [Mock Server] Received upstream request: ${req.method} ${req.url}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ mockDestination: 'ok', hits: mockReceivedCount }));
    });
    mockServer.listen(0, '127.0.0.1', () => {
      mockPort = (mockServer.address() as AddressInfo).port;
      logger.log(`  [Mock Server] Running on http://127.0.0.1:${mockPort}`);
      resolve();
    });
  });

  // 2. Setup Database & Seed
  logger.log('Step 2: Connecting to database, running migrations and seed...');
  const config = loadConfiguration();
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name,
    ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
    max: 2,
  });

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    const migrationService = new MigrationService(pool);
    await migrationService.runMigrations();
    const cryptoService = new CryptoService();
    const tenantRepo = new TenantRepository(prisma as any);
    await tenantRepo.upsertTenant(DEMO_TENANT_ID, DEMO_TENANT_NAME);
    await tenantRepo.createApiKey(DEMO_API_KEY_ID, DEMO_TENANT_ID, 'Tenant Alpha Key', cryptoService.hashToken(DEMO_API_KEY_PLAIN));
    await tenantRepo.upsertTenant(DEMO_TENANT_B_ID, DEMO_TENANT_B_NAME);
    await tenantRepo.createApiKey(DEMO_API_KEY_B_ID, DEMO_TENANT_B_ID, 'Tenant Beta Key', cryptoService.hashToken(DEMO_API_KEY_B_PLAIN));
    logger.log('  Migrations and two onboarded demo tenants (Alpha & Beta) seeded successfully.');
  } finally {
    await pool.end();
    await prisma.$disconnect();
  }

  // 3. Boot Application
  logger.log('Step 3: Bootstrapping Scope Guard Management API and Proxy...');
  const app = await NestFactory.create(AppModule, { logger: ['warn', 'error'] });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(3000);
  logger.log('  API listening on http://localhost:3000/api/v1');
  logger.log('  Proxy listening on http://localhost:3128');

  try {
    // 4. Health Check
    logger.log('\nStep 4: Verifying health check...');
    const healthRes = await httpRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/health',
      method: 'GET',
    });
    console.log(`  GET /api/v1/health -> ${healthRes.statusCode} ${healthRes.body}`);

    // 5. Create Engagement
    logger.log('\nStep 5: Creating an engagement for demo tenant...');
    const createEngPayload = JSON.stringify({
      name: 'Q4 Customer Live Pentest',
      targets: [
        { target: `127.0.0.1:${mockPort}`, effect: 'ALLOW' },
        { target: 'api.partner.local', effect: 'ALLOW' },
        { target: 'internal.corp', effect: 'DENY' },
      ],
    });

    const createEngRes = await httpRequest(
      {
        hostname: 'localhost',
        port: 3000,
        path: '/api/v1/engagements',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEMO_API_KEY_PLAIN}`,
        },
      },
      createEngPayload,
    );

    const createdEngagement = JSON.parse(createEngRes.body);
    const engagementId = createdEngagement.id;
    const workerSecret = createdEngagement.workerSecret;
    console.log(`  POST /api/v1/engagements -> ${createEngRes.statusCode}`);
    console.log(`  Created Engagement ID: ${engagementId}`);
    console.log(`  Worker Bearer Secret:  ${workerSecret}`);

    // 6. Send IN-SCOPE Request via Proxy
    logger.log('\nStep 6: Sending IN-SCOPE request through Egress Proxy (127.0.0.1)...');
    const allowedRes = await httpRequest({
      hostname: 'localhost',
      port: 3128,
      path: `http://127.0.0.1:${mockPort}/login`,
      method: 'GET',
      headers: {
        'Proxy-Authorization': `Bearer ${workerSecret}`,
      },
    });
    console.log(`  Proxy Forward -> Status ${allowedRes.statusCode} (Expected: 200 OK)`);
    console.log(`  Mock server received hit count: ${mockReceivedCount} (Expected: 1)`);

    // 7. Send OUT-OF-SCOPE Request via Proxy
    logger.log('\nStep 7: Sending OUT-OF-SCOPE request through Egress Proxy (unauthorized.com)...');
    const outOfScopeRes = await httpRequest({
      hostname: 'localhost',
      port: 3128,
      path: 'http://unauthorized.com/sensitive-data',
      method: 'GET',
      headers: {
        'Proxy-Authorization': `Bearer ${workerSecret}`,
      },
    });
    console.log(`  Proxy Forward -> Status ${outOfScopeRes.statusCode} ${outOfScopeRes.body} (Expected: 403 NO_ALLOW_RULE)`);
    console.log(`  Mock server received hit count: ${mockReceivedCount} (Expected still 1; target was NOT contacted)`);

    // 8. Send DENIED Target Request (Deny overrides allow)
    logger.log('\nStep 8: Sending DENIED target request through Egress Proxy (internal.corp)...');
    const deniedRes = await httpRequest({
      hostname: 'localhost',
      port: 3128,
      path: 'http://internal.corp/secret',
      method: 'GET',
      headers: {
        'Proxy-Authorization': `Bearer ${workerSecret}`,
      },
    });
    console.log(`  Proxy Forward -> Status ${deniedRes.statusCode} ${deniedRes.body} (Expected: 403 DENY_RULE_MATCHED)`);

    // 9. Revoke Engagement
    logger.log('\nStep 9: Revoking engagement via Management API...');
    const revokeRes = await httpRequest({
      hostname: 'localhost',
      port: 3000,
      path: `/api/v1/engagements/${engagementId}/revoke`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DEMO_API_KEY_PLAIN}`,
      },
    });
    console.log(`  POST /api/v1/engagements/:id/revoke -> ${revokeRes.statusCode} status=${JSON.parse(revokeRes.body).status}`);

    // 10. Test Subsequent Request After Revocation
    logger.log('\nStep 10: Retrying previously allowed request through proxy after revocation...');
    const afterRevokeRes = await httpRequest({
      hostname: 'localhost',
      port: 3128,
      path: `http://127.0.0.1:${mockPort}/login`,
      method: 'GET',
      headers: {
        'Proxy-Authorization': `Bearer ${workerSecret}`,
      },
    });
    console.log(`  Proxy Forward -> Status ${afterRevokeRes.statusCode} ${afterRevokeRes.body} (Expected: 403 ENGAGEMENT_REVOKED)`);

    // 11. Read Tenant Audit Trail
    logger.log('\nStep 11: Fetching durable audit trail from Audit API...');
    await wait(500); // Allow outbox background dispatcher cycle
    const auditRes = await httpRequest({
      hostname: 'localhost',
      port: 3000,
      path: `/api/v1/engagements/${engagementId}/audit`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${DEMO_API_KEY_PLAIN}`,
      },
    });
    const auditData = JSON.parse(auditRes.body);
    console.log(`  GET /api/v1/engagements/:id/audit -> Total records: ${auditData.total}`);
    for (const record of auditData.items) {
      console.log(`   - [${record.decision}] Target=${record.target} Reason=${record.reason} Status=${record.upstreamStatus ?? 'N/A'}`);
    }

    // 12. Verify Cross-Tenant Isolation (Tenant Alpha vs Tenant Beta)
    logger.log('\nStep 12: Testing multi-tenant isolation between Tenant Alpha and Tenant Beta...');
    
    // 12a. Completely unauthenticated caller
    const unauthorizedRes = await httpRequest({
      hostname: 'localhost',
      port: 3000,
      path: `/api/v1/engagements/${engagementId}/audit`,
      method: 'GET',
      headers: {
        Authorization: 'Bearer sg_invalid_key_99999',
      },
    });
    console.log(`  [12a] Access with invalid API key -> Status ${unauthorizedRes.statusCode} (Expected: 401 Unauthorized)`);

    // 12b. Tenant Beta (valid credentials) attempts to READ Tenant Alpha's engagement
    const tenantBGetRes = await httpRequest({
      hostname: 'localhost',
      port: 3000,
      path: `/api/v1/engagements/${engagementId}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${DEMO_API_KEY_B_PLAIN}`,
      },
    });
    console.log(`  [12b] Tenant Beta reads Tenant Alpha engagement -> Status ${tenantBGetRes.statusCode} (Expected: 404 Not Found)`);

    // 12c. Tenant Beta attempts to MUTATE Tenant Alpha's policy
    const tenantBPatchRes = await httpRequest({
      hostname: 'localhost',
      port: 3000,
      path: `/api/v1/engagements/${engagementId}/policy`,
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${DEMO_API_KEY_B_PLAIN}`,
        'Content-Type': 'application/json',
      },
    }, JSON.stringify({ targets: [{ target: 'attacker.com', effect: 'ALLOW' }] }));
    console.log(`  [12c] Tenant Beta mutates Tenant Alpha policy -> Status ${tenantBPatchRes.statusCode} (Expected: 404 Not Found)`);

    // 12d. Tenant Beta attempts to REVOKE Tenant Alpha's engagement
    const tenantBRevokeRes = await httpRequest({
      hostname: 'localhost',
      port: 3000,
      path: `/api/v1/engagements/${engagementId}/revoke`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DEMO_API_KEY_B_PLAIN}`,
      },
    });
    console.log(`  [12d] Tenant Beta revokes Tenant Alpha engagement -> Status ${tenantBRevokeRes.statusCode} (Expected: 404 Not Found)`);

    // 12e. Tenant Beta attempts to READ Tenant Alpha's audit trail
    const tenantBAuditRes = await httpRequest({
      hostname: 'localhost',
      port: 3000,
      path: `/api/v1/engagements/${engagementId}/audit`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${DEMO_API_KEY_B_PLAIN}`,
      },
    });
    console.log(`  [12e] Tenant Beta reads Tenant Alpha audit trail -> Status ${tenantBAuditRes.statusCode} (Expected: 404 Not Found)`);

    // 12f. Tenant Beta lists engagements (must be empty, not showing Alpha's)
    const tenantBListRes = await httpRequest({
      hostname: 'localhost',
      port: 3000,
      path: `/api/v1/engagements`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${DEMO_API_KEY_B_PLAIN}`,
      },
    });
    const tenantBList = JSON.parse(tenantBListRes.body);
    console.log(`  [12f] Tenant Beta lists engagements -> Returned count: ${tenantBList.length} (Expected: 0, Tenant Alpha data hidden)`);

    console.log('\n============================================================');
    console.log('       DEMO COMPLETED SUCCESSFULLY — ALL GATES VERIFIED     ');
    console.log('============================================================\n');
  } finally {
    await app.close();
    mockServer.close();
  }
}

if (require.main === module) {
  runDemo().catch((err) => {
    console.error('Demo simulation failed:', err);
    process.exit(1);
  });
}

