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

  /** Champs texte (montants ETH lisibles, ex. "0.00296") — pas de parseInt, valeur brute conservée. */
  const setText = (k: keyof RepRules, v: string) => {
    setRules(prev => ({ ...prev, [k]: v }));
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
    { key: 'fightLootChancePct',labelKey: 'admin.repRules.fightLootChancePct' },
    { key: 'fightForceWeight',   labelKey: 'admin.repRules.fightForceWeight' },
    { key: 'fightHpWeight',      labelKey: 'admin.repRules.fightHpWeight' },
    { key: 'fightHungerWeight',  labelKey: 'admin.repRules.fightHungerWeight' },
    { key: 'fightSpellsWeight',  labelKey: 'admin.repRules.fightSpellsWeight' },
    { key: 'fightNpcBonusMax',   labelKey: 'admin.repRules.fightNpcBonusMax' },
    { key: 'fightNpcForceRef',   labelKey: 'admin.repRules.fightNpcForceRef' },
    { key: 'xpCap',              labelKey: 'admin.repRules.xpCap' },
    { key: 'dailyLuckThreshold',     labelKey: 'admin.repRules.dailyLuckThreshold' },
    { key: 'dailyLuckWalletReward',  labelKey: 'admin.repRules.dailyLuckWalletReward' },
    { key: 'dailyLuckRepReward',     labelKey: 'admin.repRules.dailyLuckRepReward' },
    { key: 'dailyLuckXpConsolation', labelKey: 'admin.repRules.dailyLuckXpConsolation' },
  ];

  const moodFields: { key: keyof RepRules; labelKey: string }[] = [
    { key: 'moodWeatherSunnyBonus',   labelKey: 'admin.repRules.moodWeatherSunnyBonus' },
    { key: 'moodWeatherCloudyBonus',  labelKey: 'admin.repRules.moodWeatherCloudyBonus' },
    { key: 'moodWeatherRainyBonus',   labelKey: 'admin.repRules.moodWeatherRainyBonus' },
    { key: 'moodWeatherStormyBonus',  labelKey: 'admin.repRules.moodWeatherStormyBonus' },
    { key: 'moodWeatherSnowyBonus',   labelKey: 'admin.repRules.moodWeatherSnowyBonus' },
    { key: 'moodWeatherNightSwing',   labelKey: 'admin.repRules.moodWeatherNightSwing' },
    { key: 'moodEncounterGoalPerDay', labelKey: 'admin.repRules.moodEncounterGoalPerDay' },
    { key: 'moodEncounterBonusMax',   labelKey: 'admin.repRules.moodEncounterBonusMax' },
    { key: 'moodFamiliarBonus',       labelKey: 'admin.repRules.moodFamiliarBonus' },
    { key: 'moodWalletThreshold',     labelKey: 'admin.repRules.moodWalletThreshold' },
    { key: 'moodWalletBonusMax',      labelKey: 'admin.repRules.moodWalletBonusMax' },
    { key: 'moodFightWinBonus',       labelKey: 'admin.repRules.moodFightWinBonus' },
    { key: 'moodFightWinBonusCap',    labelKey: 'admin.repRules.moodFightWinBonusCap' },
    { key: 'moodFeedGoalPerDay',        labelKey: 'admin.repRules.moodFeedGoalPerDay' },
    { key: 'moodFeedBonusMax',          labelKey: 'admin.repRules.moodFeedBonusMax' },
    { key: 'moodFeedHappinessPenalty',  labelKey: 'admin.repRules.moodFeedHappinessPenalty' },
    { key: 'moodFeedXpPenalty',         labelKey: 'admin.repRules.moodFeedXpPenalty' },
    { key: 'moodFeedHungerPenalty',     labelKey: 'admin.repRules.moodFeedHungerPenalty' },
    { key: 'moodFeedWalletPenalty',     labelKey: 'admin.repRules.moodFeedWalletPenalty' },
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

      <div className="grid md:grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-700">
        <label className="text-sm">
          <span className="text-slate-300">{t('admin.repRules.teamChatCreationCostEth')}</span>
          <input type="text" className="input mt-1 w-full"
            value={rules.teamChatCreationCostEth} onChange={e => setText('teamChatCreationCostEth', e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="text-slate-300">{t('admin.repRules.teamChatCreationCostFiatHint')}</span>
          <input type="text" className="input mt-1 w-full"
            value={rules.teamChatCreationCostFiatHint} onChange={e => setText('teamChatCreationCostFiatHint', e.target.value)} />
        </label>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">😊 {t('admin.repRules.moodTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.moodDescription')}</p>
        <div className="grid md:grid-cols-2 gap-3">
          {moodFields.map(f => (
            <label key={f.key} className="text-sm">
              <span className="text-slate-300">{t(f.labelKey)}</span>
              <input type="number" className="input mt-1 w-full"
                value={rules[f.key] as number} onChange={e => set(f.key, e.target.value)} />
            </label>
          ))}
        </div>
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
