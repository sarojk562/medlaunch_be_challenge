# Design Document

This document explains the architecture, design decisions, and tradeoffs behind the MedLaunch Backend Challenge API.

---

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

---

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

---

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

---

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

---

## Idempotency

The `PUT` endpoint is **naturally idempotent** due to the version check:

1. Client sends `PUT /reports/:id` with `version: 3` and a set of field updates.
2. Server applies the update, bumps version to 4, returns the result.
3. Client retries the same request (e.g., network timeout). Server sees `version: 3` but the stored version is now 4.
4. Server returns `409 Conflict`. The client reads the current state and sees its update already took effect.

This makes retries safe without requiring client-generated idempotency keys. The version field itself acts as a natural idempotency mechanism — a given `(reportId, version)` pair can only produce one successful mutation.

---

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

### Production path

In production, `enqueueJob` would be replaced with a message broker (SQS, Kafka, BullMQ). The current implementation demonstrates the pattern — decoupled job definition, fire-and-forget dispatch, and retry semantics — without introducing infrastructure dependencies.

---

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

---

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

---

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

---

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

---

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

### Handling large datasets

- **Entries pagination** — the GET endpoint supports `entriesPage` and `entriesSize` parameters. The service slices entries server-side, returning only the requested page along with `totalItems` and `totalPages`.
- **Filtering** — entries can be filtered by `priority` before pagination, reducing transfer size.
- **Summary view** — the `view=summary` mode returns aggregate counts instead of full nested data, suitable for list/dashboard views.
- **Response shaping** — the `include` parameter lets clients opt-in to `entries`, `attachments`, and `metrics`. Fields not requested are not serialized.

---

## Tradeoffs

### In-memory database vs. real database

**Chose:** In-memory `Map`-based repository with `structuredClone` for isolation.

**Why:** Eliminates infrastructure setup, makes tests fast (no database to spin up), and focuses the challenge on application-layer design. The clean `IReportRepository` interface ensures the path to a real database is straightforward.

**Consequence:** Data is lost on restart. No query optimization, indexing, or transaction support. The `list()` method filters in JavaScript — acceptable for development but would need database-level filtering in production.

### Simple in-process queue vs. real message broker

**Chose:** Fire-and-forget async function with retry loop.

**Why:** Demonstrates the decoupled job pattern (enqueue → execute → retry → dead-letter log) without requiring Redis, RabbitMQ, or SQS infrastructure.

**Consequence:** Jobs are lost on process crash. No persistence, no visibility into queue depth, no dead-letter queue. In production, this would be replaced with BullMQ (Redis-backed) or SQS.

### Simplified auth vs. full auth system

**Chose:** JWT with a hardcoded symmetric secret and two roles.

**Why:** Implements the complete auth flow (token verification, role-based middleware, per-route authorization) without requiring an identity provider, OAuth flow, or user management system.

**Consequence:** No token refresh, no token revocation, no user registration. The secret is hardcoded (with a clear "change-in-production" marker). In production, this would integrate with an IdP (Auth0, Cognito) using RS256 asymmetric keys.

---

## Future Improvements

1. **Real database** — PostgreSQL with Prisma or Knex for the repository layer. The interface is already defined; only the implementation needs to change.

2. **Distributed job queue** — BullMQ (Redis) or AWS SQS for reliable async processing with visibility, retries, and dead-letter queues.

3. **Caching** — Redis cache in front of the repository for frequently accessed reports. Cache invalidation on updates via the existing audit/event hooks.

4. **File scanning** — Virus/malware scanning of uploaded files before persisting. ClamAV integration or a cloud scanning service (S3 event → Lambda → scan).

5. **Rate limiting** — Per-user and per-IP rate limiting via middleware (e.g., `express-rate-limit` backed by Redis for distributed deployments).

6. **API versioning** — URL-based (`/v1/reports`) or header-based versioning to support non-breaking API evolution.

7. **Pagination for report listing** — Extend `GET /reports` with cursor-based pagination for browsing across reports, not just entries within a report.

8. **Webhook / event streaming** — Emit events on report state changes for downstream consumers (dashboards, notification services, compliance systems).
