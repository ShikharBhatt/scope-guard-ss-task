# Scope Guard --- Implementation Specification

**Purpose:** This document is the source of truth for implementing Scope Guard 

**Audience:** The coding agent and the developer reviewing its work.

**Project status:** Specification before implementation. The agent must
inspect the repository first, then implement incrementally.

------------------------------------------------------------------------

## 1. Mission and success criteria

Build a small, finished, understandable backend that acts as a security
boundary between untrusted AI workers and customer systems. Every
outbound request made through the Scope Guard proxy must be associated
with an engagement, checked against the engagement's current policy,
allowed or rejected, and recorded for audit.

This is not just a CRUD exercise. The implementation will be evaluated
on:

1.  **Finishing:** readable, maintainable code that another developer
    can debug and extend; clear naming; sound structure; useful error
    handling; no dead code or half-wired options.
2.  **Written communication:** a trustworthy README with verified
    instructions, design choices and limitations.
3.  **Operational thinking:** awareness of hot-path cost, database
    behavior, throughput, latency, caching and staleness.
4.  **Design judgment:** explicit decisions for underspecified
    requirements, with alternatives and trade-offs.
5.  **Security instinct:** treating the worker as untrusted and testing
    boundary-crossing attempts.
6.  **Testing:** choosing tests based on risk, not optimizing for
    coverage percentage.

A small, complete and verified implementation is better than a broad,
unfinished one. The original assignment asks for approximately five to
six hours of work. Respect that constraint. Do not add infrastructure or
features merely to make the project look sophisticated.

## 2. How the coding agent must work

### 2.1 Inspect before changing

Before writing code:

1.  Inspect the repository, existing conventions, package manager,
    runtime versions and current tests.
2.  Read this specification completely.
3.  Identify the available relevant agent skills/rules, if the
    environment provides them. Use applicable NestJS, TypeScript,
    SOLID/clean-code, security, PostgreSQL, testing and documentation
    skills. Do not claim a skill was used if it was unavailable.
4.  Produce a short implementation plan with feature order, acceptance
    tests and likely risks.
5.  If the repository already contains useful working code, preserve it
    and adapt it instead of replacing it wholesale.

Do not start implementation by generating the entire application in one
large change.

### 2.2 Feature-by-feature, test-gated development

Implement one coherent feature at a time. For each feature:

1.  State its acceptance criteria and relevant failure cases.
2.  Implement only that feature and necessary dependencies.
3.  Add or update tests.
4.  Run the relevant tests.
5.  Run type checking and linting where available and applicable.
6.  Review security, readability, error handling and unnecessary
    complexity.
7.  Fix failures and rerun tests.
8.  Update the README or decision record if behavior or a design
    decision changed.
9.  Mark the feature complete only after verification.
10. Report what changed, commands actually run, test results,
    limitations and remaining work.

Do not move to the next milestone while the current milestone has
unresolved failures or known regressions. Do not delete, weaken, skip or
rewrite a test merely to make the suite pass. If a requirement cannot be
completed within the time budget, state that explicitly, document the
limitation and prioritize a coherent working core.

### 2.3 Required engineering practices

-   Use NestJS conventions, TypeScript strict mode, dependency
    injection, validated DTOs, centralized configuration and appropriate
    exception handling.
-   Apply SOLID principles pragmatically. Keep responsibilities
    cohesive; do not create an interface, abstraction or design pattern
    for every class.
-   Keep controllers focused on HTTP concerns, application services
    focused on behavior, and persistence concerns in a clear data-access
    boundary where that improves readability and testing.
-   Use descriptive names, small methods, consistent error formats and
    explicit types. Avoid `any` unless justified.
-   Validate environment variables at startup.
-   Use ESLint/Prettier or the repository's existing equivalents.
-   Use maintained dependencies and avoid unnecessary packages.
-   Use structured logs and correlation/request IDs where useful. Never
    log credentials or authorization headers.
-   Avoid dead code, unused parameters, fake configuration, TODO-only
    implementations and features that are presented as complete but are
    not wired end to end.
-   Review diffs and test output rather than trusting generated code.
-   Document non-obvious security decisions; do not add comments that
    merely restate the code.

## 3. Scope and explicit non-goals

### 3.1 Must implement

1.  A versioned Policy API for managing engagements and their scope
    rules.
2.  Tenant isolation on every relevant API and data-access path.
3.  A forward egress proxy that authenticates the worker, evaluates
    current policy, and forwards or rejects requests.
4.  Exact normalized hostname matching for allow and deny rules, with
    deny taking precedence.
5.  Engagement revocation that affects subsequent authorization checks
    using current committed policy.
6.  Durable audit records and a tenant-scoped Audit API.
7.  Fail-closed behavior when current authorization cannot be
    established or the local transaction containing the authorization
    decision and durable outbox event cannot commit. A downstream audit
    sink outage alone must not stop processing after that transaction commits.
8.  Automated tests for security boundaries, critical failure modes and
    end-to-end behavior.
9.  A reproducible local setup using Docker Compose, database migrations
    and documented configuration.
10. Simulation scripts that demonstrate the complete operation using a
    local mock destination.
11. A complete, verified README and documented limitations.
12. API versioning from the start.

### 3.2 Lowest priority: rate limiting

Rate limiting is desired, but must not jeopardize the core requirements.
Implement it only after all higher-priority features, tests, setup and
end-to-end demonstration work.

Use a token-bucket algorithm behind a small, testable service boundary.
For the initial single-instance local deployment, an in-memory
implementation is acceptable if its concurrency behavior is correct and
its limitations are documented. Do not add Redis or distributed
infrastructure for this take-home.

Suggested bucket key: `(engagement_id, normalized_target_hostname)`, so
one engagement's traffic to one target does not consume another target's
allowance or another engagement's allowance. Make the sustained refill
rate and burst capacity configurable with validated defaults. Do not
invent claims that token bucket limits every arbitrary one-second
interval: it enforces a sustained refill rate with a permitted burst.

When rate limited, return HTTP 429 with an actionable error and
`Retry-After` when it can be calculated. Record a `RATE_LIMIT_EXCEEDED`
decision. Scope denial must happen before rate-limit consumption.
Re-check scope and rate limits for every redirect-generated outbound
request.

If rate limiting cannot be implemented and tested within the time
budget, leave it out of the working core and document the design and
remaining work honestly. Do not leave a partially wired limiter.

### 3.3 Explicitly out of scope

Unless the original assignment or an essential security requirement
makes one unavoidable, do not implement:

-   A frontend or dashboard.
-   Microservices or distributed service deployment.
-   Kubernetes, cloud services or production deployment automation.
-   TLS interception or custom certificate issuance.
-   Kafka, message brokers, Redis, distributed caches or distributed
    locks.
-   A plugin architecture.
-   A metrics dashboard or elaborate observability platform.
-   A complex identity provider or a custom authentication system.
-   A generalized wildcard/path-pattern policy language.
-   A second API version.
-   Speculative abstractions or production features that are not
    required.

Production network-level egress enforcement is outside the code
deliverable, but its necessity and limitations must be explained in the
README.

## 4. Proposed architecture

Use a **modular monolith**: one NestJS application and one PostgreSQL
database. Keep responsibilities separated in code, not in separately
deployed services.

Suggested logical modules:

-   **Identity/Tenant:** validates tenant API credentials and worker
    engagement credentials; provides authenticated identity to
    downstream components.
-   **Policy:** engagement lifecycle, scope rules, current policy lookup
    and policy evaluation.
-   **Proxy:** inbound proxy handling, request validation, safe
    destination resolution/connection, enforcement, forwarding and
    upstream outcome handling.
-   **Audit:** durable decision records and tenant-scoped queries.
-   **Infrastructure/configuration:** database integration, migrations,
    validated environment configuration and shared HTTP/network
    utilities.

These are logical boundaries, not a requirement to create excessive
classes. Share policy evaluation logic rather than duplicating it in
controllers or the proxy. Keep the policy evaluator independently
unit-testable.

Use PostgreSQL for engagement/policy state and durable audit data. Do
not add a cache initially. Use explicit tenant-scoped queries and test
them. Database row-level security is optional defense-in-depth, not a
substitute for application authorization.

## 5. Data model and identity

A reasonable initial schema includes:

-   `tenants`: tenant ID, name and creation timestamp.
-   `engagements`: ID, tenant ID, status (`ACTIVE` or `REVOKED`),
    created timestamp and revocation timestamp.
-   `engagement_targets`: ID, engagement ID, normalized hostname and
    effect (`ALLOW` or `DENY`).
-   `audit_records`: ID, timestamp, tenant ID, engagement ID,
    request/correlation ID, method, normalized target, decision, reason
    and, where available, upstream outcome/status and duration.
-   Credential storage: a tenant API credential mapping and an
    engagement-scoped worker credential hash, or an equivalent minimal
    implementation consistent with the repository.

Use primary keys, foreign keys, appropriate uniqueness constraints and
indexes based on actual query patterns. Prevent audit tenant/engagement
mismatches through schema constraints where practical and service-level
validation. Use transactions where an operation changes related records
that must be atomic.

### 5.1 Credential behavior

-   Do not trust an engagement ID or tenant ID supplied by the caller as
    proof of identity.
-   Tenant API authentication must resolve the tenant from a credential,
    not from an arbitrary request field.
-   For the worker, prefer a cryptographically random, engagement-scoped
    bearer secret. Generate it securely, show it only when provisioned,
    store only a hash, compare securely and never log it.
-   A bearer secret can be replayed if stolen. Do not claim replay
    protection. Document secure transport, protection,
    rotation/revocation and the replay limitation.
-   A seeded demo tenant/credential may be provided only for local
    development and automated tests. It must be clearly marked
    development-only and must not be a production default.
-   Do not require preloaded engagement or audit data. Migrations create
    schema; a development seed may create a demo tenant; the API creates
    engagements and rules; proxy requests create audit records.

## 6. API contract and versioning

Use NestJS URI versioning with `/api/v1` for REST APIs. Configure
versioning centrally in NestJS. Do not hand-build inconsistent version
prefixes in individual controllers. Document the versioned routes and
test them.

Suggested routes (adjust names consistently if the repository has a
better established convention):

-   `POST /api/v1/engagements` --- create an engagement and its initial
    target rules.
-   `GET /api/v1/engagements` --- list the authenticated tenant's
    engagements.
-   `GET /api/v1/engagements/:id` --- read an engagement belonging to
    the authenticated tenant.
-   `PATCH /api/v1/engagements/:id/policy` --- update target rules for
    an engagement owned by the authenticated tenant.
-   `POST /api/v1/engagements/:id/revoke` --- revoke an engagement owned
    by the authenticated tenant.
-   `GET /api/v1/engagements/:id/audit` --- list audit records for an
    engagement owned by the authenticated tenant, with bounded
    pagination.
-   `GET /api/v1/health` --- application health suitable for local
    startup checks; do not expose secrets or detailed internals.

Use appropriate HTTP methods and status codes, DTO validation,
consistent error response shapes and bounded pagination. Return
actionable errors without exposing stack traces, credentials, internal
addresses or sensitive configuration. Document example requests and
responses. No second API version is required.

The proxy listener may use a separate port (for example, 3128) because
it speaks proxy protocol rather than ordinary REST. Document how a
worker authenticates and configures it.

## 7. Policy semantics

-   A target rule is a **hostname**, not an arbitrary substring, full
    URL prefix or wildcard.
-   Normalize hostnames consistently: parse the URL using a standard URL
    parser; lowercase the hostname; handle a trailing DNS dot
    consistently; reject malformed URLs, unsupported protocols,
    user-info tricks and invalid host representations.
-   Match exact normalized hostnames. `example.com` must not match
    `notexample.com` or `example.com.attacker.test`.
-   A matching `DENY` rule overrides a matching `ALLOW` rule.
-   A request with no matching allow rule is denied.
-   Only `ACTIVE` engagements may authorize new requests.
-   A revoked, unknown or unauthorized engagement must not forward
    traffic.
-   A policy-store/database failure that prevents current policy from
    being established must fail closed.
-   Evaluate current committed policy for every new outbound request. Do
    not cache policy in the initial implementation.
-   Define the authorization point in code and README. A request already
    authorized and dispatched before a revocation commits cannot be
    recalled. The guarantee is that subsequent authorization checks
    observe the new committed policy, not that revocation cancels
    in-flight traffic.

## 8. Egress proxy requirements

The proxy is the enforcement point for outbound traffic. It is not
merely a convenience HTTP client. The application cannot guarantee that
workers use it unless their network configuration prevents direct
egress; explain that production network controls must enforce this
boundary.

### 8.1 Protocol scope

Preferred if it can be completed and tested within the time budget:

-   Support ordinary HTTP proxy forwarding.
-   Support HTTPS via `CONNECT` tunnels, checking the target hostname
    before establishing the tunnel.
-   Do not intercept TLS or claim to inspect encrypted HTTP
    paths/methods inside HTTPS tunnels.
-   For a CONNECT tunnel, the visible audit method is `CONNECT` and the
    target is the tunnel authority/hostname. Document that inner HTTPS
    requests are not individually visible to this proxy without TLS
    interception.

If HTTP + CONNECT cannot be implemented safely and fully within the
budget, deliver a tested HTTP-only proxy, clearly declare HTTPS CONNECT
unsupported, and record the deferred work. Do not claim HTTPS support
without working tests.

### 8.2 Request processing

For each new outbound request:

1.  Assign or validate a request/correlation ID; do not let a caller
    spoof another request's audit identity.
2.  Authenticate the worker credential and resolve its engagement and
    tenant.
3.  Parse and validate the target and protocol.
4.  Load current engagement status and rules from PostgreSQL.
5.  Evaluate scope, with deny overriding allow.
6.  Apply rate limiting only if the lowest-priority limiter has been
    completed.
7.  In one PostgreSQL transaction, persist the authorization decision
    and a stable-ID durable outbox event before forwarding when allowed;
    if that transaction fails, do not forward.
8.  Forward only after authorization succeeds.
9.  Apply explicit connection and response timeouts and sensible
    request/response size limits.
10. Record or update the upstream outcome separately where feasible;
    distinguish an allowed decision from a timeout or upstream error.
11. Return an actionable response without leaking internal secrets.

Denied requests should be recorded with a clear reason in the local database transaction/outbox whenever possible. If the downstream audit sink is unavailable but PostgreSQL is healthy, continue processing and retry delivery asynchronously. If PostgreSQL is unavailable and the decision/outbox transaction cannot commit, do not forward an otherwise-allowed request. The README must explain that a complete outage of the database hosting the outbox can also prevent durable recording of a denial.

### 8.3 Redirects

Do not blindly follow redirects. Either disable automatic redirect
following and return the redirect to the caller, or follow redirects
manually with a strict hop limit and re-run authentication context,
target validation, current scope policy and rate-limit checks for every
new destination. Choose one behavior, implement it consistently, test it
and document it. Never follow an out-of-scope redirect automatically.

### 8.4 SSRF and network safety

Treat the worker as potentially malicious. Consider loopback, private,
link-local, multicast, unspecified, IPv4-mapped IPv6 and other
non-public destination addresses, plus DNS rebinding and redirects.
Validate the actual resolved destination used for connection; hostname
string matching alone is insufficient.

For the take-home, implement a reasonable, explicit destination-safety
policy. The local demo requires a local mock destination, so permit it
only through an explicit development/test configuration or a separate
controlled test path. Do not silently make loopback/private destinations
generally available in the normal proxy configuration. Avoid DNS
check/connect time-of-check/time-of-use gaps where practical; document
any remaining limitations. Do not let proxy requests choose arbitrary
protocols or proxy chaining.

### 8.5 Failure behavior

-   Unknown, revoked or unauthorized engagement: reject; never forward.
-   Invalid or unsupported destination/protocol: reject; never forward.
-   Policy database unavailable or current policy cannot be established:
    fail closed.
-   Required audit persistence unavailable before an allowed request:
    fail closed.
-   Rate limit exceeded (only if implemented): reject with 429.
-   Upstream timeout or failure after authorization: return an
    appropriate gateway error and retain the authorization decision and
    available upstream outcome.
-   Do not leak secrets, stack traces or sensitive internal details in
    client errors.

## 9. Audit requirements

Each proxy authorization decision must have at least:

-   Timestamp.
-   Tenant ID.
-   Engagement ID.
-   Request/correlation ID.
-   Method.
-   Target.
-   Decision (for example, `ALLOW` or `DENY`).
-   Reason (for example, `IN_SCOPE`, `NO_ALLOW_RULE`,
    `DENY_RULE_MATCHED`, `ENGAGEMENT_REVOKED`, `INVALID_TARGET`,
    `RATE_LIMIT_EXCEEDED` or `POLICY_UNAVAILABLE`).

Record the decision before forwarding an allowed request so an upstream
action cannot occur without its required durable authorization record.
Where feasible, record upstream status, outcome and duration separately;
an authorized request that times out is not the same as an authorization
denial.

The Audit API must enforce tenant isolation and use bounded pagination.
Audit records must not expose credentials or sensitive request headers.
Do not claim tamper-proof or immutable audit storage; stronger retention
and tamper-resistance are future work unless already supplied by the
environment.

## 10. Operational thinking and performance

The proxy hot path may include authentication lookup, policy lookup,
policy evaluation, rate-limit state access, durable audit write and
upstream network work. Keep this path simple and observable.

-   Start with no policy cache so each authorization checks current
    committed policy.
-   Explain the trade-off: simpler revocation consistency at the cost of
    database reads and latency per request.
-   Do not introduce Redis, message brokers or distributed caches
    without a measured requirement.
-   Add useful structured logs and correlation IDs; do not log secrets.
-   Use database indexes based on real query patterns, not speculative
    indexing.
-   Configure connection, request and response timeouts and sensible
    resource limits.
-   Benchmark with a documented repeatable workload if time allows.
    Record environment, request mix, concurrency, duration, throughput
    and P50/P95/P99 latency. Do not invent results.
-   Discuss the assignment's 1,000-requests-per-minute scenario (about
    16.7 requests/second): estimate the hot-path operations, then use
    measurements where possible. Do not assert performance without
    evidence.
-   If caching is considered later, state the staleness it introduces
    and how revocation invalidation/consistency would be guaranteed. Do
    not add caching in the initial implementation.
-   A single-process in-memory rate limiter resets on restart and does
    not coordinate multiple instances; document this explicitly if
    implemented.

## 11. Testing strategy and acceptance criteria

Tests should reflect risk. A high coverage percentage is not a
substitute for meaningful security tests.

### 11.1 Unit tests

At minimum:

-   Hostname normalization and exact matching.
-   Subdomain and suffix confusion cases.
-   Deny overrides allow.
-   No matching allow rule results in denial.
-   Revoked/inactive engagement results in denial.
-   Invalid URL and unsupported protocol handling.
-   Token-bucket refill/burst behavior and separate keys, only if rate
    limiting is implemented.

### 11.2 Integration tests

At minimum:

-   Database migrations and engagement lifecycle.
-   Policy update and subsequent request observes the committed update.
-   Audit persistence and tenant-scoped audit queries.
-   Invalid credentials rejected.
-   Tenant A cannot list, read, modify, revoke or inspect audit records
    belonging to Tenant B.
-   Policy-store failure prevents forwarding.
-   Failure to commit the local authorization-decision/outbox transaction prevents forwarding an otherwise-allowed request. A downstream audit-sink outage alone does not.
-   Redirect handling follows the selected safe behavior.
-   Destination validation prevents access to prohibited addresses,
    while the explicitly configured local mock test works.

### 11.3 End-to-end tests

Use a controlled local mock HTTP destination and verify:

1.  Create or provision a test tenant and engagement.
2.  Configure an allowed hostname/target.
3.  Send a permitted request through the proxy and verify the mock
    target received it.
4.  Send an out-of-scope request and verify the mock target did not
    receive it.
5.  Configure overlapping allow/deny rules and verify deny takes
    precedence.
6.  Revoke the engagement and verify a subsequent request is rejected.
7.  Retrieve audit records and verify the decision, target, reason,
    engagement and timestamp.
8.  Verify a tenant cannot retrieve another tenant's audit data.
9.  Verify dependency failures fail closed.
10. Verify HTTPS CONNECT behavior if and only if it is implemented.

Use deterministic tests; do not depend on public internet services.
Avoid tests that only assert status codes---also verify whether the
destination was actually reached and what was persisted.

### 11.4 Quality gates

Before a milestone is complete, run the relevant tests and available
type/lint/format checks. Before delivery, run:

-   Full automated test suite.
-   Type checking.
-   Linting and formatting checks.
-   Database migrations from a clean database.
-   The documented end-to-end demo from a clean local setup.

Report actual commands and results. If any command cannot run, state why
and what remains unverified.

## 12. Local developer experience and simulation scripts

A developer unfamiliar with the project must be able to start and
demonstrate it without manually writing SQL or calling undocumented
endpoints.

Provide:

-   `docker-compose.yml` or `compose.yaml` for the NestJS application
    and PostgreSQL.
-   `.env.example` with documented non-secret defaults and required
    configuration names.
-   Database migrations executed through a clear, repeatable process.
-   An idempotent development seed or setup process for a demo tenant
    and development-only credentials.
-   No preloaded engagements, target policies or audit records; create
    these through the API/proxy during the demo.
-   A health endpoint and documented readiness/startup behavior.
-   A `scripts/demo.sh` (or equivalent portable script) for the complete
    end-to-end flow.
-   Focused scripts such as `test-scope.sh`, `test-revocation.sh` and
    `test-tenant-isolation.sh` if useful and maintainable.
-   A cleanup/reset instruction that explains whether it deletes the
    database volume.
-   A local mock target server. The demo must not depend on a public
    website or send requests to real customer systems.

Proposed developer experience (adjust commands to the actual
implementation and verify them):

``` bash
cp .env.example .env
docker compose up --build -d
./scripts/demo.sh
npm test
```

The README must explain prerequisites, exact commands, expected
outcomes, troubleshooting, how to stop the system and how to reset local
data. Do not publish unverified commands as working instructions.

## 13. README and decision records

Write and maintain the README during development. It is a core
submission artifact, not end-of-project paperwork.

It must cover:

1.  Purpose and scope.
2.  Architecture and request flow.
3.  Prerequisites and exact setup/run/stop/reset commands.
4.  Environment variables and safe local credentials.
5.  Migrations and development seed behavior.
6.  Versioned API endpoints with sample requests/responses and errors.
7.  Worker identity and credential lifecycle.
8.  Policy semantics and target normalization.
9.  Proxy configuration, HTTP/CONNECT limitations and direct-egress
    bypass risk.
10. Audit semantics and failure behavior.
11. Testing commands and the complete simulation.
12. Security threat model and known limitations.
13. Hot-path analysis, database costs, measured performance and caching
    decision.
14. Rate limiting behavior and single-instance limitations, if
    implemented.
15. Important alternatives considered and why the chosen option was
    selected.
16. AI tooling used and meaningful AI-generated suggestions that were
    changed or rejected, with reasons.
17. Deferred improvements and what additional time would buy.

For significant ambiguous decisions, include a concise decision record
with: decision, alternatives, rationale, trade-off and conditions that
would cause the decision to be revisited. Never fabricate AI usage
history, benchmark results or verification.

## 14. Priority order

Work in this order. The agent may adjust sequencing only when a genuine
dependency requires it and must explain the reason.

### P0 --- Foundation

-   Inspect repository and plan.
-   NestJS project structure, strict TypeScript, formatting/linting and
    tests.
-   Validated configuration and centralized `/api/v1` URI versioning.
-   PostgreSQL connection, migrations and health check.
-   Docker Compose clean startup.
-   **Exit gate:** clean startup, migrations, health check and
    foundation checks pass.

### P1 --- Identity and tenant isolation

-   Tenant API credential validation.
-   Development-only tenant seed/setup.
-   Engagement-scoped worker credential generation/storage/validation.
-   Tenant-scoped resource access.
-   **Exit gate:** invalid credentials rejected; cross-tenant access
    tests pass.

### P2 --- Policy API and evaluator

-   Create/list/read/update/revoke engagements.
-   Allow/deny target rules and exact hostname normalization.
-   Deny-overrides-allow.
-   Current policy lookup and inactive/revoked behavior.
-   **Exit gate:** unit/integration tests for policy semantics and
    tenant boundaries pass.

### P3 --- Proxy enforcement

-   HTTP forwarding and, if safely feasible, HTTPS CONNECT.
-   Authentication, target validation, current-policy check,
    forward/reject behavior.
-   Redirect handling, timeouts and SSRF/destination safety.
-   **Exit gate:** local mock target confirms allowed requests arrive
    and rejected requests do not.

### P4 --- Audit

-   Durable authorization decision before forwarding allowed requests.
-   Tenant-scoped, paginated Audit API.
-   Dependency failure behavior and upstream outcome distinction.
-   **Exit gate:** local decision/outbox atomicity, downstream sink retry behavior, and fail-closed behavior when local persistence fails are tested.

### P5 --- End-to-end verification and documentation

-   Complete simulation scripts.
-   Full suite, clean-start validation and final review.
-   README and decision records complete and accurate.
-   Performance observations documented if measured.
-   **Exit gate:** an unfamiliar developer can follow the README and
    reproduce the demo.

### P6 --- Rate limiting (lowest priority)

-   Token-bucket implementation, configurable rate/burst, 429 response,
    audit reason and tests.
-   **Exit gate:** refill, burst exhaustion, independent keys and
    concurrency behavior tested.
-   If time is insufficient, document the design and defer
    implementation rather than destabilize P0--P5.

## 15. Definition of done

The project is ready to submit only when:

-   The mandatory functionality is implemented and wired end to end.
-   Each completed feature passed its relevant tests before the next
    feature began.
-   Tenant isolation is tested on every relevant resource path.
-   Unauthorized/out-of-scope requests are not forwarded.
-   Required audit persistence happens before forwarding an allowed
    request.
-   Revocation affects subsequent authorization checks against current
    committed policy.
-   The application starts from a clean local setup using documented
    instructions.
-   The simulation uses only a controlled local mock target.
-   API v1 routes and errors are documented.
-   README trade-offs and limitations are honest and specific.
-   Full test, type-check and lint results are reported accurately.
-   There is no dead code, misleading configuration or half-wired rate
    limiter.
-   Any incomplete or unverified behavior is explicitly listed.

### Final delivery report

At the end, provide a concise report with:

-   Implemented features.
-   Architecture and major decisions.
-   Commands executed and actual results.
-   Tests passed/failed/not run.
-   Benchmark results, only if actually measured.
-   Known limitations and deferred work.
-   How to run the demo.

**Guiding principle:** build the smallest secure, complete and
understandable system that satisfies the assignment. Prefer evidence and
explicit trade-offs over extra features or unsupported claims.

## Durable audit outbox — required decision

**Decision:** A downstream audit-sink outage must not, by itself, stop proxy processing. Use a durable transactional outbox backed by the same PostgreSQL database as the policy and audit decision records.

- In one database transaction, persist the authorization decision and an outbox event with a stable event ID. Commit before forwarding an allowed request.
- If the transaction cannot commit, do not forward the allowed request. Do not claim that an audit event is durable when it is only in memory.
- A background worker delivers committed outbox events to the downstream audit sink and retries transient failures with bounded backoff.
- Delivery is at-least-once. The sink/consumer must be idempotent using the stable event ID, because a crash after delivery but before marking the event delivered can cause a duplicate.
- Mark an event delivered only after the sink acknowledges it. Keep failed events available for retry and make backlog/oldest-event age observable; avoid silently dropping events.
- Keep authorization decision and upstream outcome distinct. The pre-forward decision record does not mean the upstream operation succeeded. Record the upstream result separately where required by the chosen event model.
- If the downstream sink is unavailable but PostgreSQL is healthy, continue processing after the local transaction commits; queue delivery for later.
- If PostgreSQL/local durable storage is unavailable, fail closed for requests that would otherwise be allowed because the required durable decision/outbox record cannot be committed. Do not promise that a rejection audit record can be persisted during a complete database outage.
- The outbox does not solve a complete PostgreSQL outage. It decouples the downstream sink from the request path while PostgreSQL remains available.
- Test sink outage, retry and recovery, duplicate delivery/idempotency, process restart with pending events, and local database failure. Document any behavior that cannot be tested within the assignment time budget.

Keep this implementation deliberately small: a PostgreSQL outbox table and a simple background dispatcher are sufficient. Do not introduce a message broker unless a measured requirement justifies it.
