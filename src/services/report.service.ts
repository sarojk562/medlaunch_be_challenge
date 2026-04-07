import { randomUUID } from 'node:crypto';
import { Report, Priority, ReportStatus } from '../models';
import { Entry } from '../models/entry.model';
import { IReportRepository } from '../repositories';
import { CreateReportInput } from '../validation/report.validation';
import { GetReportQuery } from '../validation/report-query.validation';
import { enqueueJob } from './async-job.service';
import { logger } from '../utils/logger';

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
  constructor(private readonly repo: IReportRepository) {}

  async createReport(input: CreateReportInput): Promise<Report> {
    await this.assertUniqueTitlePerUser(input.createdBy, input.title);

    const now = new Date();
    const report: Report = {
      ...input,
      id: randomUUID(),
      version: 1,
      createdAt: now,
      updatedAt: now,
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

    return { totalEntries: entries.length, highPriorityCount, lastUpdatedEntryTimestamp, derivedStatus };
  }

  // ── Private: invariants ─────────────────────────────────────────────────────

  private async assertUniqueTitlePerUser(createdBy: string, title: string): Promise<void> {
    const existing = await this.repo.list({ createdBy });
    const duplicate = existing.find(
      (r) => r.title.toLowerCase() === title.toLowerCase(),
    );

    if (duplicate) {
      throw new DuplicateReportError(title, createdBy);
    }
  }
}

export class ReportNotFoundError extends Error {
  public readonly code = 'NOT_FOUND' as const;

  constructor(id: string) {
    super(`Report "${id}" not found`);
    this.name = 'ReportNotFoundError';
  }
}

export class DuplicateReportError extends Error {
  public readonly code = 'DUPLICATE_RESOURCE' as const;

  constructor(title: string, createdBy: string) {
    super(`A report titled "${title}" already exists for user "${createdBy}"`);
    this.name = 'DuplicateReportError';
  }
}
