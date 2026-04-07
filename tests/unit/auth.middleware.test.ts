import { Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../../src/middleware/auth.middleware';
import { Role, generateToken } from '../../src/utils/token.util';

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    requestId: 'test-req',
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response {
  return {} as Response;
}

describe('auth.middleware', () => {
  describe('authenticate', () => {
    it('sets req.user for a valid token', () => {
      const token = generateToken({ userId: 'u1', role: Role.EDITOR });
      const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
      const next = jest.fn();

      authenticate(req, mockRes(), next);

      expect(req.user).toEqual({ userId: 'u1', role: Role.EDITOR });
      expect(next).toHaveBeenCalledWith();
    });

    it('calls next with UnauthorizedError when no header', () => {
      const req = mockReq();
      const next = jest.fn();

      authenticate(req, mockRes(), next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('calls next with UnauthorizedError when header does not start with Bearer', () => {
      const req = mockReq({ headers: { authorization: 'Basic abc' } });
      const next = jest.fn();

      authenticate(req, mockRes(), next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('calls next with UnauthorizedError for invalid token', () => {
      const req = mockReq({ headers: { authorization: 'Bearer bad.token' } });
      const next = jest.fn();

      authenticate(req, mockRes(), next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });
  });

  describe('authorize', () => {
    it('calls next() when user role is permitted', () => {
      const middleware = authorize(Role.EDITOR);
      const req = mockReq();
      req.user = { userId: 'u1', role: Role.EDITOR };
      const next = jest.fn();

      middleware(req, mockRes(), next);

      expect(next).toHaveBeenCalledWith();
    });

    it('calls next with ForbiddenError when role not permitted', () => {
      const middleware = authorize(Role.EDITOR);
      const req = mockReq();
      req.user = { userId: 'u1', role: Role.READER };
      const next = jest.fn();

      middleware(req, mockRes(), next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    });

    it('calls next with UnauthorizedError when no user on request', () => {
      const middleware = authorize(Role.EDITOR);
      const req = mockReq();
      // req.user is undefined
      const next = jest.fn();

      middleware(req, mockRes(), next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });
  });
});
