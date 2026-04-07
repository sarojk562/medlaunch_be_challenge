import { ReportStatus } from './enums';
import { Entry } from './entry.model';
import { Attachment } from './attachment.model';

export interface ReportMetadata {
  department?: string;
  category?: string;
  confidential?: boolean;
  [key: string]: unknown;
}

export interface Report {
  id: string;
  title: string;
  description: string;
  status: ReportStatus;
  createdBy: string;
  tags: string[];
  metadata: ReportMetadata;
  entries: Entry[];
  attachments: Attachment[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
