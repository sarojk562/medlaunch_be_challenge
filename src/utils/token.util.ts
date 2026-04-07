import jwt, { SignOptions } from 'jsonwebtoken';

export enum Role {
  READER = 'READER',
  EDITOR = 'EDITOR',
}

export interface TokenPayload {
  userId: string;
  role: Role;
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;

  if (typeof decoded.userId !== 'string' || !Object.values(Role).includes(decoded.role)) {
    throw new Error('Invalid token payload');
  }

  return { userId: decoded.userId, role: decoded.role };
}

export function generateToken(payload: TokenPayload, options?: SignOptions): string {
  return jwt.sign({ ...payload }, JWT_SECRET, { expiresIn: 3600, ...options });
}
