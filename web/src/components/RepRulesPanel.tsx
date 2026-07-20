'use client';

import { useEffect, useState } from 'react';
import { getRepRules, setRepRules, DEFAULT_REP_RULES, type RepRules } from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';

/**
 * Barème de reconnaissance appliqué aux rencontres PNJ — paramétrable owner.
 * Stocké dans Firebase (catalog/repRules), lu à chaque popup.
 */
export function RepRulesPanel() {
  const { t } = useI18n();
  const [rules, setRules] = useState<RepRules>(DEFAULT_REP_RULES);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => { getRepRules().then(setRules).catch(() => {}); }, []);

  const set = (k: keyof RepRules, v: string) => {
    const n = parseInt(v, 10);
    setRules(prev => ({ ...prev, [k]: isNaN(n) ? 0 : n }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await setRepRules(rules);
      setFeedback('✅ ' + t('common.success'));
      setTimeout(() => setFeedback(null), 2500);
    } catch (e: any) {
      setFeedback('❌ ' + (e?.message ?? 'error'));
    }
    setSaving(false);
  };

  const reset = async () => {
    setRules(DEFAULT_REP_RULES);
    await setRepRules(DEFAULT_REP_RULES);
    setFeedback('↺ ' + t('admin.repRules.reset'));
    setTimeout(() => setFeedback(null), 2500);
  };

  const fields: { key: keyof RepRules; labelKey: string; hint?: string }[] = [
    { key: 'fightWinHostile',    labelKey: 'admin.repRules.fightWinHostile' },
    { key: 'fightWinNormal',     labelKey: 'admin.repRules.fightWinNormal' },
    { key: 'fightLoss',          labelKey: 'admin.repRules.fightLoss' },
    { key: 'tradeFriendly',      labelKey: 'admin.repRules.tradeFriendly' },
    { key: 'tradeNeutral',       labelKey: 'admin.repRules.tradeNeutral' },
    { key: 'tradeHostileTheft',  labelKey: 'admin.repRules.tradeHostileTheft' },
    { key: 'questAccepted',      labelKey: 'admin.repRules.questAccepted' },
    { key: 'questSolved',        labelKey: 'admin.repRules.questSolved' },
    { key: 'chatFriendly',       labelKey: 'admin.repRules.chatFriendly' },
    { key: 'chatNeutral',        labelKey: 'admin.repRules.chatNeutral' },
    { key: 'chatHostile',        labelKey: 'admin.repRules.chatHostile' },
    { key: 'theftMaxWallet',     labelKey: 'admin.repRules.theftMaxWallet' },
    { key: 'theftMaxPct',        labelKey: 'admin.repRules.theftMaxPct' },
    { key: 'theftMaxItems',      labelKey: 'admin.repRules.theftMaxItems' },
    { key: 'fightLootPct',       labelKey: 'admin.repRules.fightLootPct' },
    { key: 'fightLootMaxWallet', labelKey: 'admin.repRules.fightLootMaxWallet' },
    { key: 'fightLootMaxItems',  labelKey: 'admin.repRules.fightLootMaxItems' },
  ];

  return (
    <section className="card">
      <h2 className="text-xl font-semibold mb-2">⭐ {t('admin.repRules.title')}</h2>
      <p className="text-xs text-slate-400 mb-4">{t('admin.repRules.description')}</p>
      <div className="grid md:grid-cols-2 gap-3">
        {fields.map(f => (
          <label key={f.key} className="text-sm">
            <span className="text-slate-300">{t(f.labelKey)}</span>
            <input type="number" className="input mt-1 w-full"
              value={rules[f.key]} onChange={e => set(f.key, e.target.value)} />
          </label>
        ))}
      </div>
      <div className="flex gap-3 mt-4">
        <button className="btn-primary" disabled={saving} onClick={save}>
          {saving ? '⏳' : t('admin.actions.apply')}
        </button>
        <button className="btn-secondary" onClick={reset}>{t('admin.repRules.resetBtn')}</button>
        {feedback && <span className="text-sm self-center">{feedback}</span>}
      </div>
    </section>
  );
}
