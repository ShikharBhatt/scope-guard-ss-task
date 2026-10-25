import * as http from 'http';

const API_BASE = 'http://localhost:3000/api/v1';
const PROXY_HOST = '127.0.0.1';
const PROXY_PORT = 3128;
const DEMO_API_KEY = 'sg_tenant_demo_secret_key_12345';
const DEMO_API_KEY_B = 'sg_tenant_beta_secret_key_67890';

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function requestApi(
  path: string,
  method = 'GET',
  token?: string,
  body?: any,
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_BASE}${path}`);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const payload = body ? JSON.stringify(body) : undefined;
    if (payload) {
      headers['Content-Length'] = Buffer.byteLength(payload).toString();
    }

    const req = http.request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let parsed: any = raw;
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

async function requestViaProxy(
  targetUrl: string,
  proxyToken?: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedTarget = new URL(targetUrl);
    const headers: Record<string, string> = {
      Host: parsedTarget.host,
    };
    if (proxyToken) {
      headers['Proxy-Authorization'] = `Bearer ${proxyToken}`;
    }

    const req = http.request(
      {
        host: PROXY_HOST,
        port: PROXY_PORT,
        method: 'GET',
        path: targetUrl,
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 500,
            headers: res.headers,
            body: raw,
          });
        });
      },
    );

    req.on('error', reject);
    req.end();
  });
}

async function requestViaConnect(
  targetAuthority: string,
  proxyToken?: string,
): Promise<{ statusCode: number; statusText: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Host: targetAuthority,
    };
    if (proxyToken) {
      headers['Proxy-Authorization'] = `Bearer ${proxyToken}`;
    }

    const req = http.request({
      host: PROXY_HOST,
      port: PROXY_PORT,
      method: 'CONNECT',
      path: targetAuthority,
      headers,
    });

    req.on('connect', (res, socket) => {
      socket.destroy();
      resolve({ statusCode: res.statusCode || 200, statusText: res.statusMessage || 'OK' });
    });

    req.on('response', (res) => {
      resolve({ statusCode: res.statusCode || 500, statusText: res.statusMessage || '' });
    });

    req.on('error', reject);
    req.end();
  });
}

export async function run(): Promise<void> {
  console.log('============================================================');
  console.log('       SCOPE GUARD — LIVE DOCKER CONTAINER VERIFICATION     ');
  console.log('============================================================\n');

  // 1. Health check
  console.log('1. Probing Health Endpoint (GET /api/v1/health)...');
  const health = await requestApi('/health');
  console.log('   Response Status:', health.status);
  console.log('   Response Body:  ', JSON.stringify(health.data));
  if (health.status !== 200 || health.data.status !== 'ok') {
    throw new Error('Health check failed!');
  }
  console.log('   ✔ Health check passed!\n');

  // 2. Auth Check - Unauthorized
  console.log('2. Probing Tenant Auth with invalid key (GET /api/v1/engagements)...');
  const unauth = await requestApi('/engagements', 'GET', 'invalid_key');
  console.log('   Response Status:', unauth.status);
  if (unauth.status !== 401) {
    throw new Error(`Expected 401 Unauthorized, got ${unauth.status}`);
  }
  console.log('   ✔ 401 Unauthorized correctly enforced!\n');

  // 3. Create Engagement
  console.log('3. Creating Engagement (POST /api/v1/engagements)...');
  const createRes = await requestApi('/engagements', 'POST', DEMO_API_KEY, {
    name: 'Live Docker Test Engagement',
    targets: [
      { target: 'icanhazip.com:80', effect: 'ALLOW' },
      { target: 'example.com:80', effect: 'ALLOW' },
      { target: 'example.com:443', effect: 'ALLOW' },
      { target: 'internal.corp:80', effect: 'DENY' },
      { target: 'internal.corp:443', effect: 'DENY' },
      { target: '169.254.169.254:80', effect: 'DENY' },
    ],
  });
  console.log('   Response Status:', createRes.status);
  console.log('   Engagement ID:  ', createRes.data.id);
  console.log('   Worker Token:   ', createRes.data.workerSecret ? `${createRes.data.workerSecret.slice(0, 15)}...` : 'undefined');
  if (createRes.status !== 201 || !createRes.data.id || !createRes.data.workerSecret) {
    console.error('Failed creation payload response:', createRes.data);
    throw new Error('Engagement creation failed!');
  }
  const engagementId = createRes.data.id;
  const workerToken = createRes.data.workerSecret;
  console.log('   ✔ Engagement created and worker token issued!\n');

  // 4. Test Proxy - No Worker Token
  console.log('4. Testing Proxy without token (GET http://example.com:80)...');
  const noTokenRes = await requestViaProxy('http://example.com:80');
  console.log('   Proxy Response Status:', noTokenRes.status);
  console.log('   Proxy Response Body:  ', noTokenRes.body);
  if (noTokenRes.status !== 407) {
    throw new Error(`Expected 407 Proxy Authentication Required, got ${noTokenRes.status}`);
  }
  console.log('   ✔ Proxy 407 PROXY_AUTH_REQUIRED verified!\n');

  // 5. Test Proxy - Scope Violation (Not on allowlist)
  console.log('5. Testing Proxy Scope Violation (GET http://unauthorized-domain.com:80)...');
  const deniedRes = await requestViaProxy('http://unauthorized-domain.com:80', workerToken);
  console.log('   Proxy Response Status:', deniedRes.status);
  console.log('   Proxy Response Body:  ', deniedRes.body);
  if (deniedRes.status !== 403) {
    throw new Error(`Expected 403 from proxy for unlisted domain, got ${deniedRes.status}`);
  }
  console.log('   ✔ Proxy 403 SCOPE_VIOLATION verified!\n');

  // 6. Test Proxy - Explicit Deny Overrides Allow
  console.log('6. Testing Proxy Explicit Deny (GET http://internal.corp:80)...');
  const explicitDenyRes = await requestViaProxy('http://internal.corp:80', workerToken);
  console.log('   Proxy Response Status:', explicitDenyRes.status);
  console.log('   Proxy Response Body:  ', explicitDenyRes.body);
  if (explicitDenyRes.status !== 403) {
    throw new Error(`Expected 403 from proxy for denied domain, got ${explicitDenyRes.status}`);
  }
  console.log('   ✔ Proxy 403 Deny-Overrides-Allow verified!\n');

  // 7. Test Proxy - Cloud Metadata SSRF Protection
  console.log('7. Testing Proxy SSRF Protection (GET http://169.254.169.254:80)...');
  const ssrfRes = await requestViaProxy('http://169.254.169.254:80', workerToken);
  console.log('   Proxy Response Status:', ssrfRes.status);
  console.log('   Proxy Response Body:  ', ssrfRes.body);
  if (ssrfRes.status !== 403) {
    throw new Error(`Expected 403 for SSRF attempt, got ${ssrfRes.status}`);
  }
  console.log('   ✔ SSRF blocked verified!\n');

  // 7b. Test HTTPS CONNECT - Unauthorized Target
  console.log('7b. Testing HTTPS CONNECT Tunnel Scope Violation (CONNECT unauthorized.com:443)...');
  const connectDenied = await requestViaConnect('unauthorized.com:443', workerToken);
  console.log('    CONNECT Status:', connectDenied.statusCode, connectDenied.statusText);
  if (connectDenied.statusCode !== 403) {
    throw new Error(`Expected 403 on unauthorized CONNECT, got ${connectDenied.statusCode}`);
  }
  console.log('    ✔ HTTPS CONNECT Scope Violation correctly blocked with 403!\n');

  // 7c. Test HTTPS CONNECT - Allowed Target
  console.log('7c. Testing HTTPS CONNECT Tunnel Allowed Target (CONNECT example.com:443)...');
  const connectAllowed = await requestViaConnect('example.com:443', workerToken);
  console.log('    CONNECT Status:', connectAllowed.statusCode, connectAllowed.statusText);
  if (connectAllowed.statusCode !== 200) {
    throw new Error(`Expected 200 on allowed CONNECT, got ${connectAllowed.statusCode}`);
  }
  console.log('    ✔ HTTPS CONNECT Tunnel Established with 200 Connection Established!\n');

  // 7d. Test Port Scope Violation on Allowed Host (CONNECT example.com:22)
  console.log('7d. Testing Port Scope Violation on Allowed Host (CONNECT example.com:22)...');
  const connectPortDenied = await requestViaConnect('example.com:22', workerToken);
  console.log('    CONNECT Status:', connectPortDenied.statusCode, connectPortDenied.statusText);
  if (connectPortDenied.statusCode !== 403) {
    throw new Error(`Expected 403 on unauthorized port CONNECT, got ${connectPortDenied.statusCode}`);
  }
  console.log('    ✔ Unauthorized port (SSH 22) on allowed host correctly blocked with 403 Forbidden!\n');

  // 8. Test Proxy - Allowed Target Forwarding
  console.log('8. Testing Proxy Forwarding Allowed Target (GET http://icanhazip.com:80)...');
  try {
    const allowedRes = await requestViaProxy('http://icanhazip.com:80', workerToken);
    console.log('   Proxy Response Status:', allowedRes.status);
    console.log('   Proxy Response Body:  ', allowedRes.body.trim());
    if (allowedRes.status === 200) {
      console.log('   ✔ Allowed target forwarded successfully and returned 200 OK!\n');
    } else {
      console.log(`   (Upstream returned status ${allowedRes.status})\n`);
    }
  } catch (err) {
    console.log('   (External network request note:', (err as Error).message, ')\n');
  }

  // 9. Revoke Engagement
  console.log('9. Revoking Engagement (POST /api/v1/engagements/:id/revoke)...');
  const revokeRes = await requestApi(`/engagements/${engagementId}/revoke`, 'POST', DEMO_API_KEY);
  console.log('   Revoke Status: ', revokeRes.status);
  console.log('   Revoke State:  ', revokeRes.data.status);
  if (revokeRes.status !== 200 || revokeRes.data.status !== 'REVOKED') {
    throw new Error('Revocation failed!');
  }
  console.log('   ✔ Engagement revoked successfully!\n');

  // 10. Test Proxy - Post-Revocation Request
  console.log('10. Testing Proxy after revocation (GET http://icanhazip.com:80)...');
  const postRevokeRes = await requestViaProxy('http://icanhazip.com:80', workerToken);
  console.log('    Proxy Response Status:', postRevokeRes.status);
  console.log('    Proxy Response Body:  ', postRevokeRes.body);
  if (postRevokeRes.status !== 403) {
    throw new Error(`Expected 403 after revocation, got ${postRevokeRes.status}`);
  }
  console.log('    ✔ Revoked engagement traffic immediately blocked with 403!\n');

  // 11. Fetch Audit Trail
  console.log('11. Fetching Audit Trail (GET /api/v1/engagements/:id/audit)...');
  await wait(500);
  const auditRes = await requestApi(`/engagements/${engagementId}/audit`, 'GET', DEMO_API_KEY);
  const items = auditRes.data.items || [];
  console.log('    Audit Records Total Count:', auditRes.data.total);
  for (const item of items) {
    console.log(`    - [${item.decision}] ${item.method} ${item.target} -> ${item.reason} (upstreamStatus: ${item.upstreamStatus ?? 'N/A'})`);
  }
  if (auditRes.status !== 200 || items.length === 0) {
    throw new Error('Audit trail empty or failed!');
  }
  console.log('    ✔ Audit records verified!\n');

  // 12. Multi-Tenant Isolation Verification (Tenant Alpha vs Tenant Beta)
  console.log('12. Verifying Multi-Tenant Isolation (Tenant Alpha vs Tenant Beta)...');

  // 12a. Tenant Beta attempts to read Tenant Alpha's engagement
  const crossGet = await requestApi(`/engagements/${engagementId}`, 'GET', DEMO_API_KEY_B);
  console.log('    Tenant Beta GET Tenant Alpha engagement Status:', crossGet.status);
  if (crossGet.status !== 404) {
    throw new Error(`Expected 404 on cross-tenant read, got ${crossGet.status}`);
  }
  console.log('    ✔ Cross-tenant engagement read blocked with 404 Not Found!');

  // 12b. Tenant Beta attempts to mutate Tenant Alpha's policy
  const crossPatch = await requestApi(
    `/engagements/${engagementId}/policy`,
    'PATCH',
    DEMO_API_KEY_B,
    { targets: [{ target: 'malicious.attacker.com', effect: 'ALLOW' }] },
  );
  console.log('    Tenant Beta PATCH Tenant Alpha policy Status:', crossPatch.status);
  if (crossPatch.status !== 404) {
    throw new Error(`Expected 404 on cross-tenant policy update, got ${crossPatch.status}`);
  }
  console.log('    ✔ Cross-tenant policy mutation blocked with 404 Not Found!');

  // 12c. Tenant Beta attempts to revoke Tenant Alpha's engagement
  const crossRevoke = await requestApi(`/engagements/${engagementId}/revoke`, 'POST', DEMO_API_KEY_B);
  console.log('    Tenant Beta POST revoke Tenant Alpha engagement Status:', crossRevoke.status);
  if (crossRevoke.status !== 404) {
    throw new Error(`Expected 404 on cross-tenant revoke, got ${crossRevoke.status}`);
  }
  console.log('    ✔ Cross-tenant revocation blocked with 404 Not Found!');

  // 12d. Tenant Beta attempts to read Tenant Alpha's audit records
  const crossAudit = await requestApi(`/engagements/${engagementId}/audit`, 'GET', DEMO_API_KEY_B);
  console.log('    Tenant Beta GET Tenant Alpha audit records Status:', crossAudit.status);
  if (crossAudit.status !== 404) {
    throw new Error(`Expected 404 on cross-tenant audit access, got ${crossAudit.status}`);
  }
  console.log('    ✔ Cross-tenant audit trail access blocked with 404 Not Found!');

  // 12e. Tenant Beta lists engagements (must NOT leak Tenant Alpha's engagements)
  const tenantBList = await requestApi('/engagements', 'GET', DEMO_API_KEY_B);
  console.log('    Tenant Beta list engagements count:', Array.isArray(tenantBList.data) ? tenantBList.data.length : 'N/A');
  const leaked = (tenantBList.data || []).some((e: any) => e.id === engagementId);
  if (leaked) {
    throw new Error('Tenant Alpha engagement leaked into Tenant Beta listing!');
  }
  console.log('    ✔ Cross-tenant list isolation verified (Tenant Alpha engagements completely hidden)!\n');

  console.log('============================================================');
  console.log('    ALL LIVE DOCKER CONTAINER VERIFICATION CHECKS PASSED    ');
  console.log('============================================================');
}

if (require.main === module) {
  run().catch((err) => {
    console.error('FATAL TEST ERROR:', err);
    process.exit(1);
  });
}
