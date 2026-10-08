'use client';

import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Booking, SERVICE_LABELS } from '@/types/booking';
import { BookingFee } from '@/types/fee';
import { formatMoney } from '@/types/expense';
import { feeBreakdown } from '@/lib/commissionStats';
import Modal, { inputClass, labelClass, primaryButton, secondaryButton } from './Modal';

/**
 * Override one job's commission, with a required reason. Also how a no-show
 * fee is charged: an override on a cancelled booking puts it on the books in
 * the week of the service date. Clearing the override restores the computed
 * fee - or, on a job that was not completed, removes the charge entirely.
 */
export default function OverrideModal({
  booking,
  fee,
  onSave,
  onClose,
}: {
  booking: Booking;
  fee?: BookingFee;
  onSave: (amount: number | null, reason: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(fee?.commission_override != null ? String(fee.commission_override) : '');
  const [reason, setReason] = useState(fee?.override_reason ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const notCompleted = booking.status !== 'completed';

  const run = async (value: number | null, why: string | null) => {
    setSaving(true);
    setError(null);
    try {
      await onSave(value, why);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not save the override.');
      setSaving(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(amount);
    if (!amount.trim() || !Number.isFinite(value) || value < 0) return setError('Enter a commission of $0 or more.');
    if (!reason.trim()) return setError('A reason is required.');
    run(Math.round(value * 100) / 100, reason.trim());
  };

  return (
    <Modal
      title={notCompleted ? 'Charge a no-show / cancellation fee' : 'Override commission'}
      subtitle={`${booking.customer_name} · ${SERVICE_LABELS[booking.service] || booking.service} · ${booking.booking_date}`}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-xl border border-charcoal-border/60 bg-canvas p-3 text-xs text-charcoal-muted space-y-0.5">
          {fee && fee.fee_amount != null ? (
            <p>
              Computed at completion: <span className="font-semibold text-charcoal">{formatMoney(fee.fee_amount)}</span> ({feeBreakdown(fee)})
            </p>
          ) : fee && fee.completed_at ? (
            <p className="text-amber-700 font-semibold">Fee not set for this package. Set one here, or add the package's fee in Fee settings.</p>
          ) : (
            <p>
              {notCompleted
                ? `This booking is ${booking.status}, so it owes nothing unless you charge a fee here. It counts in the week of ${booking.booking_date}.`
                : 'No commission was recorded for this job.'}
            </p>
          )}
          {fee?.commission_override != null && (
            <p>
              Currently overridden to <span className="font-semibold text-charcoal">{formatMoney(fee.commission_override)}</span>
            </p>
          )}
        </div>
        <div>
          <label className={labelClass} htmlFor="ov-amount">Commission</label>
          <input
            id="ov-amount"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            className={inputClass}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 25"
            autoFocus
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="ov-reason">Reason</label>
          <input
            id="ov-reason"
            className={inputClass}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={notCompleted ? 'e.g. No-show: customer not home' : 'e.g. Second car was a quick wash'}
          />
        </div>
        {error && (
          <p className="text-xs text-red-600 flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5" /> {error}
          </p>
        )}
        <div className="flex flex-wrap justify-between gap-2.5 pt-1">
          {fee?.commission_override != null ? (
            <button type="button" className={secondaryButton} disabled={saving} onClick={() => run(null, null)}>
              {notCompleted ? 'Remove fee' : 'Clear override'}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2.5">
            <button type="button" className={secondaryButton} onClick={onClose}>Cancel</button>
            <button type="submit" className={primaryButton} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
