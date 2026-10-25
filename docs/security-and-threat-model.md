# Scope Guard — Security, Threat Model & SSRF Defense

Scope Guard is designed specifically to contain autonomous, LLM-driven agents operating in adversarial environments. This document outlines the threat model, defense-in-depth controls, rate limiting, and known system boundaries.

---

## 1. Threat Model & Adversarial Assumptions

Scope Guard assumes the AI worker agent is **untrusted**:
- The worker runtime may be compromised via prompt injection, malicious supply-chain dependencies, or jailbroken system prompts.
- An adversarial worker will actively attempt to:
  1. Forge tenant or engagement identities to tamper with other customers.
  2. Pivot into internal networks (SSRF against cloud metadata, VPC services, or database ports).
  3. Port-scan or pivot to non-web services (e.g. SSH 22, Redis 6379, MySQL 3306) on authorized domains.
  4. Evade scope restrictions via open redirects, DNS rebinding, or URL parsing discrepancies.
  5. Continue operating after customer security teams have revoked the engagement.
  6. Exhaust upstream systems via denial-of-service floods.

---

## 2. SSRF Defense in Depth & Port Containment

Treating the worker as potentially adversarial, Scope Guard defends against internal network pivoting and lateral exploitation across multiple layers:

### Strict Port-Level Scope Containment
Autonomous agents are strictly confined to permitted ports:
- Bare domain allow rules permit only standard web ports (`80` and `443`).
- Explicit port targets (e.g. `api.example.com:8443`) only allow that single port.
- Probing unauthorized services (e.g. SSH 22, database ports 5432/3306, alternative HTTP 8080) on authorized domain names is blocked with `403 Forbidden` (`NO_ALLOW_RULE`) before establishing upstream connections.
- Wildcard ports (`host:*`) require explicit tenant authorization.

### Prohibited Destinations (Blocked Out-of-the-Box)
- **Loopback:** `127.0.0.0/8`, `::1`
- **RFC 1918 Private Networks:**
  - `10.0.0.0/8`
  - `172.16.0.0/12` (172.16.0.0 - 172.31.255.255)
  - `192.168.0.0/16`
- **RFC 3927 Link-Local & Cloud Metadata:** `169.254.0.0/16` (including AWS/GCP metadata at `169.254.169.254`)
- **Multicast & Broadcast:** `224.0.0.0/4`, `255.255.255.255`
- **Unspecified Addresses:** `0.0.0.0`, `::`

### DNS Rebinding Defense
Hostname strings are resolved to IP addresses via `dns.lookup`, and the resolved IP is validated prior to initiating the TCP socket. If a public domain name resolves to an internal RFC 1918 or link-local address, the proxy aborts the request before connection establishment.

### Development Mock Target Override
An explicit, test-only environment flag `ALLOW_LOCAL_MOCK_TARGETS=true` permits loopback mock targets during automated tests and demo runs. In production, this flag is disabled (`false`), enforcing unconditional loopback rejection.

---

## 3. Worker Identity & Cryptographic Guarantees

- **High-Entropy Token:** Generated via Node's `crypto.randomBytes(32)` (256 bits of entropy).
- **Hashed at Rest:** Only the SHA-256 hash is persisted in the `worker_credentials` table.
- **Timing-Safe Comparison:** Constant-time comparison ensures no timing side-channels exist during hash checks.
- **Limitation (Honest Trade-off):** A bearer secret cannot be forged, but like any bearer credential, if an attacker exfiltrates it from an untrusted worker, it can be replayed until the engagement is revoked. True non-replayable credentials require client mTLS certificates or request-bound asymmetric signatures.

---

## 4. Rate Limiting (P6)

Scope Guard includes an in-memory **Token Bucket Rate Limiter**:
- **Key:** `(engagement_id, normalized_target_hostname)`
- **Behavior:**
  - Configurable burst capacity (default 10 tokens) and sustained refill rate (default 2 tokens/sec).
  - Scope evaluation occurs *before* rate-limit consumption (out-of-scope requests never consume rate-limit tokens).
  - When exhausted, returns **HTTP 429 Too Many Requests** with `Retry-After: <seconds>` header and records an audit decision with reason `RATE_LIMIT_EXCEEDED`.
- **Limitation:** In-memory state resets upon application restart and is not shared across multi-instance clusters. In distributed production, this would be backed by Redis or PostgreSQL advisory locks.

---

## 5. What Scope Guard Does NOT Protect Against (Honest Limitations)

1. **Direct Egress Bypass (Perimeter Boundary):** Scope Guard is an application-level proxy. If the host or container running the AI worker has direct internet access without firewall rules (e.g. `iptables` / security group blocking non-3128 egress), an attacker in the worker can bypass the proxy entirely.
2. **Bearer Token Theft / Replay:** If an attacker extracts the worker's bearer secret from memory or disk, they can make requests through the proxy until the engagement is revoked.
3. **Payload Inspection Inside HTTPS CONNECT:** For HTTPS requests via `CONNECT`, the tunnel is an end-to-end TLS session between the worker and target. Scope Guard enforces the destination hostname and audits the `CONNECT` target, but cannot inspect inner HTTP methods or request bodies without TLS interception (which was an explicit non-goal).
4. **Complete Database Outage Denial Logging:** If PostgreSQL suffers a catastrophic outage, the proxy fails closed (rejects all requests). However, the denial itself cannot be persisted into PostgreSQL during a total database failure (it is logged to stdout/stderr structured logs).
5. **In-Flight Cancellation:** Revocation takes effect for all authorization checks that occur *after* the revocation transaction commits. Requests that were already authorized and dispatched upstream cannot be recalled.

---

## 6. AI Tooling & Human Decisions

In accordance with Shinobi Security instructions, AI assistance was leveraged during development:
- **Tools Used:** AI coding assistant with TypeScript, NestJS, and PostgreSQL toolchains.
- **Suggestions Accepted:**
  - Initial scaffolding of NestJS modules and parameter validation pipes.
  - Construction of comprehensive hostname normalization edge cases (trailing dots, ports, WHATWG parsing).
- **Suggestions Modified / Rejected / Overridden:**
  - *Adopted Prisma ORM:* Initially built with raw `pg` queries. Overridden to adopt **Prisma ORM** (`prisma/schema.prisma` and `@prisma/client`) to drastically improve query readability, self-documenting schema relationships, and developer onboarding ergonomics for incoming engineers, while maintaining atomic transactions and strict tenant boundaries within repository wrappers.
  - *Rejected:* In-memory policy caching. Explicitly eliminated to preserve immediate revocation consistency.
  - *Modified:* Audit persistence. Initially proposed as synchronous sink HTTP calls; replaced with the Transactional Outbox pattern backed by PostgreSQL to decouple downstream sink outages from proxy availability.

