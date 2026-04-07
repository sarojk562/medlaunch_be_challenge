import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
import { AppError } from '../errors/app-error';
import { logger } from '../utils/logger';

interface ErrorResponseBody {
  code: string;
  message: string;
  details?: unknown;
}

export function errorHandlerMiddleware(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = req.requestId;
  const log = logger.child({ requestId });

  // ── Known application errors ─────────────────────────────────────────────
  if (err instanceof AppError) {
    const body: ErrorResponseBody = { code: err.code, message: err.message };
    if (err.details !== undefined) {
      body.details = err.details;
    }

    if (err.statusCode >= 500) {
      log.error({ err, statusCode: err.statusCode }, err.message);
    } else {
      log.warn({ statusCode: err.statusCode, code: err.code }, err.message);
    }

    res.status(err.statusCode).json(body);
    return;
  }

  // ── Zod validation errors ────────────────────────────────────────────────
  if (err instanceof ZodError) {
    log.warn({ issues: err.issues }, 'Validation failed');
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'Invalid request body',
      details: err.issues,
    } satisfies ErrorResponseBody);
    return;
  }

  // ── Multer errors ────────────────────────────────────────────────────────
  if (err instanceof multer.MulterError) {
    log.warn({ multerCode: err.code }, err.message);
    const status = err.code === 'LIMIT_FILE_SIZE' ? 400 : 400;
    res.status(status).json({
      code: err.code,
      message: err.message,
    } satisfies ErrorResponseBody);
    return;
  }

  // ── Unhandled / unknown errors ───────────────────────────────────────────
  log.error({ err }, 'Unhandled error');
  res.status(500).json({
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong',
  } satisfies ErrorResponseBody);
}
