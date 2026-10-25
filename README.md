# Scope Guard

**Egress Control, Policy Enforcement, and Durable Audit Proxy for Autonomous AI Workers**

Scope Guard acts as an explicit security boundary between untrusted, LLM-driven agents and customer live systems. Every outbound request made through the Scope Guard proxy is authenticated, associated with an active engagement, verified against the current committed scope policy, allowed or rejected, and recorded with durable audit logging.

---

## Documentation Directory

To make navigating and evaluating Scope Guard effortless, detailed documentation is organized into focused guides:

| Document | Description |
| :--- | :--- |
| 📘 **[Architecture & System Design](docs/architecture.md)** | Deep-dive into system modules, container topology, modular monolith rationale, hot-path analysis, and the 5 Architectural Decision Records (ADRs). |
| 🧪 **[Manual Docker Verification Walkthrough](docs/manual-walkthrough.md)** | Sequential 14-step manual testing guide with ready-to-run `curl` and PowerShell commands. |
| 📡 **[API Reference & Multi-Tenant Guide](docs/api-reference.md)** | Complete `/api/v1` catalog, request/response schemas, Swagger UI guide, policy normalization rules, and tenant onboarding CLI. |
| 🛡️ **[Security, Threat Model & SSRF Defense](docs/security-and-threat-model.md)** | Untrusted LLM threat model, multi-layer SSRF defenses, token-bucket rate limiting, and system boundaries. |

---

## 1. System Topology & Architecture

Scope Guard is architected as a modular NestJS + PostgreSQL system deployed as segregated container services:

```
                  +--------------------------------------------------------+
                  |                  Scope Guard System                    |
                  |                                                        |
+---------------+ |  +-----------------------+    +---------------------+  |
| Customer /    | |  | Management & Audit API|    | Egress Proxy Engine |  |    +------------------+
| Security Team |--> | Port 3000 (/api/v1)   |    | Port 3128           | --->| Customer Upstream|
+---------------+ |  +-----------+-----------+    +----------+----------+  |    | Target Systems   |
 (Tenant Bearer)  |              |                           |             |    +------------------+
                  |              |                           |             |
                  |              v                           v             |
+---------------+ |  +--------------------------------------------------+  |
| AI Worker     | |  |               PostgreSQL Database                |  |
| Agents        |--> |  - Tenants & API Keys   - Audit Records          |  |
+---------------+ |  |  - Engagements & Rules  - Audit Outbox (Queue)   |  |
 (Worker Bearer)  |  +--------------------------------------------------+  |
                  +--------------------------------------------------------+
                                             |
                                             v  (Background Dispatcher)
                                    +------------------+
                                    | Downstream Audit |
                                    | Sink / SIEM      |
                                    +------------------+
```

### Container Services in Docker Compose

| Service | Container Name | Port | Responsibilities |
| :--- | :--- | :--- | :--- |
| **`postgres`** | `scope-guard-postgres` | `5432` | PostgreSQL 15 database storing tenants, API keys, engagements, policies, audit trails, and outbox queue. |
| **`api`** | `scope-guard-api` | `3000` | **Control Plane**: Runs migrations, development seed, Express REST API (`/api/v1`), and Swagger UI (`/docs`). (`SERVICE_MODE=api`) |
| **`proxy`** | `scope-guard-proxy` | `3128` | **Data Plane**: Runs the forward proxy, HTTPS `CONNECT` tunnels, SSRF defenses, rate limiter, and Transactional Outbox dispatcher. (`SERVICE_MODE=proxy`) |

---

## 2. Quickstart & How to Run

### Quick Reference: Testing Credentials & Keys

| Credential Type | Purpose | Header / Usage | Pre-Seeded / Generated Value |
| :--- | :--- | :--- | :--- |
| **Tenant Alpha API Key** | REST API & Swagger UI (`:3000`) | `Authorization: Bearer <key>` | `sg_tenant_demo_secret_key_12345` |
| **Tenant Beta API Key** | Multi-Tenant Isolation Testing (`:3000`) | `Authorization: Bearer <key>` | `sg_tenant_beta_secret_key_67890` |
| **Worker Proxy Secret** | Forward Proxy & CONNECT (`:3128`) | `Proxy-Authorization: Bearer <secret>` | Generated dynamically via `POST /api/v1/engagements` (returns `sg_worker_<hex>`) |

---

### Option A: Single Command via Docker Compose (Recommended)

```bash
# 1. Start PostgreSQL, Management API, and Egress Proxy
docker compose up --build -d

# 2. Run the automated demo simulation
npm run demo
# or using bash:
./scripts/demo.sh

# 3. View live logs
docker compose logs -f api
docker compose logs -f proxy
```

To stop and wipe database volumes:
```bash
docker compose down -v
```

### Option B: Native Local Development

**Prerequisites:** Node.js `v20+` or `v22+`, PostgreSQL `v14+` running locally.

```bash
# 1. Install dependencies
npm install

# 2. Run database migrations & seed demo tenants
npm run migrate
npm run seed

# 3. Start Scope Guard (boots both API on 3000 and Proxy on 3128)
npm start
```

---

## 3. Automated Test Suites & Verification

Scope Guard includes comprehensive verification suites covering unit, integration, live container, and multi-tenant isolation tests:

```bash
# Run complete test suite (18 suites, 78 tests passing)
npm test

# Run live Docker container verification suite (12-step validation against running containers)
npm run test:docker

# Run multi-tenant isolation verification (Tenant Alpha vs Tenant Beta)
npm run test:isolation

# Run static type checking & analysis
npm run lint

# Run production build
npm run build
```

---

## 4. Interactive Swagger UI & Seed Credentials

- **Interactive Swagger UI:** [http://localhost:3000/docs](http://localhost:3000/docs) (or [http://localhost:3000/api/docs](http://localhost:3000/api/docs))
- **OpenAPI JSON Spec:** [http://localhost:3000/docs-json](http://localhost:3000/docs-json)

### Pre-Seeded Tenants for Immediate Testing

Scope Guard automatically provisions **two isolated tenants** out of the box so multi-tenant boundaries can be tested without setup:

| Tenant | Tenant ID | Role / Organization | API Key (Bearer Token) |
| :--- | :--- | :--- | :--- |
| **Tenant Alpha** | `tenant_demo_01` | Acme Corp Pentesting | `sg_tenant_demo_secret_key_12345` |
| **Tenant Beta** | `tenant_demo_02` | Cyberdyne Security | `sg_tenant_beta_secret_key_67890` |

### Provisioning Additional Tenants
```bash
npm run tenant:create -- "Cyberdyne Systems"
```
*Note: Save the generated plaintext key displayed in the terminal. Only its SHA-256 hash is persisted.*

---

## 5. Architectural Decisions & System Trade-offs

| # | Key Architectural Question | Chosen Architecture | Primary Rationale | Trade-offs & Accepted Costs |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **How worker proves engagement identity** | Cryptographically random, engagement-scoped bearer token (`sg_worker_<randomHex>`), SHA-256 hashed at rest; authenticated via standard `Proxy-Authorization: Bearer <secret>`. | Protocol conformance (RFC 7235), unguessable 256-bit entropy, zero ambient authority (cannot supply tenant/engagement IDs), and database breach safety (hashes only). | Token replayable if exfiltrated from the worker environment prior to revocation. |
| **2** | **What exactly a target is** | Exact canonical hostname + port (`host:port`). Authorizing `app.example.com:8443` permits only port 8443. Bare domains (`host`) permit standard web ports (80, 443), blocking non-web ports (e.g. SSH 22). Wildcard ports (`host:*`) permit any port on that host. | Eliminates unauthorized port-scanning and lateral service pivoting by autonomous LLMs. Enforces strict port-level scope containment across both HTTP and HTTPS CONNECT tunnels without TLS interception. | Requires explicit port enumeration if non-standard ports are targeted. |
| **3** | **Redirect behavior** | Return HTTP 3xx responses directly and unaltered to the client/worker without automatic proxy-side following. | Completely eliminates open-redirect SSRF bypasses. Guarantees 100% audit fidelity (zero invisible network hops) and conforms to RFC 7230/7231 proxy semantics. | Worker HTTP client library must be configured to follow redirects through the proxy. |
| **4** | **When policy store is unreachable** | **Strict Fail-Closed**. Reject request immediately with HTTP 503 (`POLICY_UNAVAILABLE`); abort connection before upstream TCP socket creation. | Security and perimeter containment strictly prioritized over availability. Unverified requests never cross the perimeter. | Upstream availability is coupled to PostgreSQL health; downtime halts worker traffic. |
| **5** | **When audit sink is unreachable** | **Transactional Outbox Pattern**. Persist authorization decision and outbox event in PostgreSQL in one transaction *before* forwarding. Decoupled async dispatcher retries sink delivery with backoff. | Decouples proxy latency and availability from external SIEM outages. Guarantees durable audit persistence before traffic departs (fail-closed if local DB fails). | Minor sub-second eventual consistency to external SIEM; dual database writes (record + outbox row). |

*Full Architectural Decision Records (ADRs) with context, alternatives evaluated, and decision criteria are available in [docs/architecture.md](docs/architecture.md).*

---

## 6. Quick Verification Walkthrough

To verify Scope Guard with a single command:
```bash
docker compose up --build -d
npm run demo
```

To run through the complete 14-step manual `curl` / PowerShell walkthrough, refer to [docs/manual-walkthrough.md](docs/manual-walkthrough.md).

