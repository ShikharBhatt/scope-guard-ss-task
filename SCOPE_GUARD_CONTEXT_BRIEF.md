# Scope Guard — Conversation Context Brief

## Purpose
This is a concise companion to `SCOPE_GUARD_SPECIFICATION.md`. It captures the decisions, rationale, priorities, and workflow established during design. Use both files. The full specification is the detailed implementation contract; the original Shinobi Security take-home assignment remains authoritative if a conflict arises. Flag conflicts instead of silently resolving them.

## 1. Project goal
Build **Scope Guard**, a small, complete backend for controlling outbound requests made by untrusted LLM-driven agents working against customer live systems. The assignment suggests a 5–6 hour time budget. Favor secure, demonstrable correctness and maintainable code over feature breadth.

Core components:
1. **Policy API:** manage tenant-owned engagements with allowed targets, denied targets, and active/revoked status.
2. **Egress proxy:** authenticate each request, check current scope, reject or forward it, and record the authorization decision.
3. **Audit API:** expose engagement activity to the owning tenant, including timestamp, engagement, method, target, decision, and reason.

Tenants may own multiple engagements. Denied targets override allowed targets. Revocation must block requests whose authorization check occurs after revocation has committed.

## 2. Preferred stack and constraints
- NestJS + TypeScript; use strict TypeScript settings where practical.
- PostgreSQL.
- Docker Compose and repeatable local setup.
- API versioning from the start, e.g. `/api/v1`.
- No frontend is required.
- Use a controlled local mock HTTP target for demonstrations and end-to-end tests; do not depend on public websites.
- Keep the design small and easy for another developer to debug.
- No Kubernetes, cloud deployment, TLS interception, Redis, message brokers, or distributed microservices unless a measured need justifies them.
- Do not build elaborate custom authentication or a complex anti-replay scheme.

## 3. Decisions established during discussion

### Identity and tenant isolation
- Use a bearer credential for management/audit API calls, mapped to a tenant.
- Give each engagement a high-entropy, randomly generated worker bearer secret.
- Store a secure hash of the worker secret where feasible; show plaintext only at creation time.
- Be honest: a stolen bearer secret can be replayed until revoked/rotated. Do not claim replay protection that is not implemented.
- Derive tenant identity from authenticated credentials, never from caller-supplied tenant IDs.
- Enforce ownership on every read, mutation, and audit query, including nested routes. Cross-tenant requests must be denied without leaking data.

### Target and policy semantics
- Normalize hostnames consistently and compare exact hostnames. No substring, loose wildcard, or arbitrary URL-prefix matching.
- Deny rules override allow rules.
- Validate input at API boundaries and document the exact target format.
- Hostname checks alone do not fully prevent SSRF. Consider loopback, private, link-local, multicast, IPv4-mapped IPv6, DNS rebinding, and the actual resolved destination. If full defenses are beyond scope, document the limitation explicitly.
- Any local mock-target exception must be explicit and test-only/development-only; never create a broad production bypass.

### Revocation and freshness
- Do not cache policy in the first implementation. Read current committed policy for each authorization check.
- This favors simple revocation semantics over lower database load.
- State the consistency boundary accurately: after the revocation transaction commits, subsequent authorization checks reject the engagement. Already authorized/in-flight requests cannot be recalled.
- Do not claim revocation interrupts requests already being forwarded unless implemented and tested.

### Proxy behavior
- Prioritize reliable HTTP forwarding and enforcement.
- HTTPS `CONNECT` is desirable only if safely implementable and testable within the time budget. Never claim support unless implemented and tested. If deferred, say so plainly in the README.
- Do not perform TLS interception.
- Do not blindly follow redirects. Disable automatic following or follow redirects manually with a hop limit and re-check scope (and rate limits, if implemented) at every destination.
- Rejected requests must never reach the upstream target.
- Return actionable, safe errors without exposing credentials or internal details.

### Audit behavior
- Record each authorization decision with timestamp, engagement, method, target, decision, and reason.
- Keep authorization decision and upstream outcome conceptually distinct where feasible: an allowed request can still fail upstream.
- Prefer to persist the required decision before forwarding an allowed request.
- If required audit persistence fails, fail closed rather than forwarding without the required audit record.
- Document which events are audited, including rejections, allowed decisions, upstream failures, and rate-limit rejections if applicable.

### Rate limiting
- Desired but lowest priority.
- If implemented, use a token bucket keyed by `(engagement_id, normalized_target_hostname)`, with configurable rate and burst.
- An in-memory limiter is acceptable for a single-instance take-home, but document that it is not shared across instances and resets on restart.
- Return HTTP 429, include `Retry-After` if reliably calculable, and audit a reason such as `RATE_LIMIT_EXCEEDED`.
- Authorize scope before consuming a token.
- If core behavior is not complete and verified, defer rate limiting and document the production approach. Do not sacrifice security or core tests for it.

## 4. Priorities and non-goals

### Implement first
- Tenant-scoped management and audit API.
- Engagement creation/list/read and policy update.
- Revocation.
- Current-policy enforcement on every proxy authorization.
- Exact target normalization/matching and deny-overrides-allow.
- Actionable rejection behavior.
- Durable audit decision records.
- Tenant isolation tests.
- End-to-end tests using a local mock target.
- Repeatable local startup and clear README.

### Do not build for this assignment
- Frontend/dashboard.
- Kubernetes/cloud deployment.
- TLS interception.
- Redis/broker/distributed architecture without evidence of need.
- Complex custom authentication or elaborate anti-replay mechanisms.
- Extra features that reduce finish quality.
- Unsupported performance claims.

Rate limiting remains optional and lowest priority compared with core correctness.

## 5. Required agent workflow
1. Read the full `SCOPE_GUARD_SPECIFICATION.md` and this brief.
2. Inspect the repository, existing code, package scripts, and environment before editing. Do not overwrite existing work without understanding it.
3. Summarize repository state and gaps against the spec.
4. Propose milestones and acceptance tests.
5. Implement one milestone/feature at a time.
6. Run relevant tests/checks, diagnose and fix failures before moving on.
7. Report changed files, exact commands run, actual outcomes, unresolved issues, and the next milestone.
8. Never fabricate tests, benchmarks, files, or working behavior.
9. Prefer clear names, explicit control flow, focused modules, and straightforward code over clever abstractions or bulk code generation.
10. Do not change settled design decisions or expand scope materially without flagging the trade-off first.

## 6. Testing philosophy
Tests should demonstrate security properties, not just happy paths. At minimum, verify:
- A tenant cannot read or mutate another tenant's engagement.
- A tenant cannot access another tenant's audit records through nested or alternate routes.
- Allowed requests reach the mock target.
- Denied/out-of-scope requests do not reach it.
- Deny rules override allow rules.
- Revocation blocks subsequent requests after commit.
- Expected audit records/reasons are written.
- Database, policy, or required audit failures do not accidentally allow traffic.
- Normalization cannot be bypassed by case variations, trailing dots, ports, malformed hostnames, or URL-vs-host confusion, according to the documented contract.
- Redirects are re-authorized if supported.
- HTTPS `CONNECT` is tested if implemented; otherwise explicitly documented as unsupported.
- Rate limiting is tested if implemented.

Use unit tests for normalization/policy evaluation, integration tests for API/database/tenant boundaries and failures, and end-to-end tests for proxy behavior against the local mock target.

## 7. Operational/performance stance
- The hot path includes engagement authentication, current policy lookup, target validation/resolution, audit persistence, and upstream I/O.
- No policy cache in v1: favor clear revocation semantics over lower database load.
- 1,000 requests/minute is approximately 16.7 requests/second. Treat this as a workload to measure, not a performance guarantee.
- If benchmarking, record environment, workload, throughput, and latency percentiles (P50/P95/P99 where practical). Do not infer performance without measurements.
- Document database/policy/audit dependency failures. Authorization and required audit failures should fail closed.
- Avoid Redis/brokers until measurements establish a need.

## 8. Local setup and demo
The full specification defines the required scripts and acceptance gates. The intended experience is reproducible local startup with Docker Compose and a local mock target.

Expected flow to implement and verify before claiming it works:
```bash
cp .env.example .env
docker compose up --build -d
./scripts/demo.sh
npm test
```

Possible scripts:
- `scripts/demo.sh`: demonstrate setup and allowed/denied requests.
- `scripts/test-scope.sh`: test allowed, denied, and deny-overrides-allow.
- `scripts/test-revocation.sh`: prove subsequent requests are rejected after revocation.
- `scripts/test-tenant-isolation.sh`: prove cross-tenant reads/mutations fail.
- `scripts/test-failures.sh`: test dependency failures if feasible.

Only document commands actually run successfully. Make migrations repeatable. Seed only safe development/demo tenant credentials or fixtures; do not preload production-style engagements/policies or ship dev credentials as production defaults.

## 9. README and submission quality
README is part of the assessed deliverable. Cover:
- Configuration, startup, migrations, tests, demo, shutdown.
- Architecture and request flow.
- API routes and versioning.
- Tenant identity and worker credentials, including limitations.
- Exact target normalization/matching and deny-overrides-allow.
- Revocation semantics and in-flight limitation.
- Audit semantics and failure behavior.
- Redirect and HTTPS behavior.
- SSRF threat model and limitations.
- Rate-limiting implementation or why deferred.
- Performance assumptions and measurements, if any.
- Design alternatives/trade-offs.
- AI tools used, suggestions accepted/modified/rejected, and material human decisions.
- What additional time would be spent on.

Clearly distinguish implemented behavior from planned work.

## 10. Evaluation priorities
The solution should demonstrate:
1. **Finish quality:** small, complete, readable code a teammate can debug at 2 a.m.
2. **Written communication:** precise README, clear errors, honest limitations, explicit trade-offs.
3. **Operational thinking:** failure modes, auditability, reproducible startup, performance reasoning.
4. **Design judgment:** appropriate simplicity; no unnecessary infrastructure.
5. **Security instinct:** treat the worker as untrusted and assume deliberate scope-escape attempts.
6. **Testing:** cover high-risk bypasses and failures, not only happy paths.

Optimize for a defensible, tested, understandable implementation—not the longest feature list.

## 11. Initial implementation steps
Before modifying files:
1. Confirm it has read both this brief and `SCOPE_GUARD_SPECIFICATION.md`.
2. Summarize repository state/current implementation.
3. List requirement gaps and ambiguities/conflicts.
4. Propose milestones and acceptance tests, starting with the foundation.
5. Begin only the first milestone once the plan is clear. Do not implement all milestones in one pass.

## Source of truth
- `SCOPE_GUARD_SPECIFICATION.md`: detailed implementation contract and acceptance criteria.
- `SCOPE_GUARD_CONTEXT_BRIEF.md`: concise background, design rationale, priorities, and agent workflow.
- Original assignment: authoritative external requirements. If the implementation plan reveals a conflict, flag it and propose a resolution before proceeding.
