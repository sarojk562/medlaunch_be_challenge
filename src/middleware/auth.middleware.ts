import { Request, Response, NextFunction } from 'express';
import { Role, verifyToken } from '../utils/token.util';
import { UnauthorizedError, ForbiddenError } from '../errors/app-error';
import { logger } from '../utils/logger';

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    next(new UnauthorizedError());
    return;
  }

  const token = header.slice(7);

  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    const log = logger.child({ requestId: req.requestId });
    log.warn({ err }, 'Token verification failed');
    next(new UnauthorizedError('Invalid or expired token'));
  }
}

export function authorize(...requiredRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
      next(new UnauthorizedError());
      return;
    }

    if (!requiredRoles.includes(user.role)) {
      next(new ForbiddenError());
      return;
    }

    next();
  };
}
