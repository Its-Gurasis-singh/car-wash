'use client';

import React, { useMemo, useState } from 'react';
import { Download, Pencil, Plus, Trash2 } from 'lucide-react';
import { Booking, STATUS_LABELS, SERVICE_LABELS, bookingTotal } from '@/types/booking';
import { BookingFee, DetailerPayment, PAYMENT_METHOD_LABELS, WeekStatement, isFeeNotSet } from '@/types/fee';
import { Detailer } from '@/types/detailer';
import { formatMoney } from '@/types/expense';
import {
  FEE_MODEL_START,
  JobLine,
  Window,
  detailerJobLines,
  feeBreakdown,
  hasEngineBay,
  isSevenSeater,
  packageMix,
  statementCsv,
  windowFor,
} from '@/lib/commissionStats';
import { addDays, dayLabel, rangeLabel, shortDate } from '@/lib/weeks';
import Modal, { primaryButton, secondaryButton } from './Modal';

const STATUS_PILL: Record<string, string> = {
  completed: 'bg-sage-100 text-sage-800 border-sage-200/80',
  scheduled: 'bg-sky-50 text-sky-800 border-sky-200',
  cancelled: 'bg-charcoal-surface text-charcoal-muted border-charcoal-border/50',
};

export default function DetailerWeekModal({
  detailer,
  win,
  bookings,
  fees,
  payments,
  statements,
  onClose,
  onRecordPayment,
  onEditPayment,
  onDeletePayment,
  onOverride,
}: {
  detailer: Detailer;
  win: Window;
  bookings: Booking[];
  fees: BookingFee[];
  payments: DetailerPayment[];
  statements: WeekStatement[];
  onClose: () => void;
  onRecordPayment: () => void;
  onEditPayment: (p: DetailerPayment) => void;
  onDeletePayment: (p: DetailerPayment) => void;
  onOverride: (booking: Booking, fee?: BookingFee) => void;
}) {
  const [tab, setTab] = useState<'jobs' | 'statement'>('jobs');
  const lines = useMemo(() => detailerJobLines(detailer.id, win, bookings, fees), [detailer.id, win, bookings, fees]);
  const mix = useMemo(() => packageMix(lines), [lines]);

  const mine = useMemo(() => statements.filter((s) => s.detailer_id === detailer.id), [statements, detailer.id]);
  const at = (monday: string) => mine.find((s) => s.week_start === monday);
  const first = at(win.weeks[0]);
  const last = at(win.endMonday);
  const opening = first?.opening ?? 0;
  const closing = last?.closing ?? 0;
  const earned = win.weeks.reduce((s, w) => s + (at(w)?.earned ?? 0), 0);
  const paid = win.weeks.reduce((s, w) => s + (at(w)?.paid ?? 0), 0);

  const history = windowFor(win.endMonday, 12).weeks.slice().reverse().map((w) => at(w)).filter(Boolean) as WeekStatement[];
  const windowPayments = payments
    .filter((p) => p.detailer_id === detailer.id && p.paid_on >= win.start && p.paid_on <= win.end)
    .sort((a, b) => a.paid_on.localeCompare(b.paid_on));

  const exportCsv = () => {
    const csv = statementCsv({
      detailerName: detailer.name,
      win,
      opening,
      earned,
      paid,
      closing,
      lines,
      payments: windowPayments,
      serviceLabel: (s) => SERVICE_LABELS[s] || s,
    });
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `statement-${detailer.name.toLowerCase().replace(/\s+/g, '-')}-${win.start}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const summary = [
    { label: 'Opening', value: opening, note: `carried in at ${shortDate(win.start)}` },
    { label: 'Commission earned', value: earned, note: `${lines.filter((l) => l.fee?.effective_amount != null && win.weeks.includes(l.fee.week_start)).length} jobs` },
    { label: 'Paid', value: -paid, note: `${windowPayments.length} payment${windowPayments.length === 1 ? '' : 's'}` },
    { label: 'Closing', value: closing, note: closing < 0 ? 'in credit' : closing > 0 ? 'owed to Absolute' : 'settled', strong: true },
  ];

  return (
    <Modal
      wide
      title={`${detailer.name}${detailer.status !== 'active' ? ' (inactive)' : ''}`}
      subtitle={`${rangeLabel(win.start, win.end)}${win.weeks.length > 1 ? ` · ${win.weeks.length} weeks` : ''}`}
      onClose={onClose}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {summary.map((s) => (
            <div
              key={s.label}
              className={`rounded-xl border p-3 ${s.strong ? (closing > 0 ? 'border-amber-300 bg-amber-50/60' : 'border-sage-300/70 bg-sage-50/60') : 'border-charcoal-border/60 bg-canvas'}`}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wider text-charcoal-muted">{s.label}</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-charcoal">
                {s.value < 0 ? `−${formatMoney(-s.value)}` : formatMoney(s.value)}
              </p>
              <p className="text-[11px] text-charcoal-muted">{s.note}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 p-1 bg-canvas border border-charcoal-border/70 rounded-xl">
            {(['jobs', 'statement'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  tab === t ? 'bg-sage-600 text-white dark:text-charcoal-card shadow-soft-xs' : 'text-charcoal-muted hover:text-charcoal hover:bg-charcoal-card'
                }`}
              >
                {t === 'jobs' ? 'Jobs & payments' : '12-week statement'}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" className={`${secondaryButton} inline-flex items-center gap-1.5`} onClick={exportCsv}>
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
            <button type="button" className={`${primaryButton} inline-flex items-center gap-1.5`} onClick={onRecordPayment}>
              <Plus className="w-3.5 h-3.5" /> Record payment
            </button>
          </div>
        </div>

        {tab === 'jobs' ? (
          <>
            <JobsTable lines={lines} detailerId={detailer.id} onOverride={onOverride} />

            <section>
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-charcoal-muted mb-2">Payments in this period</h4>
              {windowPayments.length === 0 ? (
                <p className="text-xs text-charcoal-muted">None recorded.</p>
              ) : (
                <ul className="divide-y divide-charcoal-border/40 rounded-xl border border-charcoal-border/60">
                  {windowPayments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-charcoal tabular-nums">{formatMoney(p.amount)}</p>
                        <p className="text-[11px] text-charcoal-muted truncate">
                          {dayLabel(p.paid_on)} · {PAYMENT_METHOD_LABELS[p.method]}
                          {p.note ? ` · ${p.note}` : ''}
                        </p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button className="p-1.5 rounded-lg text-charcoal-muted hover:text-charcoal hover:bg-sage-50" aria-label="Edit payment" onClick={() => onEditPayment(p)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button className="p-1.5 rounded-lg text-charcoal-muted hover:text-red-600 hover:bg-red-50" aria-label="Delete payment" onClick={() => onDeletePayment(p)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-charcoal-muted mb-2">Package mix (completed)</h4>
              {mix.services.length === 0 ? (
                <p className="text-xs text-charcoal-muted">No completed jobs in this period.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {mix.services.map((s) => (
                    <span key={s.service} className="px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-sage-50 text-sage-800 border-sage-200">
                      {SERVICE_LABELS[s.service] || s.service} × {s.count}
                    </span>
                  ))}
                  {[
                    ['Pet hair', mix.petHair],
                    ['Engine bay', mix.engineBay],
                    ['7-seater', mix.sevenSeater],
                  ].map(([label, n]) => (
                    <span key={label as string} className="px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-canvas text-charcoal-muted border-charcoal-border/60">
                      {label} × {n}
                    </span>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-charcoal-border/60">
            <table className="w-full text-xs tabular-nums">
              <thead className="bg-canvas text-charcoal-muted">
                <tr>
                  {['Week', 'Opening', 'Earned', 'Paid', 'Closing'].map((h) => (
                    <th key={h} className={`px-3 py-2 font-semibold ${h === 'Week' ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-charcoal-border/40">
                {history.map((s) => (
                  <tr key={s.week_start} className={win.weeks.includes(s.week_start) ? 'bg-sage-50/40' : ''}>
                    <td className="px-3 py-2 text-left text-charcoal font-medium">{rangeLabel(s.week_start, addDays(s.week_start, 6)).replace(/, \d{4}$/, '')}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(s.opening)}</td>
                    <td className="px-3 py-2 text-right">{s.earned ? `+${formatMoney(s.earned)}` : '—'}</td>
                    <td className="px-3 py-2 text-right">{s.paid ? `−${formatMoney(s.paid)}` : '—'}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${s.closing > 0 ? 'text-amber-700' : 'text-charcoal'}`}>{formatMoney(s.closing)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

function JobsTable({
  lines,
  detailerId,
  onOverride,
}: {
  lines: JobLine[];
  detailerId: string;
  onOverride: (booking: Booking, fee?: BookingFee) => void;
}) {
  if (lines.length === 0) {
    return <p className="text-xs text-charcoal-muted py-4 text-center">No bookings or commission for this detailer in this period.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-charcoal-border/60">
      <table className="w-full text-xs">
        <thead className="bg-canvas text-charcoal-muted">
          <tr>
            {['When', 'Customer', 'Service', 'Cars', 'Add-ons', 'Price', 'Fee breakdown', 'Status', 'Commission', ''].map((h, i) => (
              <th key={i} className={`px-2.5 py-2 font-semibold whitespace-nowrap ${['Cars', 'Price', 'Commission'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-charcoal-border/40">
          {lines.map((l) => {
            const b = l.booking;
            const f = l.fee && l.fee.detailer_id === detailerId ? l.fee : undefined;
            const addons = b ? [b.pet_hair && 'Pet hair', hasEngineBay(b) && 'Engine bay', isSevenSeater(b) && '7-seater'].filter(Boolean).join(', ') : '';
            const notSet = f ? isFeeNotSet(f) : false;
            return (
              <tr key={l.booking_id} className={notSet ? 'bg-amber-50/60' : ''}>
                <td className="px-2.5 py-2 whitespace-nowrap text-charcoal">
                  {dayLabel(l.date)}
                  {b?.booking_time ? <span className="text-charcoal-muted"> · {b.booking_time.slice(0, 5)}</span> : null}
                </td>
                <td className="px-2.5 py-2 text-charcoal font-medium max-w-[10rem] truncate">{b?.customer_name ?? l.fee?.customer_name ?? '—'}</td>
                <td className="px-2.5 py-2 whitespace-nowrap">{SERVICE_LABELS[b?.service ?? l.fee?.service ?? ''] || b?.service || l.fee?.service}</td>
                <td className="px-2.5 py-2 text-right tabular-nums">{b?.car_count ?? '—'}</td>
                <td className="px-2.5 py-2 text-charcoal-muted">{addons || '—'}</td>
                <td className="px-2.5 py-2 text-right tabular-nums">{b && bookingTotal(b) != null ? formatMoney(bookingTotal(b)!) : '—'}</td>
                <td className={`px-2.5 py-2 whitespace-nowrap ${notSet ? 'text-amber-700 font-semibold' : 'text-charcoal-muted'}`}>
                  {f
                    ? `${feeBreakdown(f)}${b && f.fee_amount != null && (b.car_count ?? 1) > f.car_count ? ' (old per-job rate)' : ''}`
                    : b?.status === 'completed'
                      ? b.booking_date < FEE_MODEL_START
                        ? 'Before the commission model'
                        : 'No commission recorded'
                      : '—'}
                </td>
                <td className="px-2.5 py-2">
                  {b && <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${STATUS_PILL[b.status] || ''}`}>{STATUS_LABELS[b.status]}</span>}
                </td>
                <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap">
                  {f?.effective_amount != null ? (
                    <span className="font-semibold text-charcoal">{formatMoney(f.effective_amount)}</span>
                  ) : notSet ? (
                    <span className="font-semibold text-amber-700">Fee not set</span>
                  ) : (
                    <span className="text-charcoal-muted">$0.00</span>
                  )}
                  {f?.commission_override != null && (
                    <span className="block text-[10px] font-semibold text-indigo-700" title={f.override_reason || ''}>
                      Override{f.fee_amount != null ? ` (was ${formatMoney(f.fee_amount)})` : ''}
                    </span>
                  )}
                  {f?.override_reason && <span className="block text-[10px] text-charcoal-muted max-w-[12rem] truncate ml-auto">{f.override_reason}</span>}
                </td>
                <td className="px-2.5 py-2 text-right">
                  {b && (
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-sage-700 hover:text-sage-900 whitespace-nowrap"
                      onClick={() => onOverride(b, f)}
                    >
                      {b.status === 'completed' ? 'Override' : f ? 'Edit fee' : 'Charge fee'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
