import { enforceUpdateRules, finalizationGracePeriodRule } from '../../src/rules/report-rules';
import { Report, ReportStatus, Priority } from '../../src/models';
import { Role } from '../../src/utils/token.util';
import { BusinessRuleViolationError } from '../../src/errors/app-error';

function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    id: 'rpt-1',
    title: 'Test',
    description: '',
    status: ReportStatus.DRAFT,
    createdBy: 'user1',
    tags: [],
    metadata: {},
    entries: [],
    attachments: [],
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    finalizedAt: null,
    ...overrides,
  };
}

describe('report-rules', () => {
  describe('finalizationGracePeriodRule', () => {
    it('allows update on DRAFT report', () => {
      const report = makeReport({ status: ReportStatus.DRAFT });
      expect(() =>
        finalizationGracePeriodRule.evaluate(report, { userId: 'u1', userRole: Role.EDITOR }),
      ).not.toThrow();
    });

    it('allows update on IN_PROGRESS report', () => {
      const report = makeReport({ status: ReportStatus.IN_PROGRESS });
      expect(() =>
        finalizationGracePeriodRule.evaluate(report, { userId: 'u1', userRole: Role.EDITOR }),
      ).not.toThrow();
    });

    it('blocks ARCHIVED report', () => {
      const report = makeReport({ status: ReportStatus.ARCHIVED });
      expect(() =>
        finalizationGracePeriodRule.evaluate(report, { userId: 'u1', userRole: Role.EDITOR }),
      ).toThrow(BusinessRuleViolationError);
    });

    it('blocks non-EDITOR on FINALIZED report', () => {
      const report = makeReport({
        status: ReportStatus.FINALIZED,
        finalizedAt: new Date(),
      });
      expect(() =>
        finalizationGracePeriodRule.evaluate(report, { userId: 'u1', userRole: Role.READER }),
      ).toThrow('Only users with EDITOR role may modify a finalized report');
    });

    it('blocks FINALIZED report with no finalizedAt timestamp', () => {
      const report = makeReport({
        status: ReportStatus.FINALIZED,
        finalizedAt: null,
      });
      expect(() =>
        finalizationGracePeriodRule.evaluate(report, { userId: 'u1', userRole: Role.EDITOR }),
      ).toThrow('has no finalization timestamp');
    });

    it('allows EDITOR within 24h grace period', () => {
      const report = makeReport({
        status: ReportStatus.FINALIZED,
        finalizedAt: new Date(), // just now
      });
      expect(() =>
        finalizationGracePeriodRule.evaluate(report, { userId: 'u1', userRole: Role.EDITOR }),
      ).not.toThrow();
    });

    it('blocks EDITOR after 24h grace period expires', () => {
      const past = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const report = makeReport({
        status: ReportStatus.FINALIZED,
        finalizedAt: past,
      });
      expect(() =>
        finalizationGracePeriodRule.evaluate(report, { userId: 'u1', userRole: Role.EDITOR }),
      ).toThrow('24-hour finalization grace period');
    });
  });

  describe('enforceUpdateRules', () => {
    it('runs all rules and throws on violation', () => {
      const report = makeReport({ status: ReportStatus.ARCHIVED });
      expect(() =>
        enforceUpdateRules(report, { userId: 'u1', userRole: Role.EDITOR }),
      ).toThrow(BusinessRuleViolationError);
    });

    it('passes when no rules are violated', () => {
      const report = makeReport({ status: ReportStatus.DRAFT });
      expect(() =>
        enforceUpdateRules(report, { userId: 'u1', userRole: Role.EDITOR }),
      ).not.toThrow();
    });
  });
});
