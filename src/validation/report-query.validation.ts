import { Priority } from '../models/enums';

export type IncludeField = 'entries' | 'attachments' | 'metrics';
export type ViewMode = 'full' | 'summary';
export type EntrySortField = 'createdAt' | 'priority';
export type SortOrder = 'asc' | 'desc';

export interface GetReportQuery {
  include: Set<IncludeField>;
  view: ViewMode;
  entriesPage: number;
  entriesSize: number;
  sortBy: EntrySortField;
  order: SortOrder;
  priorityFilter?: Priority;
}

const VALID_INCLUDE_FIELDS = new Set<string>(['entries', 'attachments', 'metrics']);
const VALID_VIEWS = new Set<string>(['full', 'summary']);
const VALID_SORT_FIELDS = new Set<string>(['createdAt', 'priority']);
const VALID_ORDERS = new Set<string>(['asc', 'desc']);

export function parseGetReportQuery(raw: Record<string, unknown>): GetReportQuery {
  const includeRaw = typeof raw.include === 'string' ? raw.include.split(',') : [];
  const include = new Set<IncludeField>(
    includeRaw.filter((f): f is IncludeField => VALID_INCLUDE_FIELDS.has(f.trim())),
  );

  const viewRaw = typeof raw.view === 'string' ? raw.view : 'full';
  const view: ViewMode = VALID_VIEWS.has(viewRaw) ? (viewRaw as ViewMode) : 'full';

  const entriesPage = Math.max(1, parseInt(String(raw.entriesPage ?? '1'), 10) || 1);
  const entriesSize = Math.min(100, Math.max(1, parseInt(String(raw.entriesSize ?? '20'), 10) || 20));

  const sortByRaw = typeof raw.sortBy === 'string' ? raw.sortBy : 'createdAt';
  const sortBy: EntrySortField = VALID_SORT_FIELDS.has(sortByRaw)
    ? (sortByRaw as EntrySortField)
    : 'createdAt';

  const orderRaw = typeof raw.order === 'string' ? raw.order : 'desc';
  const order: SortOrder = VALID_ORDERS.has(orderRaw) ? (orderRaw as SortOrder) : 'desc';

  const priorityRaw = typeof raw.priority === 'string' ? raw.priority.toUpperCase() : undefined;
  const priorityFilter = priorityRaw && Object.values(Priority).includes(priorityRaw as Priority)
    ? (priorityRaw as Priority)
    : undefined;

  return { include, view, entriesPage, entriesSize, sortBy, order, priorityFilter };
}
