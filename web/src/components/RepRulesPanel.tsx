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

  /** Champs numériques décimaux (ex. fatigueStopGraceSec = 1.5 s) — parseFloat au lieu de parseInt. */
  const setFloat = (k: keyof RepRules, v: string) => {
    const n = parseFloat(v);
    setRules(prev => ({ ...prev, [k]: isNaN(n) ? 0 : n }));
  };

  /** Champs texte (montants ETH lisibles, ex. "0.00296") — pas de parseInt, valeur brute conservée. */
  const setText = (k: keyof RepRules, v: string) => {
    setRules(prev => ({ ...prev, [k]: v }));
  };

  /** Interrupteurs on/off (ex. fatigueEnabled) — valeur booléenne conservée telle quelle. */
  const setBool = (k: keyof RepRules, v: boolean) => {
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
    { key: 'fightDiceEventMalusMax',    labelKey: 'admin.repRules.fightDiceEventMalusMax' },
    { key: 'fightDiceEventBonusMin',    labelKey: 'admin.repRules.fightDiceEventBonusMin' },
    { key: 'fightDiceEventBonusAmount', labelKey: 'admin.repRules.fightDiceEventBonusAmount' },
    { key: 'fightDiceEventMalusAmount', labelKey: 'admin.repRules.fightDiceEventMalusAmount' },
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

  const equipFields: { key: keyof RepRules; labelKey: string }[] = [
    { key: 'equipRarityXpCommon',    labelKey: 'admin.repRules.equipRarityXpCommon' },
    { key: 'equipRarityXpRare',      labelKey: 'admin.repRules.equipRarityXpRare' },
    { key: 'equipRarityXpLegendary', labelKey: 'admin.repRules.equipRarityXpLegendary' },
    { key: 'equipRarityXpEpic',      labelKey: 'admin.repRules.equipRarityXpEpic' },
    { key: 'equipShopMinPrice',      labelKey: 'admin.repRules.equipShopMinPrice' },
    { key: 'equipDamageBonusDivisor',labelKey: 'admin.repRules.equipDamageBonusDivisor' },
    { key: 'equipDefenseBonusDivisor',labelKey: 'admin.repRules.equipDefenseBonusDivisor' },
    { key: 'equipDurabilityLossPct', labelKey: 'admin.repRules.equipDurabilityLossPct' },
    { key: 'equipDropChancePct',     labelKey: 'admin.repRules.equipDropChancePct' },
    { key: 'capeInvisibilityMinMinutes', labelKey: 'admin.repRules.capeInvisibilityMinMinutes' },
    { key: 'capeInvisibilityMaxMinutes', labelKey: 'admin.repRules.capeInvisibilityMaxMinutes' },
  ];

  const statCapFields: { key: keyof RepRules; labelKey: string }[] = [
    { key: 'hpMaxCap',     labelKey: 'admin.repRules.hpMaxCap' },
    { key: 'forceMaxCap',  labelKey: 'admin.repRules.forceMaxCap' },
    { key: 'spellsMaxCap', labelKey: 'admin.repRules.spellsMaxCap' },
  ];

  const mapFields: { key: keyof RepRules; labelKey: string }[] = [
    { key: 'mapPoiDiscoveryXp',             labelKey: 'admin.repRules.mapPoiDiscoveryXp' },
    { key: 'travelWalkDurationSec',         labelKey: 'admin.repRules.travelWalkDurationSec' },
    { key: 'travelNightEncounterChancePct', labelKey: 'admin.repRules.travelNightEncounterChancePct' },
    { key: 'travelNightMonsterDamage',      labelKey: 'admin.repRules.travelNightMonsterDamage' },
  ];

  const hutFields: { key: keyof RepRules; labelKey: string }[] = [
    { key: 'hutRestHp',             labelKey: 'admin.repRules.hutRestHp' },
    { key: 'hutRestCooldownHours',  labelKey: 'admin.repRules.hutRestCooldownHours' },
    { key: 'hutRestDurationSec',    labelKey: 'admin.repRules.hutRestDurationSec' },
  ];

  const sleepFields: { key: keyof RepRules; labelKey: string }[] = [
    { key: 'sleepHpThreshold',    labelKey: 'admin.repRules.sleepHpThreshold' },
    { key: 'sleepDurationSec',    labelKey: 'admin.repRules.sleepDurationSec' },
    { key: 'sleepWakeHp',         labelKey: 'admin.repRules.sleepWakeHp' },
    { key: 'sleepHappinessBonus', labelKey: 'admin.repRules.sleepHappinessBonus' },
    { key: 'sleepGraceSec',       labelKey: 'admin.repRules.sleepGraceSec' },
  ];

  const oxygenFields: { key: keyof RepRules; labelKey: string }[] = [
    { key: 'oxygenDrainIntervalSec',  labelKey: 'admin.repRules.oxygenDrainIntervalSec' },
    { key: 'oxygenDrainPct',          labelKey: 'admin.repRules.oxygenDrainPct' },
    { key: 'oxygenPenaltyXp',         labelKey: 'admin.repRules.oxygenPenaltyXp' },
    { key: 'oxygenPenaltyForce',      labelKey: 'admin.repRules.oxygenPenaltyForce' },
    { key: 'oxygenFaintThresholdPct', labelKey: 'admin.repRules.oxygenFaintThresholdPct' },
    { key: 'oxygenFaintDurationSec',  labelKey: 'admin.repRules.oxygenFaintDurationSec' },
    { key: 'oxygenFaintXpLoss',       labelKey: 'admin.repRules.oxygenFaintXpLoss' },
    { key: 'oxygenFaintHpLoss',       labelKey: 'admin.repRules.oxygenFaintHpLoss' },
    { key: 'oxygenRecoveryIntervalSec', labelKey: 'admin.repRules.oxygenRecoveryIntervalSec' },
    { key: 'oxygenRecoveryPct',         labelKey: 'admin.repRules.oxygenRecoveryPct' },
  ];

  const kingdomFields: { key: keyof RepRules; labelKey: string }[] = [
    { key: 'kingdomMinIntermediateSolved', labelKey: 'admin.repRules.kingdomMinIntermediateSolved' },
  ];

  const fatigueFields: { key: keyof RepRules; labelKey: string }[] = [
    { key: 'fatigueDrainIntervalSec',    labelKey: 'admin.repRules.fatigueDrainIntervalSec' },
    { key: 'fatigueDrainPct',            labelKey: 'admin.repRules.fatigueDrainPct' },
    { key: 'fatigueStopGraceSec',        labelKey: 'admin.repRules.fatigueStopGraceSec' },
    { key: 'fatigueRecoveryIntervalSec', labelKey: 'admin.repRules.fatigueRecoveryIntervalSec' },
    { key: 'fatigueRecoveryPct',         labelKey: 'admin.repRules.fatigueRecoveryPct' },
  ];

  const fatigueLowStatsFields: { key: keyof RepRules; labelKey: string }[] = [
    { key: 'fatigueLowStatsThresholdPct',      labelKey: 'admin.repRules.fatigueLowStatsThresholdPct' },
    { key: 'fatigueLowStatsExtraDrainPerStat', labelKey: 'admin.repRules.fatigueLowStatsExtraDrainPerStat' },
    { key: 'fatigueLowStatsMaxExtraPct',       labelKey: 'admin.repRules.fatigueLowStatsMaxExtraPct' },
  ];

  const fatigueFaintFields: { key: keyof RepRules; labelKey: string }[] = [
    { key: 'fatigueFaintThresholdPct', labelKey: 'admin.repRules.fatigueFaintThresholdPct' },
    { key: 'fatigueFaintDurationSec',  labelKey: 'admin.repRules.fatigueFaintDurationSec' },
    { key: 'fatigueFaintHpLoss',       labelKey: 'admin.repRules.fatigueFaintHpLoss' },
  ];

  const altitudeFields: { key: keyof RepRules; labelKey: string }[] = [
    { key: 'altitudeMaxM',              labelKey: 'admin.repRules.altitudeMaxM' },
    { key: 'altitudeSnowThresholdM',    labelKey: 'admin.repRules.altitudeSnowThresholdM' },
    { key: 'altitudeRarefactionStartM', labelKey: 'admin.repRules.altitudeRarefactionStartM' },
  ];

  const waterDepthFields: { key: keyof RepRules; labelKey: string }[] = [
    { key: 'waterDepthMaxM', labelKey: 'admin.repRules.waterDepthMaxM' },
  ];

  const zorghonFields: { key: keyof RepRules; labelKey: string }[] = [
    { key: 'zorghonAppearKingdomSolvedCount', labelKey: 'admin.repRules.zorghonAppearKingdomSolvedCount' },
    { key: 'zorghonProximityPct',             labelKey: 'admin.repRules.zorghonProximityPct' },
    { key: 'zorghonRelocationChancePct',      labelKey: 'admin.repRules.zorghonRelocationChancePct' },
    { key: 'zorghonCheckIntervalSec',         labelKey: 'admin.repRules.zorghonCheckIntervalSec' },
    { key: 'zorghonRescueXpReward',           labelKey: 'admin.repRules.zorghonRescueXpReward' },
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
              value={rules[f.key] as number} onChange={e => set(f.key, e.target.value)} />
          </label>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">⚔️ {t('admin.repRules.equipTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.equipDescription')}</p>
        <div className="grid md:grid-cols-2 gap-3">
          {equipFields.map(f => (
            <label key={f.key} className="text-sm">
              <span className="text-slate-300">{t(f.labelKey)}</span>
              <input type="number" className="input mt-1 w-full"
                value={rules[f.key] as number} onChange={e => set(f.key, e.target.value)} />
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">🧪 {t('admin.repRules.statCapTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.statCapDescription')}</p>
        <div className="grid md:grid-cols-2 gap-3">
          {statCapFields.map(f => (
            <label key={f.key} className="text-sm">
              <span className="text-slate-300">{t(f.labelKey)}</span>
              <input type="number" className="input mt-1 w-full"
                value={rules[f.key] as number} onChange={e => set(f.key, e.target.value)} />
            </label>
          ))}
        </div>
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
      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">🗺️ {t('admin.repRules.mapTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.mapDescription')}</p>
        <div className="grid md:grid-cols-2 gap-3">
          {mapFields.map(f => (
            <label key={f.key} className="text-sm">
              <span className="text-slate-300">{t(f.labelKey)}</span>
              <input type="number" className="input mt-1 w-full"
                value={rules[f.key] as number} onChange={e => set(f.key, e.target.value)} />
            </label>
          ))}
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">🛖 {t('admin.repRules.hutTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.hutDescription')}</p>
        <div className="grid md:grid-cols-2 gap-3">
          {hutFields.map(f => (
            <label key={f.key} className="text-sm">
              <span className="text-slate-300">{t(f.labelKey)}</span>
              <input type="number" className="input mt-1 w-full"
                value={rules[f.key] as number} onChange={e => set(f.key, e.target.value)} />
            </label>
          ))}
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">🛌 {t('admin.repRules.sleepTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.sleepDescription')}</p>
        <div className="grid md:grid-cols-2 gap-3">
          {sleepFields.map(f => (
            <label key={f.key} className="text-sm">
              <span className="text-slate-300">{t(f.labelKey)}</span>
              <input type="number" className="input mt-1 w-full"
                value={rules[f.key] as number} onChange={e => set(f.key, e.target.value)} />
            </label>
          ))}
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">🫧 {t('admin.repRules.oxygenTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.oxygenDescription')}</p>
        <div className="grid md:grid-cols-2 gap-3">
          {oxygenFields.map(f => (
            <label key={f.key} className="text-sm">
              <span className="text-slate-300">{t(f.labelKey)}</span>
              <input type="number" className="input mt-1 w-full"
                value={rules[f.key] as number} onChange={e => set(f.key, e.target.value)} />
            </label>
          ))}
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">🥵 {t('admin.repRules.fatigueTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.fatigueDescription')}</p>
        <label className="flex items-center gap-2 text-sm mb-3">
          <input type="checkbox" checked={rules.fatigueEnabled !== false}
            onChange={e => setBool('fatigueEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.fatigueEnabled')}</span>
        </label>
        <div className="grid md:grid-cols-2 gap-3">
          {fatigueFields.map(f => (
            <label key={f.key} className="text-sm">
              <span className="text-slate-300">{t(f.labelKey)}</span>
              <input type="number" step="0.1" className="input mt-1 w-full" disabled={rules.fatigueEnabled === false}
                value={rules[f.key] as number}
                onChange={e => f.key === 'fatigueStopGraceSec' ? setFloat(f.key, e.target.value) : set(f.key, e.target.value)} />
            </label>
          ))}
        </div>
        <div className="mt-4 pt-3 border-t border-slate-700/60">
          <h4 className="text-xs font-semibold mb-1 text-slate-300">⚖️ {t('admin.repRules.fatigueLowStatsTitle')}</h4>
          <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.fatigueLowStatsDescription')}</p>
          <label className="flex items-center gap-2 text-sm mb-3">
            <input type="checkbox" checked={rules.fatigueLowStatsPenaltyEnabled !== false}
              disabled={rules.fatigueEnabled === false}
              onChange={e => setBool('fatigueLowStatsPenaltyEnabled', e.target.checked)} />
            <span className="text-slate-300">{t('admin.repRules.fatigueLowStatsPenaltyEnabled')}</span>
          </label>
          <div className="grid md:grid-cols-2 gap-3">
            {fatigueLowStatsFields.map(f => (
              <label key={f.key} className="text-sm">
                <span className="text-slate-300">{t(f.labelKey)}</span>
                <input type="number" className="input mt-1 w-full"
                  disabled={rules.fatigueEnabled === false || rules.fatigueLowStatsPenaltyEnabled === false}
                  value={rules[f.key] as number} onChange={e => set(f.key, e.target.value)} />
              </label>
            ))}
          </div>
        </div>
        <div className="mt-4 pt-3 border-t border-slate-700/60">
          <h4 className="text-xs font-semibold mb-1 text-slate-300">🥱 {t('admin.repRules.fatigueFaintTitle')}</h4>
          <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.fatigueFaintDescription')}</p>
          <div className="grid md:grid-cols-2 gap-3">
            {fatigueFaintFields.map(f => (
              <label key={f.key} className="text-sm">
                <span className="text-slate-300">{t(f.labelKey)}</span>
                <input type="number" className="input mt-1 w-full" disabled={rules.fatigueEnabled === false}
                  value={rules[f.key] as number} onChange={e => set(f.key, e.target.value)} />
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm mt-3">
            <input type="checkbox" checked={rules.fatigueFaintResultPopupEnabled !== false}
              disabled={rules.fatigueEnabled === false}
              onChange={e => setBool('fatigueFaintResultPopupEnabled', e.target.checked)} />
            <span className="text-slate-300">{t('admin.repRules.fatigueFaintResultPopupEnabled')}</span>
          </label>
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">⛰️ {t('admin.repRules.altitudeTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.altitudeDescription')}</p>
        <label className="flex items-center gap-2 text-sm mb-3">
          <input type="checkbox" checked={rules.altitudeEnabled !== false}
            onChange={e => setBool('altitudeEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.altitudeEnabled')}</span>
        </label>
        <div className="grid md:grid-cols-2 gap-3">
          {altitudeFields.map(f => (
            <label key={f.key} className="text-sm">
              <span className="text-slate-300">{t(f.labelKey)}</span>
              <input type="number" className="input mt-1 w-full" disabled={rules.altitudeEnabled === false}
                value={rules[f.key] as number} onChange={e => set(f.key, e.target.value)} />
            </label>
          ))}
          <label className="text-sm">
            <span className="text-slate-300">{t('admin.repRules.altitudeRarefactionMinIntervalFactor')}</span>
            <input type="number" step="0.05" min="0.05" max="1" className="input mt-1 w-full" disabled={rules.altitudeEnabled === false}
              value={rules.altitudeRarefactionMinIntervalFactor}
              onChange={e => setFloat('altitudeRarefactionMinIntervalFactor', e.target.value)} />
          </label>
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">🌊 {t('admin.repRules.waterDepthTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.waterDepthDescription')}</p>
        <label className="flex items-center gap-2 text-sm mb-3">
          <input type="checkbox" checked={rules.waterDepthEnabled !== false}
            onChange={e => setBool('waterDepthEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.waterDepthEnabled')}</span>
        </label>
        <div className="grid md:grid-cols-2 gap-3">
          {waterDepthFields.map(f => (
            <label key={f.key} className="text-sm">
              <span className="text-slate-300">{t(f.labelKey)}</span>
              <input type="number" className="input mt-1 w-full" disabled={rules.waterDepthEnabled === false}
                value={rules[f.key] as number} onChange={e => set(f.key, e.target.value)} />
            </label>
          ))}
          <label className="text-sm">
            <span className="text-slate-300">{t('admin.repRules.waterDepthRarefactionMinIntervalFactor')}</span>
            <input type="number" step="0.05" min="0.05" max="1" className="input mt-1 w-full" disabled={rules.waterDepthEnabled === false}
              value={rules.waterDepthRarefactionMinIntervalFactor}
              onChange={e => setFloat('waterDepthRarefactionMinIntervalFactor', e.target.value)} />
          </label>
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">🏝️ {t('admin.repRules.islandTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.islandDescription')}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={rules.islandVehicleRequired !== false}
            onChange={e => setBool('islandVehicleRequired', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.islandVehicleRequired')}</span>
        </label>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">👑 {t('admin.repRules.kingdomTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.kingdomDescription')}</p>
        <div className="grid md:grid-cols-2 gap-3">
          {kingdomFields.map(f => (
            <label key={f.key} className="text-sm">
              <span className="text-slate-300">{t(f.labelKey)}</span>
              <input type="number" className="input mt-1 w-full"
                value={rules[f.key] as number} onChange={e => set(f.key, e.target.value)} />
            </label>
          ))}
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">👹 {t('admin.repRules.zorghonTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.zorghonDescription')}</p>
        <label className="flex items-center gap-2 text-sm mb-3">
          <input type="checkbox" checked={rules.zorghonEnabled !== false}
            onChange={e => setBool('zorghonEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.zorghonEnabled')}</span>
        </label>
        <div className="grid md:grid-cols-2 gap-3">
          {zorghonFields.map(f => (
            <label key={f.key} className="text-sm">
              <span className="text-slate-300">{t(f.labelKey)}</span>
              <input type="number" className="input mt-1 w-full" disabled={rules.zorghonEnabled === false}
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
