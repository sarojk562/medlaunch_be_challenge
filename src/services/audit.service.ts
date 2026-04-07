import { Report } from '../models';
import { logger } from '../utils/logger';

export interface AuditEntry {
  reportId: string;
  userId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  timestamp: Date;
  before: Partial<Report> | null;
  after: Partial<Report>;
  changedFields: string[];
}

export class AuditService {
  private readonly logs: AuditEntry[] = [];

  record(entry: AuditEntry): void {
    this.logs.push(entry);
    logger.info(
      { reportId: entry.reportId, userId: entry.userId, action: entry.action, changedFields: entry.changedFields },
      'Audit entry recorded',
    );
  }

  getByReportId(reportId: string): AuditEntry[] {
    return this.logs.filter((e) => e.reportId === reportId);
  }

  getAll(): AuditEntry[] {
    return [...this.logs];
  }
}
