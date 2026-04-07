import { Router, Request, Response } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { Role } from '../utils/token.util';
import { createReportSchema, updateReportSchema } from '../validation/report.validation';
import { parseGetReportQuery } from '../validation/report-query.validation';
import {
  ReportService,
  DuplicateReportError,
  ReportNotFoundError,
  VersionConflictError,
  ReportFinalizedError,
} from '../services/report.service';
import { logger } from '../utils/logger';

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
]);

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

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

  // ── PUT /reports/:id ─────────────────────────────────────────────────────

  router.put('/:id', authenticate, authorize(Role.EDITOR), async (req: Request, res: Response) => {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ code: 'UNAUTHORIZED', message: 'Authentication required' });
        return;
      }

      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

      const { version, ...body } = req.body;
      if (typeof version !== 'number') {
        res.status(400).json({
          code: 'VALIDATION_ERROR',
          message: 'Field "version" (number) is required for optimistic concurrency control',
        });
        return;
      }

      const payload = updateReportSchema.parse(body);
      const updated = await reportService.updateReport(id, payload, version, user.userId);

      logger.info({ reportId: id, version: updated.version }, 'Report updated');

      res.json(updated);
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: err.issues,
        });
        return;
      }

      if (err instanceof ReportNotFoundError) {
        res.status(404).json({ code: err.code, message: err.message });
        return;
      }

      if (err instanceof VersionConflictError) {
        res.status(409).json({
          code: err.code,
          message: err.message,
          expected: err.expected,
          actual: err.actual,
        });
        return;
      }

      if (err instanceof ReportFinalizedError) {
        res.status(403).json({ code: err.code, message: err.message });
        return;
      }

      if (err instanceof DuplicateReportError) {
        res.status(409).json({ code: err.code, message: err.message });
        return;
      }

      logger.error({ err }, 'Unexpected error updating report');
      res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Something went wrong' });
    }
  });

  // ── POST /reports/:id/attachment ─────────────────────────────────────────

  router.post(
    '/:id/attachment',
    authenticate,
    authorize(Role.EDITOR),
    upload.single('file'),
    async (req: Request, res: Response) => {
      try {
        const user = req.user;
        if (!user) {
          res.status(401).json({ code: 'UNAUTHORIZED', message: 'Authentication required' });
          return;
        }

        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const file = req.file;

        if (!file) {
          res.status(400).json({ code: 'VALIDATION_ERROR', message: 'No file provided' });
          return;
        }

        if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
          res.status(400).json({
            code: 'INVALID_FILE_TYPE',
            message: `File type "${file.mimetype}" is not allowed. Accepted: ${[...ALLOWED_MIME_TYPES].join(', ')}`,
          });
          return;
        }

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const result = await reportService.addAttachment(id, file, user.userId, baseUrl);

        logger.info({ reportId: id, fileId: result.attachment.id }, 'Attachment uploaded');

        const safeAttachment = {
          id: result.attachment.id,
          fileName: result.attachment.fileName,
          mimeType: result.attachment.mimeType,
          size: result.attachment.size,
          uploadedAt: result.attachment.uploadedAt,
        };
        res.status(201).json({
          attachment: safeAttachment,
          accessUrl: result.accessUrl,
        });
      } catch (err) {
        if (err instanceof ReportNotFoundError) {
          res.status(404).json({ code: err.code, message: err.message });
          return;
        }

        if (err instanceof ReportFinalizedError) {
          res.status(403).json({ code: err.code, message: err.message });
          return;
        }

        // Multer file size error
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          res.status(400).json({
            code: 'FILE_TOO_LARGE',
            message: `File exceeds maximum size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
          });
          return;
        }

        logger.error({ err }, 'Unexpected error uploading attachment');
        res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Something went wrong' });
      }
    },
  );

  return router;
}
