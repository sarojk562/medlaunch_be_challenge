# Design Document

This document explains the architecture, design decisions, and tradeoffs behind the MedLaunch Backend Challenge API.

## Architecture Overview

The system follows a **layered architecture** with clear separation of concerns:

```
Controller  →  Service  →  Repository
   ↑              ↑            ↑
Request/       Business     Data
Response       Logic        Access
Handling       + Rules
```

**Controller layer** — Handles HTTP concerns: request parsing, input validation (Zod), response formatting, and status codes. Controllers are thin; they delegate all domain logic to the service layer.

**Service layer** — Encapsulates all business logic: creating reports, enforcing uniqueness constraints, applying business rules, computing metrics, and coordinating side effects (audit logging, async jobs, file storage). Services depend on repository and utility interfaces, not on Express.

**Repository layer** — Abstracts data persistence behind the `IReportRepository` interface. The current implementation is an in-memory `Map`-based store. Swapping to PostgreSQL, MongoDB, or DynamoDB requires only implementing the same interface — no service or controller changes.

**Why this separation:**

- Each layer can be tested independently. Service tests don't need HTTP; repository tests don't need business rules.
- The repository interface makes the data layer pluggable. The in-memory implementation is fast for development and testing; a production implementation can be substituted without modifying business logic.
- Controllers stay focused on HTTP semantics, preventing business logic from leaking into route handlers.

## Data Model & Schema Design

### Report Structure

```
Report
├── id, title, description, status, createdBy
├── tags: string[]
├── metadata: { department?, category?, confidential?, ...any }
├── entries: Entry[]
│   ├── id, title, content, priority, author
│   ├── comments: Comment[]
│   └── createdAt, updatedAt
├── attachments: Attachment[]
│   ├── id, fileName, mimeType, size, storagePath
│   └── uploadedAt
├── version, createdAt, updatedAt, finalizedAt
```

### Why a document model

The Report is a natural aggregate — entries and attachments belong to and are always accessed through a report. A document model (rather than normalized relational tables) was chosen because:

1. **Read-path simplicity.** A single fetch returns the full report with all nested data. No joins needed.
2. **Atomic writes.** Updating a report and its entries in one operation avoids partial-update inconsistencies.
3. **Schema flexibility.** The `metadata` field uses `passthrough()` validation, allowing arbitrary key-value pairs without schema migrations. This is appropriate for a system where different departments may attach domain-specific metadata.
4. **Natural fit for the domain.** Medical reports are self-contained documents. Entries and attachments have no meaning outside their parent report.

### Nested entries and attachments

Entries and attachments are stored as arrays within the report document. This is acceptable because:

- Entry counts per report are bounded (typically tens, not thousands).
- The API supports server-side pagination, filtering, and sorting of entries to keep response sizes manageable.
- Attachments store only metadata in the document; file bytes live on disk (or would live in object storage in production).

If entry counts grew unbounded, they would be extracted into a separate collection with a foreign key — but for the defined domain, embedding is the simpler and more performant choice.

## Authentication & Authorization

### JWT-based authentication

Every request (except health checks) must include a `Bearer` token in the `Authorization` header. The token is verified using a symmetric HMAC secret.

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

The token payload contains:

```json
{ "userId": "user1", "role": "EDITOR" }
```

### Role-based access control

Two roles are defined:

| Role     | Create | Read | Update | Upload |
|----------|--------|------|--------|--------|
| `EDITOR` | ✓      | ✓    | ✓      | ✓      |
| `READER` | ✗      | ✓    | ✗      | ✗      |

Authorization is enforced via middleware (`authorize(Role.EDITOR)`) applied per-route. This is composable — adding a new role or permission check requires no changes to controllers or services.

### Why this model

- **Stateless.** JWT tokens carry their own claims. The server doesn't need session storage or a database lookup to authorize a request. This is essential for horizontal scaling.
- **Minimal scope.** Two roles cover the required access patterns. Over-engineering a full RBAC/ABAC system would add complexity without benefit at this stage.
- **Separation from business rules.** Auth middleware handles "can this user call this endpoint?" while the business rules engine handles "can this user modify this specific report in its current state?"

## Concurrency Control

### Version-based optimistic concurrency

Every report carries a `version` field that increments on each update. The `PUT /reports/:id` endpoint requires the caller to send the version they last read:

```json
{ "version": 3, "description": "Updated text" }
```

The service compares the submitted version against the stored version:

- **Match** — The update proceeds. The repository increments the version atomically.
- **Mismatch** — The service throws a `VersionConflictError`, returning `409 Conflict` with both the expected and actual versions.

```
Client A reads report (version 3)
Client B reads report (version 3)
Client A updates → version becomes 4 ✓
Client B updates with version 3 → 409 Conflict ✗
```

### Why optimistic over pessimistic

- **No lock contention.** Pessimistic locking (SELECT FOR UPDATE) blocks concurrent readers and doesn't scale well for read-heavy workloads.
- **Stateless.** No lock state to manage, expire, or clean up.
- **Appropriate for the domain.** Concurrent edits to the same report are infrequent. When they happen, a clear conflict signal is better than silently overwriting changes.

## Idempotency

The `PUT` endpoint is **naturally idempotent** due to the version check:

1. Client sends `PUT /reports/:id` with `version: 3` and a set of field updates.
2. Server applies the update, bumps version to 4, returns the result.
3. Client retries the same request (e.g., network timeout). Server sees `version: 3` but the stored version is now 4.
4. Server returns `409 Conflict`. The client reads the current state and sees its update already took effect.

This makes retries safe without requiring client-generated idempotency keys. The version field itself acts as a natural idempotency mechanism — a given `(reportId, version)` pair can only produce one successful mutation.

## Asynchronous Processing

### Simulated background job

When a report is created, the service fires an asynchronous job:

```ts
enqueueJob({
  name: 'ReportCreated',
  payload: { reportId, createdBy },
  execute: async () => {
    logger.info({ reportId }, 'Processing ReportCreated event');
  },
});
```

The `enqueueJob` function runs the job outside the request lifecycle (fire-and-forget via `void runWithRetry(job)`). The job does not block the HTTP response.

### Retry and failure handling

The async job runner implements exponential backoff with a maximum of 3 attempts:

```
Attempt 1 → fail → wait 500ms
Attempt 2 → fail → wait 1000ms
Attempt 3 → fail → log error with full payload, give up
```

After exhausting retries, the failure is logged at `error` level with the full job payload for manual investigation or dead-letter processing.

### Delivery semantics

The current implementation provides **at-most-once** delivery: if the process crashes mid-job, the work is lost because the queue lives in process memory. This is an intentional tradeoff — for a development-stage system, simplicity outweighs durability.

In production, the target is **at-least-once** delivery backed by a persistent broker. At-least-once is the pragmatic default for most systems because:

- **Exactly-once** is prohibitively expensive in distributed systems (requires two-phase commit or transactional outbox patterns).
- At-least-once with **idempotent consumers** achieves the same business-level correctness at far lower cost.

### Making jobs idempotent

Because at-least-once delivery means a job may execute more than once, each consumer must be safe to re-run:

| Job type | Idempotency strategy |
|----------|----------------------|
| Notification dispatch | Deduplicate on `(reportId, eventType, timestamp)` — check a "sent" log before emitting. |
| Downstream sync (e.g., analytics) | Use upsert semantics keyed on reportId. Re-processing overwrites with the same data. |
| Audit trail write | Guard with `INSERT ... ON CONFLICT DO NOTHING` on event ID. |

The current job payload already includes `reportId` and `name`, which together form a natural deduplication key. A production implementation would persist a `processedJobs` set (Redis or a database table) and skip jobs whose key has already been recorded.

### Crash recovery and failure modes

| Failure scenario | Current behavior | Production behavior |
|------------------|------------------|---------------------|
| Process crash during job execution | Job lost — no persistence | Broker redelivers after visibility timeout (SQS) or consumer timeout (Kafka) |
| Job exceeds max retries | Logged at `error` level, payload preserved in logs | Moved to a **dead-letter queue** (DLQ) for manual inspection or automated triage |
| Backpressure — jobs produced faster than consumed | Unbounded in-memory array; OOM risk under sustained load | Broker provides natural backpressure (SQS queue depth, Kafka consumer lag) with alerting on threshold breach |
| Duplicate delivery after retry | Not currently guarded | Idempotent consumers + deduplication key |

The structured log output on final failure includes the full job payload, which in today's system serves as a recoverable record — an operator can grep logs and manually re-enqueue. In production, a DLQ with monitoring (CloudWatch alarm on DLQ depth, PagerDuty integration) replaces this manual step.

### Production architecture

```
HTTP request
  └─ Service creates report
       └─ Transactional outbox write (same DB transaction)
            └─ Outbox poller / CDC (Debezium)
                 └─ Message broker (SQS / Kafka)
                      └─ Consumer workers (idempotent)
                           ├─ Success → ack message
                           └─ Failure → retry → DLQ
```

The **transactional outbox pattern** eliminates the dual-write problem (writing to the database and publishing to a broker as two separate operations that can partially fail). The event is written in the same database transaction as the report; a background poller or CDC pipeline reliably forwards it to the broker.

## File Storage Design

### Abstraction via `IFileStorageService`

File operations are behind an interface:

```ts
interface IFileStorageService {
  save(file): Promise<StoredFile>;
  getFilePath(fileId): Promise<string | null>;
  generateAccessUrl(fileId, baseUrl): string;
  verifyAccessToken(token): { fileId: string } | null;
}
```

The current implementation (`LocalFileStorageService`) writes to disk. In production, this interface would be implemented by an S3 adapter — `save()` becomes `PutObject`, `generateAccessUrl()` becomes `getSignedUrl`, and `getFilePath()` is replaced with direct S3 streaming.

### Secure access via signed URLs

Files are not served through the main auth middleware. Instead:

1. When an attachment is added, the service generates a **signed URL** containing a short-lived JWT (5-minute expiry).
2. The client accesses the file via `GET /files/:id?token=<signed-jwt>`.
3. The file controller verifies the token, checks that the `fileId` in the token matches the requested file, and validates the resolved path stays within the uploads directory (path-traversal protection).

This design:

- Decouples file access from the main auth system (useful for sharing links externally).
- Limits exposure — tokens expire quickly, and each token is scoped to a single file.
- Maps directly to S3 pre-signed URLs in production, requiring no client-side changes.

### Upload constraints

- **5 MB size limit** — enforced by multer before the file reaches application code.
- **MIME type allowlist** — PNG, JPEG, PDF, XLSX, CSV. Checked after multer processing to provide a specific error message.
- **Memory storage** — files are buffered in memory during upload (suitable for the 5 MB limit). In production with larger files, streaming to disk or directly to S3 would be appropriate.

## Business Rule: Finalization Grace Period

### The rule

Once a report's status transitions to `FINALIZED`:

1. An **EDITOR** may continue to modify the report for **24 hours** (the grace period).
2. After 24 hours, the report is locked — updates are rejected with `403 BUSINESS_RULE_VIOLATION`.
3. Once a report is `ARCHIVED`, it is permanently immutable. No role can modify it.

### Why this rule exists

In medical and regulatory contexts, finalized reports often need a brief correction window. The 24-hour grace period balances two competing needs:

- **Data integrity** — finalized reports should not change indefinitely.
- **Practical reality** — typos and last-minute corrections are discovered shortly after finalization.

The grace period provides a controlled window for corrections without requiring a formal "reopen" workflow.

### Implementation

The rule is implemented as a pluggable `BusinessRule` in `src/rules/report-rules.ts`:

```ts
const finalizationGracePeriodRule: BusinessRule = {
  name: 'FinalizationGracePeriod',
  evaluate(report, context) { ... }
};
```

Rules are evaluated by `enforceUpdateRules()` before any mutation in the service layer. This design makes it trivial to add new rules (e.g., department-based restrictions, maximum attachment count) by appending to the rules array.

The `finalizedAt` timestamp is set automatically when a report transitions to `FINALIZED` and cleared when it transitions away, ensuring the grace period clock resets on each finalization.

### Extensibility of the rule engine

The `BusinessRule` interface is deliberately minimal:

```ts
interface BusinessRule {
  name: string;
  evaluate(report: Report, context: RuleContext): void; // throws on violation
}
```

Rules are composed as an ordered array. `enforceUpdateRules()` iterates through them and short-circuits on the first violation. This gives the system deterministic, priority-based rule evaluation — rules earlier in the array take precedence.

**Adding a new rule** requires only:

1. Writing a function that conforms to `BusinessRule`.
2. Appending it to the rules array.
3. No changes to the service, controller, or middleware.

Examples of rules that slot in without modifying existing code:

| Rule | Implementation sketch |
|------|-----------------------|
| **Department restriction** — only the originating department can edit | Compare `report.metadata.department` against `context.user.department`. |
| **Max attachment count** — cap at 10 files per report | Check `report.attachments.length` against threshold. |
| **Approval workflow** — require manager sign-off before `FINALIZED` | Check an `approvals` array on the report for a matching `MANAGER` approval entry. |
| **Scheduled embargo** — block edits during a compliance review window | Compare `Date.now()` against `report.metadata.embargoUntil`. |

### Evolution toward a policy engine

The current array-of-rules model works well for a bounded set of rules known at compile time. As the system grows, two pressures will emerge:

1. **Non-technical stakeholders** need to define rules without code deploys (e.g., compliance officers adding department restrictions).
2. **Rules need to compose** — "allow edit if (within grace period AND same department) OR user has ADMIN role."

The migration path:

```
Current: BusinessRule[]            → hardcoded, deployed with app
    ↓
Phase 1: Rule definitions in DB    → admin UI for CRUD, rules loaded at startup
    ↓
Phase 2: DSL / expression engine   → e.g., JSON Rules Engine, Open Policy Agent (OPA)
    ↓
Phase 3: External policy service   → OPA sidecar, decoupled from app lifecycle
```

The key architectural decision that enables this evolution is that **rules are evaluated at a single enforcement point** (`enforceUpdateRules`). Whether that function reads from a hardcoded array or queries an OPA sidecar, the service layer's call site remains unchanged.

## Observability

### Structured logging

All logs are JSON-structured via **Pino**, enabling parsing by log aggregation tools (ELK, Datadog, CloudWatch Logs):

```json
{
  "level": 30,
  "time": 1712505600000,
  "pid": 12345,
  "hostname": "api-1",
  "requestId": "a1b2c3d4-...",
  "reportId": "rpt_01...",
  "msg": "Report created"
}
```

### Request ID tracing

Every request is assigned a unique `requestId` (UUID). If the client sends an `X-Request-Id` header, that value is used instead. The ID is:

- Attached to all log entries for that request via `logger.child({ requestId })`.
- Available in the HTTP-level request logger (pino-http).
- Propagated through service calls for full trace correlation.

This makes it straightforward to trace a single request through creation, validation, business rule evaluation, repository operations, and async job dispatch.

### Error handling strategy

Errors follow a typed hierarchy rooted at `AppError`:

```
AppError (base)
├── ValidationError        → 400
├── UnauthorizedError      → 401
├── ForbiddenError         → 403
├── BusinessRuleViolationError → 403
├── NotFoundError          → 404
└── ConflictError          → 409
```

A centralized `errorHandlerMiddleware` catches all errors:

- **`AppError`** instances → mapped directly to their HTTP status and code.
- **`ZodError`** (validation failures) → `400` with structured issue details.
- **`MulterError`** (file upload errors) → `400` with the multer error code.
- **Unknown errors** → `500 INTERNAL_ERROR` with a generic message (no stack traces leaked to clients).

The service layer throws domain-specific errors (`ReportNotFoundError`, `VersionConflictError`, `DuplicateReportError`), and the error middleware translates them to HTTP responses. This keeps controllers clean and ensures consistent error formatting across all endpoints.

## Code Quality Practices

### Linting

ESLint with `typescript-eslint` strict config. Key rules:

- `no-explicit-any: error` — forces proper typing throughout.
- `no-unused-vars: error` — with `argsIgnorePattern: "^_"` for intentionally unused parameters (e.g., `_next` in middleware).
- Prettier integration via `eslint-config-prettier` to avoid formatting conflicts.

### Formatting

Prettier enforces consistent code style. Configured via `.prettierrc` and runnable with `npm run format`.

### Type safety

- TypeScript in `strict` mode — enables `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`, and all other strict checks.
- Zod schemas produce inferred TypeScript types (`CreateReportInput`, `UpdateReportInput`), ensuring validation and type system stay in sync.
- Express request augmentation (`express.d.ts`) types `req.user` and `req.requestId` without `any` casts.

### Testing strategy

Tests are organized by scope:

| Layer        | Tests                    | What's covered                                             |
|--------------|--------------------------|-------------------------------------------------------------|
| Repository   | `repository.test.ts`     | CRUD operations, filtering, sorting, clone isolation        |
| Service      | `report.service.test.ts` | Business logic, status transitions, audit, error cases      |
| Validation   | `validation.test.ts`     | Schema acceptance, rejection, defaults, edge cases          |
| E2E          | `report.e2e.test.ts`     | Full HTTP round-trips — auth, CRUD, file upload, pagination |

Unit tests use real repository instances (cheap, in-memory) rather than mocks where possible. This tests actual integration between service and repository without the fragility of mock-heavy tests. External boundaries (file storage) are stubbed.

## Scalability Considerations

### Stateless services

The Express app holds no per-request state beyond the request lifecycle. All persistence is in the repository layer. This means:

- Multiple instances can run behind a load balancer with no session affinity required.
- Horizontal scaling is achieved by adding instances.

### Repository replacement

The `IReportRepository` interface is the only contract the service layer depends on. Migrating to a real database requires:

1. Implement `IReportRepository` for the target database (e.g., `PostgresReportRepository`).
2. Swap the instantiation in `app.ts`.
3. No changes to services, controllers, or tests (except adding integration tests for the new repository).

The interface methods (`create`, `findById`, `update`, `delete`, `list`) map directly to standard database operations.

### Migration to a production database

The in-memory repository was chosen to eliminate infrastructure dependencies during development. The path to a production database is designed in from the start — every repository method maps cleanly to database primitives.

**MongoDB (document store):**

| Repository method | MongoDB operation |
|-------------------|-------------------|
| `create(report)` | `insertOne(report)` — the document shape matches directly |
| `findById(id)` | `findOne({ _id: id })` |
| `update(id, partial)` | `findOneAndUpdate({ _id: id, version: expected }, { $set: partial, $inc: { version: 1 } })` — atomic version bump |
| `delete(id)` | `deleteOne({ _id: id })` |
| `list(filters)` | Aggregation pipeline with `$match`, `$sort`, `$skip`, `$limit` |

MongoDB is the most natural fit because the data model is already a document aggregate. Entries and attachments embed directly — no impedance mismatch.

**PostgreSQL (relational):**

| Repository method | PostgreSQL mapping |
|-------------------|--------------------|
| `create(report)` | `INSERT INTO reports` + batch `INSERT INTO entries` in a transaction |
| `findById(id)` | `SELECT ... JOIN entries ... JOIN attachments` or `jsonb` column for metadata |
| `update(id, partial)` | `UPDATE reports SET ... WHERE id = $1 AND version = $2` + separate entry updates, all in a transaction |
| `list(filters)` | `WHERE` clause filtering + `ORDER BY` + `LIMIT/OFFSET` |

PostgreSQL requires normalizing entries and attachments into child tables but gains queryability across reports (e.g., "find all reports containing HIGH-priority entries").

**Indexing strategy (applicable to either):**

```
Primary:     reports.id (PK)
Lookup:      reports.status, reports.createdBy
Sorting:     reports.createdAt, reports.updatedAt
Text search: reports.title (text index / GIN)
Composite:   (status, createdAt) for filtered + sorted listing
Entries:     entries.reportId + entries.priority (for filtered pagination)
```

**Pagination at the database level:** The current implementation loads all entries into memory and slices. With a real database, `entriesPage` / `entriesSize` would translate to `SKIP` / `LIMIT` (MongoDB) or `OFFSET` / `LIMIT` (PostgreSQL), pushing pagination to the storage engine where it belongs. For large datasets, cursor-based pagination (`WHERE createdAt > :lastSeen ORDER BY createdAt LIMIT :size`) avoids the O(n) skip cost.

**Transaction considerations:** The in-memory repository achieves atomicity trivially — JavaScript is single-threaded and the Map update is synchronous. In a database, updates that touch the report and its entries (e.g., adding an entry while updating status) must be wrapped in a transaction. PostgreSQL provides ACID transactions natively; MongoDB supports multi-document transactions since 4.0, though at a performance cost that reinforces the preference for single-document updates on the embedded model.

### Handling large datasets

- **Entries pagination** — the GET endpoint supports `entriesPage` and `entriesSize` parameters. The service slices entries server-side, returning only the requested page along with `totalItems` and `totalPages`.
- **Filtering** — entries can be filtered by `priority` before pagination, reducing transfer size.
- **Summary view** — the `view=summary` mode returns aggregate counts instead of full nested data, suitable for list/dashboard views.
- **Response shaping** — the `include` parameter lets clients opt-in to `entries`, `attachments`, and `metrics`. Fields not requested are not serialized.

## Tradeoffs

### In-memory database vs. real database

**Chose:** In-memory `Map`-based repository with `structuredClone` for isolation.

**Why:** Eliminates infrastructure setup, makes tests fast (no database to spin up), and focuses the challenge on application-layer design. The clean `IReportRepository` interface ensures the path to a real database is straightforward.

**Consequence:** Data is lost on restart. No query optimization, indexing, or transaction support. The `list()` method filters in JavaScript — acceptable for development but would need database-level filtering in production.

**Migration cost:** Low. The interface defines 5 methods. A PostgreSQL implementation using Knex or Prisma would take ~200 lines with the same method signatures. The service layer has zero direct data-access code — it calls only interface methods.

### Simple in-process queue vs. real message broker

**Chose:** Fire-and-forget async function with retry loop.

**Why:** Demonstrates the decoupled job pattern (enqueue → execute → retry → dead-letter log) without requiring Redis, RabbitMQ, or SQS infrastructure.

**Consequence:** Jobs are lost on process crash. No persistence, no visibility into queue depth, no dead-letter queue. In production, this would be replaced with BullMQ (Redis-backed) or SQS.

**Why not BullMQ from day one:** Adding Redis as a dependency for a development-stage system introduces operational overhead (running Redis locally, connection management, health checks) that doesn't improve correctness at this scale. The in-process implementation validates that the job interface is clean; swapping the executor behind `enqueueJob` is a one-file change.

### Simplified auth vs. full auth system

**Chose:** JWT with a hardcoded symmetric secret and two roles.

**Why:** Implements the complete auth flow (token verification, role-based middleware, per-route authorization) without requiring an identity provider, OAuth flow, or user management system.

**Consequence:** No token refresh, no token revocation, no user registration. The secret is hardcoded (with a clear "change-in-production" marker). In production, this would integrate with an IdP (Auth0, Cognito) using RS256 asymmetric keys.

## Advanced System Design Considerations

This section describes how the system would evolve under real production traffic and organizational growth. None of these are implemented — they represent the next architectural decisions a team would face.

### Caching strategy

**What to cache:** Individual reports by ID (hot-path for dashboards), and report list results filtered by common parameters (status + createdBy).

**Cache topology:**

```
Client → API Gateway (CDN / edge cache for GET) → Application → Redis (L1) → Database (L2)
```

- **Read-through:** On cache miss, the service fetches from the database, writes to Redis with a TTL, and returns the result.
- **Write-through invalidation:** On `PUT /reports/:id`, the service invalidates the cache key `report:{id}` after the database write succeeds. This is safe because the version field prevents stale reads from causing data corruption — a client that reads a stale cached report and attempts an update will fail with `409 Conflict`.
- **TTL policy:** Short TTLs (30–60s) for list queries (which change frequently as new reports are created); longer TTLs (5–10 min) for individual reports (which change only on explicit update).

**Cache stampede mitigation:** When a hot key expires, many concurrent requests hit the database simultaneously. Solutions:

1. **Lock-based revalidation** — the first request acquires a distributed lock (Redis `SET NX EX`), fetches from the database, and repopulates the cache. Other requests wait or serve slightly stale data.
2. **Probabilistic early expiration** — each request has a small chance of refreshing the cache before TTL expires, spreading the load.

**Why not implemented now:** Caching adds a consistency dimension (stale reads, invalidation bugs) that is unnecessary when the data store is in-memory and already fast. The version-based concurrency model means the system is already tolerant of stale reads at the API level.

### Rate limiting

**Granularity:**

| Scope | Limit | Purpose |
|-------|-------|---------|
| Per-user (by `userId` from JWT) | 100 req/min | Prevent a single user from monopolizing resources |
| Per-IP | 300 req/min | Protect against unauthenticated abuse (e.g., brute-force token guessing) |
| Per-endpoint | Configurable | Heavier limits on write endpoints (POST, PUT) vs. reads |

**Implementation path:**

1. **Single-instance:** `express-rate-limit` with an in-memory store. Simple, zero-dependency, sufficient for a single process.
2. **Multi-instance:** Swap the store to `rate-limit-redis`. All instances share the counter via Redis, ensuring the limit is global rather than per-process.

**Response:** `429 Too Many Requests` with a `Retry-After` header indicating when the client can retry. Rate limit metadata (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) is included on every response for client-side awareness.

**Adaptive rate limiting:** Under sustained load, rate limits could tighten dynamically based on system health metrics (CPU, memory, request latency p99). This prevents cascading failures — if the database is slow, the API throttles incoming traffic before queues back up to the point of OOM.

### Event-driven architecture

The current system has synchronous request-response semantics with a single fire-and-forget job on creation. In production, report lifecycle events would power a broader event-driven architecture:

**Events:**

```
ReportCreated   → { reportId, createdBy, timestamp }
ReportUpdated   → { reportId, updatedBy, changedFields, oldVersion, newVersion }
ReportFinalized → { reportId, finalizedBy, timestamp }
ReportArchived  → { reportId, archivedBy, timestamp }
AttachmentAdded → { reportId, attachmentId, mimeType, size }
```

**Consumers:**

| Consumer | Trigger | Action |
|----------|---------|--------|
| Notification service | `ReportFinalized` | Email stakeholders, Slack webhook |
| Analytics pipeline | All events | Write to data warehouse for reporting dashboards |
| Compliance audit | `ReportFinalized`, `ReportArchived` | Immutable audit log in append-only store |
| Search indexer | `ReportCreated`, `ReportUpdated` | Update Elasticsearch index for full-text search |
| File scanner | `AttachmentAdded` | Trigger virus/malware scan, quarantine on failure |

**Broker selection:**

- **SQS + SNS (fan-out):** Simplest option on AWS. SNS topic per event type, SQS queues per consumer. Built-in DLQ, at-least-once delivery, no infrastructure to manage.
- **Kafka:** Better for high-throughput, ordered event streams where consumers need replay capability (e.g., rebuilding a search index from scratch). Higher operational cost.
- **EventBridge:** If events need to cross AWS account boundaries or trigger Step Functions workflows.

The current `enqueueJob` call site in the service is already the natural place to emit these events. The refactor is: replace `enqueueJob(...)` with `eventBus.publish('ReportCreated', payload)`, where `eventBus` is backed by the chosen broker.

### Graceful shutdown and health checks

**Liveness probe** (`GET /health`): Already implemented. Returns `200 OK` when the process is running.

**Readiness probe** (not yet implemented): Would return `200` only when the service can accept traffic — database connection is established, Redis is reachable, queue consumers are running. During startup or when a dependency is down, returns `503 Service Unavailable` so the load balancer stops routing traffic to this instance.

**Graceful shutdown:**

```
SIGTERM received
  → Stop accepting new connections
  → Wait for in-flight requests to complete (with timeout)
  → Drain async job queue
  → Close database connections
  → Exit 0
```

This prevents request failures during rolling deployments in Kubernetes or ECS. The current implementation exits immediately on SIGTERM; adding a shutdown handler with a drain period is a small but important production hardening step.

## Future Improvements

1. **Real database** — PostgreSQL with Prisma or Knex for the repository layer. The interface is already defined; only the implementation needs to change. See the [Migration to a production database](#migration-to-a-production-database) section for the detailed mapping.

2. **Distributed job queue** — BullMQ (Redis) or AWS SQS for reliable async processing with visibility, retries, and dead-letter queues. See [Production architecture](#production-architecture) for the transactional outbox pattern.

3. **Caching** — Redis cache in front of the repository for frequently accessed reports. See [Caching strategy](#caching-strategy) for invalidation design and stampede mitigation.

4. **File scanning** — Virus/malware scanning of uploaded files before persisting. ClamAV integration or a cloud scanning service (S3 event → Lambda → scan).

5. **Rate limiting** — Per-user and per-IP rate limiting via middleware. See [Rate limiting](#rate-limiting) for the multi-instance approach.

6. **API versioning** — URL-based (`/v1/reports`) or header-based versioning to support non-breaking API evolution.

7. **Pagination for report listing** — Extend `GET /reports` with cursor-based pagination for browsing across reports, not just entries within a report.

8. **Event-driven integration** — Emit lifecycle events for downstream consumers (dashboards, notification services, compliance systems). See [Event-driven architecture](#event-driven-architecture).
