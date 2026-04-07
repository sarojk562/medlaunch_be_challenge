import { verifyToken, generateToken, Role } from '../../src/utils/token.util';

describe('token.util', () => {
  describe('generateToken', () => {
    it('generates a valid JWT that can be verified', () => {
      const token = generateToken({ userId: 'u1', role: Role.EDITOR });
      const payload = verifyToken(token);
      expect(payload.userId).toBe('u1');
      expect(payload.role).toBe(Role.EDITOR);
    });
  });

  describe('verifyToken', () => {
    it('returns payload for a valid token', () => {
      const token = generateToken({ userId: 'u2', role: Role.READER });
      const result = verifyToken(token);
      expect(result).toEqual({ userId: 'u2', role: Role.READER });
    });

    it('throws on invalid signature', () => {
      expect(() => verifyToken('bad.token.value')).toThrow();
    });

    it('throws on token with missing userId', () => {
      const jwt = require('jsonwebtoken');
      const token = jwt.sign({ role: 'EDITOR' }, 'dev-secret-change-in-production', { expiresIn: 60 });
      expect(() => verifyToken(token)).toThrow('Invalid token payload');
    });

    it('throws on token with invalid role', () => {
      const jwt = require('jsonwebtoken');
      const token = jwt.sign({ userId: 'u1', role: 'ADMIN' }, 'dev-secret-change-in-production', { expiresIn: 60 });
      expect(() => verifyToken(token)).toThrow('Invalid token payload');
    });
  });
});
