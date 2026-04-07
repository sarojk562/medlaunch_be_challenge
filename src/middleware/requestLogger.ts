import pinoHttp from 'pino-http';
import { Request } from 'express';
import { logger } from '../utils/logger';

export const requestLogger = pinoHttp({
  logger,
  customProps(req) {
    return { requestId: (req as Request).requestId };
  },
  customSuccessMessage(req, res) {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  customErrorMessage(req, res) {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  customLogLevel(_req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
});
