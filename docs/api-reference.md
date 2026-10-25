# Scope Guard — API Reference & Multi-Tenant Guide

Scope Guard exposes a versioned REST API (`/api/v1`) for tenant-side policy administration and audit querying, alongside an RFC 7230/7235 forward proxy engine.

---

## Interactive Swagger / OpenAPI UI

Scope Guard includes interactive OpenAPI documentation mounted directly in the API service:
- **Interactive Swagger UI:** [http://localhost:3000/docs](http://localhost:3000/docs) (or [http://localhost:3000/api/docs](http://localhost:3000/api/docs))
- **OpenAPI Schema (JSON):** [http://localhost:3000/docs-json](http://localhost:3000/docs-json)

To execute requests through the Swagger UI:
1. Click the green **Authorize** button on the top right.
2. Enter the bearer token: `sg_tenant_demo_secret_key_12345`.
3. Try any endpoint interactively.

---

## Authentication & Multi-Tenancy

All management and audit endpoints require tenant bearer authentication:
```http
Authorization: Bearer <tenant_api_key>
```

### Pre-Seeded Development Tenants

Scope Guard automatically provisions two isolated tenants out of the box so multi-tenant boundaries can be tested immediately:

| Tenant | Tenant ID | Organization | API Key (Bearer Token) |
| :--- | :--- | :--- | :--- |
| **Tenant Alpha** | `tenant_demo_01` | Acme Corp Pentesting | `sg_tenant_demo_secret_key_12345` |
| **Tenant Beta** | `tenant_demo_02` | Cyberdyne Security | `sg_tenant_beta_secret_key_67890` |

### Verifying Multi-Tenant Isolation

To verify that Tenant Beta cannot read, mutate, revoke, or inspect Tenant Alpha's data, run the automated isolation suite:

```bash
npm run test:isolation
```

#### Manual Cross-Tenant Isolation Proof (cURL):

1. **Tenant Alpha creates an engagement:**
   ```bash
   curl -X POST http://localhost:3000/api/v1/engagements \
     -H "Authorization: Bearer sg_tenant_demo_secret_key_12345" \
     -H "Content-Type: application/json" \
     -d '{"name": "Alpha Secret Ops", "targets": [{"target": "alpha.corp", "effect": "ALLOW"}]}'
   # Returns: {"id": "eng_alpha_...", ...}
   ```

2. **Tenant Beta attempts to READ Tenant Alpha's engagement:**
   ```bash
   curl -i http://localhost:3000/api/v1/engagements/<ALPHA_ENGAGEMENT_ID> \
     -H "Authorization: Bearer sg_tenant_beta_secret_key_67890"
   # Response: 404 Not Found (Data is completely invisible to Tenant Beta)
   ```

3. **Tenant Beta attempts to MUTATE Tenant Alpha's policy:**
   ```bash
   curl -i -X PATCH http://localhost:3000/api/v1/engagements/<ALPHA_ENGAGEMENT_ID>/policy \
     -H "Authorization: Bearer sg_tenant_beta_secret_key_67890" \
     -H "Content-Type: application/json" \
     -d '{"targets": [{"target": "malicious.com", "effect": "ALLOW"}]}'
   # Response: 404 Not Found (Unauthorized mutation rejected)
   ```

4. **Tenant Beta attempts to REVOKE Tenant Alpha's engagement:**
   ```bash
   curl -i -X POST http://localhost:3000/api/v1/engagements/<ALPHA_ENGAGEMENT_ID>/revoke \
     -H "Authorization: Bearer sg_tenant_beta_secret_key_67890"
   # Response: 404 Not Found (Unauthorized revocation rejected)
   ```

5. **Tenant Beta attempts to READ Tenant Alpha's audit trail:**
   ```bash
   curl -i http://localhost:3000/api/v1/engagements/<ALPHA_ENGAGEMENT_ID>/audit \
     -H "Authorization: Bearer sg_tenant_beta_secret_key_67890"
   # Response: 404 Not Found (Audit records are strictly isolated)
   ```

6. **Tenant Beta lists engagements:**
   ```bash
   curl -s http://localhost:3000/api/v1/engagements \
     -H "Authorization: Bearer sg_tenant_beta_secret_key_67890"
   # Response: [] (Tenant Alpha's engagements are never leaked)
   ```

---

## Provisioning Additional Tenants

Scope Guard provides a CLI command to onboard new tenants and issue secure API keys:

```bash
# Provision a tenant with an auto-generated high-entropy key
npm run tenant:create -- "Cyberdyne Systems"

# Or if running inside Docker
docker compose exec api npx ts-node scripts/create-tenant.ts "Cyberdyne Systems"
```

You can also specify a custom Tenant ID and API key:
```bash
npm run tenant:create -- "Partner Security" "tenant_partner_99" "sg_tenant_custom_secret_key_99"
```

---

## API Endpoints Reference

### 1. Application Health
- **`GET /api/v1/health`**
  - **Auth:** Public
  - **Response (200 OK):**
    ```json
    {
      "status": "ok",
      "timestamp": "2026-10-24T16:20:00.000Z",
      "database": "connected"
    }
    ```
  - **Response (503 Service Unavailable):** Returned if PostgreSQL connectivity is interrupted.

---

### 2. Create Engagement
- **`POST /api/v1/engagements`**
  - **Auth:** Tenant Bearer Key
  - **Request Body:**
    ```json
    {
      "name": "Q4 Financial Portal Pentest",
      "targets": [
        { "target": "app.dev.example.com", "effect": "ALLOW" },
        { "target": "https://api.example.com:443/v1", "effect": "ALLOW" },
        { "target": "internal.corp", "effect": "DENY" },
        { "target": "lab.example.com:*", "effect": "ALLOW" }
      ]
    }
    ```
  - **Response (201 Created):**
    ```json
    {
      "id": "eng_b93d6d5c-9c71-48e0-a7d1-37f26c2cf42b",
      "tenantId": "tenant_demo_01",
      "name": "Q4 Financial Portal Pentest",
      "status": "ACTIVE",
      "createdAt": "2026-10-24T16:21:00.000Z",
      "revokedAt": null,
      "workerSecret": "sg_worker_e9b276d4982613e54b67ab7c...",
      "targets": [
        { "normalizedTarget": "app.dev.example.com", "effect": "ALLOW" },
        { "normalizedTarget": "api.example.com:443", "effect": "ALLOW" },
        { "normalizedTarget": "internal.corp", "effect": "DENY" },
        { "normalizedTarget": "lab.example.com:*", "effect": "ALLOW" }
      ]
    }
    ```
  - **Target Formats & Port Containment:**
    - **`host:port`** (e.g. `api.example.com:8443`, `api.example.com:443`): Strict port matching. Only requests directed to that exact port are permitted.
    - **`host`** (e.g. `app.dev.example.com`): Bare domain. In `ALLOW` rules, permits standard web ports `80` (HTTP) and `443` (HTTPS); unauthorized non-web ports (e.g., SSH 22, Redis 6379, Alt-HTTP 8080) are rejected with `403 Forbidden`. In `DENY` rules, denies **all** ports on that host.
    - **`host:*`** (e.g. `lab.example.com:*`): Wildcard port. Permits any port on that target host when full-port penetration testing is explicitly approved.
  - **Security Invariant:** `workerSecret` is returned **only once** upon creation. Only its SHA-256 hash is persisted.

---

### 3. List Engagements
- **`GET /api/v1/engagements`**
  - **Auth:** Tenant Bearer Key
  - **Response (200 OK):** Returns an array of engagements belonging exclusively to the authenticated tenant.

---

### 4. Read Engagement
- **`GET /api/v1/engagements/:id`**
  - **Auth:** Tenant Bearer Key
  - **Response (200 OK):** Returns engagement metadata and normalized targets.
  - **Response (404 Not Found):** Returned if the engagement does not exist **or belongs to another tenant**.

---

### 5. Update Target Policy
- **`PATCH /api/v1/engagements/:id/policy`**
  - **Auth:** Tenant Bearer Key
  - **Request Body:**
    ```json
    {
      "targets": [
        { "target": "new.target.example.com", "effect": "ALLOW" }
      ]
    }
    ```
  - **Response (200 OK):** Returns updated engagement with new normalized targets.

---

### 6. Revoke Engagement
- **`POST /api/v1/engagements/:id/revoke`**
  - **Auth:** Tenant Bearer Key
  - **Response (200 OK):**
    ```json
    {
      "id": "eng_b93d6d5c-9c71-48e0-a7d1-37f26c2cf42b",
      "status": "REVOKED",
      "revokedAt": "2026-10-24T16:25:00.000Z"
    }
    ```
  - **Invariant:** Subsequent requests through the proxy for this engagement are immediately blocked.

---

### 7. Read Audit Log
- **`GET /api/v1/engagements/:id/audit?limit=20&offset=0`**
  - **Auth:** Tenant Bearer Key
  - **Query Parameters:** `limit` (1-100, default 20), `offset` (default 0).
  - **Response (200 OK):**
    ```json
    {
      "total": 3,
      "limit": 20,
      "offset": 0,
      "items": [
        {
          "id": "audit_17a4c9b2-...",
          "timestamp": "2026-10-24T16:22:00.000Z",
          "tenantId": "tenant_demo_01",
          "engagementId": "eng_b93d6d5c-...",
          "requestId": "req_5f2b8...",
          "method": "GET",
          "target": "app.dev.example.com:80",
          "decision": "ALLOW",
          "reason": "IN_SCOPE",
          "upstreamStatus": 200,
          "upstreamOutcome": "UPSTREAM_SUCCESS",
          "durationMs": 42
        }
      ]
    }
    ```

---

## Worker Proxy Integration

AI workers configure standard HTTP proxy variables:
```bash
export http_proxy="http://localhost:3128"
export https_proxy="http://localhost:3128"
```

Each outbound request must provide the worker secret in the `Proxy-Authorization` header:
```bash
curl -x http://localhost:3128 \
     -H "Proxy-Authorization: Bearer <workerSecret>" \
     http://app.dev.example.com/api/v1/data
```

---

## Policy Semantics & Normalization

### What is a "Target"?
A target in Scope Guard is an **exact normalized hostname**.
- Substrings, loose wildcards (`*.example.com`), and arbitrary URL path prefixes are **strictly rejected**.
- Permitting arbitrary substrings or loose regexes leads directly to bypass vulnerabilities (e.g., `example.com` accidentally matching `notexample.com` or `example.com.attacker.com`).

### Target Normalization Algorithm:
1. Parse the input using WHATWG standard URL rules (or extract hostname if raw host).
2. Strip URL credentials/userinfo (`user:pass@host` is rejected with `400 Bad Request`).
3. Strip trailing DNS root dots (`app.example.com.` -> `app.example.com`).
4. Lowercase all characters.
5. Strip default ports (`:80` for http, `:443` for https) and raw ports.
6. Validate against RFC 1123 hostname rules or bracketed IPv6.

### Precedence Rules:
1. **Engagement Status:** If status is `REVOKED` -> **DENY** (`ENGAGEMENT_REVOKED`).
2. **Deny Precedence:** If any rule for the exact normalized host has effect `DENY` -> **DENY** (`DENY_RULE_MATCHED`), even if an `ALLOW` rule also exists.
3. **Allow Match:** If a matching `ALLOW` rule exists -> **ALLOW** (`IN_SCOPE`).
4. **Default Stance:** Any destination without an explicit allow rule -> **DENY** (`NO_ALLOW_RULE`).

