import { Router, Request, Response } from 'express';
import { ZodError } from 'zod';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { Role } from '../utils/token.util';
import { createReportSchema } from '../validation/report.validation';
import { parseGetReportQuery } from '../validation/report-query.validation';
import {
  ReportService,
  DuplicateReportError,
  ReportNotFoundError,
} from '../services/report.service';
import { logger } from '../utils/logger';

export function reportController(reportService: ReportService): Router {
  const router = Router();

  router.post('/', authenticate, authorize(Role.EDITOR), async (req: Request, res: Response) => {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ code: 'UNAUTHORIZED', message: 'Authentication required' });
        return;
      }

      const input = createReportSchema.parse({
        ...req.body,
        createdBy: user.userId,
      });

      const report = await reportService.createReport(input);

      logger.info({ reportId: report.id, createdBy: report.createdBy }, 'Report created');

      res.status(201).location(`/reports/${report.id}`).json(report);
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: err.issues,
        });
        return;
      }

      if (err instanceof DuplicateReportError) {
        res.status(409).json({
          code: err.code,
          message: err.message,
        });
        return;
      }

      logger.error({ err }, 'Unexpected error creating report');
      res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Something went wrong' });
    }
  });

  // ── GET /reports/:id ─────────────────────────────────────────────────────

  router.get(
    '/:id',
    authenticate,
    authorize(Role.READER, Role.EDITOR),
    async (req: Request, res: Response) => {
      try {
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const query = parseGetReportQuery(req.query as Record<string, unknown>);
        const result = await reportService.getReportById(id, query);
        res.json(result);
      } catch (err) {
        if (err instanceof ReportNotFoundError) {
          res.status(404).json({ code: err.code, message: err.message });
          return;
        }

        logger.error({ err }, 'Unexpected error fetching report');
        res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Something went wrong' });
      }
    },
  );

  return router;
}
