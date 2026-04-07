export interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  storagePath: string;
  uploadedAt: Date;
}
