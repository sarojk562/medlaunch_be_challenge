import { Router, Request, Response } from 'express';
import path from 'node:path';
import { IFileStorageService } from '../services/file-storage.service';
import { logger } from '../utils/logger';

export function fileController(fileStorage: IFileStorageService): Router {
  const router = Router();

  // GET /files/:id?token=...
  router.get('/:id', async (req: Request, res: Response) => {
    const fileId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const token = req.query.token;

    if (typeof token !== 'string' || !token) {
      res.status(401).json({ code: 'UNAUTHORIZED', message: 'File access token required' });
      return;
    }

    const decoded = fileStorage.verifyAccessToken(token);
    if (!decoded || decoded.fileId !== fileId) {
      res.status(401).json({ code: 'UNAUTHORIZED', message: 'Invalid or expired file access token' });
      return;
    }

    const filePath = await fileStorage.getFilePath(fileId);
    if (!filePath) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'File not found' });
      return;
    }

    // Prevent path traversal by resolving and checking the path
    const resolved = path.resolve(filePath);
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    if (!resolved.startsWith(uploadsDir)) {
      logger.warn({ fileId, resolved }, 'Path traversal attempt blocked');
      res.status(403).json({ code: 'FORBIDDEN', message: 'Access denied' });
      return;
    }

    res.sendFile(resolved);
  });

  return router;
}
