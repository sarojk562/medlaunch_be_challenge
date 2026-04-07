import { z } from 'zod';
import { Priority, ReportStatus } from '../models/enums';

// ── Helpers ──────────────────────────────────────────────────────────────────

const trimmedString = z.string().trim();
const nonEmptyString = trimmedString.min(1, 'Must not be empty');
const isoDateString = z.coerce.date();

// ── Comment ──────────────────────────────────────────────────────────────────

export const commentSchema = z.object({
  id: nonEmptyString,
  text: nonEmptyString,
  author: nonEmptyString,
  createdAt: isoDateString,
});

// ── Entry ────────────────────────────────────────────────────────────────────

export const entrySchema = z.object({
  id: nonEmptyString,
  title: nonEmptyString,
  content: trimmedString,
  priority: z.nativeEnum(Priority),
  author: nonEmptyString,
  comments: z.array(commentSchema).default([]),
  createdAt: isoDateString,
  updatedAt: isoDateString,
});

// ── Attachment ───────────────────────────────────────────────────────────────

export const attachmentSchema = z.object({
  id: nonEmptyString,
  fileName: nonEmptyString,
  mimeType: nonEmptyString,
  size: z.number().int().positive(),
  storagePath: nonEmptyString,
  uploadedAt: isoDateString,
});

// ── Report Metadata ──────────────────────────────────────────────────────────

export const reportMetadataSchema = z
  .object({
    department: trimmedString.optional(),
    category: trimmedString.optional(),
    confidential: z.boolean().optional(),
  })
  .passthrough();

// ── Report Creation ──────────────────────────────────────────────────────────

export const createReportSchema = z.object({
  title: nonEmptyString.max(200, 'Title must be 200 characters or fewer'),
  description: trimmedString.max(2000).default(''),
  status: z.nativeEnum(ReportStatus).default(ReportStatus.DRAFT),
  createdBy: nonEmptyString,
  tags: z.array(trimmedString).default([]),
  metadata: reportMetadataSchema.default({}),
  entries: z
    .array(entrySchema)
    .default([])
    .refine(
      (entries) => {
        const ids = entries.map((e) => e.id);
        return new Set(ids).size === ids.length;
      },
      { message: 'Entry IDs must be unique within a report' },
    ),
  attachments: z.array(attachmentSchema).default([]),
});

// ── Report Update (partial) ──────────────────────────────────────────────────

export const updateReportSchema = createReportSchema
  .omit({ createdBy: true })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

// ── Inferred types (useful for handler-level typing) ─────────────────────────

export type CreateReportInput = z.infer<typeof createReportSchema>;
export type UpdateReportInput = z.infer<typeof updateReportSchema>;
export type EntryInput = z.infer<typeof entrySchema>;
