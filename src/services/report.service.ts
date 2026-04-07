import { randomUUID } from 'node:crypto';
import { Report, Priority, ReportStatus, Attachment } from '../models';
import { Entry } from '../models/entry.model';
import { IReportRepository } from '../repositories';
import { CreateReportInput, UpdateReportInput } from '../validation/report.validation';
import { GetReportQuery } from '../validation/report-query.validation';
import { AuditService } from './audit.service';
import { IFileStorageService, StoredFile } from './file-storage.service';
import { enqueueJob } from './async-job.service';
import { logger } from '../utils/logger';
import { NotFoundError, ConflictError } from '../errors/app-error';
import { Role } from '../utils/token.util';
import { enforceUpdateRules } from '../rules/report-rules';

// ── Computed metrics shape ───────────────────────────────────────────────────

export interface ReportMetrics {
  totalEntries: number;
  highPriorityCount: number;
  lastUpdatedEntryTimestamp: Date | null;
  derivedStatus: string;
}

// ── Shaped response types ────────────────────────────────────────────────────

interface PaginationInfo {
  page: number;
  size: number;
  totalItems: number;
  totalPages: number;
}

export interface ShapedReport {
  id: string;
  title: string;
  description: string;
  status: ReportStatus;
  createdBy: string;
  tags: string[];
  metadata: Report['metadata'];
  version: number;
  createdAt: Date;
  updatedAt: Date;
  entries?: Entry[];
  entriesPagination?: PaginationInfo;
  attachments?: Report['attachments'];
  metrics?: ReportMetrics;
}

export interface SummaryReport {
  id: string;
  title: string;
  status: ReportStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  totalEntries: number;
  totalAttachments: number;
  highPriorityCount: number;
}

export class ReportService {
  constructor(
    private readonly repo: IReportRepository,
    private readonly audit: AuditService,
    private readonly fileStorage: IFileStorageService,
  ) {}

  async createReport(input: CreateReportInput): Promise<Report> {
    await this.assertUniqueTitlePerUser(input.createdBy, input.title);

    const now = new Date();
    const report: Report = {
      ...input,
      id: randomUUID(),
      version: 1,
      createdAt: now,
      updatedAt: now,
      finalizedAt: input.status === ReportStatus.FINALIZED ? now : null,
    };

    const created = await this.repo.create(report);

    enqueueJob({
      name: 'ReportCreated',
      payload: { reportId: created.id, createdBy: created.createdBy },
      execute: async () => {
        // Simulate async work (e.g. send notification, index for search)
        logger.info({ reportId: created.id }, 'Processing ReportCreated event');
      },
    });

    return created;
  }

  async getReportById(id: string, query: GetReportQuery): Promise<ShapedReport | SummaryReport> {
    const report = await this.repo.findById(id);
    if (!report) {
      throw new ReportNotFoundError(id);
    }

    if (query.view === 'summary') {
      return this.buildSummary(report);
    }

    return this.buildShapedReport(report, query);
  }

  async updateReport(
    id: string,
    payload: UpdateReportInput,
    expectedVersion: number,
    userId: string,
    userRole: Role,
  ): Promise<Report> {
    const existing = await this.repo.findById(id);
    if (!existing) {
      throw new ReportNotFoundError(id);
    }

    // Enforce business rules (replaces the old assertNotFinalized check)
    enforceUpdateRules(existing, { userId, userRole });

    if (existing.version !== expectedVersion) {
      throw new VersionConflictError(id, expectedVersion, existing.version);
    }

    // If title is changing, enforce uniqueness
    if (payload.title && payload.title.toLowerCase() !== existing.title.toLowerCase()) {
      await this.assertUniqueTitlePerUser(existing.createdBy, payload.title);
    }

    // Track finalizedAt when status transitions to FINALIZED
    const effectivePayload = { ...payload } as Partial<Report>;
    if (payload.status === ReportStatus.FINALIZED && existing.status !== ReportStatus.FINALIZED) {
      effectivePayload.finalizedAt = new Date();
    }
    // Clear finalizedAt if transitioning away from FINALIZED
    if (
      payload.status &&
      payload.status !== ReportStatus.FINALIZED &&
      existing.status === ReportStatus.FINALIZED
    ) {
      effectivePayload.finalizedAt = null;
    }

    const updated = await this.repo.update(id, effectivePayload);

    const changedFields = Object.keys(payload);
    this.audit.record({
      reportId: id,
      userId,
      action: 'UPDATE',
      timestamp: new Date(),
      before: this.pickFields(existing, changedFields),
      after: this.pickFields(updated, changedFields),
      changedFields,
    });

    return updated;
  }

  async addAttachment(
    reportId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    userId: string,
    userRole: Role,
    baseUrl: string,
  ): Promise<{ attachment: Attachment; accessUrl: string }> {
    const report = await this.repo.findById(reportId);
    if (!report) {
      throw new ReportNotFoundError(reportId);
    }

    enforceUpdateRules(report, { userId, userRole });

    const stored: StoredFile = await this.fileStorage.save(file);

    const attachment: Attachment = {
      id: stored.fileId,
      fileName: stored.originalName,
      mimeType: stored.mimeType,
      size: stored.size,
      storagePath: stored.storagePath,
      uploadedAt: new Date(),
    };

    await this.repo.update(reportId, {
      attachments: [...report.attachments, attachment],
    });

    this.audit.record({
      reportId,
      userId,
      action: 'UPDATE',
      timestamp: new Date(),
      before: null,
      after: { attachments: [attachment] } as Partial<Report>,
      changedFields: ['attachments'],
    });

    const accessUrl = this.fileStorage.generateAccessUrl(stored.fileId, baseUrl);

    logger.info(
      { reportId, fileId: stored.fileId, fileName: stored.originalName },
      'Attachment added to report',
    );

    return { attachment, accessUrl };
  }

  // ── Private: helpers ────────────────────────────────────────────────────────

  private pickFields(report: Report, fields: string[]): Partial<Report> {
    const picked: Record<string, unknown> = {};
    for (const field of fields) {
      if (field in report) {
        picked[field] = report[field as keyof Report];
      }
    }
    return picked as Partial<Report>;
  }

  // ── Private: shaping ────────────────────────────────────────────────────────

  private buildSummary(report: Report): SummaryReport {
    return {
      id: report.id,
      title: report.title,
      status: report.status,
      createdBy: report.createdBy,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      totalEntries: report.entries.length,
      totalAttachments: report.attachments.length,
      highPriorityCount: report.entries.filter((e) => e.priority === Priority.HIGH).length,
    };
  }

  private buildShapedReport(report: Report, query: GetReportQuery): ShapedReport {
    const shaped: ShapedReport = {
      id: report.id,
      title: report.title,
      description: report.description,
      status: report.status,
      createdBy: report.createdBy,
      tags: report.tags,
      metadata: report.metadata,
      version: report.version,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    };

    if (query.include.has('entries')) {
      const { entries, pagination } = this.paginateEntries(report.entries, query);
      shaped.entries = entries;
      shaped.entriesPagination = pagination;
    }

    if (query.include.has('attachments')) {
      shaped.attachments = report.attachments;
    }

    if (query.include.has('metrics')) {
      shaped.metrics = this.computeMetrics(report);
    }

    return shaped;
  }

  private paginateEntries(
    entries: Entry[],
    query: GetReportQuery,
  ): { entries: Entry[]; pagination: PaginationInfo } {
    let filtered = entries;

    if (query.priorityFilter) {
      filtered = filtered.filter((e) => e.priority === query.priorityFilter);
    }

    filtered = this.sortEntries(filtered, query.sortBy, query.order);

    const totalItems = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.entriesSize));
    const start = (query.entriesPage - 1) * query.entriesSize;
    const paged = filtered.slice(start, start + query.entriesSize);

    return {
      entries: paged,
      pagination: { page: query.entriesPage, size: query.entriesSize, totalItems, totalPages },
    };
  }

  private sortEntries(entries: Entry[], sortBy: string, order: string): Entry[] {
    const sorted = [...entries];
    const priorityOrder: Record<string, number> = {
      [Priority.HIGH]: 3,
      [Priority.MEDIUM]: 2,
      [Priority.LOW]: 1,
    };

    sorted.sort((a, b) => {
      let diff: number;
      if (sortBy === 'priority') {
        diff = (priorityOrder[a.priority] ?? 0) - (priorityOrder[b.priority] ?? 0);
      } else {
        diff = a.createdAt.getTime() - b.createdAt.getTime();
      }
      return order === 'asc' ? diff : -diff;
    });

    return sorted;
  }

  private computeMetrics(report: Report): ReportMetrics {
    const entries = report.entries;
    const highPriorityCount = entries.filter((e) => e.priority === Priority.HIGH).length;

    const timestamps = entries.map((e) => e.updatedAt.getTime());
    const lastUpdatedEntryTimestamp =
      timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;

    let derivedStatus: string;
    if (report.status === ReportStatus.FINALIZED || report.status === ReportStatus.ARCHIVED) {
      derivedStatus = report.status;
    } else if (entries.length === 0) {
      derivedStatus = 'EMPTY';
    } else if (highPriorityCount > 0) {
      derivedStatus = 'NEEDS_ATTENTION';
    } else {
      derivedStatus = 'ON_TRACK';
    }

    return {
      totalEntries: entries.length,
      highPriorityCount,
      lastUpdatedEntryTimestamp,
      derivedStatus,
    };
  }

  // ── Private: invariants ─────────────────────────────────────────────────────

  private async assertUniqueTitlePerUser(createdBy: string, title: string): Promise<void> {
    const existing = await this.repo.list({ createdBy });
    const duplicate = existing.find((r) => r.title.toLowerCase() === title.toLowerCase());

    if (duplicate) {
      throw new DuplicateReportError(title, createdBy);
    }
  }
}

export class ReportNotFoundError extends NotFoundError {
  constructor(id: string) {
    super(`Report "${id}" not found`);
  }
}

export class DuplicateReportError extends ConflictError {
  constructor(title: string, createdBy: string) {
    super(`A report titled "${title}" already exists for user "${createdBy}"`);
  }
}

export class VersionConflictError extends ConflictError {
  constructor(
    id: string,
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(`Version conflict on report "${id}": expected ${expected}, current is ${actual}`, {
      expected,
      actual,
    });
  }
}
