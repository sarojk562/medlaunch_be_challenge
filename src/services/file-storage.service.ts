import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';

export interface StoredFile {
  fileId: string;
  originalName: string;
  mimeType: string;
  size: number;
  storagePath: string;
}

export interface IFileStorageService {
  save(file: { buffer: Buffer; originalname: string; mimetype: string; size: number }): Promise<StoredFile>;
  getFilePath(fileId: string): Promise<string | null>;
  generateAccessUrl(fileId: string, baseUrl: string): string;
  verifyAccessToken(token: string): { fileId: string } | null;
}

const FILE_TOKEN_SECRET = process.env.FILE_TOKEN_SECRET || 'file-access-secret-change-in-production';
const ACCESS_TOKEN_EXPIRY_SECONDS = 300; // 5 minutes

export class LocalFileStorageService implements IFileStorageService {
  private readonly uploadDir: string;
  private readonly fileIndex = new Map<string, StoredFile>();

  constructor(uploadDir = path.join(process.cwd(), 'uploads')) {
    this.uploadDir = uploadDir;
  }

  async save(file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
  }): Promise<StoredFile> {
    await fs.mkdir(this.uploadDir, { recursive: true });

    const fileId = randomUUID();
    const ext = path.extname(file.originalname);
    const storedName = `${fileId}${ext}`;
    const storagePath = path.join(this.uploadDir, storedName);

    await fs.writeFile(storagePath, file.buffer);

    const stored: StoredFile = {
      fileId,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      storagePath,
    };

    this.fileIndex.set(fileId, stored);

    logger.info({ fileId, originalName: file.originalname, size: file.size }, 'File saved');

    // NOTE: In production, a virus/malware scan (e.g. ClamAV, AWS GuardDuty)
    // would be triggered here before the file is made available for download.
    // The file would be quarantined until the scan completes.

    return stored;
  }

  async getFilePath(fileId: string): Promise<string | null> {
    const stored = this.fileIndex.get(fileId);
    if (!stored) return null;

    try {
      await fs.access(stored.storagePath);
      return stored.storagePath;
    } catch {
      return null;
    }
  }

  generateAccessUrl(fileId: string, baseUrl: string): string {
    const token = jwt.sign({ fileId }, FILE_TOKEN_SECRET, {
      expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
    });
    return `${baseUrl}/files/${fileId}?token=${token}`;
  }

  verifyAccessToken(token: string): { fileId: string } | null {
    try {
      const decoded = jwt.verify(token, FILE_TOKEN_SECRET) as jwt.JwtPayload;
      if (typeof decoded.fileId !== 'string') return null;
      return { fileId: decoded.fileId };
    } catch {
      return null;
    }
  }
}
