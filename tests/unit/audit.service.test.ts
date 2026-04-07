import { AuditService } from '../../src/services/audit.service';
import { ReportStatus } from '../../src/models';

describe('AuditService', () => {
  let audit: AuditService;

  beforeEach(() => {
    audit = new AuditService();
  });

  it('records and retrieves entries by reportId', () => {
    audit.record({
      reportId: 'r1',
      userId: 'u1',
      action: 'CREATE',
      timestamp: new Date(),
      before: null,
      after: { title: 'Test' },
      changedFields: ['title'],
    });

    audit.record({
      reportId: 'r2',
      userId: 'u1',
      action: 'UPDATE',
      timestamp: new Date(),
      before: { description: '' },
      after: { description: 'updated' },
      changedFields: ['description'],
    });

    expect(audit.getByReportId('r1')).toHaveLength(1);
    expect(audit.getByReportId('r2')).toHaveLength(1);
    expect(audit.getByReportId('r3')).toHaveLength(0);
  });

  it('returns all entries via getAll', () => {
    audit.record({
      reportId: 'r1',
      userId: 'u1',
      action: 'CREATE',
      timestamp: new Date(),
      before: null,
      after: { title: 'A' },
      changedFields: ['title'],
    });

    audit.record({
      reportId: 'r2',
      userId: 'u2',
      action: 'UPDATE',
      timestamp: new Date(),
      before: null,
      after: { title: 'B' },
      changedFields: ['title'],
    });

    const all = audit.getAll();
    expect(all).toHaveLength(2);
    // Ensure it returns a copy
    all.pop();
    expect(audit.getAll()).toHaveLength(2);
  });
});
