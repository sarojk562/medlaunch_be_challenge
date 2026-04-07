import { Request, Response } from 'express';
import { errorHandlerMiddleware } from '../../src/middleware/error.middleware';
import { AppError, ValidationError, NotFoundError } from '../../src/errors/app-error';

// Minimal mock for res
function mockRes() {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis() as unknown as Response['status'],
    json: jest.fn().mockReturnThis() as unknown as Response['json'],
  };
  return res as Response;
}

function mockReq(overrides: Partial<Request> = {}): Request {
  return { requestId: 'test-req-id', ...overrides } as unknown as Request;
}

describe('errorHandlerMiddleware', () => {
  const next = jest.fn();

  it('handles AppError with statusCode < 500', () => {
    const res = mockRes();
    const err = new ValidationError('bad input');

    errorHandlerMiddleware(err, mockReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'VALIDATION_ERROR', message: 'bad input' }),
    );
  });

  it('handles AppError with details', () => {
    const res = mockRes();
    const err = new AppError('conflict', 409, 'CONFLICT', { expected: 1, actual: 2 });

    errorHandlerMiddleware(err, mockReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ details: { expected: 1, actual: 2 } }),
    );
  });

  it('handles AppError with statusCode >= 500', () => {
    const res = mockRes();
    const err = new AppError('internal', 500, 'INTERNAL', undefined);

    errorHandlerMiddleware(err, mockReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'INTERNAL', message: 'internal' }),
    );
  });

  it('handles ZodError', () => {
    const res = mockRes();
    // Create a real ZodError via a failed parse
    const { z } = require('zod');
    let zodErr: Error;
    try {
      z.string().parse(123);
    } catch (e) {
      zodErr = e as Error;
    }

    errorHandlerMiddleware(zodErr!, mockReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'VALIDATION_ERROR', message: 'Invalid request body' }),
    );
  });

  it('handles MulterError', () => {
    const res = mockRes();
    const multer = require('multer');
    const err = new multer.MulterError('LIMIT_FILE_SIZE');

    errorHandlerMiddleware(err, mockReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'LIMIT_FILE_SIZE' }),
    );
  });

  it('handles unknown error as 500', () => {
    const res = mockRes();
    const err = new Error('something unexpected');

    errorHandlerMiddleware(err, mockReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'INTERNAL_ERROR', message: 'Something went wrong' }),
    );
  });
});
