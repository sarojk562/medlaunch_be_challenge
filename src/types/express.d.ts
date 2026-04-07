import { TokenPayload } from '../utils/token.util';

declare module 'express' {
  interface Request {
    user?: TokenPayload;
    requestId?: string;
  }
}
