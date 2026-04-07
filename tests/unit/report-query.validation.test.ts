import { parseGetReportQuery } from '../../src/validation/report-query.validation';
import { Priority } from '../../src/models/enums';

describe('parseGetReportQuery', () => {
  it('returns defaults for empty input', () => {
    const result = parseGetReportQuery({});
    expect(result.include.size).toBe(0);
    expect(result.view).toBe('full');
    expect(result.entriesPage).toBe(1);
    expect(result.entriesSize).toBe(20);
    expect(result.sortBy).toBe('createdAt');
    expect(result.order).toBe('desc');
    expect(result.priorityFilter).toBeUndefined();
  });

  it('parses comma-separated include fields', () => {
    const result = parseGetReportQuery({ include: 'entries,metrics' });
    expect(result.include.has('entries')).toBe(true);
    expect(result.include.has('metrics')).toBe(true);
    expect(result.include.has('attachments')).toBe(false);
  });

  it('ignores invalid include fields', () => {
    const result = parseGetReportQuery({ include: 'entries,bogus,metrics' });
    expect(result.include.size).toBe(2);
  });

  it('handles non-string include value', () => {
    const result = parseGetReportQuery({ include: 123 });
    expect(result.include.size).toBe(0);
  });

  it('parses view=summary', () => {
    const result = parseGetReportQuery({ view: 'summary' });
    expect(result.view).toBe('summary');
  });

  it('defaults invalid view to full', () => {
    const result = parseGetReportQuery({ view: 'invalid' });
    expect(result.view).toBe('full');
  });

  it('defaults non-string view to full', () => {
    const result = parseGetReportQuery({ view: 42 });
    expect(result.view).toBe('full');
  });

  it('parses entriesPage and entriesSize', () => {
    const result = parseGetReportQuery({ entriesPage: '3', entriesSize: '50' });
    expect(result.entriesPage).toBe(3);
    expect(result.entriesSize).toBe(50);
  });

  it('clamps entriesPage minimum to 1', () => {
    const result = parseGetReportQuery({ entriesPage: '-5' });
    expect(result.entriesPage).toBe(1);
  });

  it('clamps entriesSize to 1..100', () => {
    expect(parseGetReportQuery({ entriesSize: '0' }).entriesSize).toBe(20); // 0 → NaN fallback → default 20
    expect(parseGetReportQuery({ entriesSize: '200' }).entriesSize).toBe(100);
  });

  it('handles non-numeric entriesPage/entriesSize', () => {
    const result = parseGetReportQuery({ entriesPage: 'abc', entriesSize: 'xyz' });
    expect(result.entriesPage).toBe(1);
    expect(result.entriesSize).toBe(20);
  });

  it('parses sortBy=priority', () => {
    const result = parseGetReportQuery({ sortBy: 'priority' });
    expect(result.sortBy).toBe('priority');
  });

  it('defaults invalid sortBy to createdAt', () => {
    const result = parseGetReportQuery({ sortBy: 'bogus' });
    expect(result.sortBy).toBe('createdAt');
  });

  it('defaults non-string sortBy to createdAt', () => {
    const result = parseGetReportQuery({ sortBy: 99 });
    expect(result.sortBy).toBe('createdAt');
  });

  it('parses order=asc', () => {
    const result = parseGetReportQuery({ order: 'asc' });
    expect(result.order).toBe('asc');
  });

  it('defaults invalid order to desc', () => {
    const result = parseGetReportQuery({ order: 'sideways' });
    expect(result.order).toBe('desc');
  });

  it('defaults non-string order to desc', () => {
    const result = parseGetReportQuery({ order: true });
    expect(result.order).toBe('desc');
  });

  it('parses priority filter (case-insensitive)', () => {
    const result = parseGetReportQuery({ priority: 'high' });
    expect(result.priorityFilter).toBe(Priority.HIGH);
  });

  it('ignores invalid priority', () => {
    const result = parseGetReportQuery({ priority: 'URGENT' });
    expect(result.priorityFilter).toBeUndefined();
  });

  it('ignores non-string priority', () => {
    const result = parseGetReportQuery({ priority: 5 });
    expect(result.priorityFilter).toBeUndefined();
  });
});
