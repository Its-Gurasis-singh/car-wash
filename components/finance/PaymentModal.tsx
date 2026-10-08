'use client';

import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Detailer } from '@/types/detailer';
import { DetailerPayment, PAYMENT_METHOD_LABELS, PaymentInput, PaymentMethod } from '@/types/fee';
import { formatMoney } from '@/types/expense';
import { torontoToday } from '@/lib/weeks';
import Modal, { inputClass, labelClass, primaryButton, secondaryButton } from './Modal';

/**
 * Record (or edit) money a detailer paid Absolute. It is applied to their
 * balance, not to any one week or job, so a partial payment is fine and the
 * rest simply carries forward.
 */
export default function PaymentModal({
  detailers,
  detailerId,
  payment,
  balance,
  onSave,
  onClose,
}: {
  detailers: Detailer[];
  detailerId?: string;
  /** Present when editing. */
  payment?: DetailerPayment;
  /** Current balance of the preselected detailer, shown as a hint. */
  balance?: number;
  onSave: (input: PaymentInput) => Promise<void>;
  onClose: () => void;
}) {
  const [who, setWho] = useState(payment?.detailer_id ?? detailerId ?? '');
  const [amount, setAmount] = useState(payment ? String(payment.amount) : '');
  const [paidOn, setPaidOn] = useState(payment?.paid_on ?? torontoToday());
  const [method, setMethod] = useState<PaymentMethod>(payment?.method ?? 'e_transfer');
  const [note, setNote] = useState(payment?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(amount);
    if (!who) return setError('Choose a detailer.');
    if (!amount.trim() || !Number.isFinite(value) || value <= 0) return setError('Enter an amount above $0.');
    if (!paidOn) return setError('Enter the date it was paid.');
    setSaving(true);
    setError(null);
    try {
      await onSave({
        detailer_id: who,
        amount: Math.round(value * 100) / 100,
        paid_on: paidOn,
        method,
        note: note.trim() || null,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not save the payment.');
      setSaving(false);
    }
  };

  return (
    <Modal
      title={payment ? 'Edit payment' : 'Record payment'}
      subtitle="Applied to the detailer's balance. Partial payments carry the rest forward."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelClass} htmlFor="pay-detailer">Detailer</label>
          <select id="pay-detailer" className={inputClass} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Choose…</option>
            {detailers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.status !== 'active' ? ' (inactive)' : ''}
              </option>
            ))}
          </select>
          {balance !== undefined && who === detailerId && (
            <p className="mt-1 text-[11px] text-charcoal-muted">
              {balance > 0 ? `Owes ${formatMoney(balance)} right now.` : balance < 0 ? `In credit by ${formatMoney(-balance)}.` : 'Nothing owed right now.'}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="pay-amount">Amount</label>
            <input
              id="pay-amount"
              type="number"
              min={0.01}
              step="0.01"
              inputMode="decimal"
              className={inputClass}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 100"
              autoFocus
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="pay-date">Paid on</label>
            <input id="pay-date" type="date" className={inputClass} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor="pay-method">Method</label>
          <select id="pay-method" className={inputClass} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="pay-note">Note <span className="normal-case font-medium text-charcoal-muted">(optional)</span></label>
          <input id="pay-note" className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. e-Transfer ref" />
        </div>
        {error && (
          <p className="text-xs text-red-600 flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5" /> {error}
          </p>
        )}
        <div className="flex justify-end gap-2.5 pt-1">
          <button type="button" className={secondaryButton} onClick={onClose}>Cancel</button>
          <button type="submit" className={primaryButton} disabled={saving}>
            {saving ? 'Saving…' : payment ? 'Save changes' : 'Record payment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
