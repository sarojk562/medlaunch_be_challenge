import { LocalFileStorageService } from '../../src/services/file-storage.service';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('LocalFileStorageService', () => {
  let service: LocalFileStorageService;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fss-test-'));
    service = new LocalFileStorageService(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const fakeFile = {
    buffer: Buffer.from('hello world'),
    originalname: 'doc.pdf',
    mimetype: 'application/pdf',
    size: 11,
  };

  describe('save', () => {
    it('writes the file to disk and returns metadata', async () => {
      const stored = await service.save(fakeFile);

      expect(stored.fileId).toBeDefined();
      expect(stored.originalName).toBe('doc.pdf');
      expect(stored.mimeType).toBe('application/pdf');
      expect(stored.size).toBe(11);
      expect(stored.storagePath).toContain(tmpDir);

      const content = await fs.readFile(stored.storagePath, 'utf8');
      expect(content).toBe('hello world');
    });
  });

  describe('getFilePath', () => {
    it('returns the path for a saved file', async () => {
      const stored = await service.save(fakeFile);
      const result = await service.getFilePath(stored.fileId);
      expect(result).toBe(stored.storagePath);
    });

    it('returns null for an unknown fileId', async () => {
      const result = await service.getFilePath('no-such-id');
      expect(result).toBeNull();
    });

    it('returns null when the file was deleted from disk', async () => {
      const stored = await service.save(fakeFile);
      await fs.unlink(stored.storagePath);
      const result = await service.getFilePath(stored.fileId);
      expect(result).toBeNull();
    });
  });

  describe('generateAccessUrl', () => {
    it('returns a URL with a signed token', () => {
      const url = service.generateAccessUrl('file-123', 'http://localhost:3000');
      expect(url).toMatch(/^http:\/\/localhost:3000\/files\/file-123\?token=.+/);
    });
  });

  describe('verifyAccessToken', () => {
    it('verifies a valid token and returns fileId', () => {
      const url = service.generateAccessUrl('file-abc', 'http://localhost:3000');
      const token = new URL(url).searchParams.get('token')!;
      const result = service.verifyAccessToken(token);
      expect(result).toEqual({ fileId: 'file-abc' });
    });

    it('returns null for a tampered token', () => {
      const result = service.verifyAccessToken('invalid.jwt.token');
      expect(result).toBeNull();
    });

    it('returns null for a token with missing fileId claim', () => {
      const jwt = require('jsonwebtoken');
      const token = jwt.sign({ notFileId: 'x' }, 'file-access-secret-change-in-production', { expiresIn: 60 });
      const result = service.verifyAccessToken(token);
      expect(result).toBeNull();
    });
  });
});
