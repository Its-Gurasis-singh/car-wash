'use client';

import React, { useEffect } from 'react';
import { X } from 'lucide-react';

/** The panel's dialog shell, styled like ConfirmModal. Escape and the backdrop close it. */
export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-4 bg-charcoal/40 dark:bg-black/70 backdrop-blur-sm animate-fade-in overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`bg-charcoal-card w-full ${wide ? 'max-w-5xl' : 'max-w-md'} rounded-2xl shadow-soft-lg border border-charcoal-border animate-scale-up my-auto`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-start justify-between gap-4 px-4 sm:px-6 pt-4 sm:pt-5 pb-3 border-b border-charcoal-border/40">
          <div className="min-w-0">
            <h3 className="text-sm sm:text-base font-bold text-charcoal">{title}</h3>
            {subtitle && <div className="text-[11px] sm:text-xs text-charcoal-muted mt-0.5">{subtitle}</div>}
          </div>
          <button
            onClick={onClose}
            className="text-charcoal-muted hover:text-charcoal p-1 rounded-lg hover:bg-sage-50 transition-colors shrink-0"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-4 sm:px-6 py-4 sm:py-5">{children}</div>
      </div>
    </div>
  );
}

export const inputClass =
  'w-full px-3.5 py-2.5 rounded-xl text-base sm:text-sm bg-canvas border border-charcoal-border focus:border-sage-500 text-charcoal focus:bg-charcoal-card transition-colors';
export const labelClass = 'block text-xs font-semibold uppercase tracking-wider text-charcoal mb-1.5';
export const primaryButton =
  'px-4 py-2.5 sm:py-2 text-xs sm:text-sm font-semibold text-white rounded-xl shadow-soft-sm bg-sage-500 hover:bg-sage-600 disabled:opacity-60 transition-all';
export const secondaryButton =
  'px-4 py-2.5 sm:py-2 text-xs sm:text-sm font-medium text-charcoal-muted hover:text-charcoal bg-sage-50/80 hover:bg-sage-100 rounded-xl transition-colors';
