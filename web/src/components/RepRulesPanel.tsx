'use client';

import { useEffect, useState } from 'react';
import {
  getRepRules, setRepRules, updateRepRulesFields, DEFAULT_REP_RULES, DEFAULT_PLATFORM3D_OBJECT_FLAGS, PLATFORM3D_OBJECT_KINDS,
  type RepRules, type Platform3DObjectKind, type Platform3DObjectFlags,
} from '@/lib/gameState';
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
  const [emailConfig, setEmailConfig] = useState<{ configured: boolean; fromEmail: string; isSandbox: boolean } | null>(null);
  const [instantFeedback, setInstantFeedback] = useState<string | null>(null);

  useEffect(() => { getRepRules().then(setRules).catch(() => {}); }, []);
  useEffect(() => { fetch('/api/email/config').then(r => r.json()).then(setEmailConfig).catch(() => {}); }, []);

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

  /** Interrupteur à SAUVEGARDE INSTANTANÉE (écriture partielle Firebase immédiate, sans attendre
   * le bouton "Enregistrer" global) — réservé aux 3 boutons de l'écran d'accueil dont l'effet doit
   * être garanti dès le clic (bug corrigé : un admin qui bascule l'interrupteur sans faire défiler
   * jusqu'au bouton "Enregistrer", tout en bas d'un très long formulaire, perdait silencieusement
   * son changement). Met à jour l'état local pour un retour visuel immédiat ET persiste tout de
   * suite via `updateRepRulesFields` (fusion partielle — ne touche à aucun autre champ en cours
   * d'édition, non sauvegardé, ailleurs dans ce même formulaire). */
  const setBoolInstant = (k: keyof RepRules, v: boolean) => {
    setRules(prev => ({ ...prev, [k]: v }));
    updateRepRulesFields({ [k]: v })
      .then(() => {
        setInstantFeedback('✅ ' + t('common.success'));
        setTimeout(() => setInstantFeedback(null), 2000);
      })
      .catch((e) => {
        setInstantFeedback('❌ ' + (e?.message ?? 'error'));
        // Revert visuel si la persistance échoue réellement, pour ne jamais afficher un état
        // que Firebase n'a en réalité pas retenu.
        setRules(prev => ({ ...prev, [k]: !v }));
      });
  };

  /** Un des 3 interrupteurs (obstacle/climbable/water) du registre `platform3dObjectFlags` pour un
   * type d'objet/décor donné (voir gameState.ts::Platform3DObjectKind/Platform3DObjectFlags) —
   * merge défensif avec les valeurs par défaut si le type n'est pas encore présent en mémoire. */
  const setObjectFlag = (kind: Platform3DObjectKind, flag: keyof Platform3DObjectFlags, v: boolean) => {
    setRules(prev => ({
      ...prev,
      platform3dObjectFlags: {
        ...prev.platform3dObjectFlags,
        [kind]: { ...(prev.platform3dObjectFlags?.[kind] ?? DEFAULT_PLATFORM3D_OBJECT_FLAGS[kind]), [flag]: v },
      },
    }));
  };

  /** Facteur d'échelle (`scale`, défaut 1) du décor 3D (arbres/huttes/châteaux/portails/…) — voir
   * Platform3DWidget.tsx::PropBlock. Ne s'applique qu'aux `prop:*` (le sol/terrain ne se redimensionne
   * pas) mais reste éditable pour toutes les lignes pour rester cohérent avec les 3 autres colonnes ;
   * `Platform3DWidget.tsx` ignore simplement `scale` pour les `terrain:*`. Borné à [0.2, 5] pour
   * éviter un décor invisible (trop petit) ou qui dévore l'écran (trop grand) par erreur de saisie. */
  const setObjectScale = (kind: Platform3DObjectKind, v: number) => {
    const clamped = Number.isFinite(v) ? Math.min(5, Math.max(0.2, v)) : 1;
    setRules(prev => ({
      ...prev,
      platform3dObjectFlags: {
        ...prev.platform3dObjectFlags,
        [kind]: { ...(prev.platform3dObjectFlags?.[kind] ?? DEFAULT_PLATFORM3D_OBJECT_FLAGS[kind]), scale: clamped },
      },
    }));
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

  /** Champs du Dé d'Action D&D (Flight/Fight/Freeze/Fawn — voir resolveActionDiceRoll dans
   * gameState.ts), rendus en grille numérique classique. `actionDiceSides` a son propre <select>
   * (noms réels des dés polyédriques) et n'apparaît donc pas ici — voir plus bas. */
  const actionDiceFields: { key: keyof RepRules; labelKey: string }[] = [
    { key: 'actionDiceChancePct',            labelKey: 'admin.repRules.actionDiceChancePct' },
    { key: 'actionDiceFlightXp',             labelKey: 'admin.repRules.actionDiceFlightXp' },
    { key: 'actionDiceFlightHp',             labelKey: 'admin.repRules.actionDiceFlightHp' },
    { key: 'actionDiceFlightForce',          labelKey: 'admin.repRules.actionDiceFlightForce' },
    { key: 'actionDiceFightXp',              labelKey: 'admin.repRules.actionDiceFightXp' },
    { key: 'actionDiceFightHp',              labelKey: 'admin.repRules.actionDiceFightHp' },
    { key: 'actionDiceFightForce',           labelKey: 'admin.repRules.actionDiceFightForce' },
    { key: 'actionDiceFreezeXp',             labelKey: 'admin.repRules.actionDiceFreezeXp' },
    { key: 'actionDiceFawnXp',               labelKey: 'admin.repRules.actionDiceFawnXp' },
    { key: 'actionDiceFawnHp',               labelKey: 'admin.repRules.actionDiceFawnHp' },
    { key: 'actionDiceExtraUltraChancePct',  labelKey: 'admin.repRules.actionDiceExtraUltraChancePct' },
    { key: 'actionDiceUltraForceBonus',      labelKey: 'admin.repRules.actionDiceUltraForceBonus' },
    { key: 'actionDiceUltraXpBonus',         labelKey: 'admin.repRules.actionDiceUltraXpBonus' },
    { key: 'actionDiceUltraSpellsBonus',     labelKey: 'admin.repRules.actionDiceUltraSpellsBonus' },
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
        <h3 className="text-sm font-semibold mb-1">🎲 {t('admin.repRules.actionDiceTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.actionDiceDescription')}</p>
        <label className="flex items-center gap-2 text-sm mb-3">
          <input type="checkbox" checked={rules.actionDiceEnabled !== false}
            onChange={e => setBool('actionDiceEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.actionDiceEnabled')}</span>
        </label>
        <div className="grid md:grid-cols-2 gap-3 mb-3">
          <label className="text-sm">
            <span className="text-slate-300">{t('admin.repRules.actionDiceSides')}</span>
            <select className="input mt-1 w-full" disabled={rules.actionDiceEnabled === false}
              value={rules.actionDiceSides} onChange={e => set('actionDiceSides', e.target.value)}>
              <option value={4}>{t('admin.repRules.actionDiceSides.d4')}</option>
              <option value={6}>{t('admin.repRules.actionDiceSides.d6')}</option>
              <option value={8}>{t('admin.repRules.actionDiceSides.d8')}</option>
              <option value={10}>{t('admin.repRules.actionDiceSides.d10')}</option>
              <option value={12}>{t('admin.repRules.actionDiceSides.d12')}</option>
              <option value={20}>{t('admin.repRules.actionDiceSides.d20')}</option>
              <option value={100}>{t('admin.repRules.actionDiceSides.d100')}</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="text-slate-300">{t('admin.repRules.actionDiceUltraItemName')}</span>
            <input type="text" className="input mt-1 w-full" disabled={rules.actionDiceEnabled === false}
              value={rules.actionDiceUltraItemName} onChange={e => setText('actionDiceUltraItemName', e.target.value)} />
          </label>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {actionDiceFields.map(f => (
            <label key={f.key} className="text-sm">
              <span className="text-slate-300">{t(f.labelKey)}</span>
              <input type="number" className="input mt-1 w-full" disabled={rules.actionDiceEnabled === false}
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
        <h3 className="text-sm font-semibold mb-1">🚶 {t('admin.repRules.synkLimbAnimationTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.synkLimbAnimationDescription')}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={rules.synkLimbAnimationEnabled !== false}
            onChange={e => setBool('synkLimbAnimationEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.synkLimbAnimationEnabled')}</span>
        </label>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">🧝 {t('admin.repRules.synkAppearanceTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.synkAppearanceDescription')}</p>
        <label className="flex items-center gap-2 text-sm mb-3">
          <input type="checkbox" checked={rules.synkEyeBlinkEnabled !== false}
            onChange={e => setBool('synkEyeBlinkEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.synkEyeBlinkEnabled')}</span>
        </label>
        <label className="text-sm block max-w-xs">
          <span className="text-slate-300">{t('admin.repRules.synkEyeBlinkIntervalSec')}</span>
          <input type="number" min="0.5" step="0.5" className="input mt-1 w-full" disabled={rules.synkEyeBlinkEnabled === false}
            value={rules.synkEyeBlinkIntervalSec}
            onChange={e => setFloat('synkEyeBlinkIntervalSec', e.target.value)} />
        </label>
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
        <h3 className="text-sm font-semibold mb-1">🏃 {t('admin.repRules.movementTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.movementDescription')}</p>
        <div className="grid md:grid-cols-3 gap-3 mb-3">
          <label className="text-sm">
            <span className="text-slate-300">{t('admin.repRules.movementWalkStepMs')}</span>
            <input type="number" min="30" className="input mt-1 w-full"
              value={rules.movementWalkStepMs} onChange={e => set('movementWalkStepMs', e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="text-slate-300">{t('admin.repRules.movementRunStepMs')}</span>
            <input type="number" min="30" className="input mt-1 w-full"
              value={rules.movementRunStepMs} onChange={e => set('movementRunStepMs', e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="text-slate-300">{t('admin.repRules.movementRunHoldThresholdMs')}</span>
            <input type="number" min="0" className="input mt-1 w-full"
              value={rules.movementRunHoldThresholdMs} onChange={e => set('movementRunHoldThresholdMs', e.target.value)} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={rules.poiObstacleCollisionEnabled !== false}
            onChange={e => setBool('poiObstacleCollisionEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.poiObstacleCollisionEnabled')}</span>
        </label>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">🧊 {t('admin.repRules.platform3dRefinementsTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.platform3dRefinementsDescription')}</p>
        <label className="flex items-center gap-2 text-sm mb-2">
          <input type="checkbox" checked={rules.platform3dEquipmentRenderEnabled !== false}
            onChange={e => setBool('platform3dEquipmentRenderEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.platform3dEquipmentRenderEnabled')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm mb-2">
          <input type="checkbox" checked={rules.platform3dJumpEnabled !== false}
            onChange={e => setBool('platform3dJumpEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.platform3dJumpEnabled')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm mb-2">
          <input type="checkbox" checked={rules.platform3dResizableEnabled !== false}
            onChange={e => setBool('platform3dResizableEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.platform3dResizableEnabled')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm mb-2">
          <input type="checkbox" checked={rules.platform3dCameraRelativeMovement !== false}
            onChange={e => setBool('platform3dCameraRelativeMovement', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.platform3dCameraRelativeMovement')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={rules.platform3dChaseCameraEnabled !== false}
            onChange={e => setBool('platform3dChaseCameraEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.platform3dChaseCameraEnabled')}</span>
        </label>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">🧗 {t('admin.repRules.platform3dClimbTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.platform3dClimbDescription')}</p>
        <div className="grid md:grid-cols-3 gap-3 mb-1">
          <label className="text-sm">
            <span className="text-slate-300">{t('admin.repRules.platform3dCubeHeightM')}</span>
            <input type="number" min="10" className="input mt-1 w-full"
              value={rules.platform3dCubeHeightM} onChange={e => set('platform3dCubeHeightM', e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="text-slate-300">{t('admin.repRules.platform3dFallDamageMinCubes')}</span>
            <input type="number" min="0" className="input mt-1 w-full"
              value={rules.platform3dFallDamageMinCubes} onChange={e => set('platform3dFallDamageMinCubes', e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="text-slate-300">{t('admin.repRules.platform3dFallDeathCubes')}</span>
            <input type="number" min="0" className="input mt-1 w-full"
              value={rules.platform3dFallDeathCubes} onChange={e => set('platform3dFallDeathCubes', e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="text-slate-300">{t('admin.repRules.platform3dFallDamageHp')}</span>
            <input type="number" min="0" className="input mt-1 w-full"
              value={rules.platform3dFallDamageHp} onChange={e => set('platform3dFallDamageHp', e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="text-slate-300">{t('admin.repRules.platform3dFallDamageXp')}</span>
            <input type="number" min="0" className="input mt-1 w-full"
              value={rules.platform3dFallDamageXp} onChange={e => set('platform3dFallDamageXp', e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="text-slate-300">{t('admin.repRules.platform3dFallDeathXp')}</span>
            <input type="number" min="0" className="input mt-1 w-full"
              value={rules.platform3dFallDeathXp} onChange={e => set('platform3dFallDeathXp', e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="text-slate-300">{t('admin.repRules.platform3dFallDeathReviveSec')}</span>
            <input type="number" min="1" className="input mt-1 w-full"
              value={rules.platform3dFallDeathReviveSec} onChange={e => set('platform3dFallDeathReviveSec', e.target.value)} />
          </label>
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">🧱 {t('admin.repRules.platform3dObjectFlagsTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.platform3dObjectFlagsDescription')}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 text-left">
                <th className="pb-1 pr-2">{t('admin.repRules.platform3dObjectFlagsKind')}</th>
                <th className="pb-1 px-2 text-center">{t('admin.repRules.platform3dObjectFlagsObstacle')}</th>
                <th className="pb-1 px-2 text-center">{t('admin.repRules.platform3dObjectFlagsClimbable')}</th>
                <th className="pb-1 px-2 text-center">{t('admin.repRules.platform3dObjectFlagsWater')}</th>
                <th className="pb-1 px-2 text-center">{t('admin.repRules.platform3dObjectFlagsScale')}</th>
              </tr>
            </thead>
            <tbody>
              {PLATFORM3D_OBJECT_KINDS.map(kind => {
                const flags = rules.platform3dObjectFlags?.[kind] ?? DEFAULT_PLATFORM3D_OBJECT_FLAGS[kind];
                const isTerrain = kind.startsWith('terrain:');
                // Marqueurs (PNJ voxel / dragon-familier) : seul `scale` est pertinent, voir le
                // commentaire sur Platform3DObjectKind dans gameState.ts — obstacle/climbable/eau
                // ne s'appliquent qu'aux tuiles (tile.prop), jamais aux marqueurs de la carte.
                const isMarker = kind.startsWith('marker:');
                return (
                  <tr key={kind} className="border-t border-slate-800">
                    <td className="py-1 pr-2 text-slate-300">{t(`admin.repRules.platform3dKind.${kind.replace(':', '_')}`)}</td>
                    <td className="text-center">{isMarker ? <span className="text-slate-600">—</span> : <input type="checkbox" checked={flags.obstacle} onChange={e => setObjectFlag(kind, 'obstacle', e.target.checked)} />}</td>
                    <td className="text-center">{isMarker ? <span className="text-slate-600">—</span> : <input type="checkbox" checked={flags.climbable} onChange={e => setObjectFlag(kind, 'climbable', e.target.checked)} />}</td>
                    <td className="text-center">{isMarker ? <span className="text-slate-600">—</span> : <input type="checkbox" checked={flags.water} onChange={e => setObjectFlag(kind, 'water', e.target.checked)} />}</td>
                    <td className="text-center">
                      {isTerrain ? (
                        <span className="text-slate-600">—</span>
                      ) : (
                        <input type="number" min="0.2" max="5" step="0.1" className="input w-16 text-center"
                          value={flags.scale ?? 1} onChange={e => setObjectScale(kind, parseFloat(e.target.value))} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">🤿 {t('admin.repRules.platform3dUnderwaterTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.platform3dUnderwaterDescription')}</p>
        <label className="flex items-center gap-2 text-sm mb-2">
          <input type="checkbox" checked={rules.platform3dUnderwaterWorldEnabled !== false}
            onChange={e => setBool('platform3dUnderwaterWorldEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.platform3dUnderwaterWorldEnabled')}</span>
        </label>
        <div className="grid md:grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="text-slate-300">{t('admin.repRules.platform3dUnderwaterFishCount')}</span>
            <input type="number" min="0" className="input mt-1 w-full"
              value={rules.platform3dUnderwaterFishCount} onChange={e => set('platform3dUnderwaterFishCount', e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="text-slate-300">{t('admin.repRules.platform3dUnderwaterMonsterCount')}</span>
            <input type="number" min="0" className="input mt-1 w-full"
              value={rules.platform3dUnderwaterMonsterCount} onChange={e => set('platform3dUnderwaterMonsterCount', e.target.value)} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm mt-3 mb-2">
          <input type="checkbox" checked={rules.platform3dUnderwaterMoveEnabled !== false}
            onChange={e => setBool('platform3dUnderwaterMoveEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.platform3dUnderwaterMoveEnabled')}</span>
        </label>
        <label className="text-sm block max-w-xs">
          <span className="text-slate-300">{t('admin.repRules.platform3dUnderwaterMoveRadius')}</span>
          <input type="number" min="1" className="input mt-1 w-full"
            value={rules.platform3dUnderwaterMoveRadius} onChange={e => set('platform3dUnderwaterMoveRadius', e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm mt-3">
          <input type="checkbox" checked={rules.defaultLakesEnabled !== false}
            onChange={e => setBool('defaultLakesEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.defaultLakesEnabled')}</span>
        </label>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">📍 {t('admin.repRules.depthAltitudePopupTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.depthAltitudePopupDescription')}</p>
        <label className="flex items-center gap-2 text-sm mb-3">
          <input type="checkbox" checked={rules.depthAltitudePopupEnabled !== false}
            onChange={e => setBool('depthAltitudePopupEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.depthAltitudePopupEnabled')}</span>
        </label>
        <div className="grid md:grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="text-slate-300">{t('admin.repRules.depthAltitudePopupPosition')}</span>
            <select className="input mt-1 w-full" disabled={rules.depthAltitudePopupEnabled === false}
              value={rules.depthAltitudePopupPosition}
              onChange={e => setText('depthAltitudePopupPosition', e.target.value)}>
              <option value="top-left">{t('admin.repRules.corner.topLeft')}</option>
              <option value="top-right">{t('admin.repRules.corner.topRight')}</option>
              <option value="bottom-left">{t('admin.repRules.corner.bottomLeft')}</option>
              <option value="bottom-right">{t('admin.repRules.corner.bottomRight')}</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="text-slate-300">{t('admin.repRules.depthAltitudePopupWaterTemplate')}</span>
            <input type="text" className="input mt-1 w-full" disabled={rules.depthAltitudePopupEnabled === false}
              placeholder={t('game.depthAltitude.water')}
              value={rules.depthAltitudePopupWaterTemplate}
              onChange={e => setText('depthAltitudePopupWaterTemplate', e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="text-slate-300">{t('admin.repRules.depthAltitudePopupMountainTemplate')}</span>
            <input type="text" className="input mt-1 w-full" disabled={rules.depthAltitudePopupEnabled === false}
              placeholder={t('game.depthAltitude.mountain')}
              value={rules.depthAltitudePopupMountainTemplate}
              onChange={e => setText('depthAltitudePopupMountainTemplate', e.target.value)} />
          </label>
        </div>
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
      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">❓ {t('admin.repRules.onboardingTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.onboardingDescription')}</p>
        <label className="flex items-center gap-2 text-sm mb-2">
          <input type="checkbox" checked={rules.onboardingEnabled !== false}
            onChange={e => setBool('onboardingEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.onboardingEnabled')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={rules.helpWidgetEnabled !== false}
            onChange={e => setBool('helpWidgetEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.helpWidgetEnabled')}</span>
        </label>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">📖 {t('admin.repRules.progressWidgetTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.progressWidgetDescription')}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={rules.progressWidgetEnabled !== false}
            onChange={e => setBool('progressWidgetEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.progressWidgetEnabled')}</span>
        </label>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">⏱️ {t('admin.repRules.playtimeTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.playtimeDescription')}</p>
        <label className="flex items-center gap-2 text-sm mb-2">
          <input type="checkbox" checked={rules.playtimeTrackingEnabled !== false}
            onChange={e => setBool('playtimeTrackingEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.playtimeTrackingEnabled')}</span>
        </label>
        <label className="text-sm block max-w-xs">
          <span className="text-slate-300">{t('admin.repRules.playtimeHeartbeatSec')}</span>
          <input type="number" min={5} className="input mt-1 w-full" disabled={rules.playtimeTrackingEnabled === false}
            value={rules.playtimeHeartbeatSec} onChange={e => set('playtimeHeartbeatSec', e.target.value)} />
        </label>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">🏠 {t('admin.repRules.homeButtonsTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.homeButtonsDescription')}</p>
        <label className="flex items-center gap-2 text-sm mb-2">
          <input type="checkbox" checked={rules.walletConnectEnabled !== false}
            onChange={e => setBoolInstant('walletConnectEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.walletConnectEnabled')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm mb-2">
          <input type="checkbox" checked={rules.demoAccessEnabled !== false}
            onChange={e => setBoolInstant('demoAccessEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.demoAccessEnabledHomeBtn')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm mb-1">
          <input type="checkbox" checked={rules.fiatPaymentEnabled !== false}
            onChange={e => setBoolInstant('fiatPaymentEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.fiatPaymentEnabledHomeBtn')}</span>
        </label>
        {instantFeedback && <p className="text-xs mt-1">{instantFeedback}</p>}
        <p className="text-xs text-amber-400/80 mt-1">{t('admin.repRules.homeButtonsHint')}</p>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">🎟️ {t('admin.repRules.demoTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.demoDescription')}</p>
        <label className="flex items-center gap-2 text-sm mb-2">
          <input type="checkbox" checked={rules.demoAccessEnabled !== false}
            onChange={e => setBoolInstant('demoAccessEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.demoAccessEnabled')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm mb-3">
          <input type="checkbox" checked={rules.demoAnonymousEnabled !== false}
            disabled={rules.demoAccessEnabled === false}
            onChange={e => setBoolInstant('demoAnonymousEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.demoAnonymousEnabled')}</span>
        </label>
        <div className="grid md:grid-cols-3 gap-3">
          <label className="text-sm">
            <span className="text-slate-300">{t('admin.repRules.demoMaxConcurrentSessions')}</span>
            <input type="number" min="0" className="input mt-1 w-full" disabled={rules.demoAccessEnabled === false}
              value={rules.demoMaxConcurrentSessions} onChange={e => set('demoMaxConcurrentSessions', e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="text-slate-300">{t('admin.repRules.demoAnonymousMaxConcurrentSessions')}</span>
            <input type="number" min="0" className="input mt-1 w-full" disabled={rules.demoAnonymousEnabled === false}
              value={rules.demoAnonymousMaxConcurrentSessions} onChange={e => set('demoAnonymousMaxConcurrentSessions', e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="text-slate-300">{t('admin.repRules.demoInitialCoins')}</span>
            <input type="number" min="0" className="input mt-1 w-full" disabled={rules.demoAccessEnabled === false}
              value={rules.demoInitialCoins} onChange={e => set('demoInitialCoins', e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="text-slate-300">{t('admin.repRules.demoSessionMaxDurationMin')}</span>
            <input type="number" min="1" className="input mt-1 w-full" disabled={rules.demoAccessEnabled === false}
              value={rules.demoSessionMaxDurationMin} onChange={e => set('demoSessionMaxDurationMin', e.target.value)} />
          </label>
        </div>
        <p className="text-xs text-amber-400/80 mt-1">{t('admin.repRules.demoSessionMaxDurationMinHint')}</p>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">💳 {t('admin.repRules.fiatTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.fiatDescription')}</p>
        <label className="flex items-center gap-2 text-sm mb-3">
          <input type="checkbox" checked={rules.fiatPaymentEnabled !== false}
            onChange={e => setBoolInstant('fiatPaymentEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.fiatPaymentEnabled')}</span>
        </label>
        <div className="grid md:grid-cols-2 gap-2 mb-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={rules.fiatMethodCardEnabled !== false}
              disabled={rules.fiatPaymentEnabled === false}
              onChange={e => setBool('fiatMethodCardEnabled', e.target.checked)} />
            <span className="text-slate-300">💳 {t('admin.repRules.fiatMethodCardEnabled')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={rules.fiatMethodPaypalEnabled !== false}
              disabled={rules.fiatPaymentEnabled === false}
              onChange={e => setBool('fiatMethodPaypalEnabled', e.target.checked)} />
            <span className="text-slate-300">🅿️ {t('admin.repRules.fiatMethodPaypalEnabled')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={rules.fiatMethodApplePayEnabled !== false}
              disabled={rules.fiatPaymentEnabled === false}
              onChange={e => setBool('fiatMethodApplePayEnabled', e.target.checked)} />
            <span className="text-slate-300"> {t('admin.repRules.fiatMethodApplePayEnabled')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={rules.fiatMethodGooglePayEnabled !== false}
              disabled={rules.fiatPaymentEnabled === false}
              onChange={e => setBool('fiatMethodGooglePayEnabled', e.target.checked)} />
            <span className="text-slate-300">G {t('admin.repRules.fiatMethodGooglePayEnabled')}</span>
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={rules.fiatSimulationMode !== false}
            disabled={rules.fiatPaymentEnabled === false}
            onChange={e => setBool('fiatSimulationMode', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.fiatSimulationMode')}</span>
        </label>
        <p className="text-xs text-amber-400/80 mt-1">{t('admin.repRules.fiatSimulationModeHint')}</p>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-700">
        <h3 className="text-sm font-semibold mb-1">✉️ {t('admin.repRules.emailTitle')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('admin.repRules.emailDescription')}</p>
        <label className="flex items-center gap-2 text-sm mb-3">
          <input type="checkbox" checked={rules.emailNotificationsEnabled !== false}
            onChange={e => setBool('emailNotificationsEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.emailNotificationsEnabled')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm mb-3">
          <input type="checkbox" checked={rules.welcomeEmailEnabled !== false}
            disabled={rules.emailNotificationsEnabled === false}
            onChange={e => setBool('welcomeEmailEnabled', e.target.checked)} />
          <span className="text-slate-300">{t('admin.repRules.welcomeEmailEnabled')}</span>
        </label>
        <div className="grid md:grid-cols-2 gap-3 mb-2">
          <label className="text-sm">
            {t('admin.repRules.emailFromName')}
            <input type="text" className="input mt-1 w-full" value={rules.emailFromName ?? ''}
              onChange={e => setText('emailFromName', e.target.value)} />
          </label>
          <label className="text-sm">
            {t('admin.repRules.emailBannerImageUrl')}
            <input type="text" className="input mt-1 w-full" placeholder="https://…"
              value={rules.emailBannerImageUrl ?? ''}
              onChange={e => setText('emailBannerImageUrl', e.target.value)} />
          </label>
        </div>
        <p className="text-xs text-amber-400/80 mt-1">{t('admin.repRules.emailKeyMissingHint')}</p>
        {emailConfig?.isSandbox && (
          <p className="text-xs text-red-400 mt-2 bg-red-950/40 border border-red-800/50 rounded p-2">
            ⚠️ {t('admin.repRules.emailSandboxWarning', { email: emailConfig.fromEmail })}
          </p>
        )}
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
