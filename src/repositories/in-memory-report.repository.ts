import { Report } from '../models';
import { IReportRepository, ReportListFilters } from './report.repository';

export class InMemoryReportRepository implements IReportRepository {
  private readonly store = new Map<string, Report>();

  async create(report: Report): Promise<Report> {
    if (this.store.has(report.id)) {
      throw new Error(`Report with id "${report.id}" already exists`);
    }
    const doc = structuredClone(report);
    this.store.set(doc.id, doc);
    return structuredClone(doc);
  }

  async findById(id: string): Promise<Report | null> {
    const doc = this.store.get(id);
    return doc ? structuredClone(doc) : null;
  }

  async update(
    id: string,
    payload: Partial<Omit<Report, 'id' | 'createdBy' | 'createdAt'>>,
  ): Promise<Report> {
    const existing = this.store.get(id);
    if (!existing) {
      throw new Error(`Report with id "${id}" not found`);
    }

    const updated: Report = {
      ...existing,
      ...payload,
      metadata: { ...existing.metadata, ...payload.metadata },
      id: existing.id,
      createdBy: existing.createdBy,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
      version: existing.version + 1,
    };

    this.store.set(id, updated);
    return structuredClone(updated);
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  async list(filters: ReportListFilters = {}): Promise<Report[]> {
    let results = Array.from(this.store.values());

    if (filters.status) {
      results = results.filter((r) => r.status === filters.status);
    }
    if (filters.createdBy) {
      results = results.filter((r) => r.createdBy === filters.createdBy);
    }

    const sortBy = filters.sortBy ?? 'createdAt';
    const sortOrder = filters.sortOrder ?? 'desc';
    results.sort((a, b) => {
      const diff = a[sortBy].getTime() - b[sortBy].getTime();
      return sortOrder === 'asc' ? diff : -diff;
    });

    return results.map((r) => structuredClone(r));
  }
}
