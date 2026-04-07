import { Router, Request, Response, NextFunction } from 'express';
import path from 'node:path';
import { IFileStorageService } from '../services/file-storage.service';
import { UnauthorizedError, NotFoundError, ForbiddenError } from '../errors/app-error';
import { logger } from '../utils/logger';

export function fileController(fileStorage: IFileStorageService): Router {
  const router = Router();

  // GET /files/:id?token=...
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const fileId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const token = req.query.token;

      if (typeof token !== 'string' || !token) {
        throw new UnauthorizedError('File access token required');
      }

      const decoded = fileStorage.verifyAccessToken(token);
      if (!decoded || decoded.fileId !== fileId) {
        throw new UnauthorizedError('Invalid or expired file access token');
      }

      const filePath = await fileStorage.getFilePath(fileId);
      if (!filePath) {
        throw new NotFoundError('File not found');
      }

      // Prevent path traversal by resolving and checking the path
      const resolved = path.resolve(filePath);
      const uploadsDir = path.resolve(process.cwd(), 'uploads');
      if (!resolved.startsWith(uploadsDir)) {
        const log = logger.child({ requestId: req.requestId });
        log.warn({ fileId, resolved }, 'Path traversal attempt blocked');
        throw new ForbiddenError('Access denied');
      }

      res.sendFile(resolved);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
