import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/app';

const JWT_SECRET = 'dev-secret-change-in-production';

function editorToken(userId = 'user1') {
  return jwt.sign({ userId, role: 'EDITOR' }, JWT_SECRET, { expiresIn: 3600 });
}

function readerToken(userId = 'reader1') {
  return jwt.sign({ userId, role: 'READER' }, JWT_SECRET, { expiresIn: 3600 });
}

describe('Reports E2E', () => {
  let token: string;
  let reportId: string;

  beforeAll(() => {
    token = editorToken();
  });

  // ── POST /reports ──────────────────────────────────────────────────────────

  describe('POST /reports', () => {
    it('201 — creates a report', async () => {
      const res = await request(app)
        .post('/reports')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'E2E Report' });

      expect(res.status).toBe(201);
      expect(res.body.title).toBe('E2E Report');
      expect(res.body.id).toBeDefined();
      expect(res.body.version).toBe(1);
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.finalizedAt).toBeNull();
      expect(res.headers.location).toContain(`/reports/${res.body.id}`);

      reportId = res.body.id;
    });

    it('409 — rejects duplicate title for same user', async () => {
      const res = await request(app)
        .post('/reports')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'E2E Report' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CONFLICT');
    });

    it('400 — rejects invalid payload (missing title)', async () => {
      const res = await request(app)
        .post('/reports')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('400 — rejects title over 200 chars', async () => {
      const res = await request(app)
        .post('/reports')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'x'.repeat(201) });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('401 — rejects missing auth', async () => {
      const res = await request(app)
        .post('/reports')
        .send({ title: 'No Auth' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('401 — rejects invalid token', async () => {
      const res = await request(app)
        .post('/reports')
        .set('Authorization', 'Bearer invalid.token.here')
        .send({ title: 'Bad Token' });

      expect(res.status).toBe(401);
    });

    it('403 — rejects READER role', async () => {
      const res = await request(app)
        .post('/reports')
        .set('Authorization', `Bearer ${readerToken()}`)
        .send({ title: 'Reader Attempt' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  // ── GET /reports/:id ───────────────────────────────────────────────────────

  describe('GET /reports/:id', () => {
    it('200 — returns full report (default view)', async () => {
      const res = await request(app)
        .get(`/reports/${reportId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(reportId);
      expect(res.body.title).toBe('E2E Report');
      expect(res.body.version).toBeDefined();
    });

    it('200 — returns summary view', async () => {
      const res = await request(app)
        .get(`/reports/${reportId}?view=summary`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('totalEntries');
      expect(res.body).toHaveProperty('totalAttachments');
      expect(res.body).not.toHaveProperty('entries');
      expect(res.body).not.toHaveProperty('description');
    });

    it('200 — returns metrics when requested', async () => {
      const res = await request(app)
        .get(`/reports/${reportId}?include=metrics`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.metrics).toBeDefined();
      expect(res.body.metrics.derivedStatus).toBeDefined();
    });

    it('200 — READER can access', async () => {
      const res = await request(app)
        .get(`/reports/${reportId}`)
        .set('Authorization', `Bearer ${readerToken()}`);

      expect(res.status).toBe(200);
    });

    it('404 — returns not found for missing id', async () => {
      const res = await request(app)
        .get('/reports/nonexistent-id')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('401 — rejects unauthenticated request', async () => {
      const res = await request(app).get(`/reports/${reportId}`);

      expect(res.status).toBe(401);
    });
  });

  // ── PUT /reports/:id ───────────────────────────────────────────────────────

  describe('PUT /reports/:id', () => {
    it('200 — updates a report', async () => {
      const res = await request(app)
        .put(`/reports/${reportId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ version: 1, description: 'Updated via E2E' });

      expect(res.status).toBe(200);
      expect(res.body.description).toBe('Updated via E2E');
      expect(res.body.version).toBe(2);
    });

    it('400 — rejects missing version field', async () => {
      const res = await request(app)
        .put(`/reports/${reportId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ description: 'No version' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('version');
    });

    it('200 — accepts update with only version (defaults fill in)', async () => {
      const getRes = await request(app)
        .get(`/reports/${reportId}`)
        .set('Authorization', `Bearer ${token}`);

      const res = await request(app)
        .put(`/reports/${reportId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ version: getRes.body.version });

      expect(res.status).toBe(200);
    });

    it('409 — rejects version conflict', async () => {
      const res = await request(app)
        .put(`/reports/${reportId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ version: 999, description: 'stale' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CONFLICT');
    });

    it('404 — rejects update for missing report', async () => {
      const res = await request(app)
        .put('/reports/nonexistent')
        .set('Authorization', `Bearer ${token}`)
        .send({ version: 1, description: 'nope' });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('401 — rejects unauthenticated request', async () => {
      const res = await request(app)
        .put(`/reports/${reportId}`)
        .send({ version: 2, description: 'no auth' });

      expect(res.status).toBe(401);
    });

    it('403 — rejects READER role', async () => {
      const res = await request(app)
        .put(`/reports/${reportId}`)
        .set('Authorization', `Bearer ${readerToken()}`)
        .send({ version: 2, description: 'reader attempt' });

      expect(res.status).toBe(403);
    });
  });

  // ── Business rule — finalization ───────────────────────────────────────────

  describe('PUT /reports/:id (finalization rule)', () => {
    let ruleReportId: string;

    beforeAll(async () => {
      // Create a separate report for rule testing
      const res = await request(app)
        .post('/reports')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Rule Test Report' });

      ruleReportId = res.body.id;
    });

    it('200 — transitions to FINALIZED and sets finalizedAt', async () => {
      const res = await request(app)
        .put(`/reports/${ruleReportId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ version: 1, status: 'FINALIZED' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('FINALIZED');
      expect(res.body.finalizedAt).not.toBeNull();
    });

    it('200 — EDITOR can update within 24h grace period', async () => {
      const res = await request(app)
        .put(`/reports/${ruleReportId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ version: 2, description: 'Grace period update' });

      expect(res.status).toBe(200);
      expect(res.body.description).toBe('Grace period update');
    });

    it('200 — transitions to ARCHIVED', async () => {
      // Re-finalize first from current DRAFT state
      const fin = await request(app)
        .put(`/reports/${ruleReportId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ version: 3, status: 'FINALIZED' });

      const res = await request(app)
        .put(`/reports/${ruleReportId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ version: fin.body.version, status: 'ARCHIVED' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ARCHIVED');
    });

    it('403 — blocks update on ARCHIVED report', async () => {
      const getRes = await request(app)
        .get(`/reports/${ruleReportId}`)
        .set('Authorization', `Bearer ${token}`);

      const res = await request(app)
        .put(`/reports/${ruleReportId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ version: getRes.body.version, description: 'should fail' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('BUSINESS_RULE_VIOLATION');
    });
  });

  // ── POST /reports/:id/attachment ───────────────────────────────────────────

  describe('POST /reports/:id/attachment', () => {
    it('201 — uploads a valid file', async () => {
      const res = await request(app)
        .post(`/reports/${reportId}/attachment`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('pdf content'), {
          filename: 'test.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(201);
      expect(res.body.attachment).toBeDefined();
      expect(res.body.attachment.fileName).toBe('test.pdf');
      expect(res.body.attachment.mimeType).toBe('application/pdf');
      expect(res.body.accessUrl).toContain('/files/');
      // storagePath must NOT be in response
      expect(res.body.attachment).not.toHaveProperty('storagePath');
    });

    it('400 — rejects disallowed MIME type', async () => {
      const res = await request(app)
        .post(`/reports/${reportId}/attachment`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('exe content'), {
          filename: 'malware.exe',
          contentType: 'application/x-msdownload',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('400 — rejects request with no file', async () => {
      const res = await request(app)
        .post(`/reports/${reportId}/attachment`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('404 — rejects if report not found', async () => {
      const res = await request(app)
        .post('/reports/nonexistent/attachment')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('data'), {
          filename: 'test.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('401 — rejects unauthenticated request', async () => {
      const res = await request(app)
        .post(`/reports/${reportId}/attachment`)
        .attach('file', Buffer.from('data'), {
          filename: 'test.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(401);
    });
  });

  // ── GET /reports/:id with include & pagination ─────────────────────────────

  describe('GET /reports/:id (shaping & pagination)', () => {
    let richReportId: string;

    beforeAll(async () => {
      // Create report with entries for pagination testing
      const entries = Array.from({ length: 5 }, (_, i) => ({
        id: `ent-${i}`,
        title: `Entry ${i}`,
        content: `Content ${i}`,
        priority: i < 2 ? 'HIGH' : 'LOW',
        author: 'user1',
        createdAt: new Date(2025, 0, i + 1).toISOString(),
        updatedAt: new Date(2025, 0, i + 1).toISOString(),
      }));

      const res = await request(app)
        .post('/reports')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Rich Report', entries });

      richReportId = res.body.id;
    });

    it('200 — returns entries with pagination info', async () => {
      const res = await request(app)
        .get(`/reports/${richReportId}?include=entries&entriesSize=2&entriesPage=1`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(2);
      expect(res.body.entriesPagination.page).toBe(1);
      expect(res.body.entriesPagination.size).toBe(2);
      expect(res.body.entriesPagination.totalItems).toBe(5);
      expect(res.body.entriesPagination.totalPages).toBe(3);
    });

    it('200 — returns page 2', async () => {
      const res = await request(app)
        .get(`/reports/${richReportId}?include=entries&entriesSize=2&entriesPage=2`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(2);
      expect(res.body.entriesPagination.page).toBe(2);
    });

    it('200 — filters entries by priority', async () => {
      const res = await request(app)
        .get(`/reports/${richReportId}?include=entries&priority=HIGH`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(2);
      expect(res.body.entries.every((e: { priority: string }) => e.priority === 'HIGH')).toBe(true);
    });

    it('200 — includes attachments when requested', async () => {
      const res = await request(app)
        .get(`/reports/${richReportId}?include=attachments`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('attachments');
      expect(Array.isArray(res.body.attachments)).toBe(true);
    });

    it('200 — includes multiple fields', async () => {
      const res = await request(app)
        .get(`/reports/${richReportId}?include=entries,attachments,metrics`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('entries');
      expect(res.body).toHaveProperty('attachments');
      expect(res.body).toHaveProperty('metrics');
      expect(res.body.metrics.totalEntries).toBe(5);
      expect(res.body.metrics.highPriorityCount).toBe(2);
    });

    it('200 — does not include entries unless requested', async () => {
      const res = await request(app)
        .get(`/reports/${richReportId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('entries');
      expect(res.body).not.toHaveProperty('metrics');
    });
  });

  // ── Health ─────────────────────────────────────────────────────────────────

  describe('GET /health', () => {
    it('200 — returns ok', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });
});
