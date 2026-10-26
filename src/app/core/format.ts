/** Pure formatting and date helpers. No Angular here, so they are easy to unit test. */

export const CATEGORIES = ['Kitchen', 'Pantry', 'Bathroom', 'Cleaning', 'Laundry', 'Office', 'Other'] as const;

export const UNITS = [
  'pcs', 'pack', 'box', 'roll', 'bottle', 'can', 'bag', 'carton', 'tube', 'sheet', 'pod',
  'lb', 'oz', 'gal', 'fl oz', 'g', 'kg', 'ml', 'L',
];

const PLURALS: Record<string, string> = {
  pack: 'packs', box: 'boxes', roll: 'rolls', bottle: 'bottles', can: 'cans', bag: 'bags',
  carton: 'cartons', tube: 'tubes', sheet: 'sheets', pod: 'pods', piece: 'pieces', jar: 'jars',
  tablet: 'tablets', bar: 'bars', loaf: 'loaves', lb: 'lbs',
};

/** 2 -> "2", 1.5 -> "1.5", 1.25 -> "1.25". */
export function formatQuantity(q: number): string {
  return String(Math.round(Number(q) * 100) / 100);
}

/** Singular for exactly 1, plural otherwise: (1, "roll") -> "roll", (3, "roll") -> "rolls", (2, "kg") -> "kg". */
export function unitLabel(q: number, unit: string): string {
  if (!unit) return '';
  return Math.abs(Number(q) - 1) < 1e-9 ? unit : PLURALS[unit] ?? unit;
}

/** "3 rolls", "1 carton", "250 g". */
export function amount(q: number, unit: string): string {
  return `${formatQuantity(q)} ${unitLabel(q, unit)}`.trim();
}

/** Same key the server uses to group items: trimmed, single-spaced, lower case. */
export function itemKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-10" for a Date in local time. */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}

export function monthLabel(key: string, locale?: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
}

/** Local calendar day, e.g. "2026-10-25". */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Value for <input type="datetime-local">, in local time. */
export function toLocalInputValue(d: Date): string {
  return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "today", "yesterday", "3 days ago", or "Oct 12". */
export function relativeDay(when: Date, now: Date = new Date(), locale?: string): string {
  const a = new Date(now); a.setHours(0, 0, 0, 0);
  const b = new Date(when); b.setHours(0, 0, 0, 0);
  const days = Math.round((a.getTime() - b.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(when);
}

export interface DayGroup<T> {
  key: string;
  date: Date;
  items: T[];
}

/** Groups items (already sorted newest first) by local calendar day, keeping order. */
export function groupByDay<T>(items: T[], dateOf: (item: T) => Date): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const date = dateOf(item);
    const key = dayKey(date);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, date, items: [item] });
  }
  return groups;
}

/**
 * Tally marks: groups of five (four strokes and a slash). Returns the size of each group,
 * capped at `max` marks in total. 7 -> [5, 2]; 23 with max 20 -> [5, 5, 5, 5].
 */
export function tallyGroups(count: number, max = 20): number[] {
  const shown = Math.max(0, Math.min(count, max));
  const groups: number[] = [];
  for (let left = shown; left > 0; left -= 5) groups.push(Math.min(5, left));
  return groups;
}

/** Pulls the human-readable message out of an API error (RFC 9457 problem "detail"). */
export function errorMessage(err: unknown, fallback: string): string {
  const e = err as { status?: number; error?: { detail?: unknown } } | null;
  if (e?.status === 0) return 'Can’t reach the server. Check your connection and try again.';
  const detail = e?.error?.detail;
  return typeof detail === 'string' && detail.trim() ? detail : fallback;
}
