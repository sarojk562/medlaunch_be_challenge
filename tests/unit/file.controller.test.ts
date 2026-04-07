import request from 'supertest';
import express from 'express';
import { fileController } from '../../src/controllers/file.controller';
import { IFileStorageService } from '../../src/services/file-storage.service';
import { requestContextMiddleware } from '../../src/middleware/request-context.middleware';
import { errorHandlerMiddleware } from '../../src/middleware/error.middleware';

function buildApp(fileStorage: IFileStorageService) {
  const app = express();
  app.use(requestContextMiddleware);
  app.use('/files', fileController(fileStorage));
  app.use(errorHandlerMiddleware);
  return app;
}

describe('fileController', () => {
  it('401 — missing token query param', async () => {
    const storage: IFileStorageService = {
      save: jest.fn(),
      getFilePath: jest.fn(),
      generateAccessUrl: jest.fn(),
      verifyAccessToken: jest.fn().mockReturnValue(null),
    };
    const app = buildApp(storage);

    const res = await request(app).get('/files/abc');
    expect(res.status).toBe(401);
  });

  it('401 — token that does not match fileId', async () => {
    const storage: IFileStorageService = {
      save: jest.fn(),
      getFilePath: jest.fn(),
      generateAccessUrl: jest.fn(),
      verifyAccessToken: jest.fn().mockReturnValue({ fileId: 'different-id' }),
    };
    const app = buildApp(storage);

    const res = await request(app).get('/files/abc?token=sometoken');
    expect(res.status).toBe(401);
  });

  it('404 — file not found on disk', async () => {
    const storage: IFileStorageService = {
      save: jest.fn(),
      getFilePath: jest.fn().mockResolvedValue(null),
      generateAccessUrl: jest.fn(),
      verifyAccessToken: jest.fn().mockReturnValue({ fileId: 'abc' }),
    };
    const app = buildApp(storage);

    const res = await request(app).get('/files/abc?token=validtoken');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('403 — path traversal attempt', async () => {
    const storage: IFileStorageService = {
      save: jest.fn(),
      getFilePath: jest.fn().mockResolvedValue('/etc/passwd'),
      generateAccessUrl: jest.fn(),
      verifyAccessToken: jest.fn().mockReturnValue({ fileId: 'abc' }),
    };
    const app = buildApp(storage);

    const res = await request(app).get('/files/abc?token=validtoken');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});
