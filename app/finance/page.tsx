'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Booking, bookingTotal } from '@/types/booking';
import { Expense, EXPENSE_TYPE_LABELS, formatMoney } from '@/types/expense';
import { getBookings, subscribeToBookings } from '@/lib/bookings';
import {
  getExpenses,
  addExpense,
  updateExpense,
  deleteExpense,
  subscribeToExpenses,
  existingCategories,
  ExpenseInput,
} from '@/lib/expenses';
import { expandExpenses, todayIso } from '@/lib/expenseOccurrences';
import { BookingFee, DetailerPayment } from '@/types/fee';
import { getFees, getPayments, subscribeToLedger } from '@/lib/fees';
import { overdueFor } from '@/lib/commissionStats';
import { torontoToday } from '@/lib/weeks';
import { Detailer } from '@/types/detailer';
import { getDetailers } from '@/lib/detailers';
import { useAuth } from '@/components/AuthProvider';
import ExpenseManager from '@/components/ExpenseManager';
import CommissionPanel from '@/components/finance/CommissionPanel';
import {
  Wallet,
  HandCoins,
  RefreshCw,
  AlertCircle,
  Sparkles,
  TrendingUp,
  TrendingDown,
  BarChart3,
  PieChart,
} from 'lucide-react';

/**
 * The window every figure on this page is calculated over — the headline cards
 * included. Previously the cards summed a rolling twelve periods, so switching
 * Weekly to Monthly silently changed the headline from "last 12 weeks" to
 * "last 12 months" without saying so, and neither was the period a person
 * actually wanted to look at.
 */
type Range = 'this_week' | 'this_month' | 'last_3_months' | 'this_year' | 'all';

/** How the trend chart buckets that window. Derived from the range, not chosen. */
type Granularity = 'day' | 'week' | 'month';

const RANGE_LABELS: Record<Range, string> = {
  this_week: 'This week',
  this_month: 'This month',
  last_3_months: 'Last 3 months',
  this_year: 'This year',
  all: 'All time',
};

function toIsoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Monday-based week key, matching how the rest of the panel treats weeks. */
function weekKey(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay();
  dt.setDate(dt.getDate() + (dow === 0 ? -6 : 1 - dow));
  return toIsoDate(dt);
}

function periodKey(dateStr: string, granularity: Granularity): string {
  if (granularity === 'day') return dateStr;
  if (granularity === 'week') return weekKey(dateStr);
  return dateStr.slice(0, 7);
}

function periodLabel(key: string, granularity: Granularity): string {
  if (granularity === 'month') {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(
    'en-US',
    granularity === 'day' ? { weekday: 'short' } : { month: 'short', day: 'numeric' }
  );
}

/**
 * Start and end of a range, plus the bucket size the chart should use.
 *
 * Every range ends today rather than at the end of the calendar period, so
 * "this month" means the month so far. Charging a full month of recurring costs
 * against three weeks of revenue would show a loss that does not exist.
 *
 * `earliest` is the oldest date in the data, used only by All time.
 */
function rangeBounds(range: Range, earliest: string): { start: string; end: string; granularity: Granularity } {
  const now = new Date();
  const end = toIsoDate(now);

  switch (range) {
    case 'this_week': {
      const dow = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() + (dow === 0 ? -6 : 1 - dow));
      return { start: toIsoDate(monday), end, granularity: 'day' };
    }
    case 'this_month':
      return { start: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)), end, granularity: 'week' };
    case 'last_3_months':
      return { start: toIsoDate(new Date(now.getFullYear(), now.getMonth() - 2, 1)), end, granularity: 'week' };
    case 'this_year':
      return { start: `${now.getFullYear()}-01-01`, end, granularity: 'month' };
    case 'all':
    default:
      return { start: earliest, end, granularity: 'month' };
  }
}

interface PeriodRow {
  key: string;
  label: string;
  revenueMobile: number;
  revenueShop: number;
  expenseMobile: number;
  expenseShop: number;
  expenseShared: number;
}

export default function FinancePage() {
  const { isConfigured } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [fees, setFees] = useState<BookingFee[]>([]);
  const [payments, setPayments] = useState<DetailerPayment[]>([]);
  const [detailers, setDetailers] = useState<Detailer[]>([]);
  const [range, setRange] = useState<Range>('this_month');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [b, e, f, p, d] = await Promise.all([getBookings(), getExpenses(), getFees(), getPayments(), getDetailers()]);
      setBookings(b);
      setExpenses(e);
      setFees(f);
      setPayments(p);
      setDetailers(d);
    } catch (err: any) {
      console.error('[FinancePage loadData error]:', err);
      setError(err?.message || 'Failed to load finance data.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const unsubBookings = subscribeToBookings(() => loadData());
    const unsubExpenses = subscribeToExpenses(() => loadData());
    const unsubLedger = subscribeToLedger(() => loadData());
    return () => {
      unsubBookings();
      unsubExpenses();
      unsubLedger();
    };
  }, [loadData]);

  /**
   * Revenue counts COMPLETED bookings only — money actually earned. Scheduled
   * work is pipeline, and cancelled bookings still carry a price, so including
   * either would inflate profit against real expenses.
   */
  // bookingTotal, not price: a job's revenue includes the engine bay and
  // out-of-area surcharges, which are stored separately from the base price.
  const earned = useMemo(
    () => bookings.filter((b) => b.status === 'completed' && bookingTotal(b) != null),
    [bookings]
  );

  /** Oldest date in the data, so All time starts where the records start. */
  const earliest = useMemo(() => {
    let oldest = todayIso();
    earned.forEach((b) => {
      if (b.booking_date < oldest) oldest = b.booking_date;
    });
    expenses.forEach((e) => {
      if (e.date < oldest) oldest = e.date;
    });
    return oldest;
  }, [earned, expenses]);

  const bounds = useMemo(() => rangeBounds(range, earliest), [range, earliest]);

  const earnedInRange = useMemo(
    () => earned.filter((b) => b.booking_date >= bounds.start && b.booking_date <= bounds.end),
    [earned, bounds]
  );

  const feeByBooking = useMemo(() => {
    const m = new Map<string, BookingFee>();
    fees.forEach((f) => m.set(f.booking_id, f));
    return m;
  }, [fees]);

  /**
   * What the business actually earned on a job. Under the current model the
   * detailer collects the full amount and owes a commission, so the commission
   * (an admin override if there is one) is the revenue and the rest never
   * touches the business. A job with no commission row was completed under the
   * old model, when the business collected the whole amount itself - so its
   * gross is still the right figure. A "Fee not set" job counts $0 here and is
   * flagged in the commission panel.
   */
  const revenueOf = useCallback(
    (b: Booking): number => {
      const fee = feeByBooking.get(b.id);
      return fee ? fee.effective_amount ?? 0 : bookingTotal(b) || 0;
    },
    [feeByBooking]
  );

  /**
   * Commission charged on a job that was not completed - a no-show fee. The
   * completed-jobs list does not include it, so it is added on its own, dated
   * to the day it was charged for.
   */
  const noShowFeesInRange = useMemo(() => {
    const status = new Map(bookings.map((b) => [b.id, b.status]));
    return fees.filter(
      (f) =>
        !!f.effective_amount &&
        status.get(f.booking_id) !== 'completed' &&
        f.completed_on >= bounds.start &&
        f.completed_on <= bounds.end
    );
  }, [fees, bookings, bounds]);

  /**
   * The money flow for the range. Every completed job is one of two kinds:
   * a fee-model job, where the detailer collected the gross and Absolute's
   * revenue is the fee; or a pre-model job, where the business collected the
   * gross itself. Revenue is the sum of the two, and this is where the split
   * is made visible rather than buried.
   */
  const feeStats = useMemo(() => {
    const today = torontoToday();
    let feeJobs = 0, feeGross = 0, feeRevenue = 0, legacyJobs = 0, legacyGross = 0;
    earnedInRange.forEach((b) => {
      const fee = feeByBooking.get(b.id);
      if (fee) {
        feeJobs += 1;
        feeGross += fee.customer_total;
        feeRevenue += fee.effective_amount ?? 0;
      } else {
        legacyJobs += 1;
        legacyGross += bookingTotal(b) || 0;
      }
    });
    // Outstanding comes from the payments ledger: every commission charged,
    // less every payment, per detailer. A detailer in credit does not reduce
    // what the others owe.
    let owedAllTime = 0;
    let overdueAllTime = 0;
    for (const id of Array.from(new Set(fees.map((f) => f.detailer_id)))) {
      const charged = fees.filter((f) => f.detailer_id === id).reduce((s, f) => s + (f.effective_amount ?? 0), 0);
      const paid = payments.filter((p) => p.detailer_id === id).reduce((s, p) => s + p.amount, 0);
      owedAllTime += Math.max(0, charged - paid);
      overdueAllTime += overdueFor(id, fees, payments, today);
    }
    const noShowFees = noShowFeesInRange.reduce((s, f) => s + (f.effective_amount ?? 0), 0);
    return {
      feeJobs,
      feeGross,
      feeRevenue: feeRevenue + noShowFees,
      noShowFees,
      detailerShare: feeGross - feeRevenue,
      legacyJobs,
      legacyGross,
      bookingsValue: feeGross + legacyGross,
      owedAllTime,
      overdueAllTime,
    };
  }, [fees, payments, earnedInRange, feeByBooking, noShowFeesInRange]);

  /**
   * Recurring expenses are expanded into the individual costs that landed in
   * this window, so a $200/week ad spend counts four times in a month rather
   * than once. Expansion stops at today, never in the future.
   */
  const occurrences = useMemo(
    () => expandExpenses(expenses, bounds.start, bounds.end),
    [expenses, bounds]
  );

  const rows: PeriodRow[] = useMemo(() => {
    const map = new Map<string, PeriodRow>();
    const ensure = (key: string) => {
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: periodLabel(key, bounds.granularity),
          revenueMobile: 0,
          revenueShop: 0,
          expenseMobile: 0,
          expenseShop: 0,
          expenseShared: 0,
        });
      }
      return map.get(key)!;
    };

    earnedInRange.forEach((b) => {
      const row = ensure(periodKey(b.booking_date, bounds.granularity));
      const amount = revenueOf(b);
      if ((b.service_location || 'mobile') === 'shop') row.revenueShop += amount;
      else row.revenueMobile += amount;
    });

    noShowFeesInRange.forEach((f) => {
      ensure(periodKey(f.completed_on, bounds.granularity)).revenueMobile += f.effective_amount ?? 0;
    });

    occurrences.forEach((o) => {
      const row = ensure(periodKey(o.date, bounds.granularity));
      if (o.expense.service_location === 'shop') row.expenseShop += o.amount;
      else if (o.expense.service_location === 'mobile') row.expenseMobile += o.amount;
      else row.expenseShared += o.amount;
    });

    // No slice: the range itself decides the window now, so the chart shows the
    // whole of what the headline cards are counting and the two cannot disagree.
    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [earnedInRange, noShowFeesInRange, occurrences, bounds, revenueOf]);

  const totals = useMemo(() => {
    const t = {
      revenueMobile: 0,
      revenueShop: 0,
      expenseMobile: 0,
      expenseShop: 0,
      expenseShared: 0,
      expenseFixed: 0,
      expenseVariable: 0,
    };
    rows.forEach((r) => {
      t.revenueMobile += r.revenueMobile;
      t.revenueShop += r.revenueShop;
      t.expenseMobile += r.expenseMobile;
      t.expenseShop += r.expenseShop;
      t.expenseShared += r.expenseShared;
    });
    // Same occurrences the rows were built from, so the fixed / variable split
    // always adds up to the Expenses card above it.
    occurrences.forEach((o) => {
      if (o.expense.type === 'fixed') t.expenseFixed += o.amount;
      else t.expenseVariable += o.amount;
    });
    return t;
  }, [rows, occurrences]);

  const revenueTotal = totals.revenueMobile + totals.revenueShop;
  const expenseTotal = totals.expenseMobile + totals.expenseShop + totals.expenseShared;
  const profitTotal = revenueTotal - expenseTotal;
  // Per-location profit subtracts only that location's own expenses. Shared
  // overhead is deliberately NOT apportioned — it is reported on its own line.

  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    occurrences.forEach((o) => {
      const k = o.expense.category.trim() || 'Uncategorised';
      map.set(k, (map.get(k) || 0) + o.amount);
    });
    const items = Array.from(map.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
    const max = items.reduce((m, i) => Math.max(m, i.amount), 0);
    return { items, max };
  }, [occurrences]);

  // Bars are scaled against the largest revenue-or-expense value in the window.
  const chartMax = useMemo(
    () =>
      rows.reduce(
        (m, r) =>
          Math.max(
            m,
            r.revenueMobile + r.revenueShop,
            r.expenseMobile + r.expenseShop + r.expenseShared
          ),
        0
      ),
    [rows]
  );

  const categories = useMemo(() => existingCategories(expenses), [expenses]);

  const reloadLedger = useCallback(async () => {
    const [f, p] = await Promise.all([getFees(), getPayments()]);
    setFees(f);
    setPayments(p);
  }, []);

  const handleAdd = async (data: ExpenseInput) => {
    const created = await addExpense(data);
    setExpenses((prev) => [created, ...prev]);
  };
  const handleUpdate = async (id: string, data: ExpenseInput) => {
    const updated = await updateExpense(id, data);
    setExpenses((prev) => prev.map((e) => (e.id === id ? updated : e)));
  };
  const handleDelete = async (id: string) => {
    const previous = [...expenses];
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    try {
      await deleteExpense(id);
    } catch (err: any) {
      setExpenses(previous);
      throw err;
    }
  };

  // Every card names the window it covers, so a figure can never be mistaken
  // for an all-time total.
  const rangeNote = RANGE_LABELS[range].toLowerCase();

  const statCards = [
    {
      title: 'Absolute revenue',
      value: formatMoney(revenueTotal),
      note:
        feeStats.feeJobs > 0 && feeStats.legacyJobs > 0
          ? `${formatMoney(feeStats.feeRevenue)} commission on ${feeStats.feeJobs} job${feeStats.feeJobs === 1 ? '' : 's'} + ${formatMoney(feeStats.legacyGross)} gross on ${feeStats.legacyJobs} pre-commission job${feeStats.legacyJobs === 1 ? '' : 's'}`
          : feeStats.feeJobs > 0 || feeStats.noShowFees > 0
            ? `Commission on ${feeStats.feeJobs} completed job${feeStats.feeJobs === 1 ? '' : 's'}${feeStats.noShowFees > 0 ? ` + ${formatMoney(feeStats.noShowFees)} no-show fees` : ''} · ${rangeNote}`
            : `Completed jobs · ${rangeNote}`,
      icon: Wallet,
    },
    {
      title: 'Commission outstanding',
      value: formatMoney(feeStats.owedAllTime),
      note:
        feeStats.overdueAllTime > 0
          ? `${formatMoney(feeStats.overdueAllTime)} overdue · owed by detailers, all weeks`
          : 'Owed by detailers, all weeks, after payments',
      icon: HandCoins,
    },
    {
      title: 'Expenses',
      value: formatMoney(expenseTotal),
      note: `${formatMoney(totals.expenseFixed)} fixed · ${formatMoney(totals.expenseVariable)} variable`,
      icon: TrendingDown,
    },
    {
      title: 'Profit',
      value: formatMoney(profitTotal),
      note: `Revenue minus all expenses · ${rangeNote}`,
      icon: TrendingUp,
    },
  ];

  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-in pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 pb-2 border-b border-charcoal-border/40">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl sm:text-3xl font-bold tracking-tight text-charcoal">Finance</h1>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] sm:text-xs font-semibold bg-sage-100 text-sage-800">
              <Wallet className="w-3 h-3 text-sage-600" />
              Revenue &amp; Expenses
            </span>
          </div>
          <p className="text-xs sm:text-sm text-charcoal-muted mt-0.5 sm:mt-1">
            Revenue counts completed jobs only. Expenses are entered manually.
          </p>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            onClick={() => loadData()}
            className="p-2.5 rounded-xl border border-charcoal-border/60 bg-charcoal-card hover:bg-sage-50 text-charcoal-muted hover:text-charcoal shadow-soft-sm transition-colors shrink-0"
            title="Refresh Finance Data"
            aria-label="Refresh Finance Data"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-sage-600' : ''}`} />
          </button>

          {/* Time range. Everything below is calculated over this window. */}
          <div className="flex items-center gap-1 p-1 bg-canvas border border-charcoal-border/70 rounded-xl overflow-x-auto no-scrollbar">
            {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                  range === r
                    ? 'bg-sage-600 text-white dark:text-charcoal-card shadow-soft-xs'
                    : 'text-charcoal-muted hover:text-charcoal hover:bg-charcoal-card'
                }`}
              >
                {RANGE_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!isConfigured && (
        <div className="p-4 rounded-xl bg-sage-50/80 border border-sage-200 text-charcoal text-xs flex items-start gap-3">
          <div className="w-6 h-6 rounded-lg bg-sage-200/80 text-sage-800 flex items-center justify-center shrink-0 mt-0.5">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div>
            <p className="font-semibold text-charcoal">Supabase Live Connection Ready</p>
            <p className="text-charcoal-muted mt-0.5">
              Add your credentials in <code className="font-mono bg-charcoal-card px-1 py-0.5 rounded border border-sage-200">.env.local</code> to load live finance data.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="p-3.5 sm:p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2 animate-fade-in">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Headline figures */}
      <section aria-label="Finance Summary">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-6">
          {statCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.title}
                className="bg-charcoal-card rounded-xl p-3.5 sm:p-5 border border-charcoal-border/60 shadow-soft-sm hover:shadow-soft-md transition-all duration-200"
              >
                <div className="flex items-center justify-between mb-2 sm:mb-3">
                  <span className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-charcoal-muted">
                    {card.title}
                  </span>
                  <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg bg-sage-50 text-sage-600 flex items-center justify-center border border-sage-100 shrink-0">
                    <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </div>
                </div>
                <div className="flex items-baseline gap-1.5 sm:gap-2 mb-0.5 sm:mb-1">
                  <span className="text-xl sm:text-3xl font-bold tracking-tight text-charcoal">
                    {card.value}
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-charcoal-muted/80 line-clamp-2">
                  {card.note}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Profit by location */}
      {/* Where every dollar the customer paid went, for the range. Absolute's
          revenue is the last box; the first is the number people tend to
          mistake for it. */}
      <section
        aria-label="Money flow"
        className="bg-charcoal-card rounded-2xl p-4 sm:p-5 border border-charcoal-border/60 shadow-soft-sm"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-stretch">
          <div className="rounded-xl border border-charcoal-border/60 bg-canvas p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-charcoal-muted">Gross job value</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-charcoal">{formatMoney(feeStats.bookingsValue)}</p>
            <p className="text-[11px] text-charcoal-muted">What customers paid for completed jobs, {rangeNote}. Detailers collect it.</p>
          </div>
          <div className="rounded-xl border border-charcoal-border/60 bg-canvas p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-charcoal-muted">Detailers kept</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-charcoal">−{formatMoney(feeStats.detailerShare)}</p>
            <p className="text-[11px] text-charcoal-muted">Their share on {feeStats.feeJobs} fee-model job{feeStats.feeJobs === 1 ? '' : 's'}</p>
          </div>
          <div className="rounded-xl border border-sage-300/70 bg-sage-50/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-sage-800">Absolute revenue</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-sage-900">{formatMoney(revenueTotal)}</p>
            <p className="text-[11px] text-sage-800/80">
              {feeStats.legacyJobs > 0
                ? `Commission ${formatMoney(feeStats.feeRevenue)} + pre-commission gross ${formatMoney(feeStats.legacyGross)}`
                : 'Absolute commission revenue only'}
            </p>
          </div>
        </div>
      </section>

      <section
        aria-label="Revenue and Expense Trend"
        className="bg-charcoal-card rounded-2xl p-4 sm:p-5 border border-charcoal-border/60 shadow-soft-sm space-y-3.5"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-charcoal-border/40">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-sage-100 text-sage-800 flex items-center justify-center shrink-0">
              <BarChart3 className="w-4 h-4 text-sage-700" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-charcoal tracking-tight">
                Revenue vs Expenses
              </h2>
              <p className="text-[11px] sm:text-xs text-charcoal-muted">
                {RANGE_LABELS[range]}, by{' '}
                {bounds.granularity === 'day' ? 'day' : bounds.granularity === 'week' ? 'week' : 'month'}.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[11px] text-charcoal-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-sage-500"></span>
              <span>Revenue</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-500"></span>
              <span>Expenses</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600"></span>
              <span>Profit</span>
            </span>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="py-16 text-center text-charcoal-muted text-xs sm:text-sm">
            No completed jobs or expenses recorded yet.
          </div>
        ) : (
          <div className="pt-4 pb-2">
            <div className="flex items-end gap-2 sm:gap-3 h-52 sm:h-64 w-full px-1 border-b border-charcoal-border/70 overflow-x-auto">
              {rows.map((r) => {
                const revenue = r.revenueMobile + r.revenueShop;
                const expense = r.expenseMobile + r.expenseShop + r.expenseShared;
                const profit = revenue - expense;
                const pct = (v: number) =>
                  chartMax > 0 ? Math.max(Math.round((v / chartMax) * 100), v > 0 ? 6 : 2) : 2;

                return (
                  <div
                    key={r.key}
                    className="flex-1 flex flex-col items-center h-full justify-end group min-w-[52px] sm:min-w-[64px]"
                  >
                    <span
                      className={`text-[10px] sm:text-xs font-bold mb-1 opacity-80 group-hover:opacity-100 transition-all ${
                        profit >= 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}
                      title={`Profit: ${formatMoney(profit)}`}
                    >
                      {profit !== 0 ? formatMoney(profit).replace('CA', '') : ''}
                    </span>

                    <div className="w-full flex items-end justify-center gap-1 h-full">
                      <div
                        style={{ height: `${pct(revenue)}%` }}
                        className="w-1/2 max-w-[26px] rounded-t-lg bg-sage-500 hover:bg-sage-600 transition-colors shadow-soft-xs"
                        title={`${r.label} revenue: ${formatMoney(revenue)}`}
                      />
                      <div
                        style={{ height: `${pct(expense)}%` }}
                        className="w-1/2 max-w-[26px] rounded-t-lg bg-amber-500 hover:bg-amber-600 transition-colors shadow-soft-xs"
                        title={`${r.label} expenses: ${formatMoney(expense)}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-start gap-2 sm:gap-3 px-1 pt-2 overflow-x-auto">
              {rows.map((r) => (
                <div
                  key={r.key}
                  className="flex-1 text-center text-[10px] sm:text-[11px] text-charcoal-muted min-w-[52px] sm:min-w-[64px]"
                >
                  {r.label}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Expenses by category */}
      <section
        aria-label="Expenses by Category"
        className="bg-charcoal-card rounded-2xl p-4 sm:p-5 border border-charcoal-border/60 shadow-soft-sm space-y-3.5"
      >
        <div className="flex items-center gap-2 pb-3 border-b border-charcoal-border/40">
          <div className="w-8 h-8 rounded-xl bg-sage-100 text-sage-800 flex items-center justify-center shrink-0">
            <PieChart className="w-4 h-4 text-sage-700" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-charcoal tracking-tight">
              Expenses by Category
            </h2>
            <p className="text-[11px] sm:text-xs text-charcoal-muted">
              {formatMoney(totals.expenseFixed)} {EXPENSE_TYPE_LABELS.fixed.toLowerCase()} ·{' '}
              {formatMoney(totals.expenseVariable)} {EXPENSE_TYPE_LABELS.variable.toLowerCase()}
            </p>
          </div>
        </div>

        {categoryBreakdown.items.length === 0 ? (
          <div className="py-10 text-center text-charcoal-muted text-xs sm:text-sm">
            No expenses logged in this window yet.
          </div>
        ) : (
          <div className="space-y-2.5">
            {categoryBreakdown.items.map((item) => {
              const width =
                categoryBreakdown.max > 0
                  ? Math.max(Math.round((item.amount / categoryBreakdown.max) * 100), 4)
                  : 4;
              const share = expenseTotal > 0 ? Math.round((item.amount / expenseTotal) * 100) : 0;
              return (
                <div key={item.category} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-charcoal truncate">{item.category}</span>
                    <span className="text-charcoal-muted shrink-0">
                      {formatMoney(item.amount)} · {share}%
                    </span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-canvas border border-charcoal-border/60 overflow-hidden">
                    <div
                      style={{ width: `${width}%` }}
                      className="h-full rounded-full bg-sage-500 transition-all duration-300"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Weekly commission: per detailer and per Mon-Sun week, what was booked,
          completed, earned, paid and is still owed. Has its own week selector;
          the range buttons at the top do not apply to it. */}
      <CommissionPanel bookings={bookings} fees={fees} payments={payments} detailers={detailers} onChanged={reloadLedger} />

      {/* Manual expense entry */}
      <ExpenseManager
        expenses={expenses}
        categories={categories}
        onAdd={handleAdd}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
    </div>
  );
}
