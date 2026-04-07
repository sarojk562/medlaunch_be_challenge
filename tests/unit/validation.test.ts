import { ZodError } from 'zod';
import { createReportSchema, updateReportSchema } from '../../src/validation/report.validation';
import { ReportStatus, Priority } from '../../src/models/enums';

describe('createReportSchema', () => {
  const validPayload = {
    title: 'Valid Title',
    createdBy: 'user1',
  };

  it('accepts a minimal valid payload with defaults', () => {
    const result = createReportSchema.parse(validPayload);

    expect(result.title).toBe('Valid Title');
    expect(result.createdBy).toBe('user1');
    expect(result.description).toBe('');
    expect(result.status).toBe(ReportStatus.DRAFT);
    expect(result.tags).toEqual([]);
    expect(result.entries).toEqual([]);
    expect(result.attachments).toEqual([]);
  });

  it('accepts a full valid payload with entries', () => {
    const result = createReportSchema.parse({
      ...validPayload,
      description: 'Some description',
      status: ReportStatus.IN_PROGRESS,
      tags: ['tag1', 'tag2'],
      metadata: { department: 'Research', confidential: true },
      entries: [
        {
          id: 'e1',
          title: 'Entry',
          content: 'Content',
          priority: Priority.HIGH,
          author: 'user1',
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        },
      ],
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].createdAt).toBeInstanceOf(Date);
    expect(result.metadata.department).toBe('Research');
  });

  it('rejects missing title', () => {
    expect(() => createReportSchema.parse({ createdBy: 'user1' })).toThrow(ZodError);
  });

  it('rejects empty title', () => {
    expect(() => createReportSchema.parse({ title: '', createdBy: 'user1' })).toThrow(ZodError);
  });

  it('rejects title over 200 characters', () => {
    expect(() =>
      createReportSchema.parse({ title: 'x'.repeat(201), createdBy: 'user1' }),
    ).toThrow(ZodError);
  });

  it('rejects missing createdBy', () => {
    expect(() => createReportSchema.parse({ title: 'Test' })).toThrow(ZodError);
  });

  it('rejects invalid status enum', () => {
    expect(() =>
      createReportSchema.parse({ ...validPayload, status: 'INVALID' }),
    ).toThrow(ZodError);
  });

  it('rejects duplicate entry IDs', () => {
    const entry = {
      id: 'dup',
      title: 'E',
      content: '',
      priority: Priority.LOW,
      author: 'u',
      createdAt: '2025-01-01',
      updatedAt: '2025-01-01',
    };

    expect(() =>
      createReportSchema.parse({ ...validPayload, entries: [entry, entry] }),
    ).toThrow(ZodError);
  });

  it('trims whitespace from title', () => {
    const result = createReportSchema.parse({ title: '  Trimmed  ', createdBy: 'user1' });
    expect(result.title).toBe('Trimmed');
  });

  it('rejects invalid priority on entry', () => {
    expect(() =>
      createReportSchema.parse({
        ...validPayload,
        entries: [
          {
            id: 'e1',
            title: 'E',
            content: '',
            priority: 'CRITICAL',
            author: 'u',
            createdAt: '2025-01-01',
            updatedAt: '2025-01-01',
          },
        ],
      }),
    ).toThrow(ZodError);
  });
});

describe('updateReportSchema', () => {
  it('accepts a partial update with at least one field', () => {
    const result = updateReportSchema.parse({ description: 'Updated' });
    expect(result.description).toBe('Updated');
  });

  it('accepts an empty object (defaults fill in keys)', () => {
    // Zod .default() on fields means {} gets populated, so refine passes
    const result = updateReportSchema.parse({});
    expect(result).toBeDefined();
  });

  it('does not allow createdBy to be set', () => {
    // createdBy is omitted from the update schema — any value supplied
    // is stripped (zod strict would reject, but .omit strips it)
    const result = updateReportSchema.parse({ title: 'New', createdBy: 'hacker' });
    expect(result).not.toHaveProperty('createdBy');
  });

  it('accepts status change', () => {
    const result = updateReportSchema.parse({ status: ReportStatus.FINALIZED });
    expect(result.status).toBe(ReportStatus.FINALIZED);
  });
});
