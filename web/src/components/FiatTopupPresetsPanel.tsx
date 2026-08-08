'use client';

import { useEffect, useState } from 'react';
import { getFiatTopupPresets, setFiatTopupPresets, DEFAULT_FIAT_TOPUP_PRESETS, type FiatTopupPreset } from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';

/** Panneau admin — presets de recharge fiat (CB/PayPal/Apple Pay/Google Pay → coins), sans passage
 * par la blockchain — voir docs/DEMO_FIAT.md et FiatTopupPanel.tsx (widget côté joueur). */
export function FiatTopupPresetsPanel() {
  const { t } = useI18n();
  const [presets, setPresetsLocal] = useState<FiatTopupPreset[]>(DEFAULT_FIAT_TOPUP_PRESETS);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { getFiatTopupPresets().then(setPresetsLocal).catch(() => {}); }, []);

  const upd = (i: number, k: keyof FiatTopupPreset, v: string) => {
    setPresetsLocal(prev => {
      const next = [...prev];
      next[i] = { ...next[i], [k]: k === 'coins' ? (parseInt(v, 10) || 0) : v } as FiatTopupPreset;
      return next;
    });
  };

  const addRow = () => setPresetsLocal(prev => [...prev, { priceLabel: '0,99 €', coins: 500 }]);
  const removeRow = (i: number) => setPresetsLocal(prev => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    setSaving(true);
    try {
      await setFiatTopupPresets(presets);
      setFeedback('✅ ' + t('common.success'));
      setTimeout(() => setFeedback(null), 2500);
    } catch (e: any) {
      setFeedback('❌ ' + (e?.message ?? 'error'));
    }
    setSaving(false);
  };

  const reset = async () => {
    setPresetsLocal(DEFAULT_FIAT_TOPUP_PRESETS);
    await setFiatTopupPresets(DEFAULT_FIAT_TOPUP_PRESETS);
    setFeedback('↺');
    setTimeout(() => setFeedback(null), 2000);
  };

  return (
    <section className="card">
      <h2 className="text-xl font-semibold mb-2">💳 {t('admin.fiatTopup.title')}</h2>
      <p className="text-xs text-slate-400 mb-4">{t('admin.fiatTopup.description')}</p>

      <div className="space-y-2">
        {presets.map((p, i) => (
          <div key={i} className="grid grid-cols-3 gap-2 items-end">
            <label className="text-xs">
              <span className="text-slate-400">{t('admin.fiatTopup.priceLabel')}</span>
              <input type="text" className="input mt-1 w-full" value={p.priceLabel}
                     onChange={e => upd(i, 'priceLabel', e.target.value)} />
            </label>
            <label className="text-xs">
              <span className="text-slate-400">💰 coins</span>
              <input type="number" className="input mt-1 w-full" value={p.coins}
                     onChange={e => upd(i, 'coins', e.target.value)} />
            </label>
            <button className="btn-secondary text-xs" onClick={() => removeRow(i)}>✕</button>
          </div>
        ))}
      </div>

      <div className="flex gap-3 mt-4">
        <button className="btn-secondary" onClick={addRow}>+ {t('admin.topup.add')}</button>
        <button className="btn-primary" disabled={saving} onClick={save}>
          {saving ? '⏳' : t('admin.actions.apply')}
        </button>
        <button className="btn-secondary" onClick={reset}>{t('admin.repRules.resetBtn')}</button>
        {feedback && <span className="text-sm self-center">{feedback}</span>}
      </div>
    </section>
  );
}
