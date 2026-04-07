# MedLaunch Backend Challenge

A production-grade REST API for managing structured reports with nested entries, file attachments, role-based access control, and asynchronous processing. Built with Node.js, Express 5, and TypeScript.

## Key Features

- **CRUD API** for reports with rich nested data (entries, attachments, metadata)
- **JWT authentication** with role-based authorization (EDITOR / READER)
- **Optimistic concurrency control** via version fields to prevent lost updates
- **File upload** with MIME-type validation, size limits, and signed access URLs
- **Business rules engine** — finalization grace period, status transition enforcement
- **Asynchronous job processing** with retry logic
- **Structured logging** (Pino) with per-request tracing
- **Response shaping** — callers choose which fields to include, with server-side pagination
- **Comprehensive test suite** — unit tests and end-to-end tests (Jest + Supertest)

---

## Prerequisites

- **Node.js** >= 20
- **npm** >= 10

---

## Setup

```bash
# Clone the repository
git clone https://github.com/sarojk562/medlaunch_be_challenge.git
cd medlaunch_be_challenge

# Install dependencies
npm install

# Start in development mode (hot-reload)
npm run dev

# --- OR ---

# Build and start in production mode
npm run build
npm start
```

The server starts on port **3000** by default. Override with:

```bash
PORT=8080 npm run dev
```

---

## Authentication

All endpoints (except `GET /health`) require a JWT bearer token.

```
Authorization: Bearer <token>
```

Tokens encode a `userId` and a `role` (`EDITOR` or `READER`). For local development, generate a token with the built-in utility:

```bash
node -e "
  const jwt = require('jsonwebtoken');
  const token = jwt.sign(
    { userId: 'user1', role: 'EDITOR' },
    'dev-secret-change-in-production',
    { expiresIn: '1h' }
  );
  console.log(token);
"
```

| Role     | Permissions                                    |
|----------|------------------------------------------------|
| `EDITOR` | Create, read, update reports; upload files     |
| `READER` | Read reports only                              |

---

## API Endpoints

### Health Check

```
GET /health
```

```json
{ "status": "ok" }
```

---

### Create Report

```
POST /reports
```

**Auth:** EDITOR

**Request body:**

```json
{
  "title": "Q4 Clinical Trial Summary",
  "description": "Phase II results for compound MED-4821.",
  "status": "DRAFT",
  "tags": ["clinical-trial", "phase-2"],
  "metadata": { "department": "Clinical Research", "confidential": true },
  "entries": [
    {
      "id": "ent-001",
      "title": "Patient Enrollment",
      "content": "342 patients enrolled across 12 sites.",
      "priority": "HIGH",
      "author": "user1",
      "createdAt": "2025-11-01T09:00:00Z",
      "updatedAt": "2025-11-01T09:00:00Z"
    }
  ]
}
```

Only `title` is required. All other fields have sensible defaults (`status` → `DRAFT`, arrays → `[]`, etc.).

**curl:**

```bash
curl -s -X POST http://localhost:3000/reports \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Q4 Clinical Trial Summary"}' | jq
```

**Response:** `201 Created`

```json
{
  "id": "a1b2c3d4-...",
  "title": "Q4 Clinical Trial Summary",
  "description": "",
  "status": "DRAFT",
  "createdBy": "user1",
  "tags": [],
  "metadata": {},
  "entries": [],
  "attachments": [],
  "version": 1,
  "createdAt": "2026-04-07T10:00:00.000Z",
  "updatedAt": "2026-04-07T10:00:00.000Z",
  "finalizedAt": null
}
```

---

### Get Report

```
GET /reports/:id
```

**Auth:** READER or EDITOR

**Query parameters:**

| Parameter      | Type   | Default     | Description                                      |
|----------------|--------|-------------|--------------------------------------------------|
| `view`         | string | `full`      | `full` or `summary`                              |
| `include`      | string | —           | Comma-separated: `entries`, `attachments`, `metrics` |
| `entriesPage`  | number | `1`         | Pagination page for entries                      |
| `entriesSize`  | number | `20`        | Entries per page (max 100)                       |
| `sortBy`       | string | `createdAt` | Sort entries by `createdAt` or `priority`        |
| `order`        | string | `desc`      | `asc` or `desc`                                  |
| `priority`     | string | —           | Filter entries: `HIGH`, `MEDIUM`, `LOW`          |

**curl — summary view:**

```bash
curl -s http://localhost:3000/reports/$REPORT_ID?view=summary \
  -H "Authorization: Bearer $TOKEN" | jq
```

**curl — full view with entries, metrics, and pagination:**

```bash
curl -s "http://localhost:3000/reports/$REPORT_ID?include=entries,metrics&entriesPage=1&entriesSize=5&priority=HIGH" \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Response (summary):**

```json
{
  "id": "a1b2c3d4-...",
  "title": "Q4 Clinical Trial Summary",
  "status": "DRAFT",
  "createdBy": "user1",
  "createdAt": "2026-04-07T10:00:00.000Z",
  "updatedAt": "2026-04-07T10:00:00.000Z",
  "totalEntries": 3,
  "totalAttachments": 1,
  "highPriorityCount": 1
}
```

---

### Update Report

```
PUT /reports/:id
```

**Auth:** EDITOR

The `version` field is **required** for optimistic concurrency control. Send the version you last read; the server rejects the update with `409 Conflict` if it has changed.

**Request body:**

```json
{
  "version": 1,
  "description": "Updated summary with final enrollment numbers.",
  "status": "IN_PROGRESS",
  "tags": ["clinical-trial", "phase-2", "final"]
}
```

**curl:**

```bash
curl -s -X PUT http://localhost:3000/reports/$REPORT_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"version": 1, "description": "Updated summary.", "status": "IN_PROGRESS"}' | jq
```

**Response:** `200 OK` — returns the full updated report with `version` incremented.

---

### Upload Attachment

```
POST /reports/:id/attachment
```

**Auth:** EDITOR

Multipart form upload. Field name: `file`.

**Constraints:**

| Rule          | Value                                                                |
|---------------|----------------------------------------------------------------------|
| Max file size | 5 MB                                                                 |
| Allowed types | `image/png`, `image/jpeg`, `application/pdf`, `.xlsx`, `text/csv`   |

**curl:**

```bash
curl -s -X POST http://localhost:3000/reports/$REPORT_ID/attachment \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./enrollment-data.pdf" | jq
```

**Response:** `201 Created`

```json
{
  "attachment": {
    "id": "f5e6d7c8-...",
    "fileName": "enrollment-data.pdf",
    "mimeType": "application/pdf",
    "size": 245760,
    "uploadedAt": "2026-04-07T10:05:00.000Z"
  },
  "accessUrl": "http://localhost:3000/files/f5e6d7c8-...?token=eyJhbGci..."
}
```

The `accessUrl` contains a signed token that expires after 5 minutes. The `storagePath` is intentionally omitted from the response.

---

### Download File

```
GET /files/:id?token=<signed-token>
```

No `Authorization` header needed — the signed query-string token is sufficient. The server validates the token and prevents path-traversal attacks before serving the file.

---

## Error Responses

All errors follow a consistent shape:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Title must be 200 characters or fewer",
  "details": [...]
}
```

| Code                       | HTTP Status | Meaning                                       |
|----------------------------|-------------|-----------------------------------------------|
| `VALIDATION_ERROR`         | 400         | Invalid input (schema violation, missing file) |
| `UNAUTHORIZED`             | 401         | Missing or invalid JWT                        |
| `FORBIDDEN`                | 403         | Role lacks permission                         |
| `BUSINESS_RULE_VIOLATION`  | 403         | Blocked by a business rule                    |
| `NOT_FOUND`                | 404         | Resource does not exist                       |
| `CONFLICT`                 | 409         | Duplicate title or version mismatch           |
| `INTERNAL_ERROR`           | 500         | Unexpected server error                       |

---

## Running Tests

```bash
# Run all tests (unit + E2E)
npm test

# Run with coverage report
npm run test:coverage
```

Test structure:

```
tests/
├── unit/
│   ├── repository.test.ts     # In-memory repository CRUD, filtering, sorting
│   ├── report.service.test.ts # Service logic, business rules, audit
│   └── validation.test.ts     # Zod schema acceptance/rejection
└── e2e/
    └── report.e2e.test.ts     # Full HTTP round-trips via Supertest
```

---

## Scripts Reference

| Command              | Description                                |
|----------------------|--------------------------------------------|
| `npm run dev`        | Start with hot-reload (ts-node-dev)        |
| `npm run build`      | Compile TypeScript to `dist/`              |
| `npm start`          | Run compiled output                        |
| `npm test`           | Run all tests                              |
| `npm run test:coverage` | Run tests with coverage                 |
| `npm run lint`       | ESLint check on `src/`                     |
| `npm run format`     | Prettier format `src/`                     |

---

## Project Structure

```
src/
├── app.ts                        # Express app assembly
├── server.ts                     # HTTP server bootstrap
├── controllers/
│   ├── report.controller.ts      # Report CRUD + attachment routes
│   └── file.controller.ts        # Signed file download
├── services/
│   ├── report.service.ts         # Core business logic
│   ├── audit.service.ts          # Audit trail
│   ├── file-storage.service.ts   # File persistence + signed URLs
│   └── async-job.service.ts      # Background job runner with retry
├── repositories/
│   ├── report.repository.ts      # Repository interface
│   └── in-memory-report.repository.ts
├── models/                       # Domain types and enums
├── validation/                   # Zod schemas for input/query validation
├── rules/                        # Pluggable business rules engine
├── middleware/                    # Auth, error handling, logging, request context
├── errors/                       # Typed error hierarchy
├── utils/                        # Logger, JWT utilities
└── types/                        # Express type augmentations
```
