import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';

export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
  next();
}
