import { ReportService, ReportNotFoundError, DuplicateReportError, VersionConflictError } from '../../src/services/report.service';
import { InMemoryReportRepository } from '../../src/repositories/in-memory-report.repository';
import { AuditService } from '../../src/services/audit.service';
import { IFileStorageService, StoredFile } from '../../src/services/file-storage.service';
import { ReportStatus, Priority } from '../../src/models';
import { Role } from '../../src/utils/token.util';
import { BusinessRuleViolationError } from '../../src/errors/app-error';
import { CreateReportInput } from '../../src/validation/report.validation';

// ── Stubs ────────────────────────────────────────────────────────────────────

const stubFileStorage: IFileStorageService = {
  async save(file) {
    return {
      fileId: 'file-1',
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      storagePath: `/uploads/file-1${file.originalname}`,
    };
  },
  async getFilePath(fileId) {
    return `/uploads/${fileId}`;
  },
  generateAccessUrl(fileId, baseUrl) {
    return `${baseUrl}/files/${fileId}?token=stub`;
  },
  verifyAccessToken() {
    return { fileId: 'file-1' };
  },
};

function validInput(overrides: Partial<CreateReportInput> = {}): CreateReportInput {
  return {
    title: 'Test Report',
    description: '',
    status: ReportStatus.DRAFT,
    createdBy: 'user1',
    tags: [],
    metadata: {},
    entries: [],
    attachments: [],
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ReportService', () => {
  let service: ReportService;
  let repo: InMemoryReportRepository;
  let audit: AuditService;

  beforeEach(() => {
    repo = new InMemoryReportRepository();
    audit = new AuditService();
    service = new ReportService(repo, audit, stubFileStorage);
  });

  // ── createReport ─────────────────────────────────────────────────────────

  describe('createReport', () => {
    it('creates a report with generated id, version 1, timestamps', async () => {
      const report = await service.createReport(validInput());

      expect(report.id).toBeDefined();
      expect(report.version).toBe(1);
      expect(new Date(report.createdAt).getTime()).not.toBeNaN();
      expect(new Date(report.updatedAt).getTime()).not.toBeNaN();
      expect(report.finalizedAt).toBeNull();
    });

    it('sets finalizedAt when created with FINALIZED status', async () => {
      const report = await service.createReport(validInput({ status: ReportStatus.FINALIZED }));
      expect(report.finalizedAt).not.toBeNull();
      expect(new Date(report.finalizedAt!).getTime()).not.toBeNaN();
    });

    it('persists the report in the repository', async () => {
      const report = await service.createReport(validInput());
      const found = await repo.findById(report.id);
      expect(found).not.toBeNull();
      expect(found!.title).toBe('Test Report');
    });

    it('throws DuplicateReportError for same title+user (case-insensitive)', async () => {
      await service.createReport(validInput({ title: 'Unique Title' }));

      await expect(
        service.createReport(validInput({ title: 'unique title' })),
      ).rejects.toThrow(DuplicateReportError);
    });

    it('allows same title for different users', async () => {
      await service.createReport(validInput({ title: 'Shared Title', createdBy: 'user1' }));
      const report = await service.createReport(validInput({ title: 'Shared Title', createdBy: 'user2' }));
      expect(report.title).toBe('Shared Title');
    });
  });

  // ── getReportById ────────────────────────────────────────────────────────

  describe('getReportById', () => {
    it('throws ReportNotFoundError for missing id', async () => {
      await expect(
        service.getReportById('nonexistent', {
          include: new Set(),
          view: 'full',
          entriesPage: 1,
          entriesSize: 20,
          sortBy: 'createdAt',
          order: 'desc',
        }),
      ).rejects.toThrow(ReportNotFoundError);
    });

    it('returns summary view with counts', async () => {
      const input = validInput({
        entries: [
          {
            id: 'e1',
            title: 'Entry 1',
            content: '',
            priority: Priority.HIGH,
            author: 'user1',
            comments: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'e2',
            title: 'Entry 2',
            content: '',
            priority: Priority.LOW,
            author: 'user1',
            comments: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });
      const created = await service.createReport(input);

      const summary = await service.getReportById(created.id, {
        include: new Set(),
        view: 'summary',
        entriesPage: 1,
        entriesSize: 20,
        sortBy: 'createdAt',
        order: 'desc',
      });

      expect(summary).toHaveProperty('totalEntries', 2);
      expect(summary).toHaveProperty('highPriorityCount', 1);
      expect(summary).toHaveProperty('totalAttachments', 0);
      expect(summary).not.toHaveProperty('entries');
    });

    it('returns shaped report with metrics', async () => {
      const created = await service.createReport(validInput());

      const result = await service.getReportById(created.id, {
        include: new Set(['metrics'] as const),
        view: 'full',
        entriesPage: 1,
        entriesSize: 20,
        sortBy: 'createdAt',
        order: 'desc',
      });

      expect(result).toHaveProperty('metrics');
      expect((result as { metrics: { derivedStatus: string } }).metrics.derivedStatus).toBe('EMPTY');
    });
  });

  // ── updateReport ─────────────────────────────────────────────────────────

  describe('updateReport', () => {
    it('updates a DRAFT report successfully', async () => {
      const report = await service.createReport(validInput());
      const updated = await service.updateReport(
        report.id,
        { description: 'updated' },
        1,
        'user1',
        Role.EDITOR,
      );

      expect(updated.description).toBe('updated');
      expect(updated.version).toBe(2);
    });

    it('throws ReportNotFoundError for missing report', async () => {
      await expect(
        service.updateReport('missing', { description: 'x' }, 1, 'user1', Role.EDITOR),
      ).rejects.toThrow(ReportNotFoundError);
    });

    it('throws VersionConflictError on version mismatch', async () => {
      const report = await service.createReport(validInput());

      await expect(
        service.updateReport(report.id, { description: 'x' }, 999, 'user1', Role.EDITOR),
      ).rejects.toThrow(VersionConflictError);
    });

    it('throws DuplicateReportError when title conflicts', async () => {
      await service.createReport(validInput({ title: 'Existing' }));
      const other = await service.createReport(validInput({ title: 'Other' }));

      await expect(
        service.updateReport(other.id, { title: 'Existing' }, 1, 'user1', Role.EDITOR),
      ).rejects.toThrow(DuplicateReportError);
    });

    it('sets finalizedAt when transitioning to FINALIZED', async () => {
      const report = await service.createReport(validInput());
      const updated = await service.updateReport(
        report.id,
        { status: ReportStatus.FINALIZED },
        1,
        'user1',
        Role.EDITOR,
      );

      expect(updated.status).toBe(ReportStatus.FINALIZED);
      expect(updated.finalizedAt).not.toBeNull();
      expect(new Date(updated.finalizedAt!).getTime()).not.toBeNaN();
    });

    it('clears finalizedAt when transitioning away from FINALIZED', async () => {
      const report = await service.createReport(validInput());
      const finalized = await service.updateReport(
        report.id,
        { status: ReportStatus.FINALIZED },
        1,
        'user1',
        Role.EDITOR,
      );
      expect(finalized.finalizedAt).not.toBeNull();

      // Within 24h, EDITOR can transition back
      const unfinalized = await service.updateReport(
        report.id,
        { status: ReportStatus.IN_PROGRESS },
        2,
        'user1',
        Role.EDITOR,
      );
      expect(unfinalized.finalizedAt).toBeNull();
    });

    it('records an audit entry', async () => {
      const report = await service.createReport(validInput());
      await service.updateReport(report.id, { description: 'changed' }, 1, 'user1', Role.EDITOR);

      const entries = audit.getByReportId(report.id);
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe('UPDATE');
      expect(entries[0].changedFields).toContain('description');
    });
  });

  // ── Business rule enforcement ────────────────────────────────────────────

  describe('business rules', () => {
    it('allows EDITOR to update a recently finalized report', async () => {
      const report = await service.createReport(validInput());
      await service.updateReport(report.id, { status: ReportStatus.FINALIZED }, 1, 'user1', Role.EDITOR);

      // Within grace period — should succeed
      const updated = await service.updateReport(
        report.id,
        { description: 'grace period edit' },
        2,
        'user1',
        Role.EDITOR,
      );
      expect(updated.description).toBe('grace period edit');
    });

    it('blocks update on ARCHIVED report', async () => {
      const report = await service.createReport(validInput());
      await service.updateReport(report.id, { status: ReportStatus.FINALIZED }, 1, 'user1', Role.EDITOR);
      await service.updateReport(report.id, { status: ReportStatus.ARCHIVED }, 2, 'user1', Role.EDITOR);

      await expect(
        service.updateReport(report.id, { description: 'nope' }, 3, 'user1', Role.EDITOR),
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('blocks update when finalization grace period has expired', async () => {
      const report = await service.createReport(validInput());
      await service.updateReport(report.id, { status: ReportStatus.FINALIZED }, 1, 'user1', Role.EDITOR);

      // Manually set finalizedAt to 25 hours ago
      const stored = await repo.findById(report.id);
      const past = new Date(Date.now() - 25 * 60 * 60 * 1000);
      await repo.update(report.id, { finalizedAt: past });
      // Version is now 3 after the manual update
      const current = await repo.findById(report.id);

      await expect(
        service.updateReport(report.id, { description: 'too late' }, current!.version, 'user1', Role.EDITOR),
      ).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  // ── addAttachment ────────────────────────────────────────────────────────

  describe('addAttachment', () => {
    it('adds an attachment and returns the access URL', async () => {
      const report = await service.createReport(validInput());

      const result = await service.addAttachment(
        report.id,
        { buffer: Buffer.from('test'), originalname: 'test.pdf', mimetype: 'application/pdf', size: 4 },
        'user1',
        Role.EDITOR,
        'http://localhost:3000',
      );

      expect(result.attachment.fileName).toBe('test.pdf');
      expect(result.accessUrl).toContain('/files/');

      const updated = await repo.findById(report.id);
      expect(updated!.attachments).toHaveLength(1);
    });

    it('throws ReportNotFoundError for missing report', async () => {
      await expect(
        service.addAttachment(
          'missing',
          { buffer: Buffer.from('x'), originalname: 'f.pdf', mimetype: 'application/pdf', size: 1 },
          'user1',
          Role.EDITOR,
          'http://localhost:3000',
        ),
      ).rejects.toThrow(ReportNotFoundError);
    });

    it('blocks attachment on ARCHIVED report', async () => {
      const report = await service.createReport(validInput());
      await service.updateReport(report.id, { status: ReportStatus.FINALIZED }, 1, 'user1', Role.EDITOR);
      await service.updateReport(report.id, { status: ReportStatus.ARCHIVED }, 2, 'user1', Role.EDITOR);

      await expect(
        service.addAttachment(
          report.id,
          { buffer: Buffer.from('x'), originalname: 'f.pdf', mimetype: 'application/pdf', size: 1 },
          'user1',
          Role.EDITOR,
          'http://localhost:3000',
        ),
      ).rejects.toThrow(BusinessRuleViolationError);
    });
  });
});
