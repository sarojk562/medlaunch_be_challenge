import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { Role } from '../utils/token.util';
import { createReportSchema, updateReportSchema } from '../validation/report.validation';
import { parseGetReportQuery } from '../validation/report-query.validation';
import { ReportService } from '../services/report.service';
import { UnauthorizedError, ValidationError } from '../errors/app-error';
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

  router.post(
    '/',
    authenticate,
    authorize(Role.EDITOR),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const user = req.user;
        if (!user) throw new UnauthorizedError();

        const input = createReportSchema.parse({
          ...req.body,
          createdBy: user.userId,
        });

        const report = await reportService.createReport(input);

        const log = logger.child({ requestId: req.requestId });
        log.info({ reportId: report.id, createdBy: report.createdBy }, 'Report created');

        res.status(201).location(`/reports/${report.id}`).json(report);
      } catch (err) {
        next(err);
      }
    },
  );

  // ── GET /reports/:id ─────────────────────────────────────────────────────

  router.get(
    '/:id',
    authenticate,
    authorize(Role.READER, Role.EDITOR),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const query = parseGetReportQuery(req.query as Record<string, unknown>);
        const result = await reportService.getReportById(id, query);
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // ── PUT /reports/:id ─────────────────────────────────────────────────────

  router.put(
    '/:id',
    authenticate,
    authorize(Role.EDITOR),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const user = req.user;
        if (!user) throw new UnauthorizedError();

        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

        const { version, ...body } = req.body;
        if (typeof version !== 'number') {
          throw new ValidationError(
            'Field "version" (number) is required for optimistic concurrency control',
          );
        }

        const payload = updateReportSchema.parse(body);
        const updated = await reportService.updateReport(id, payload, version, user.userId, user.role);

        const log = logger.child({ requestId: req.requestId });
        log.info({ reportId: id, version: updated.version }, 'Report updated');

        res.json(updated);
      } catch (err) {
        next(err);
      }
    },
  );

  // ── POST /reports/:id/attachment ─────────────────────────────────────────

  router.post(
    '/:id/attachment',
    authenticate,
    authorize(Role.EDITOR),
    upload.single('file'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const user = req.user;
        if (!user) throw new UnauthorizedError();

        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const file = req.file;

        if (!file) {
          throw new ValidationError('No file provided');
        }

        if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
          throw new ValidationError(
            `File type "${file.mimetype}" is not allowed. Accepted: ${[...ALLOWED_MIME_TYPES].join(', ')}`,
          );
        }

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const result = await reportService.addAttachment(id, file, user.userId, user.role, baseUrl);

        const log = logger.child({ requestId: req.requestId });
        log.info({ reportId: id, fileId: result.attachment.id }, 'Attachment uploaded');

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
        next(err);
      }
    },
  );

  return router;
}
