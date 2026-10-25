# Scope Guard — Architecture & System Design

This document details the architectural decisions, design rationale, trade-off analyses, and operational performance models for **Scope Guard**.

---

## 1. System Architecture Overview

Scope Guard is implemented as a **modular monolith** with NestJS, TypeScript (strict mode), and PostgreSQL. Responsibilities are strictly segregated across cohesive domain modules:

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

### Logical Modules:
1. **Identity & Tenant Boundary (`src/identity`):**
   - Authenticates tenant API calls via bearer keys.
   - Manages cryptographically random worker bearer tokens (`sg_worker_<randomHex>`) and stores only SHA-256 hashes at rest.
   - Enforces strict tenant ownership on every read, write, and query.
2. **Policy Engine (`src/policy`):**
   - Manages engagements and target scope rules (`ALLOW` / `DENY`).
   - Normalizes targets to exact canonical hostnames.
   - Evaluates scope: Deny rules take absolute precedence over allow rules; default stance is Deny.
3. **Egress Proxy (`src/proxy`):**
   - High-throughput forward proxy listening on port `3128`.
   - Supports standard HTTP forward proxying and HTTPS `CONNECT` tunnels.
   - Validates worker credentials, checks fresh committed DB policy (no stale cache in v1), enforces SSRF protections, and applies token-bucket rate limiting.
4. **Durable Audit & Transactional Outbox (`src/audit`):**
   - Persists authorization decisions and durable outbox records in a single PostgreSQL transaction *before* forwarding allowed traffic.
   - Guarantees fail-closed security if local persistence fails.
   - Asynchronously dispatches events from `audit_outbox` to downstream audit sinks with bounded exponential backoff and stable event IDs for idempotent delivery.
   - Exposes bounded, paginated audit records via tenant-scoped API.

### Container Topology & Service Separation (Docker Compose)

In Docker environments, Scope Guard segregates the **Control Plane** (Management & Audit API) and the **Data Plane** (Egress Forward Proxy) into independent container services:

| Container Service | Container Name | Port | Description & Responsibilities |
|---|---|---|---|
| **API (`api`)** | `scope-guard-api` | `3000` | **Control Plane**: Runs database migrations, development seed, Express REST API (`/api/v1`), and Swagger UI (`/docs`). Operates with `SERVICE_MODE=api` (proxy listener disabled). |
| **Proxy (`proxy`)** | `scope-guard-proxy` | `3128` | **Data Plane**: Runs the high-performance Egress Forward Proxy & HTTPS `CONNECT` tunnels, SSRF defenses, token-bucket rate limiter, and Transactional Outbox dispatcher. Operates with `SERVICE_MODE=proxy` (API listener disabled). |
| **PostgreSQL (`postgres`)** | `scope-guard-postgres` | `5432` | **Persistence Layer**: PostgreSQL 15 database storing tenants, API keys, engagements, policies, audit trails, and outbox queue. |

> **Single-Process Mode (`SERVICE_MODE=all`):**
> When running locally via `npm start` or unit/integration test suites, Scope Guard defaults to `SERVICE_MODE=all`, hosting both the API on port 3000 and the Egress Proxy on port 3128 within a single unified process for frictionless local development.

---

## 2. Core Architectural Decisions & System-Level Rationale

### 2.1 Why a Modular Monolith with NestJS?
- **Decision:** Build a cohesive modular monolith rather than separating the system into independent microservices (e.g., Policy Service, Proxy Service, Audit Service).
- **Rationale:** 
  - *Zero Network Fallibility on the Critical Security Path:* Microservices introduce inter-service network hops, serialization latency, circuit breakers, and partial failure modes between policy evaluation, proxy forwarding, and audit logging. In an egress security proxy, an internal RPC network timeout between the proxy and a policy service introduces critical ambiguity. A modular monolith executes policy checks and audit transactions via direct in-process calls to local connection pools, ensuring deterministic sub-millisecond dispatch and eliminating inter-service network failure modes.
  - *Strict Transactional Atomicity:* Decoupling audit logging from policy enforcement across separate microservices would require distributed transactions (2-Phase Commit / Sagas) to ensure that traffic is never forwarded without an audit record. A unified backend allows Scope Guard to persist authorization decisions and outbox events in a single PostgreSQL ACID transaction before dispatching upstream traffic.
  - *Operational Simplicity:* Minimizes operational blast radius, requires zero service-mesh infrastructure, and guarantees single-command local orchestration via `docker compose up`.
- **Alternatives Rejected:** Microservices architecture was rejected as premature optimization that multiplies operational complexity and network failure modes without performance justification at 1,000 req/min.

### 2.2 Why an HTTP Forward Proxy & CONNECT Tunnel (Port 3128)?
- **Decision:** Implement an external, standards-compliant HTTP forward proxy and HTTPS `CONNECT` tunneling listener on port 3128.
- **Rationale:**
  - *Language-Agnostic, Tamper-Resistant Perimeter:* Autonomous AI workers execute arbitrary Python, Bash, Node.js, or compiled binary pentest tooling (e.g., `nmap`, `curl`, `sqlmap`, custom exploit scripts). An external network proxy enforces egress controls *out-of-process*. Even if an LLM is prompt-injected or executes adversarial code, it cannot tamper with the proxy's memory, bypass policy evaluation, or suppress audit logging.
  - *Standard RFC 7230/7235 Compliance:* Standard tooling natively supports `HTTP_PROXY`, `HTTPS_PROXY`, and `Proxy-Authorization` headers without requiring custom SDKs or application rewrites.
- **Alternatives Rejected:**
  - *In-Process SDK / Wrapper Library:* Rejected because untrusted LLMs executing arbitrary shell commands or native binaries can easily bypass monkey-patched libraries or in-process hooks.
  - *Reverse Proxy:* Rejected because reverse proxies require pre-configured routing tables for known upstreams and cannot handle arbitrary dynamic outbound pentesting targets.
  - *eBPF / Transparent iptables Redirection:* Rejected due to host kernel dependency, OS portability limitations, and lack of L7 credential binding context.

### 2.3 Why PostgreSQL with Prisma ORM?
- **Decision:** Use PostgreSQL as the relational store, wrapped with Prisma ORM for type-safe queries and schema management.
- **Rationale:**
  - *ACID Transaction Guarantees:* Scope Guard's core safety invariant—*persisting audit decisions before forwarding allowed traffic (fail-closed)*—requires strict ACID transactions. PostgreSQL provides rock-solid durability and row-level locking.
  - *Readability & Developer Onboarding:* Raw database queries across complex joins (`tenants`, `api_keys`, `engagements`, `worker_credentials`, `engagement_targets`, `audit_records`, `audit_outbox`) are error-prone and hard for new teammates to quickly parse. Prisma provides declarative relational schemas, compile-time TypeScript safety, and auto-generated clients, making onboarding frictionless without compromising query transparency.
- **Alternatives Rejected:**
  - *NoSQL / Document Store (e.g., MongoDB):* Rejected due to weaker multi-document transaction semantics and lack of strict relational constraints across tenants and policies.
  - *Raw `pg` SQL Driver:* Initially utilized for baseline setup, but refactored to Prisma to ensure maintainability, clear schema contracts, and developer readability.

### 2.4 Why the Transactional Outbox Pattern for Audit Delivery?
- **Decision:** Implement the Transactional Outbox pattern backed by PostgreSQL rather than direct synchronous HTTP calls or fire-and-forget in-memory queuing.
- **Rationale:**
  - *Decouples Downstream Sink Availability:* If the downstream audit sink (SIEM, logging webhook) is slow or unreachable, the proxy's hot path is unaffected. Outbox events are retried asynchronously with bounded exponential backoff.
  - *Eliminates Data Loss:* Unlike in-memory queues, outbox records survive proxy crashes and restarts.
  - *True Fail-Closed Guarantee:* The authorization decision and outbox event are committed in the same database transaction *before* traffic leaves the proxy. If PostgreSQL fails to write the audit record, the request is aborted before reaching the customer target.
- **Alternatives Rejected:**
  - *Synchronous HTTP Push on Hot Path:* Rejected because downstream latency or outages would stall proxy traffic.
  - *In-Memory Queue:* Rejected because process crashes result in unrecoverable audit loss.
  - *Kafka / RabbitMQ:* Rejected as an external dependency violation under the assignment constraints.

---

## 3. Key Architectural Decisions & System Trade-offs

### Architectural Decision Matrix

| # | Key Architectural Question | Chosen Architecture | Primary Rationale | Trade-offs & Accepted Costs |
| :--- | :--- | :--- | :--- | :--- |
| **3.1** | **How worker proves engagement identity** | Cryptographically random, engagement-scoped bearer token (`sg_worker_<randomHex>`), SHA-256 hashed at rest; authenticated via standard `Proxy-Authorization: Bearer <secret>`. | Protocol conformance (RFC 7235), unguessable 256-bit entropy, zero ambient authority (cannot supply tenant/engagement IDs), and database breach safety (hashes only). | Token replayable if exfiltrated from the worker environment prior to revocation. |
| **3.2** | **What exactly a target is** | Exact canonical hostname + port (`host:port`). Authorizing `app.example.com:8443` permits only port 8443. Bare domains (`host`) permit standard web ports (80, 443), blocking non-web ports (e.g. SSH 22). Wildcard ports (`host:*`) permit any port on that host. | Eliminates unauthorized port-scanning and lateral service pivoting by autonomous LLMs. Enforces strict port-level scope containment across both HTTP and HTTPS CONNECT tunnels without TLS interception. | Requires explicit port enumeration if non-standard ports are targeted. |
| **3.3** | **Redirect behavior** | Return HTTP 3xx responses directly and unaltered to the client/worker without automatic proxy-side following. | Completely eliminates open-redirect SSRF bypasses. Guarantees 100% audit fidelity (zero invisible network hops) and conforms to RFC 7230/7231 proxy semantics. | Worker HTTP client library must be configured to follow redirects through the proxy. |
| **3.4** | **When policy store is unreachable** | **Strict Fail-Closed**. Reject request immediately with HTTP 503 (`POLICY_UNAVAILABLE`); abort connection before upstream TCP socket creation. | Security and perimeter containment strictly prioritized over availability. Unverified requests never cross the perimeter. | Upstream availability is coupled to PostgreSQL health; downtime halts worker traffic. |
| **3.5** | **When audit sink is unreachable** | **Transactional Outbox Pattern**. Persist authorization decision and outbox event in PostgreSQL in one transaction *before* forwarding. Decoupled async dispatcher retries sink delivery with backoff. | Decouples proxy latency and availability from external SIEM outages. Guarantees durable audit persistence before traffic departs (fail-closed if local DB fails). | Minor sub-second eventual consistency to external SIEM; dual database writes (record + outbox row). |

---

### 3.1 ADR-1: How Worker Proves Engagement Identity

#### Context & Problem Statement
The worker agent is an untrusted autonomous LLM operating in an external runtime. Scope Guard must determine which engagement the outbound request belongs to, enforce tenant isolation, and ensure that a worker cannot forge an identity or pivot into another tenant's engagement.

#### Chosen Architecture
- **Cryptographic High-Entropy Bearer Token (`sg_worker_<randomHex>`):**
  - Upon engagement creation (`POST /api/v1/engagements`), Scope Guard generates 32 cryptographically random bytes via Node.js `crypto.randomBytes(32)` (256 bits of entropy).
  - The plaintext secret (`sg_worker_<hex>`) is returned **exactly once** in the creation response to the authenticated tenant.
  - Scope Guard calculates the **SHA-256 hash** of the secret and persists only the hash in the `worker_credentials` table along with the immutable `engagement_id` foreign key.
- **Standard Protocol Delivery (`Proxy-Authorization: Bearer <secret>`):**
  - The worker configures standard environment variables (`http_proxy="http://proxy:3128"` and `https_proxy="http://proxy:3128"`).
  - Outbound requests present the secret via RFC 7235 `Proxy-Authorization: Bearer <secret>` (or fallback `Authorization: Bearer <secret>`).
- **Validation Hot Path:**
  - The proxy hashes the incoming token using SHA-256 and executes a constant-time lookup against PostgreSQL indexed on `secret_hash`.
  - The engagement identity and tenant boundary are derived strictly from the verified hash. The caller is never permitted to supply caller-controlled `tenant_id` or `engagement_id` parameters.

#### Security Rationale
1. **Zero Ambient Authority:** The worker cannot claim to act on behalf of an engagement by sending arbitrary headers (e.g. `X-Engagement-ID`). Possession of the cryptographic secret is the sole proof of identity.
2. **Breach Containment:** If the PostgreSQL database is read or dumped, attackers obtain only SHA-256 hashes. They cannot derive the plaintext worker tokens required to make proxy requests.
3. **Cross-Platform Compatibility:** Every standard pentesting tool (`curl`, Python `requests`, Node `undici`, Go `net/http`, Burp Suite) natively supports `Proxy-Authorization: Bearer`.

#### Alternatives Evaluated & Rejected
- **Caller-Supplied Engagement ID + Tenant API Key:**
  - *Why Rejected:* AI workers should never possess the customer's root Tenant API Key. A compromised worker could create unauthorized engagements or read other engagements.
- **Client mTLS Certificates:**
  - *Why Rejected:* While mTLS provides non-replayable cryptographic binding, generating, distributing, and rotating PKI client certificates inside dynamic, short-lived Docker containers adds substantial orchestration overhead.

#### Trade-offs & Accepted Limitations
- **Bearer Secret Replay:** Like all bearer credentials, if an attacker exfiltrates the worker secret prior to engagement revocation, they can replay requests through the proxy. Mitigation is immediate revocation via `POST /api/v1/engagements/:id/revoke`.

---

### 3.2 ADR-2: What Exactly a "Target" Is

#### Context & Problem Statement
Customer security policies define what resources autonomous pentesting workers may interact with. How should a "target" be defined: as an exact hostname, a wildcard (`*.corp.com`), a CIDR IP range (`192.168.1.0/24`), or a URL path prefix (`https://api.corp.com/v1`)? Crucially, should targets be host-only or enforce both **Host and Port**?

#### Chosen Architecture
- **Strict Host + Port Targeting Model:**
  - A target destination is evaluated as both **canonical hostname and port** (`host:port`).
  - **Exact `host:port` Rule:** Specifying an explicit port (e.g., `app.dev.example.com:8443` or `example.com:443`) strictly restricts traffic to that exact port. Requests to any other port on that host (e.g., SSH port 22, database ports) are denied with `403 Forbidden` (`NO_ALLOW_RULE`).
  - **Default Bare Domain Semantics (`host`):** If a customer specifies a bare hostname without a port in an `ALLOW` rule (e.g., `app.dev.example.com`), Scope Guard permits only **standard web ports** (`80` for HTTP and `443` for HTTPS). Non-web ports (e.g. 22 SSH, 8080 alt-http, 6379 Redis) are blocked. Conversely, a bare hostname in a `DENY` rule denies **all ports** on that host.
  - **Explicit Wildcard Port (`host:*`):** A tenant may specify a wildcard port (e.g., `lab.example.com:*`) when multi-port scanning or full-stack pentesting on a target host is explicitly approved.
  - **Deny-Overrides-Allow at Port Granularity:** Specific port deny rules (e.g., `example.com:8080` DENY) take precedence over broader host allow rules.
  - Inputs are canonicalized: lowercased, trailing DNS root dots stripped (`example.com.` -> `example.com`), IPv6 brackets normalized, and validated against RFC 1123 hostname syntax.

#### Security Rationale
1. **Preventing Autonomous Agent Exploitation & Lateral Pivoting:**
   - Autonomous LLM pentesting agents routinely execute nmap sweeps, service enumeration, and credential brute-forcing against non-web daemons (SSH port 22, Redis port 6379, MySQL 3306, internal admin consoles on 8080/8443).
   - If scope only validated the hostname, authorizing `example.com` would grant an LLM agent free rein to exploit an internal SSH server or database daemon exposed on that same host. Enforcing port-level containment guarantees that agents stay strictly within their intended service boundaries.
2. **Protocol Parity Between HTTP and HTTPS `CONNECT` Tunnels:**
   - In HTTPS `CONNECT` tunneling (RFC 7231), the client requests a TCP tunnel by specifying the destination authority and port (`CONNECT app.example.com:443 HTTP/1.1` or `CONNECT example.com:22`).
   - Plaintext HTTP forward requests provide the destination port via absolute URI or `Host` header (defaulting to 80).
   - Both HTTP and HTTPS proxy mechanisms expose the target port to Scope Guard before any connection to the destination is opened. Evaluating `host:port` provides uniform, identical policy evaluation for both plaintext HTTP and encrypted HTTPS traffic without requiring TLS interception (MITM).
3. **Elimination of Path-Traversal & Substring Bypass Attacks:**
   - Path-prefix matching is notoriously susceptible to parser differentials (`/api/v1/..;/admin`, URL-encoded slashes `%2f`, Unicode normalization, Matrix parameters). Host + Port matching is mathematically discrete and unambiguous.
   - Wildcard domain matching (`*.example.com`) introduces subdomain takeover risks and accidental over-scoping.

#### Alternatives Evaluated & Rejected
- **Host-Only Without Port:**
  - *Why Rejected:* Allows untrusted workers to probe non-web services (SSH, Redis, DBs, internal debugging ports) on authorized web hosts.
- **URL Path-Prefix Matching (`https://example.com/api/v1`):**
  - *Why Rejected:* Path matching is impossible for HTTPS traffic without performing TLS interception. In addition, path normalization discrepancies between proxy engines and upstream backends create high-severity bypass vulnerabilities.
- **Wildcard Subdomains (`*.example.com`):**
  - *Why Rejected:* In enterprise environments, third-party SaaS tools or forgotten subdomains (`abandoned.example.com`) frequently point to dangling CNAMEs. Wildcards inadvertently grant untrusted workers permission to attack out-of-scope or third-party hosted assets.

#### Trade-offs & Accepted Limitations
- **Coarse-Grained Path Control:** Authorizing `host:port` authorizes all paths on that port. If a customer wishes to authorize only `/v1/public` and forbid `/admin` on the same port, Scope Guard cannot enforce this without TLS termination.
- **Explicit Port Definition:** Non-standard ports (e.g. 8080, 8443) must be explicitly listed in the target scope.

---

### 3.3 ADR-3: HTTP Redirect Handling & Policy Traversal

#### Context & Problem Statement
When an authorized upstream server responds with an HTTP redirect (`301 Moved Permanently`, `302 Found`, `307 Temporary Redirect`) pointing to an external destination, how should Scope Guard handle it?

#### Chosen Architecture
- **Unaltered Return to Client (No Automatic Proxy Following):**
  - Scope Guard **never follows HTTP redirects on behalf of the client**.
  - The proxy returns the upstream `3xx` redirect status, headers (including `Location`), and response body directly to the worker client.
  - When the worker follows the redirect, the subsequent request arrives at Scope Guard as a **new, independent outbound proxy request**.
  - This request must independently undergo worker authentication, policy evaluation against fresh committed rules, rate limiting, and pre-forward audit logging.

#### Security Rationale
1. **Complete Elimination of Open-Redirect SSRF Bypasses:**
   - If a proxy automatically follows redirects, an in-scope server with an open-redirect vulnerability (`http://allowed.com/redirect?url=http://169.254.169.254/`) could trick the proxy into requesting forbidden cloud metadata or out-of-scope targets behind the proxy's identity.
   - Forcing every redirect hop through the front door ensures that out-of-scope redirect locations are rejected with HTTP 403 before any TCP connection is established.
2. **100% Audit Fidelity (Zero Hidden Network Hops):**
   - Every single network hop executed across the wire corresponds to an immutable record in `audit_records`.
3. **Transport Intermediary Conformance (RFC 7230 / RFC 7231):**
   - The HTTP specification defines forward proxies as transport intermediaries, not user-agents. User-agents own redirect policies and method rewrite semantics.

#### Alternatives Evaluated & Rejected
- **Automatic Proxy-Side Redirect Following with Scope Checking:**
  - *Why Rejected:* Statefully following redirects across multiple hops requires complex redirect loop detection, cookie jar persistence, and re-buffering streaming POST request bodies, creating unnecessary complexity and attack surface.

---

### 3.4 ADR-4: Proxy Behavior When Policy Store Is Unreachable

#### Context & Problem Statement
If PostgreSQL becomes temporarily unreachable, exhausts its connection pool, or crashes, what should the egress proxy do when a worker attempts an outbound request?

#### Chosen Architecture
- **Strict Fail-Closed Enforcement (Zero Trust Perimeter):**
  - Scope Guard immediately aborts the request before any upstream socket or DNS lookup is initiated.
  - Returns **HTTP 503 Service Unavailable** with standard JSON error payload:
    `{"error": "Scope Guard policy store unavailable. Failing closed.", "decision": "DENY", "reason": "POLICY_UNAVAILABLE"}`.
  - For HTTPS `CONNECT` requests, the socket is immediately terminated with `HTTP/1.1 503 Service Unavailable\r\n\r\n`.
  - The failure is logged to standard error (`stderr`) structured logs.

#### Security Rationale
1. **Containment Prioritized Over Availability:** In security engineering, availability is subordinate to containment. Forwarding an unverified request could allow an autonomous agent to execute an unauthorized exploit payload against an out-of-scope production database.
2. **DoS-to-Bypass Attack Elimination:** If the proxy failed open during database outages, an adversarial worker or compromised LLM could intentionally flood PostgreSQL with heavy queries, induce a database outage, and immediately achieve unrestricted, unmonitored egress.
3. **Preservation of the Revocation Invariant:** If the proxy fell back to a stale in-memory cache, an engagement revoked during a security incident would continue to forward dangerous worker traffic while the database was recovering.

#### Alternatives Evaluated & Rejected
- **Fail-Open (Forward Anyway):**
  - *Why Rejected:* Catastrophic breach of perimeter control.
- **Fallback to In-Memory Stale Policy Cache:**
  - *Why Rejected:* Violates the strict revocation guarantee. Revoked engagements must stop immediately.

---

### 3.5 ADR-5: Proxy Behavior When Audit Sink Is Unreachable

#### Context & Problem Statement
Scope Guard must deliver audit records to downstream audit sinks (SIEMs, customer webhooks, logging collectors). What happens when the downstream audit sink is slow, experiencing network partitions, or offline?

#### Chosen Architecture
- **Transactional Outbox Pattern (PostgreSQL-Backed):**
  - When an outbound request is authorized, Scope Guard persists the authorization decision (`audit_records`) and a pending outbox event (`audit_outbox`) **in a single atomic PostgreSQL transaction *before* the upstream request is forwarded**.
  - **Local Durability Fail-Closed:** If this local database transaction fails, the proxy **fails closed** (the request is aborted, and nothing is forwarded upstream).
  - **Decoupled Async Dispatcher:** Once the local transaction commits, the upstream request proceeds immediately. A background dispatcher (`AuditOutboxDispatcherService`) polls pending outbox records and delivers them to the downstream sink.
  - **Reliable Retry with Backoff:** If the downstream sink fails or times out, the dispatcher increments `retry_count`, logs `last_error`, and reschedules delivery using bounded exponential backoff (`Math.min(60000, 1000 * 2^retry)`).
  - **Idempotency Guarantees:** Every outbox record carries a stable, unique UUID (`eventId` and `auditRecordId`), allowing downstream sinks to deduplicate retried events.

#### Security Rationale
1. **Decoupling Network Fault Domains:** External SIEMs and HTTP webhooks frequently experience network jitter and rate limits. If the proxy hot path synchronously posted to an external HTTP webhook, proxy throughput would collapse and external sink outages would halt all worker egress.
2. **Zero Audit Loss (At-Least-Once Delivery):** In-memory queues lose all pending audit records if the container crashes, runs out of memory, or restarts. The Transactional Outbox guarantees that every audit record is durably flushed to disk on PostgreSQL WAL before traffic departs the perimeter.
3. **True Audit-Before-Forward Guarantee:** The proxy never forwards allowed traffic without a committed audit record. If the database cannot write the record, the request is blocked, preventing "ghost" unaudited egress.
4. **Compliance With Assignment Constraints:** Avoids heavyweight distributed message brokers (Kafka, RabbitMQ, SQS) while providing identical reliability semantics using PostgreSQL's existing ACID transaction engine.

---

## 4. Operational Thinking, Hot-Path Analysis & Caching

### Hot-Path Analysis
For every outbound proxy request, the hot path executes:
1. Worker credential hash calculation (in-memory SHA-256, < 0.05ms).
2. Worker credential & current policy lookup (`SELECT ... FROM worker_credentials ...`, indexed on `secret_hash`, ~1-2ms).
3. Target normalization & policy evaluation (in-memory, < 0.1ms).
4. Rate limit check (in-memory token bucket, < 0.01ms).
5. Pre-forward audit transaction (`INSERT INTO audit_records ... INSERT INTO audit_outbox ... COMMIT`, ~2-4ms).
6. SSRF destination check & DNS resolution (~1-3ms).
7. Upstream TCP / HTTP I/O (dominated by network latency).
8. Upstream outcome update (`UPDATE audit_records ...`, ~1-2ms).

### Workload Assessment: 1,000 Requests / Minute
- 1,000 requests/minute is **~16.7 requests/second**.
- A standard PostgreSQL instance on modern hardware comfortably handles 2,000–5,000 transactions/second. 16.7 requests/second requires negligible CPU (< 3%) and connection pool depth (10–20 connections is ample).

### The Caching Decision: Why Zero Cache in v1?
- We intentionally chose **not to cache policy state in v1**.
- **Rationale:** Fresh committed DB reads guarantee that when an engagement is revoked via `POST /api/v1/engagements/:id/revoke`, **every subsequent request is blocked immediately**.
- Adding a cache introduces staleness windows, complex cache-invalidation messaging across instances, and time-of-check races. For 16.7 req/sec, the database read cost (~1ms) is dwarfed by upstream network latency (50–200ms).

---

## 5. What Would Be Done With Another Day

1. **Client mTLS Authentication:** Replace worker bearer tokens with ephemeral mTLS client certificates tied to the engagement lifecycle, eliminating bearer token replay risk.
2. **Distributed Rate Limiting:** Back the token bucket with Redis using atomic Lua scripts or sliding-window counters for multi-instance deployments.
3. **Cryptographic Audit Log Verification:** Implement tamper-evident cryptographic chaining (hash-linked Merkle tree or append-only ledger) for audit records.
4. **Socket-level DNS Pinning:** Connect directly to the verified resolved IP address to eliminate time-of-check to time-of-use (TOCTOU) DNS rebinding gaps.

