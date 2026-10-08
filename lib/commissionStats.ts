/**
 * The numbers behind the commission panel, as pure functions over rows the page
 * already holds. Balances (opening / earned / paid / closing) come from the
 * database's detailer_week_statements() and are only summed here, never
 * recomputed, so the panel and the detailer portal agree to the cent.
 *
 * Which date counts:
 *   - jobs scheduled / completed / cancelled: the service date (booking_date)
 *   - new bookings: created_at, as a Brampton date
 *   - commission: the week it was earned (booking_fees.week_start / completed_on)
 *   - payments: paid_on
 */
import { Booking, bookingTotal } from '@/types/booking';
import { BookingFee, DetailerPayment, WeekStatement, isFeeNotSet } from '@/types/fee';
import { Detailer } from '@/types/detailer';
import { addDays, shortDate, torontoDateOf, weekMonday, weekSeries, weekdayShort } from './weeks';

/** Jobs completed from this date run under the commission model. */
export const FEE_MODEL_START = '2026-09-19';

export type RangeWeeks = 1 | 4 | 8 | 12;

export interface Window {
  /** Mondays in the window, oldest first. */
  weeks: string[];
  start: string;
  /** The last Sunday. */
  end: string;
  endMonday: string;
}

export function windowFor(endMonday: string, count: number): Window {
  const weeks = weekSeries(endMonday, count);
  return { weeks, start: weeks[0], end: addDays(endMonday, 6), endMonday };
}

/** The window of the same length immediately before. */
export function previousWindow(win: Window): Window {
  return windowFor(addDays(win.weeks[0], -7), win.weeks.length);
}

const inWindow = (date: string | undefined | null, win: Window) => !!date && date >= win.start && date <= win.end;

/** True when the booking had the engine bay charged to the customer. */
export const hasEngineBay = (b: Booking) => (b.engine_bay_fee ?? 0) > 0;
export const isSevenSeater = (b: Booking) => /7-seater/i.test(b.notes || '');

/** completed / (completed + cancelled). Null when nothing has resolved yet. */
export function completionRate(completed: number, cancelled: number): number | null {
  const resolved = completed + cancelled;
  return resolved === 0 ? null : completed / resolved;
}

interface StatementTotals {
  earned: number;
  paid: number;
  /** Sum of positive closing balances at the window's end. A credit is not outstanding. */
  outstanding: number;
}

/** Earned and paid over the window, and what is owed at its end, optionally for one detailer. */
export function statementTotals(statements: WeekStatement[], win: Window, detailerId?: string): StatementTotals {
  const weeks = new Set(win.weeks);
  let earned = 0;
  let paid = 0;
  let outstanding = 0;
  for (const s of statements) {
    if (detailerId && s.detailer_id !== detailerId) continue;
    if (weeks.has(s.week_start)) {
      earned += s.earned;
      paid += s.paid;
    }
    if (s.week_start === win.endMonday) outstanding += Math.max(0, s.closing);
  }
  return { earned, paid, outstanding };
}

export interface Kpis {
  newBookings: number;
  scheduled: number;
  completed: number;
  cancelled: number;
  completionRate: number | null;
  /** What customers paid for the completed jobs. The detailers collected it. */
  gross: number;
  earned: number;
  collected: number;
  outstanding: number;
}

export function computeKpis(win: Window, bookings: Booking[], statements: WeekStatement[]): Kpis {
  let newBookings = 0, scheduled = 0, completed = 0, cancelled = 0, gross = 0;
  for (const b of bookings) {
    if (b.created_at && inWindow(torontoDateOf(b.created_at), win)) newBookings += 1;
    if (!inWindow(b.booking_date, win)) continue;
    scheduled += 1;
    if (b.status === 'completed') {
      completed += 1;
      gross += bookingTotal(b) || 0;
    } else if (b.status === 'cancelled') {
      cancelled += 1;
    }
  }
  const t = statementTotals(statements, win);
  return {
    newBookings,
    scheduled,
    completed,
    cancelled,
    completionRate: completionRate(completed, cancelled),
    gross,
    earned: t.earned,
    collected: t.paid,
    outstanding: t.outstanding,
  };
}

export interface SeriesPoint {
  key: string;
  label: string;
  sublabel: string;
  jobs: number;
  completed: number;
  commission: number;
}

/**
 * Mon->Sun by day for a one-week window; by week for longer ones, where 56 or
 * 84 daily bars would be unreadable.
 */
export function computeSeries(win: Window, bookings: Booking[], fees: BookingFee[]): SeriesPoint[] {
  const byDay = win.weeks.length === 1;
  const keys = byDay ? Array.from({ length: 7 }, (_, i) => addDays(win.start, i)) : win.weeks;
  const points = new Map<string, SeriesPoint>(
    keys.map((k) => [
      k,
      {
        key: k,
        label: byDay ? weekdayShort(k) : shortDate(k),
        sublabel: byDay ? shortDate(k) : `wk of ${shortDate(k)}`,
        jobs: 0,
        completed: 0,
        commission: 0,
      },
    ])
  );
  const bucket = (date: string) => (byDay ? date : weekMonday(date));

  for (const b of bookings) {
    if (!inWindow(b.booking_date, win)) continue;
    const p = points.get(bucket(b.booking_date));
    if (!p) continue;
    p.jobs += 1;
    if (b.status === 'completed') p.completed += 1;
  }
  for (const f of fees) {
    if (f.effective_amount == null || !inWindow(f.completed_on, win)) continue;
    const p = points.get(bucket(f.completed_on));
    if (p) p.commission += f.effective_amount;
  }
  return keys.map((k) => points.get(k)!);
}

export interface DetailerRow {
  id: string;
  name: string;
  inactive: boolean;
  assigned: number;
  completed: number;
  cancelled: number;
  /** Still scheduled. */
  pending: number;
  completionRate: number | null;
  gross: number;
  earned: number;
  paid: number;
  /** Closing balance at the window's end. Negative = in credit. */
  outstanding: number;
  /** Jobs that carried a commission in the window. */
  jobsCharged: number;
  avgCommission: number | null;
}

export interface UnassignedRow {
  assigned: number;
  completed: number;
  cancelled: number;
  pending: number;
  gross: number;
}

export function computeDetailerRows(
  win: Window,
  detailers: Detailer[],
  bookings: Booking[],
  fees: BookingFee[],
  statements: WeekStatement[]
): { rows: DetailerRow[]; unassigned: UnassignedRow } {
  const blank = () => ({ assigned: 0, completed: 0, cancelled: 0, pending: 0, gross: 0 });
  const counts = new Map<string, ReturnType<typeof blank>>();
  const unassigned = blank();

  for (const b of bookings) {
    if (!inWindow(b.booking_date, win)) continue;
    let c = unassigned;
    if (b.assigned_detailer_id) {
      if (!counts.has(b.assigned_detailer_id)) counts.set(b.assigned_detailer_id, blank());
      c = counts.get(b.assigned_detailer_id)!;
    }
    c.assigned += 1;
    if (b.status === 'completed') {
      c.completed += 1;
      c.gross += bookingTotal(b) || 0;
    } else if (b.status === 'cancelled') c.cancelled += 1;
    else c.pending += 1;
  }

  const weeks = new Set(win.weeks);
  const charged = new Map<string, number>();
  for (const f of fees) {
    if (f.effective_amount == null || !weeks.has(f.week_start)) continue;
    charged.set(f.detailer_id, (charged.get(f.detailer_id) || 0) + 1);
  }

  const rows: DetailerRow[] = [];
  for (const d of detailers) {
    const c = counts.get(d.id) || blank();
    const t = statementTotals(statements, win, d.id);
    const closing = statements.find((s) => s.detailer_id === d.id && s.week_start === win.endMonday)?.closing ?? 0;
    const jobsCharged = charged.get(d.id) || 0;
    // Someone off the roster with nothing in the window and nothing owed is noise.
    if (d.status !== 'active' && c.assigned === 0 && t.earned === 0 && t.paid === 0 && closing === 0) continue;
    rows.push({
      id: d.id,
      name: d.name,
      inactive: d.status !== 'active',
      ...c,
      completionRate: completionRate(c.completed, c.cancelled),
      earned: t.earned,
      paid: t.paid,
      outstanding: closing,
      jobsCharged,
      avgCommission: jobsCharged > 0 ? t.earned / jobsCharged : null,
    });
  }
  return { rows, unassigned };
}

export interface Alerts {
  /** Completed since the commission model began, with nobody to charge. */
  noDetailer: Booking[];
  /** Completed jobs before the model with no detailer - not actionable, just counted. */
  legacyNoDetailer: number;
  feeNotSet: { fee: BookingFee; booking?: Booking }[];
  /** Service date has passed and the booking is still scheduled. */
  stale: Booking[];
}

export function computeAlerts(bookings: Booking[], fees: BookingFee[], today: string): Alerts {
  const byId = new Map(bookings.map((b) => [b.id, b]));
  const noDetailer: Booking[] = [];
  const stale: Booking[] = [];
  let legacyNoDetailer = 0;
  for (const b of bookings) {
    if (b.status === 'completed' && !b.assigned_detailer_id) {
      if (b.booking_date >= FEE_MODEL_START) noDetailer.push(b);
      else legacyNoDetailer += 1;
    }
    if (b.status === 'scheduled' && b.booking_date < today) stale.push(b);
  }
  const feeNotSet = fees.filter(isFeeNotSet).map((fee) => ({ fee, booking: byId.get(fee.booking_id) }));
  const byDate = (a: Booking, b: Booking) => (a.booking_date + a.booking_time).localeCompare(b.booking_date + b.booking_time);
  return { noDetailer: noDetailer.sort(byDate), legacyNoDetailer, feeNotSet, stale: stale.sort(byDate) };
}

/** One line of a detailer's drill-down: the booking, and their commission on it if any. */
export interface JobLine {
  booking_id: string;
  booking?: Booking;
  fee?: BookingFee;
  date: string;
}

export function detailerJobLines(detailerId: string, win: Window, bookings: Booking[], fees: BookingFee[]): JobLine[] {
  const weeks = new Set(win.weeks);
  const byId = new Map(bookings.map((b) => [b.id, b]));
  const lines = new Map<string, JobLine>();
  for (const b of bookings) {
    if (b.assigned_detailer_id === detailerId && inWindow(b.booking_date, win)) {
      lines.set(b.id, { booking_id: b.id, booking: b, date: b.booking_date });
    }
  }
  for (const f of fees) {
    if (f.detailer_id !== detailerId) continue;
    const line = lines.get(f.booking_id);
    if (line) line.fee = f;
    else if (weeks.has(f.week_start)) {
      // Earned in this window but serviced outside it (completed late), or the
      // booking has since moved to someone else - the commission stays here.
      lines.set(f.booking_id, { booking_id: f.booking_id, booking: byId.get(f.booking_id), fee: f, date: f.completed_on });
    }
  }
  return Array.from(lines.values()).sort((a, b) =>
    (a.date + (a.booking?.booking_time || '')).localeCompare(b.date + (b.booking?.booking_time || ''))
  );
}

const money = (n: number) => `$${n.toFixed(2).replace(/\.00$/, '')}`;

/** "$46 × 2 + pet hair $10 + engine bay $15". */
export function feeBreakdown(f: BookingFee): string {
  if (f.fee_amount == null) {
    return f.completed_at ? 'Fee not set' : 'No-show / not completed';
  }
  const parts = [
    f.package_fee_per_car != null ? `${money(f.package_fee_per_car)} × ${f.car_count}` : 'package',
  ];
  if (f.pet_hair_fee > 0) parts.push(`pet hair ${money(f.pet_hair_fee)}`);
  if (f.engine_bay_commission > 0) parts.push(`engine bay ${money(f.engine_bay_commission)}`);
  return parts.join(' + ');
}

/**
 * What a detailer owes that is past due, paying oldest weeks first. Fees are
 * due 7 days after their week ends (due_on), so anything still inside that
 * grace period is owed but not yet overdue.
 */
export function overdueFor(detailerId: string, fees: BookingFee[], payments: DetailerPayment[], today: string): number {
  let charged = 0;
  let notYetDue = 0;
  for (const f of fees) {
    if (f.detailer_id !== detailerId || f.effective_amount == null) continue;
    charged += f.effective_amount;
    if (f.due_on >= today) notYetDue += f.effective_amount;
  }
  const paid = payments.filter((p) => p.detailer_id === detailerId).reduce((s, p) => s + p.amount, 0);
  return Math.max(0, charged - paid - notYetDue);
}

export interface PackageMix {
  services: { service: string; count: number }[];
  petHair: number;
  engineBay: number;
  sevenSeater: number;
}

export function packageMix(lines: JobLine[]): PackageMix {
  const counts = new Map<string, number>();
  let petHair = 0, engineBay = 0, sevenSeater = 0;
  for (const l of lines) {
    const b = l.booking;
    if (!b || b.status !== 'completed') continue;
    counts.set(b.service, (counts.get(b.service) || 0) + 1);
    if (b.pet_hair) petHair += 1;
    if (hasEngineBay(b)) engineBay += 1;
    if (isSevenSeater(b)) sevenSeater += 1;
  }
  return {
    services: Array.from(counts.entries())
      .map(([service, count]) => ({ service, count }))
      .sort((a, b) => b.count - a.count),
    petHair,
    engineBay,
    sevenSeater,
  };
}

const csvCell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function statementCsv(opts: {
  detailerName: string;
  win: Window;
  opening: number;
  earned: number;
  paid: number;
  closing: number;
  lines: JobLine[];
  payments: DetailerPayment[];
  serviceLabel: (s: string) => string;
}): string {
  const { detailerName, win, opening, earned, paid, closing, lines, payments, serviceLabel } = opts;
  const rows: (string | number | null)[][] = [
    ['Statement', detailerName],
    ['Period', `${win.start} to ${win.end}`],
    ['Opening balance', opening.toFixed(2)],
    ['Commission earned', earned.toFixed(2)],
    ['Payments received', paid.toFixed(2)],
    ['Closing balance', closing.toFixed(2)],
    [],
    ['Date', 'Time', 'Customer', 'Service', 'Cars', 'Add-ons', 'Customer price', 'Status', 'Fee breakdown', 'Commission', 'Override reason'],
  ];
  for (const l of lines) {
    const b = l.booking;
    const addons = b
      ? [b.pet_hair && 'pet hair', hasEngineBay(b) && 'engine bay', isSevenSeater(b) && '7-seater'].filter(Boolean).join('; ')
      : '';
    rows.push([
      l.date,
      b?.booking_time?.slice(0, 5) ?? '',
      b?.customer_name ?? l.fee?.customer_name ?? '',
      serviceLabel(b?.service ?? l.fee?.service ?? ''),
      b?.car_count ?? '',
      addons,
      b ? (bookingTotal(b) ?? '') : '',
      b?.status ?? '',
      l.fee ? feeBreakdown(l.fee) : '',
      l.fee?.effective_amount != null ? l.fee.effective_amount.toFixed(2) : '',
      l.fee?.override_reason ?? '',
    ]);
  }
  rows.push([], ['Payment date', 'Amount', 'Method', 'Note']);
  for (const p of payments) rows.push([p.paid_on, p.amount.toFixed(2), p.method, p.note]);
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}
