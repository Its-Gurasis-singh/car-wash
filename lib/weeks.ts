/**
 * Week arithmetic for the commission panel. Every date here is a Brampton
 * (America/Toronto) calendar date held as a 'YYYY-MM-DD' string, and every week
 * runs Monday to Sunday - the same weeks the database invoices by.
 *
 * Plain date strings are shifted through Date.UTC so the browser's own time
 * zone and daylight saving can never move a day.
 */

const TZ = 'America/Toronto';

const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Today in Brampton. */
export function torontoToday(): string {
  return ymd.format(new Date());
}

/** The Brampton calendar date of an instant (e.g. a created_at timestamp). */
export function torontoDateOf(iso: string): string {
  return ymd.format(new Date(iso));
}

function toUtc(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const dt = toUtc(date);
  dt.setUTCDate(dt.getUTCDate() + days);
  return fromUtc(dt);
}

/** Monday of the week a date falls in. */
export function weekMonday(date: string): string {
  const dow = toUtc(date).getUTCDay(); // 0 = Sunday
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

/** The Mondays of `count` weeks ending with `lastMonday`, oldest first. */
export function weekSeries(lastMonday: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(lastMonday, -7 * (count - 1 - i)));
}

function fmt(date: string, opts: Intl.DateTimeFormatOptions): string {
  return toUtc(date).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
}

/** "Mon Oct 5" - built from parts, since the locale puts a comma after the weekday. */
function weekdayMonthDay(date: string): string {
  return `${fmt(date, { weekday: 'short' })} ${fmt(date, { month: 'short', day: 'numeric' })}`;
}

/** "Mon Oct 5 – Sun Oct 11, 2026" for a window from a Monday to a Sunday. */
export function rangeLabel(start: string, end: string): string {
  return `${weekdayMonthDay(start)} – ${weekdayMonthDay(end)}, ${fmt(end, { year: 'numeric' })}`;
}

/** "Oct 5" */
export function shortDate(date: string): string {
  return fmt(date, { month: 'short', day: 'numeric' });
}

/** "Mon" */
export function weekdayShort(date: string): string {
  return fmt(date, { weekday: 'short' });
}

/** "Mon, Oct 5" */
export function dayLabel(date: string): string {
  return fmt(date, { weekday: 'short', month: 'short', day: 'numeric' });
}
