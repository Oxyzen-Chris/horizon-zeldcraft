'use client';

import { useEffect, useState } from 'react';
import { getTopupPresets, setTopupPresets, DEFAULT_TOPUP_PRESETS, type TopupPreset } from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';

/** Panneau admin — presets de recharge portefeuille (fiat → ETH → coins). */
export function TopupPresetsPanel() {
  const { t, currency } = useI18n();
  const [presets, setPresetsLocal] = useState<TopupPreset[]>(DEFAULT_TOPUP_PRESETS);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { getTopupPresets().then(setPresetsLocal).catch(() => {}); }, []);

  const upd = (i: number, k: keyof TopupPreset, v: string) => {
    setPresetsLocal(prev => {
      const next = [...prev];
      const num = k === 'eth' ? v : (parseInt(v, 10) || 0);
      next[i] = { ...next[i], [k]: num as any };
      return next;
    });
  };

  const addRow = () => setPresetsLocal(prev => [...prev, { fiat: 0, eth: '0.001', coins: 100 }]);
  const removeRow = (i: number) => setPresetsLocal(prev => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    setSaving(true);
    try {
      await setTopupPresets(presets);
      setFeedback('✅ ' + t('common.success'));
      setTimeout(() => setFeedback(null), 2500);
    } catch (e: any) {
      setFeedback('❌ ' + (e?.message ?? 'error'));
    }
    setSaving(false);
  };

  const reset = async () => {
    setPresetsLocal(DEFAULT_TOPUP_PRESETS);
    await setTopupPresets(DEFAULT_TOPUP_PRESETS);
    setFeedback('↺');
    setTimeout(() => setFeedback(null), 2000);
  };

  return (
    <section className="card">
      <h2 className="text-xl font-semibold mb-2">💰 {t('admin.topup.title')}</h2>
      <p className="text-xs text-slate-400 mb-4">{t('admin.topup.description')}</p>

      <div className="space-y-2">
        {presets.map((p, i) => (
          <div key={i} className="grid grid-cols-4 gap-2 items-end">
            <label className="text-xs">
              <span className="text-slate-400">{t('admin.topup.fiat')} ({currency})</span>
              <input type="number" className="input mt-1 w-full" value={p.fiat}
                     onChange={e => upd(i, 'fiat', e.target.value)} />
            </label>
            <label className="text-xs">
              <span className="text-slate-400">ETH</span>
              <input type="text" className="input mt-1 w-full" value={p.eth}
                     onChange={e => upd(i, 'eth', e.target.value)} />
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
