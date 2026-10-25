# Scope Guard — Step-by-Step Manual Docker Verification Walkthrough

This guide provides an end-to-end sequential verification script for developers and security reviewers to manually test the running Docker container stack step-by-step using `curl` or PowerShell.

---

## Test Environment & Pre-Seeded Credentials
- **Management & Audit API:** `http://localhost:3000/api/v1`
- **Interactive Swagger UI:** `http://localhost:3000/docs`
- **Egress Proxy Listener:** `http://localhost:3128`
- **Tenant Alpha API Key (Primary Pentest Tenant):** `sg_tenant_demo_secret_key_12345`
- **Tenant Beta API Key (Cross-Tenant Isolation Testing):** `sg_tenant_beta_secret_key_67890`
- **Worker Proxy Secret:** Generated dynamically upon calling `POST /api/v1/engagements` (e.g. `sg_worker_<randomHex>`); used with `Proxy-Authorization: Bearer <workerSecret>` on port `3128`.

---

### Step 1: Start the Docker Containers
```bash
# Start PostgreSQL, Management API, and Egress Proxy in the background
docker compose up --build -d

# Verify all three containers are up and healthy
docker ps
```
*Expected Output:* Three running containers:
- `scope-guard-postgres` (PostgreSQL 15, healthy on port 5432)
- `scope-guard-api` (Management API & Swagger, healthy on port 3000)
- `scope-guard-proxy` (Egress Forward Proxy, running on port 3128)

---

### Step 2: Verify System Health
Verify that the NestJS app and PostgreSQL connection pool are operational.

**cURL / Bash:**
```bash
curl -i http://localhost:3000/api/v1/health
```

**PowerShell:**
```powershell
Invoke-RestMethod -Uri http://localhost:3000/api/v1/health
```
*Expected Output:* `HTTP 200 OK` with JSON:
```json
{"status":"ok","timestamp":"...","database":"connected"}
```

---

### Step 3: Create an Engagement via Management API
Create an engagement with allowed targets (`icanhazip.com`, `httpbin.org`) and a denied target (`internal.corp`).

**cURL / Bash:**
```bash
curl -i -X POST http://localhost:3000/api/v1/engagements \
  -H "Authorization: Bearer sg_tenant_demo_secret_key_12345" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Q4 Target Pentest",
    "targets": [
      { "target": "icanhazip.com", "effect": "ALLOW" },
      { "target": "httpbin.org", "effect": "ALLOW" },
      { "target": "internal.corp", "effect": "DENY" }
    ]
  }'
```

**PowerShell:**
```powershell
$headers = @{
  "Authorization" = "Bearer sg_tenant_demo_secret_key_12345"
  "Content-Type"  = "application/json"
}
$body = @{
  name = "Q4 Target Pentest"
  targets = @(
    @{ target = "icanhazip.com"; effect = "ALLOW" },
    @{ target = "httpbin.org"; effect = "ALLOW" },
    @{ target = "internal.corp"; effect = "DENY" }
  )
} | ConvertTo-Json

$eng = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/engagements" -Method POST -Headers $headers -Body $body
$engId = $eng.id
$workerSecret = $eng.workerSecret
Write-Host "Created Engagement ID: $engId"
Write-Host "Worker Secret: $workerSecret"
```
*Expected Output:* `HTTP 201 Created` returning the engagement ID and the single-use plaintext `workerSecret` (e.g., `sg_worker_...`).

---

### Step 4: Test Proxy Authentication Failure (No Token)
Attempt to send an outbound request through the proxy without credentials.

**cURL / Bash:**
```bash
curl -i -x http://localhost:3128 http://example.com/
```
*Expected Output:* `HTTP 407 Proxy Authentication Required`:
```json
{"error":"Proxy authentication required. Provide Bearer token in Proxy-Authorization header."}
```

---

### Step 5: Send an In-Scope Allowed Request Through the Proxy
Forward an HTTP request to an allowed target (`icanhazip.com`).

**cURL / Bash:**
```bash
curl -i -x http://localhost:3128 \
     -H "Proxy-Authorization: Bearer <YOUR_WORKER_SECRET>" \
     http://icanhazip.com/
```

**PowerShell:**
```powershell
Invoke-RestMethod -Uri "http://icanhazip.com/" -Proxy "http://localhost:3128" -Headers @{ "Proxy-Authorization" = "Bearer $workerSecret" }
```
*Expected Output:* `HTTP 200 OK` returning your public IP address.

---

### Step 6: Test HTTPS CONNECT Tunneling to Allowed Host
Tunnel an HTTPS connection through the proxy using RFC 7231 `CONNECT`.

**cURL / Bash:**
```bash
curl -i -x http://localhost:3128 \
     --proxy-header "Proxy-Authorization: Bearer <YOUR_WORKER_SECRET>" \
     https://httpbin.org/get
```
*Expected Output:* `HTTP 200 OK` with JSON response from `httpbin.org`.

---

### Step 7: Test Scope Violation (Unlisted Target Denied)
Attempt to access an unlisted destination (`google.com`).

**cURL / Bash:**
```bash
curl -i -x http://localhost:3128 \
     -H "Proxy-Authorization: Bearer <YOUR_WORKER_SECRET>" \
     http://google.com/
```
*Expected Output:* `HTTP 403 Forbidden`:
```json
{
  "error": "Request denied by Scope Guard policy",
  "decision": "DENY",
  "reason": "NO_ALLOW_RULE",
  "target": "google.com:80"
}
```

---

### Step 7b: Test Unauthorized Port on Allowed Host (Port Scope Violation)
Attempt to connect to an unauthorized port (e.g. SSH port 22 or alt-web 8080) on an allowed hostname (`httpbin.org`).

**cURL / Bash:**
```bash
curl -i -x http://localhost:3128 \
     --proxy-header "Proxy-Authorization: Bearer <YOUR_WORKER_SECRET>" \
     https://httpbin.org:22/
```
*Expected Output:* `HTTP 403 Forbidden`:
```
HTTP/1.1 403 Forbidden
Content-Type: application/json

{"error":"Request denied by Scope Guard policy","decision":"DENY","reason":"NO_ALLOW_RULE","target":"httpbin.org:22"}
```
*(Scope Guard blocks unauthorized port access, preventing autonomous agents from pivoting into non-web services).*

---

### Step 8: Test Explicit Deny (Deny Overrides Allow)
Attempt to access `internal.corp`, which has an explicit `DENY` rule.

**cURL / Bash:**
```bash
curl -i -x http://localhost:3128 \
     -H "Proxy-Authorization: Bearer <YOUR_WORKER_SECRET>" \
     http://internal.corp/admin
```
*Expected Output:* `HTTP 403 Forbidden`:
```json
{
  "error": "Request denied by Scope Guard policy",
  "decision": "DENY",
  "reason": "DENY_RULE_MATCHED",
  "target": "internal.corp:80"
}
```

---

### Step 9: Test Cloud Metadata SSRF Protection
Attempt to reach the AWS/GCP cloud metadata endpoint (`169.254.169.254`).

**cURL / Bash:**
```bash
curl -i -x http://localhost:3128 \
     -H "Proxy-Authorization: Bearer <YOUR_WORKER_SECRET>" \
     http://169.254.169.254/latest/meta-data/
```
*Expected Output:* `HTTP 403 Forbidden` (`DENY_RULE_MATCHED` or blocked destination IP). The request is aborted before opening a network socket.

---

### Step 10: Revoke the Engagement via Management API
Revoke the active engagement using the tenant API key.

**cURL / Bash:**
```bash
curl -i -X POST http://localhost:3000/api/v1/engagements/<YOUR_ENGAGEMENT_ID>/revoke \
  -H "Authorization: Bearer sg_tenant_demo_secret_key_12345"
```

**PowerShell:**
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/engagements/$engId/revoke" -Method POST -Headers @{ "Authorization" = "Bearer sg_tenant_demo_secret_key_12345" }
```
*Expected Output:* `HTTP 200 OK` returning:
```json
{"id":"eng_...","status":"REVOKED","revokedAt":"..."}
```

---

### Step 11: Retest Proxy Traffic After Revocation (Immediate Cutoff)
Attempt to re-send the previously allowed request to `icanhazip.com`.

**cURL / Bash:**
```bash
curl -i -x http://localhost:3128 \
     -H "Proxy-Authorization: Bearer <YOUR_WORKER_SECRET>" \
     http://icanhazip.com/
```
*Expected Output:* `HTTP 403 Forbidden`:
```json
{
  "error": "Request denied by Scope Guard policy",
  "decision": "DENY",
  "reason": "ENGAGEMENT_REVOKED",
  "target": "icanhazip.com"
}
```
*Invariant:* Immediate cutoff is enforced. Upstream `icanhazip.com` is never contacted.

---

### Step 12: Query Durable Audit Trail
Retrieve the complete immutable audit trail for the engagement.

**cURL / Bash:**
```bash
curl -i http://localhost:3000/api/v1/engagements/<YOUR_ENGAGEMENT_ID>/audit \
  -H "Authorization: Bearer sg_tenant_demo_secret_key_12345"
```

**PowerShell:**
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/engagements/$engId/audit" -Headers @{ "Authorization" = "Bearer sg_tenant_demo_secret_key_12345" } | ConvertTo-Json -Depth 5
```
*Expected Output:* `HTTP 200 OK` returning records for all preceding attempts:
```json
{
  "total": 6,
  "limit": 20,
  "offset": 0,
  "items": [
    { "decision": "DENY", "method": "GET", "target": "icanhazip.com", "reason": "ENGAGEMENT_REVOKED" },
    { "decision": "DENY", "method": "GET", "target": "169.254.169.254", "reason": "DENY_RULE_MATCHED" },
    { "decision": "DENY", "method": "GET", "target": "internal.corp", "reason": "DENY_RULE_MATCHED" },
    { "decision": "DENY", "method": "GET", "target": "google.com", "reason": "NO_ALLOW_RULE" },
    { "decision": "ALLOW", "method": "CONNECT", "target": "httpbin.org:443", "reason": "IN_SCOPE", "upstreamStatus": 200 },
    { "decision": "ALLOW", "method": "GET", "target": "icanhazip.com", "reason": "IN_SCOPE", "upstreamStatus": 200 }
  ]
}
```

---

### Step 13: Inspect Background Outbox Dispatcher Logs
Check proxy container logs to verify that the Transactional Outbox delivered events to the downstream audit sink:

```bash
docker compose logs --tail=20 proxy
```
*Expected Log Output:*
```log
[DownstreamAuditSink] [SinkDelivery] Event=evt_... Record=audit_... Decision=ALLOW Target=icanhazip.com
[DownstreamAuditSink] [SinkDelivery] Event=evt_... Record=audit_... Decision=DENY Target=google.com
[DownstreamAuditSink] [SinkDelivery] Event=evt_... Record=audit_... Decision=DENY Target=icanhazip.com
```

---

### Step 14: Clean Teardown
```bash
docker compose down -v
```
This halts containers and deletes PostgreSQL volumes to ensure a completely clean environment for future runs.

