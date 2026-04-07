import { Report, ReportStatus } from '../models';
import { Role } from '../utils/token.util';
import { BusinessRuleViolationError } from '../errors/app-error';

// ── Rule interface ───────────────────────────────────────────────────────────
// Each rule receives the report being updated and the context of who is
// performing the update.  If the rule is violated it throws a
// BusinessRuleViolationError; otherwise it returns void.

export interface BusinessRuleContext {
  userId: string;
  userRole: Role;
}

export interface BusinessRule {
  /** Short identifier for logging / debugging. */
  name: string;
  /** Evaluate the rule. Throw BusinessRuleViolationError on violation. */
  evaluate(report: Report, context: BusinessRuleContext): void;
}

// ── Rule: Finalization grace-period ──────────────────────────────────────────
//
// "A Report in FINALIZED status cannot be modified unless the user has the
//  EDITOR role AND the update occurs within 24 hours of finalization."
//
// Edge cases handled:
//   • report.finalizedAt is null despite FINALIZED status → treat as
//     no-grace-period (block the update).
//   • ARCHIVED reports are always blocked.

const FINALIZATION_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours

export const finalizationGracePeriodRule: BusinessRule = {
  name: 'FinalizationGracePeriod',

  evaluate(report: Report, context: BusinessRuleContext): void {
    if (report.status === ReportStatus.ARCHIVED) {
      throw new BusinessRuleViolationError(
        `Report "${report.id}" is archived and cannot be modified`,
      );
    }

    if (report.status !== ReportStatus.FINALIZED) {
      return; // rule does not apply to non-finalized reports
    }

    // EDITOR role is required for any modification of a finalized report
    if (context.userRole !== Role.EDITOR) {
      throw new BusinessRuleViolationError(
        'Only users with EDITOR role may modify a finalized report',
      );
    }

    // finalizedAt must be present; if missing treat as expired grace period
    if (!report.finalizedAt) {
      throw new BusinessRuleViolationError(
        `Report "${report.id}" is finalized but has no finalization timestamp — cannot determine grace period`,
      );
    }

    const elapsed = Date.now() - report.finalizedAt.getTime();
    if (elapsed > FINALIZATION_GRACE_PERIOD_MS) {
      throw new BusinessRuleViolationError(
        'Report cannot be modified after the 24-hour finalization grace period',
        {
          finalizedAt: report.finalizedAt.toISOString(),
          elapsedMs: elapsed,
          gracePeriodMs: FINALIZATION_GRACE_PERIOD_MS,
        },
      );
    }
  },
};

// ── Rule runner ──────────────────────────────────────────────────────────────
// Runs every registered rule in order.  This is the single point of entry for
// the service layer.  New rules are added by pushing to the array.

const updateRules: BusinessRule[] = [finalizationGracePeriodRule];

export function enforceUpdateRules(report: Report, context: BusinessRuleContext): void {
  for (const rule of updateRules) {
    rule.evaluate(report, context);
  }
}
