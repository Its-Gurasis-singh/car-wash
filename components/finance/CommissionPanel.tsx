'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  HandCoins,
  Plus,
  Settings2,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Booking, SERVICE_LABELS } from '@/types/booking';
import { BookingFee, DetailerPayment, PaymentInput, WeekStatement } from '@/types/fee';
import { Detailer } from '@/types/detailer';
import { formatMoney } from '@/types/expense';
import { addPayment, deletePayment, getStatements, setCommissionOverride, updatePayment } from '@/lib/fees';
import {
  DetailerRow,
  FEE_MODEL_START,
  RangeWeeks,
  computeAlerts,
  computeDetailerRows,
  computeKpis,
  computeSeries,
  previousWindow,
  statementTotals,
  windowFor,
} from '@/lib/commissionStats';
import { addDays, dayLabel, rangeLabel, shortDate, torontoToday, weekMonday } from '@/lib/weeks';
import ConfirmModal from '@/components/ConfirmModal';
import DetailerWeekModal from './DetailerWeekModal';
import PaymentModal from './PaymentModal';
import OverrideModal from './OverrideModal';
import FeeSettingsModal from './FeeSettingsModal';

const RANGES: { weeks: RangeWeeks; label: string }[] = [
  { weeks: 1, label: 'Week' },
  { weeks: 4, label: 'Last 4' },
  { weeks: 8, label: 'Last 8' },
  { weeks: 12, label: 'Last 12' },
];

const card = 'bg-charcoal-card rounded-2xl p-4 sm:p-5 border border-charcoal-border/60 shadow-soft-sm';
const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);

type SortKey = keyof Pick<
  DetailerRow,
  'name' | 'assigned' | 'completed' | 'cancelled' | 'pending' | 'completionRate' | 'gross' | 'earned' | 'paid' | 'outstanding' | 'avgCommission'
>;

/**
 * Weekly finance and detailer commission. Absolute does not pay detailers:
 * each detailer collects the customer's money and pays Absolute a commission
 * per completed job. This section shows, per detailer and per Mon-Sun week
 * (Brampton time), what was booked, what was done, what was earned, what was
 * paid, and what is still owed.
 */
export default function CommissionPanel({
  bookings,
  fees,
  payments,
  detailers,
  onChanged,
}: {
  bookings: Booking[];
  fees: BookingFee[];
  payments: DetailerPayment[];
  detailers: Detailer[];
  /** Reload fees and payments after a write. */
  onChanged: () => Promise<void> | void;
}) {
  const today = torontoToday();
  const thisMonday = weekMonday(today);
  const [endMonday, setEndMonday] = useState(thisMonday);
  const [rangeWeeks, setRangeWeeks] = useState<RangeWeeks>(1);
  const [statements, setStatements] = useState<WeekStatement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'outstanding', dir: -1 });

  const [drillId, setDrillId] = useState<string | null>(null);
  const [paymentModal, setPaymentModal] = useState<{ detailerId?: string; payment?: DetailerPayment } | null>(null);
  const [overrideModal, setOverrideModal] = useState<{ booking: Booking; fee?: BookingFee } | null>(null);
  const [deleting, setDeleting] = useState<DetailerPayment | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const win = useMemo(() => windowFor(endMonday, rangeWeeks), [endMonday, rangeWeeks]);
  const prev = useMemo(() => previousWindow(win), [win]);

  // Enough history for the previous period (deltas), the 12-week trend and the
  // 12-week statement in the drill-down.
  const loadStatements = useCallback(async () => {
    try {
      const from = addDays(endMonday, -7 * Math.max(2 * rangeWeeks - 1, 11));
      setStatements(await getStatements(from, endMonday));
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Could not load weekly statements.');
    }
  }, [endMonday, rangeWeeks]);

  // fees / payments change on every write and realtime update; balances follow.
  useEffect(() => {
    loadStatements();
  }, [loadStatements, fees, payments]);

  const kpis = useMemo(() => computeKpis(win, bookings, statements), [win, bookings, statements]);
  const prevKpis = useMemo(() => computeKpis(prev, bookings, statements), [prev, bookings, statements]);
  const series = useMemo(() => computeSeries(win, bookings, fees), [win, bookings, fees]);
  const { rows, unassigned } = useMemo(
    () => computeDetailerRows(win, detailers, bookings, fees, statements),
    [win, detailers, bookings, fees, statements]
  );
  const alerts = useMemo(() => computeAlerts(bookings, fees, today), [bookings, fees, today]);
  const trend = useMemo(() => {
    const w12 = windowFor(endMonday, 12);
    return w12.weeks.map((w) => {
      const t = statementTotals(statements, windowFor(w, 1));
      return { week: w, earned: t.earned, collected: t.paid };
    });
  }, [endMonday, statements]);

  const sorted = useMemo(() => {
    const val = (r: DetailerRow) => r[sort.key];
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (typeof x === 'string' || typeof y === 'string') return String(x).localeCompare(String(y)) * sort.dir;
      return ((x ?? -Infinity) - (y ?? -Infinity)) * sort.dir || a.name.localeCompare(b.name);
    });
  }, [rows, sort]);

  const totals = useMemo(() => {
    const t = rows.reduce(
      (acc, r) => {
        acc.assigned += r.assigned; acc.completed += r.completed; acc.cancelled += r.cancelled; acc.pending += r.pending;
        acc.gross += r.gross; acc.earned += r.earned; acc.paid += r.paid; acc.outstanding += r.outstanding; acc.jobsCharged += r.jobsCharged;
        return acc;
      },
      { assigned: 0, completed: 0, cancelled: 0, pending: 0, gross: 0, earned: 0, paid: 0, outstanding: 0, jobsCharged: 0 }
    );
    return t;
  }, [rows]);

  const balanceNow = (detailerId: string) =>
    statements.find((s) => s.detailer_id === detailerId && s.week_start === endMonday)?.closing;

  // ---- writes -------------------------------------------------------------
  const savePayment = async (input: PaymentInput) => {
    if (paymentModal?.payment) await updatePayment(paymentModal.payment.id, input);
    else await addPayment(input);
    await onChanged();
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    const p = deleting;
    setDeleting(null);
    try {
      await deletePayment(p.id);
      await onChanged();
    } catch (err: any) {
      setError(err?.message || 'Could not delete the payment.');
    }
  };
  const saveOverride = async (amount: number | null, reason: string | null) => {
    if (!overrideModal) return;
    await setCommissionOverride(overrideModal.booking.id, amount, reason);
    await onChanged();
  };

  const drillDetailer = drillId ? detailers.find((d) => d.id === drillId) : undefined;
  const detailerName = (id?: string | null) => (id ? detailers.find((d) => d.id === id)?.name : undefined) || 'Unassigned';

  // ---- render -------------------------------------------------------------
  const kpiCards: { title: string; value: string; cur: number | null; prev: number | null; money?: boolean; rate?: boolean; goodUp?: boolean; note: string }[] = [
    { title: 'New bookings', value: String(kpis.newBookings), cur: kpis.newBookings, prev: prevKpis.newBookings, goodUp: true, note: 'by date booked' },
    { title: 'Jobs scheduled', value: String(kpis.scheduled), cur: kpis.scheduled, prev: prevKpis.scheduled, goodUp: true, note: 'by service date' },
    { title: 'Completed', value: String(kpis.completed), cur: kpis.completed, prev: prevKpis.completed, goodUp: true, note: 'by service date' },
    { title: 'Cancelled / no-show', value: String(kpis.cancelled), cur: kpis.cancelled, prev: prevKpis.cancelled, goodUp: false, note: 'by service date' },
    { title: 'Completion rate', value: pct(kpis.completionRate), cur: kpis.completionRate, prev: prevKpis.completionRate, rate: true, goodUp: true, note: 'completed / (completed + cancelled)' },
    { title: 'Gross job value', value: formatMoney(kpis.gross), cur: kpis.gross, prev: prevKpis.gross, money: true, goodUp: true, note: 'paid to detailers by customers' },
    { title: 'Commission earned', value: formatMoney(kpis.earned), cur: kpis.earned, prev: prevKpis.earned, money: true, goodUp: true, note: "Absolute's commission revenue" },
    { title: 'Commission collected', value: formatMoney(kpis.collected), cur: kpis.collected, prev: prevKpis.collected, money: true, goodUp: true, note: 'payments received' },
    { title: 'Total outstanding', value: formatMoney(kpis.outstanding), cur: kpis.outstanding, prev: prevKpis.outstanding, money: true, goodUp: false, note: `all weeks, as of ${shortDate(win.end)}` },
  ];

  const isCurrent = endMonday === thisMonday;
  const periodWord = rangeWeeks === 1 ? 'week' : `${rangeWeeks} weeks`;

  return (
    <section aria-label="Weekly commission" className="space-y-4 sm:space-y-5">
      {/* Header + week selector */}
      <div className={`${card} space-y-3`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-sage-100 text-sage-800 flex items-center justify-center shrink-0">
              <HandCoins className="w-4 h-4 text-sage-700" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-charcoal tracking-tight">Weekly commission</h2>
              <p className="text-[11px] sm:text-xs text-charcoal-muted">
                Detailers keep what customers pay and owe Absolute a commission per completed job. Weeks are Mon–Sun, Brampton time.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end md:self-auto">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-charcoal-border/60 bg-charcoal-card hover:bg-sage-50 text-xs font-semibold text-charcoal-muted hover:text-charcoal whitespace-nowrap"
            >
              <Settings2 className="w-3.5 h-3.5" /> Fee settings
            </button>
            <button
              type="button"
              onClick={() => setPaymentModal({})}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sage-500 hover:bg-sage-600 text-white text-xs font-semibold shadow-soft-sm whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" /> Record payment
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-3 border-t border-charcoal-border/40">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label={`Previous ${periodWord}`}
              onClick={() => setEndMonday(addDays(endMonday, -7 * rangeWeeks))}
              className="p-2 rounded-xl border border-charcoal-border/60 hover:bg-sage-50 text-charcoal-muted hover:text-charcoal"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label={`Next ${periodWord}`}
              disabled={isCurrent}
              onClick={() => {
                const next = addDays(endMonday, 7 * rangeWeeks);
                setEndMonday(next > thisMonday ? thisMonday : next);
              }}
              className="p-2 rounded-xl border border-charcoal-border/60 hover:bg-sage-50 text-charcoal-muted hover:text-charcoal disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <p className="text-sm font-semibold text-charcoal tabular-nums px-1">
              {rangeLabel(win.start, win.end)}
              {rangeWeeks > 1 && <span className="text-charcoal-muted font-medium"> · {rangeWeeks} weeks</span>}
            </p>
            {!isCurrent && (
              <button
                type="button"
                onClick={() => setEndMonday(thisMonday)}
                className="ml-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-sage-700 hover:bg-sage-50"
              >
                This week
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 p-1 bg-canvas border border-charcoal-border/70 rounded-xl self-start sm:self-auto">
            {RANGES.map((r) => (
              <button
                key={r.weeks}
                type="button"
                onClick={() => setRangeWeeks(r.weeks)}
                className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  rangeWeeks === r.weeks ? 'bg-sage-600 text-white dark:text-charcoal-card shadow-soft-xs' : 'text-charcoal-muted hover:text-charcoal hover:bg-charcoal-card'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5 sm:gap-4">
        {kpiCards.map((k) => (
          <KpiCard key={k.title} {...k} periodWord={rangeWeeks === 1 ? 'last week' : `previous ${rangeWeeks} weeks`} />
        ))}
      </div>

      {/* Day-by-day (or week-by-week) */}
      <div className={`${card} space-y-3`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-charcoal-border/40">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-sage-700" />
            <h3 className="text-sm font-bold text-charcoal">{rangeWeeks === 1 ? 'Day by day, Mon → Sun' : 'Week by week'}</h3>
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] text-charcoal-muted">
            <Legend color="bg-sage-300" label="Jobs booked (service date)" />
            <Legend color="bg-sage-600" label="Completed" />
            <Legend color="bg-amber-500" label="Commission (date earned)" />
          </div>
        </div>
        <SeriesChart series={series} />
      </div>

      {/* Detailer table */}
      <div className={`${card} space-y-3`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-charcoal-border/40">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-sage-700" />
            <h3 className="text-sm font-bold text-charcoal">Detailers</h3>
          </div>
          <p className="text-[11px] text-charcoal-muted">Click a row for jobs, payments and the 12-week statement. Outstanding is at the end of the period.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="text-charcoal-muted">
              <tr className="border-b border-charcoal-border/50">
                {(
                  [
                    ['name', 'Detailer'],
                    ['assigned', 'Assigned'],
                    ['completed', 'Completed'],
                    ['cancelled', 'Cancelled'],
                    ['pending', 'Pending'],
                    ['completionRate', 'Rate'],
                    ['gross', 'Gross job value'],
                    ['earned', 'Commission'],
                    ['paid', 'Paid'],
                    ['outstanding', 'Outstanding'],
                    ['avgCommission', 'Avg / job'],
                  ] as [SortKey, string][]
                ).map(([key, label]) => (
                  <th key={key} className={`px-2.5 py-2 font-semibold whitespace-nowrap ${key === 'name' ? 'text-left' : 'text-right'}`}>
                    <button
                      type="button"
                      className="inline-flex items-center gap-0.5 hover:text-charcoal"
                      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : key === 'name' ? 1 : -1 }))}
                    >
                      {label}
                      {sort.key === key && (sort.dir === 1 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-charcoal-border/30">
              {sorted.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setDrillId(r.id)}
                  className={`cursor-pointer transition-colors ${r.outstanding > 0 ? 'bg-amber-50/60 hover:bg-amber-100/60 dark:bg-amber-500/10' : 'hover:bg-sage-50/50'} ${r.inactive ? 'opacity-60' : ''}`}
                >
                  <td className="px-2.5 py-2.5 text-left font-semibold text-charcoal whitespace-nowrap">
                    {r.name}
                    {r.inactive && <span className="ml-1 text-[10px] font-medium text-charcoal-muted">inactive</span>}
                  </td>
                  <td className="px-2.5 py-2.5 text-right">{r.assigned}</td>
                  <td className="px-2.5 py-2.5 text-right">{r.completed}</td>
                  <td className="px-2.5 py-2.5 text-right">{r.cancelled}</td>
                  <td className="px-2.5 py-2.5 text-right">{r.pending}</td>
                  <td className="px-2.5 py-2.5 text-right">{pct(r.completionRate)}</td>
                  <td className="px-2.5 py-2.5 text-right">{formatMoney(r.gross)}</td>
                  <td className="px-2.5 py-2.5 text-right font-semibold text-charcoal">{formatMoney(r.earned)}</td>
                  <td className="px-2.5 py-2.5 text-right">{formatMoney(r.paid)}</td>
                  <td className={`px-2.5 py-2.5 text-right font-semibold ${r.outstanding > 0 ? 'text-amber-700' : r.outstanding < 0 ? 'text-sage-700' : 'text-charcoal'}`}>
                    {r.outstanding < 0 ? `${formatMoney(-r.outstanding)} credit` : formatMoney(r.outstanding)}
                  </td>
                  <td className="px-2.5 py-2.5 text-right">{r.avgCommission == null ? '—' : formatMoney(r.avgCommission)}</td>
                </tr>
              ))}
              {unassigned.assigned > 0 && (
                <tr className="text-charcoal-muted">
                  <td className="px-2.5 py-2.5 text-left italic">Unassigned</td>
                  <td className="px-2.5 py-2.5 text-right">{unassigned.assigned}</td>
                  <td className="px-2.5 py-2.5 text-right">{unassigned.completed}</td>
                  <td className="px-2.5 py-2.5 text-right">{unassigned.cancelled}</td>
                  <td className="px-2.5 py-2.5 text-right">{unassigned.pending}</td>
                  <td className="px-2.5 py-2.5 text-right">—</td>
                  <td className="px-2.5 py-2.5 text-right">{formatMoney(unassigned.gross)}</td>
                  <td colSpan={4} className="px-2.5 py-2.5 text-right text-[11px]">no detailer to charge</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-charcoal-border/60 font-bold text-charcoal">
                <td className="px-2.5 py-2.5 text-left">Total</td>
                <td className="px-2.5 py-2.5 text-right">{totals.assigned + unassigned.assigned}</td>
                <td className="px-2.5 py-2.5 text-right">{totals.completed + unassigned.completed}</td>
                <td className="px-2.5 py-2.5 text-right">{totals.cancelled + unassigned.cancelled}</td>
                <td className="px-2.5 py-2.5 text-right">{totals.pending + unassigned.pending}</td>
                <td className="px-2.5 py-2.5 text-right">
                  {pct(
                    totals.completed + unassigned.completed + totals.cancelled + unassigned.cancelled === 0
                      ? null
                      : (totals.completed + unassigned.completed) / (totals.completed + unassigned.completed + totals.cancelled + unassigned.cancelled)
                  )}
                </td>
                <td className="px-2.5 py-2.5 text-right">{formatMoney(totals.gross + unassigned.gross)}</td>
                <td className="px-2.5 py-2.5 text-right">{formatMoney(totals.earned)}</td>
                <td className="px-2.5 py-2.5 text-right">{formatMoney(totals.paid)}</td>
                <td className="px-2.5 py-2.5 text-right">{formatMoney(totals.outstanding)}</td>
                <td className="px-2.5 py-2.5 text-right">{totals.jobsCharged ? formatMoney(totals.earned / totals.jobsCharged) : '—'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {rows.length === 0 && <p className="text-xs text-charcoal-muted text-center py-4">No detailers yet.</p>}
      </div>

      {/* Trend */}
      <div className={`${card} space-y-3`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-charcoal-border/40">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-sage-700" />
            <h3 className="text-sm font-bold text-charcoal">Commission earned vs collected, 12 weeks</h3>
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] text-charcoal-muted">
            <Legend color="bg-sage-500" label="Earned" />
            <Legend color="bg-sky-500" label="Collected" />
          </div>
        </div>
        <TrendChart trend={trend} />
      </div>

      {/* Data quality */}
      <div className={`${card} space-y-3`}>
        <div className="flex items-center gap-2 pb-3 border-b border-charcoal-border/40">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <h3 className="text-sm font-bold text-charcoal">Needs attention</h3>
        </div>
        <AlertGroup
          title="Completed with no detailer"
          hint={`Nobody to charge the commission to. Assign one on the Admin page and the commission is recorded automatically.${
            alerts.legacyNoDetailer ? ` (${alerts.legacyNoDetailer} older jobs from before ${shortDate(FEE_MODEL_START)} are not counted.)` : ''
          }`}
          items={alerts.noDetailer.map((b) => ({ id: b.id, text: `${b.customer_name} · ${SERVICE_LABELS[b.service] || b.service}`, date: b.booking_date }))}
        />
        <AlertGroup
          title="Fee not set"
          hint="Completed on a package with no commission configured. Set the package fee in Fee settings (future jobs) and override these."
          items={alerts.feeNotSet.map(({ fee, booking }) => ({
            id: fee.id,
            text: `${fee.customer_name || booking?.customer_name || 'Booking'} · ${SERVICE_LABELS[fee.service] || fee.service} · ${detailerName(fee.detailer_id)}`,
            date: fee.completed_on,
            action: booking ? { label: 'Set commission', run: () => setOverrideModal({ booking, fee }) } : undefined,
          }))}
        />
        <AlertGroup
          title="Past their date, still scheduled"
          hint="Mark these completed or cancelled on the Admin page so the numbers above are right."
          items={alerts.stale.map((b) => ({
            id: b.id,
            text: `${b.customer_name} · ${SERVICE_LABELS[b.service] || b.service} · ${detailerName(b.assigned_detailer_id)}`,
            date: b.booking_date,
          }))}
        />
        <p className="text-[11px] text-charcoal-muted">
          <Link href="/admin" className="font-semibold text-sage-700 hover:text-sage-900">Open the Admin page →</Link>
        </p>
      </div>

      {/* Modals */}
      {drillDetailer && (
        <DetailerWeekModal
          detailer={drillDetailer}
          win={win}
          bookings={bookings}
          fees={fees}
          payments={payments}
          statements={statements}
          onClose={() => setDrillId(null)}
          onRecordPayment={() => setPaymentModal({ detailerId: drillDetailer.id })}
          onEditPayment={(payment) => setPaymentModal({ payment })}
          onDeletePayment={(p) => setDeleting(p)}
          onOverride={(booking, fee) => setOverrideModal({ booking, fee })}
        />
      )}
      {paymentModal && (
        <PaymentModal
          detailers={detailers}
          detailerId={paymentModal.detailerId}
          payment={paymentModal.payment}
          balance={paymentModal.detailerId ? balanceNow(paymentModal.detailerId) : undefined}
          onSave={savePayment}
          onClose={() => setPaymentModal(null)}
        />
      )}
      {overrideModal && (
        <OverrideModal
          booking={overrideModal.booking}
          fee={overrideModal.fee}
          onSave={saveOverride}
          onClose={() => setOverrideModal(null)}
        />
      )}
      {settingsOpen && <FeeSettingsModal onClose={() => setSettingsOpen(false)} onSaved={() => onChanged()} />}
      <ConfirmModal
        isOpen={!!deleting}
        title="Delete this payment?"
        message={
          deleting
            ? `${formatMoney(deleting.amount)} from ${detailerName(deleting.detailer_id)} on ${dayLabel(deleting.paid_on)}. Their balance goes back up by that amount.`
            : ''
        }
        confirmLabel="Delete payment"
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </section>
  );
}

function KpiCard({
  title,
  value,
  cur,
  prev,
  money,
  rate,
  goodUp,
  note,
  periodWord,
}: {
  title: string;
  value: string;
  cur: number | null;
  prev: number | null;
  money?: boolean;
  rate?: boolean;
  goodUp?: boolean;
  note: string;
  periodWord: string;
}) {
  let delta: React.ReactNode = <span className="text-charcoal-muted">— vs {periodWord}</span>;
  if (cur != null && prev != null) {
    const d = cur - prev;
    const text =
      d === 0
        ? 'no change'
        : rate
          ? `${d > 0 ? '+' : '−'}${Math.abs(Math.round(d * 100))} pts`
          : money
            ? `${d > 0 ? '+' : '−'}${formatMoney(Math.abs(d))}`
            : `${d > 0 ? '+' : '−'}${Math.abs(d)}`;
    const good = d === 0 ? null : (d > 0) === !!goodUp;
    delta = (
      <span className={good == null ? 'text-charcoal-muted' : good ? 'text-emerald-700' : 'text-red-600'}>
        {text} <span className="text-charcoal-muted font-normal">vs {periodWord}</span>
      </span>
    );
  }
  return (
    <div className="bg-charcoal-card rounded-xl p-3.5 sm:p-4 border border-charcoal-border/60 shadow-soft-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-charcoal-muted">{title}</p>
      <p className="mt-1 text-lg sm:text-2xl font-bold tracking-tight tabular-nums text-charcoal">{value}</p>
      <p className="text-[11px] font-semibold tabular-nums">{delta}</p>
      <p className="text-[10px] text-charcoal-muted/80 mt-0.5">{note}</p>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2.5 h-2.5 rounded-sm ${color}`} />
      {label}
    </span>
  );
}

const barHeight = (v: number, max: number) => (max > 0 ? Math.max(Math.round((v / max) * 100), v > 0 ? 4 : 0) : 0);

function SeriesChart({ series }: { series: ReturnType<typeof computeSeries> }) {
  const maxCount = Math.max(0, ...series.map((p) => p.jobs));
  const maxMoney = Math.max(0, ...series.map((p) => p.commission));
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[28rem] space-y-1">
        <div className="flex items-end gap-2 h-32 border-b border-charcoal-border/60 px-1">
          {series.map((p) => (
            <div key={p.key} className="flex-1 flex items-end justify-center gap-1 h-full" title={`${p.sublabel}: ${p.jobs} booked, ${p.completed} completed`}>
              <div className="w-1/3 max-w-[18px] rounded-t bg-sage-300" style={{ height: `${barHeight(p.jobs, maxCount)}%` }} />
              <div className="w-1/3 max-w-[18px] rounded-t bg-sage-600" style={{ height: `${barHeight(p.completed, maxCount)}%` }} />
            </div>
          ))}
        </div>
        <div className="flex gap-2 px-1 text-[10px] text-charcoal-muted tabular-nums">
          {series.map((p) => (
            <div key={p.key} className="flex-1 text-center">{p.jobs}/{p.completed}</div>
          ))}
        </div>
        <div className="flex items-end gap-2 h-20 border-b border-charcoal-border/60 px-1 pt-2">
          {series.map((p) => (
            <div key={p.key} className="flex-1 flex flex-col items-center justify-end h-full" title={`${p.sublabel}: ${formatMoney(p.commission)} commission`}>
              <span className="text-[10px] font-semibold text-amber-700 tabular-nums mb-0.5">{p.commission ? `$${Math.round(p.commission)}` : ''}</span>
              <div className="w-1/2 max-w-[28px] rounded-t bg-amber-500" style={{ height: `${barHeight(p.commission, maxMoney)}%` }} />
            </div>
          ))}
        </div>
        <div className="flex gap-2 px-1">
          {series.map((p) => (
            <div key={p.key} className="flex-1 text-center">
              <p className="text-[11px] font-semibold text-charcoal">{p.label}</p>
              <p className="text-[10px] text-charcoal-muted">{p.sublabel}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TrendChart({ trend }: { trend: { week: string; earned: number; collected: number }[] }) {
  const max = Math.max(0, ...trend.flatMap((t) => [t.earned, t.collected]));
  if (max === 0) return <p className="text-xs text-charcoal-muted text-center py-8">No commission or payments in these 12 weeks.</p>;
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[36rem]">
        <div className="flex items-end gap-2 h-40 border-b border-charcoal-border/60 px-1">
          {trend.map((t) => (
            <div key={t.week} className="flex-1 flex items-end justify-center gap-1 h-full" title={`Week of ${shortDate(t.week)}: earned ${formatMoney(t.earned)}, collected ${formatMoney(t.collected)}`}>
              <div className="w-1/3 max-w-[16px] rounded-t bg-sage-500" style={{ height: `${barHeight(t.earned, max)}%` }} />
              <div className="w-1/3 max-w-[16px] rounded-t bg-sky-500" style={{ height: `${barHeight(t.collected, max)}%` }} />
            </div>
          ))}
        </div>
        <div className="flex gap-2 px-1 pt-1.5">
          {trend.map((t) => (
            <div key={t.week} className="flex-1 text-center text-[10px] text-charcoal-muted">{shortDate(t.week)}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AlertGroup({
  title,
  hint,
  items,
}: {
  title: string;
  hint: string;
  items: { id: string; text: string; date: string; action?: { label: string; run: () => void } }[];
}) {
  return (
    <div className={`rounded-xl border p-3 ${items.length ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-500/10' : 'border-charcoal-border/50'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-charcoal">{title}</p>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${items.length ? 'bg-amber-500 text-white' : 'bg-sage-100 text-sage-800'}`}>
          {items.length || 'none'}
        </span>
      </div>
      {items.length > 0 && (
        <>
          <p className="text-[11px] text-charcoal-muted mt-0.5">{hint}</p>
          <ul className="mt-2 space-y-1">
            {items.slice(0, 12).map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-charcoal truncate">
                  <span className="text-charcoal-muted tabular-nums">{dayLabel(i.date)}</span> · {i.text}
                </span>
                {i.action && (
                  <button type="button" onClick={i.action.run} className="shrink-0 text-[11px] font-semibold text-sage-700 hover:text-sage-900">
                    {i.action.label}
                  </button>
                )}
              </li>
            ))}
            {items.length > 12 && <li className="text-[11px] text-charcoal-muted">and {items.length - 12} more</li>}
          </ul>
        </>
      )}
    </div>
  );
}
