import { Report, ReportStatus } from '../models';

export interface ReportListFilters {
  status?: ReportStatus;
  createdBy?: string;
  sortBy?: 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export interface IReportRepository {
  create(report: Report): Promise<Report>;
  findById(id: string): Promise<Report | null>;
  update(
    id: string,
    payload: Partial<Omit<Report, 'id' | 'createdBy' | 'createdAt'>>,
  ): Promise<Report>;
  delete(id: string): Promise<boolean>;
  list(filters?: ReportListFilters): Promise<Report[]>;
}
