'use client';

import React, { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { SERVICE_LABELS } from '@/types/booking';
import { ADDON_LABELS, AddonFee, AddonKey, ServiceFee } from '@/types/fee';
import { getAddonFees, getServiceFees, saveAddonFee, saveServiceFee } from '@/lib/fees';
import Modal, { inputClass, primaryButton, secondaryButton } from './Modal';

/** Current packages first, retired ones after. */
const SERVICE_ORDER = [
  'full_gold', 'interior_gold', 'full_titanium', 'interior_titanium',
  'full_silver', 'interior_silver', 'tint', 'ceramic_tint', 'nano_ceramic_tint',
];

interface Draft {
  fee: string;
  active: boolean;
}

/**
 * The commission schedule. Package fees are per car; add-on fees are once per
 * booking. A change applies to jobs completed from then on - every past job
 * keeps the commission it was charged, because that was snapshotted at
 * completion.
 */
export default function FeeSettingsModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [services, setServices] = useState<ServiceFee[]>([]);
  const [addons, setAddons] = useState<AddonFee[]>([]);
  const [sDraft, setSDraft] = useState<Record<string, Draft>>({});
  const [aDraft, setADraft] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, a] = await Promise.all([getServiceFees(), getAddonFees()]);
        s.sort((x, y) => SERVICE_ORDER.indexOf(x.service_key) - SERVICE_ORDER.indexOf(y.service_key));
        setServices(s);
        setAddons(a);
        setSDraft(Object.fromEntries(s.map((r) => [r.service_key, { fee: r.fee_per_car == null ? '' : String(r.fee_per_car), active: r.is_active }])));
        setADraft(Object.fromEntries(a.map((r) => [r.addon_key, { fee: String(r.fee), active: r.is_active }])));
      } catch (err: any) {
        setError(err?.message || 'Could not load fee settings.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    setError(null);
    // Validate everything before writing anything.
    for (const r of services) {
      const v = sDraft[r.service_key].fee.trim();
      if (v !== '' && (!Number.isFinite(Number(v)) || Number(v) < 0)) {
        return setError(`${SERVICE_LABELS[r.service_key] || r.service_key}: enter a fee of $0 or more, or leave it blank.`);
      }
    }
    for (const r of addons) {
      const v = aDraft[r.addon_key].fee.trim();
      if (v === '' || !Number.isFinite(Number(v)) || Number(v) < 0) {
        return setError(`${ADDON_LABELS[r.addon_key]}: enter a fee of $0 or more.`);
      }
    }
    setSaving(true);
    try {
      for (const r of services) {
        const d = sDraft[r.service_key];
        const fee = d.fee.trim() === '' ? null : Number(d.fee);
        if (fee !== r.fee_per_car || d.active !== r.is_active) await saveServiceFee(r.service_key, fee, d.active);
      }
      for (const r of addons) {
        const d = aDraft[r.addon_key];
        const fee = Number(d.fee);
        if (fee !== r.fee || d.active !== r.is_active) await saveAddonFee(r.addon_key, fee, d.active);
      }
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not save fee settings.');
      setSaving(false);
    }
  };

  const row = (
    key: string,
    label: string,
    draft: Draft,
    set: (d: Draft) => void,
    unit: string,
    allowBlank: boolean
  ) => (
    <div key={key} className="grid grid-cols-[1fr_7.5rem_auto] items-center gap-3 py-2 border-b border-charcoal-border/30 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-charcoal truncate">{label}</p>
        {allowBlank && draft.fee.trim() === '' && <p className="text-[11px] text-amber-700">Fee not set — completed jobs are flagged</p>}
      </div>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-charcoal-muted">$</span>
        <input
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          aria-label={`${label} fee ${unit}`}
          className={`${inputClass} pl-6 py-2`}
          value={draft.fee}
          placeholder={allowBlank ? 'not set' : '0'}
          onChange={(e) => set({ ...draft, fee: e.target.value })}
        />
      </div>
      <label className="flex items-center gap-1.5 text-xs text-charcoal-muted cursor-pointer select-none">
        <input type="checkbox" checked={draft.active} onChange={(e) => set({ ...draft, active: e.target.checked })} />
        Active
      </label>
    </div>
  );

  return (
    <Modal
      title="Commission settings"
      subtitle="Changes apply to jobs completed from now on. Past jobs keep the commission they were charged."
      onClose={onClose}
    >
      {loading ? (
        <p className="text-xs text-charcoal-muted py-6 text-center">Loading…</p>
      ) : (
        <div className="space-y-5">
          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-charcoal-muted mb-1">Package fee, per car</h4>
            {services.map((r) =>
              row(r.service_key, SERVICE_LABELS[r.service_key] || r.service_key, sDraft[r.service_key], (d) => setSDraft((p) => ({ ...p, [r.service_key]: d })), 'per car', true)
            )}
          </section>
          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-charcoal-muted mb-1">Add-ons, once per booking</h4>
            {addons.map((r) =>
              row(r.addon_key, ADDON_LABELS[r.addon_key as AddonKey], aDraft[r.addon_key], (d) => setADraft((p) => ({ ...p, [r.addon_key]: d })), 'per booking', false)
            )}
            <p className="text-[11px] text-charcoal-muted mt-1.5">
              Engine bay is charged only when the customer paid for it. Inactive = treated as not set.
            </p>
          </section>
          {error && (
            <p className="text-xs text-red-600 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" /> {error}
            </p>
          )}
          <div className="flex justify-end gap-2.5">
            <button type="button" className={secondaryButton} onClick={onClose}>Cancel</button>
            <button type="button" className={primaryButton} disabled={saving} onClick={save}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
