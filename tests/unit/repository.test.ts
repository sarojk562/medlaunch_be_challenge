import { InMemoryReportRepository } from '../../src/repositories/in-memory-report.repository';
import { Report, ReportStatus, Priority } from '../../src/models';

function makeReport(overrides: Partial<Report> = {}): Report {
  const now = new Date();
  return {
    id: 'rpt-1',
    title: 'Test Report',
    description: '',
    status: ReportStatus.DRAFT,
    createdBy: 'user1',
    tags: [],
    metadata: {},
    entries: [],
    attachments: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
    finalizedAt: null,
    ...overrides,
  };
}

describe('InMemoryReportRepository', () => {
  let repo: InMemoryReportRepository;

  beforeEach(() => {
    repo = new InMemoryReportRepository();
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('stores and returns a clone of the report', async () => {
      const report = makeReport();
      const created = await repo.create(report);

      expect(created).toEqual(report);
      expect(created).not.toBe(report); // clone, not same reference
    });

    it('throws when creating a report with a duplicate id', async () => {
      await repo.create(makeReport());
      await expect(repo.create(makeReport())).rejects.toThrow('already exists');
    });
  });

  // ── findById ───────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns the report when found', async () => {
      const report = makeReport();
      await repo.create(report);
      const found = await repo.findById('rpt-1');

      expect(found).toEqual(report);
      expect(found).not.toBe(report);
    });

    it('returns null when not found', async () => {
      const found = await repo.findById('nonexistent');
      expect(found).toBeNull();
    });
  });

  // ── update ─────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('increments version on every update', async () => {
      await repo.create(makeReport());
      const updated = await repo.update('rpt-1', { description: 'changed' });

      expect(updated.version).toBe(2);
    });

    it('sets a new updatedAt timestamp', async () => {
      const report = makeReport({ createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-01-01') });
      await repo.create(report);
      const updated = await repo.update('rpt-1', { description: 'changed' });

      expect(updated.updatedAt.getTime()).toBeGreaterThan(report.updatedAt.getTime());
    });

    it('preserves immutable fields (id, createdBy, createdAt)', async () => {
      const report = makeReport();
      await repo.create(report);

      const updated = await repo.update('rpt-1', { description: 'new desc' });

      expect(updated.id).toBe(report.id);
      expect(updated.createdBy).toBe(report.createdBy);
      expect(updated.createdAt).toEqual(report.createdAt);
    });

    it('merges metadata instead of replacing', async () => {
      const report = makeReport({ metadata: { department: 'Research', confidential: true } });
      await repo.create(report);

      const updated = await repo.update('rpt-1', { metadata: { category: 'Phase II' } });

      expect(updated.metadata).toEqual({
        department: 'Research',
        confidential: true,
        category: 'Phase II',
      });
    });

    it('throws when updating a nonexistent report', async () => {
      await expect(repo.update('nonexistent', { title: 'nope' })).rejects.toThrow('not found');
    });
  });

  // ── delete ─────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('returns true when the report existed', async () => {
      await repo.create(makeReport());
      expect(await repo.delete('rpt-1')).toBe(true);
    });

    it('returns false when the report did not exist', async () => {
      expect(await repo.delete('nonexistent')).toBe(false);
    });

    it('removes the report from the store', async () => {
      await repo.create(makeReport());
      await repo.delete('rpt-1');
      expect(await repo.findById('rpt-1')).toBeNull();
    });
  });

  // ── list filtering & sorting ───────────────────────────────────────────────

  describe('list', () => {
    beforeEach(async () => {
      await repo.create(makeReport({
        id: 'rpt-a',
        title: 'Alpha',
        status: ReportStatus.DRAFT,
        createdBy: 'user1',
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-15'),
      }));
      await repo.create(makeReport({
        id: 'rpt-b',
        title: 'Bravo',
        status: ReportStatus.FINALIZED,
        createdBy: 'user2',
        createdAt: new Date('2025-02-01'),
        updatedAt: new Date('2025-02-10'),
      }));
      await repo.create(makeReport({
        id: 'rpt-c',
        title: 'Charlie',
        status: ReportStatus.DRAFT,
        createdBy: 'user1',
        createdAt: new Date('2025-03-01'),
        updatedAt: new Date('2025-03-05'),
      }));
    });

    it('returns all reports when no filters', async () => {
      const results = await repo.list();
      expect(results).toHaveLength(3);
    });

    it('filters by status', async () => {
      const results = await repo.list({ status: ReportStatus.DRAFT });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.status === ReportStatus.DRAFT)).toBe(true);
    });

    it('filters by createdBy', async () => {
      const results = await repo.list({ createdBy: 'user2' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('rpt-b');
    });

    it('sorts by createdAt desc by default', async () => {
      const results = await repo.list();
      const ids = results.map((r) => r.id);
      expect(ids).toEqual(['rpt-c', 'rpt-b', 'rpt-a']);
    });

    it('sorts by createdAt asc', async () => {
      const results = await repo.list({ sortBy: 'createdAt', sortOrder: 'asc' });
      const ids = results.map((r) => r.id);
      expect(ids).toEqual(['rpt-a', 'rpt-b', 'rpt-c']);
    });

    it('sorts by updatedAt desc', async () => {
      const results = await repo.list({ sortBy: 'updatedAt', sortOrder: 'desc' });
      const ids = results.map((r) => r.id);
      expect(ids).toEqual(['rpt-c', 'rpt-b', 'rpt-a']);
    });

    it('combines filter and sort', async () => {
      const results = await repo.list({
        createdBy: 'user1',
        sortBy: 'createdAt',
        sortOrder: 'asc',
      });
      expect(results.map((r) => r.id)).toEqual(['rpt-a', 'rpt-c']);
    });
  });
});
