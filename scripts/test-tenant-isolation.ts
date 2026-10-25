import * as http from 'http';

const API_BASE = 'http://localhost:3000/api/v1';

// Pre-seeded Tenant Credentials
const TENANT_A_KEY = 'sg_tenant_demo_secret_key_12345'; // Tenant Alpha (Acme Corp)
const TENANT_B_KEY = 'sg_tenant_beta_secret_key_67890'; // Tenant Beta (Cyberdyne Security)

async function request(
  path: string,
  method = 'GET',
  apiKey?: string,
  body?: any,
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_BASE}${path}`);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const payload = body ? JSON.stringify(body) : undefined;
    if (payload) {
      headers['Content-Length'] = Buffer.byteLength(payload).toString();
    }

    const req = http.request(
      url,
      { method, headers },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let parsed = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {
            // Keep parsed as raw text if not JSON
          }
          resolve({ status: res.statusCode || 500, data: parsed });
        });
      },
    );

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function run() {
  console.log('============================================================');
  console.log('    SCOPE GUARD — MULTI-TENANT ISOLATION VERIFICATION       ');
  console.log('============================================================\n');

  console.log('Onboarded Tenants:');
  console.log('  - Tenant Alpha (Acme Corp):         Key = sg_tenant_demo_secret_key_12345');
  console.log('  - Tenant Beta (Cyberdyne Security): Key = sg_tenant_beta_secret_key_67890\n');

  // 1. Tenant Alpha creates an engagement
  console.log('1. Tenant Alpha creates private engagement "Alpha Secret Ops"...');
  const createA = await request('/engagements', 'POST', TENANT_A_KEY, {
    name: 'Alpha Secret Ops',
    targets: [{ target: 'alpha-system.internal', effect: 'ALLOW' }],
  });
  console.log('   Response Status:', createA.status);
  console.log('   Created ID:     ', createA.data.id);
  if (createA.status !== 201 || !createA.data.id) {
    throw new Error('Tenant Alpha engagement creation failed!');
  }
  const engagementAlphaId = createA.data.id;
  console.log('   ✔ Tenant Alpha engagement created successfully!\n');

  // 2. Tenant Beta attempts to read Tenant Alpha's engagement
  console.log(`2. Tenant Beta attempts to READ Tenant Alpha's engagement (${engagementAlphaId})...`);
  const readAttempt = await request(`/engagements/${engagementAlphaId}`, 'GET', TENANT_B_KEY);
  console.log('   Response Status:', readAttempt.status);
  console.log('   Response Body:  ', JSON.stringify(readAttempt.data));
  if (readAttempt.status !== 404) {
    throw new Error(`Expected 404 Not Found, got ${readAttempt.status}`);
  }
  console.log('   ✔ Cross-tenant READ successfully blocked (404 Not Found)!\n');

  // 3. Tenant Beta attempts to mutate Tenant Alpha's policy
  console.log(`3. Tenant Beta attempts to MUTATE Tenant Alpha's policy (${engagementAlphaId})...`);
  const patchAttempt = await request(
    `/engagements/${engagementAlphaId}/policy`,
    'PATCH',
    TENANT_B_KEY,
    { targets: [{ target: 'malicious-hacker.com', effect: 'ALLOW' }] },
  );
  console.log('   Response Status:', patchAttempt.status);
  console.log('   Response Body:  ', JSON.stringify(patchAttempt.data));
  if (patchAttempt.status !== 404) {
    throw new Error(`Expected 404 Not Found, got ${patchAttempt.status}`);
  }
  console.log('   ✔ Cross-tenant POLICY MUTATION successfully blocked (404 Not Found)!\n');

  // 4. Tenant Beta attempts to revoke Tenant Alpha's engagement
  console.log(`4. Tenant Beta attempts to REVOKE Tenant Alpha's engagement (${engagementAlphaId})...`);
  const revokeAttempt = await request(`/engagements/${engagementAlphaId}/revoke`, 'POST', TENANT_B_KEY);
  console.log('   Response Status:', revokeAttempt.status);
  console.log('   Response Body:  ', JSON.stringify(revokeAttempt.data));
  if (revokeAttempt.status !== 404) {
    throw new Error(`Expected 404 Not Found, got ${revokeAttempt.status}`);
  }
  console.log('   ✔ Cross-tenant REVOCATION successfully blocked (404 Not Found)!\n');

  // 5. Tenant Beta attempts to read Tenant Alpha's audit trail
  console.log(`5. Tenant Beta attempts to READ Tenant Alpha's audit trail (${engagementAlphaId})...`);
  const auditAttempt = await request(`/engagements/${engagementAlphaId}/audit`, 'GET', TENANT_B_KEY);
  console.log('   Response Status:', auditAttempt.status);
  console.log('   Response Body:  ', JSON.stringify(auditAttempt.data));
  if (auditAttempt.status !== 404) {
    throw new Error(`Expected 404 Not Found, got ${auditAttempt.status}`);
  }
  console.log('   ✔ Cross-tenant AUDIT ACCESS successfully blocked (404 Not Found)!\n');

  // 6. Tenant Beta lists engagements (Tenant Alpha's data must be completely hidden)
  console.log('6. Tenant Beta lists its engagements...');
  const listB = await request('/engagements', 'GET', TENANT_B_KEY);
  console.log('   Response Status:', listB.status);
  const leaked = (listB.data || []).some((e: any) => e.id === engagementAlphaId);
  if (leaked) {
    throw new Error('CRITICAL LEAK: Tenant Alpha engagement appeared in Tenant Beta listing!');
  }
  console.log(`   Tenant Beta sees ${listB.data.length} engagements. (Tenant Alpha engagement completely hidden).`);
  console.log('   ✔ Tenant listing boundary strictly enforced!\n');

  console.log('============================================================');
  console.log('   ALL TWO-TENANT ISOLATION GATES PASSED (100% ISOLATED)    ');
  console.log('============================================================\n');
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});

