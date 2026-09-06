/** Shared by every dashboard callable so range/bucketing logic isn't duplicated 5 times. */
export type DashboardRangeInput = {
  range?: 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'year' | 'custom';
  from?: string; // ISO date, only used when range === 'custom'
  to?: string;
};

export interface ResolvedRange {
  start: Date;
  end: Date;
  /** Same-length period immediately preceding `start` — the comparison baseline for a real (not fabricated) percent-change. */
  previousStart: Date;
  previousEnd: Date;
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

const DAY_MS = 86400000;

export function resolveRange(input: DashboardRangeInput): ResolvedRange {
  const now = new Date();
  let start: Date;
  let end: Date;

  switch (input.range) {
    case 'today':
      start = startOfDay(now);
      end = endOfDay(now);
      break;
    case 'yesterday': {
      const y = new Date(now.getTime() - DAY_MS);
      start = startOfDay(y);
      end = endOfDay(y);
      break;
    }
    case '7d':
      start = startOfDay(new Date(now.getTime() - 6 * DAY_MS));
      end = endOfDay(now);
      break;
    case '90d':
      start = startOfDay(new Date(now.getTime() - 89 * DAY_MS));
      end = endOfDay(now);
      break;
    case 'year':
      start = startOfDay(new Date(now.getFullYear(), 0, 1));
      end = endOfDay(now);
      break;
    case 'custom': {
      if (!input.from || !input.to) {
        throw new Error('Custom range requires from/to.');
      }
      start = startOfDay(new Date(input.from));
      end = endOfDay(new Date(input.to));
      break;
    }
    case '30d':
    default:
      start = startOfDay(new Date(now.getTime() - 29 * DAY_MS));
      end = endOfDay(now);
      break;
  }

  const durationMs = end.getTime() - start.getTime();
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - durationMs);

  return {start, end, previousStart, previousEnd};
}

export interface Bucket {
  /** ISO date (YYYY-MM-DD) of the bucket's start — the client's x-axis label. */
  label: string;
  start: Date;
  end: Date;
}

/**
 * Adaptive granularity keeps the number of per-bucket count queries bounded
 * (daily for a month, weekly for a quarter, monthly beyond) rather than
 * running 365 queries for a "This Year" range.
 */
export function buildBuckets(start: Date, end: Date): Bucket[] {
  const totalDays = Math.ceil((end.getTime() - start.getTime()) / DAY_MS);
  const buckets: Bucket[] = [];

  if (totalDays <= 31) {
    let cursor = startOfDay(start);
    while (cursor.getTime() <= end.getTime()) {
      buckets.push({label: cursor.toISOString().slice(0, 10), start: new Date(cursor), end: endOfDay(cursor)});
      cursor = new Date(cursor.getTime() + DAY_MS);
    }
  } else if (totalDays <= 90) {
    let cursor = startOfDay(start);
    while (cursor.getTime() <= end.getTime()) {
      const bucketEnd = new Date(Math.min(cursor.getTime() + 7 * DAY_MS - 1, end.getTime()));
      buckets.push({label: cursor.toISOString().slice(0, 10), start: new Date(cursor), end: bucketEnd});
      cursor = new Date(cursor.getTime() + 7 * DAY_MS);
    }
  } else {
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor.getTime() <= end.getTime()) {
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);
      const clampedEnd = new Date(Math.min(monthEnd.getTime(), end.getTime()));
      buckets.push({label: cursor.toISOString().slice(0, 10), start: new Date(cursor), end: clampedEnd});
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
  }

  return buckets;
}
