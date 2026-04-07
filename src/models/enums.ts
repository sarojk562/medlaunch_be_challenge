export enum ReportStatus {
  DRAFT = 'DRAFT',
  IN_PROGRESS = 'IN_PROGRESS',
  FINALIZED = 'FINALIZED',
  ARCHIVED = 'ARCHIVED',
}

export enum Priority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

/**
 * Valid status transitions.
 * Key = current status, Value = set of statuses it can transition to.
 *
 * Not enforced yet — placeholder for future business logic.
 */
export const VALID_STATUS_TRANSITIONS: Record<ReportStatus, ReadonlySet<ReportStatus>> = {
  [ReportStatus.DRAFT]: new Set([ReportStatus.IN_PROGRESS]),
  [ReportStatus.IN_PROGRESS]: new Set([ReportStatus.FINALIZED, ReportStatus.DRAFT]),
  [ReportStatus.FINALIZED]: new Set([ReportStatus.ARCHIVED, ReportStatus.IN_PROGRESS]),
  [ReportStatus.ARCHIVED]: new Set<ReportStatus>(),
};
