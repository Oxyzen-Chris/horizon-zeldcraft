'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/lib/i18n';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
}

/** Popup Oui/Non générique — rendu via portal pour éviter le clipping des parents. */
export function ConfirmDialog({
  open, title, message, onConfirm, onCancel,
  confirmLabel, cancelLabel, variant = 'default',
}: ConfirmDialogProps) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter')  onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel, onConfirm]);

  if (!open || typeof document === 'undefined') return null;
  console.log('[ConfirmDialog] render: open=true title=', title);

  const confirmClass = variant === 'danger'
    ? 'bg-rose-600 hover:bg-rose-500'
    : 'bg-emerald-600 hover:bg-emerald-500';

  return createPortal(
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4" onClick={onCancel}>
      <div
        className="bg-slate-900 border-2 border-cyan-500 rounded-xl p-6 max-w-sm w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-cyan-300 mb-2">{title}</h3>
        <p className="text-sm text-slate-300 mb-5">{message}</p>
        <div className="flex gap-3">
          <button
            className={`flex-1 py-2 rounded font-semibold text-white transition ${confirmClass}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel ?? t('common.yes')}
          </button>
          <button
            className="flex-1 py-2 rounded font-semibold bg-slate-700 hover:bg-slate-600 text-white transition"
            onClick={onCancel}
          >
            {cancelLabel ?? t('common.no')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
