import { randomUUID } from 'node:crypto';
import { Report } from '../models';
import { IReportRepository } from '../repositories';
import { CreateReportInput } from '../validation/report.validation';
import { enqueueJob } from './async-job.service';
import { logger } from '../utils/logger';

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

export class DuplicateReportError extends Error {
  public readonly code = 'DUPLICATE_RESOURCE' as const;

  constructor(title: string, createdBy: string) {
    super(`A report titled "${title}" already exists for user "${createdBy}"`);
    this.name = 'DuplicateReportError';
  }
}
