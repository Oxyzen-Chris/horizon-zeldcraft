'use client';

import { useAccount, useChainId, useReadContract, useWriteContract, useBalance } from 'wagmi';
import { keccak256, toBytes, parseEther, formatEther } from 'viem';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { CONTRACT_ADDRESSES } from '@/lib/wagmi';
import { HORIZON_ABI, FEED_TYPES, WEATHER, WEATHER_KEYS, normalizeAnswer } from '@/lib/contract';
import { addQuestDef, getQuestDefs, questIdOf, seedQuestAnswer, getAllQuestAnswers, hashAnswer, type QuestDef } from '@/lib/gameState';
import {
  addNpcDef, getNpcDefs, addTreasureDef, getTreasureDefs, addWorldDef, getWorldDefs,
  getRepRules, setNpcMaxPerDay, addMapPoiDef, getMapPoiDefs, removeMapPoiDef, addMapDef, getMapDefs,
  getSeasonState, setSeasonState, computeAutoSeason, SEASONS, SEASON_ICONS,
  getMoonState, setMoonState, isFullMoonOnDate, nextFullMoonDateFromState, getMoonCalendar, setMoonOverrideForMonth,
  DEFAULT_MAP_ID, type NpcDef, type TreasureDef, type WorldDef, type MapPoiDef, type MapPoiType,
  type Season, type SeasonState, type MoonState, type MoonMonthEntry,
} from '@/lib/gameState';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { NetworkSwitcher } from '@/components/NetworkSwitcher';
import { PlayerStats } from '@/components/PlayerStats';
import { ChatHistory } from '@/components/ChatHistory';
import { RepRulesPanel } from '@/components/RepRulesPanel';
import { TopupPresetsPanel } from '@/components/TopupPresetsPanel';
import { FamiliarsAdminPanel } from '@/components/FamiliarsAdminPanel';
import { ChatScriptsAdminPanel } from '@/components/ChatScriptsAdminPanel';
import { CustomWidgetsAdminPanel } from '@/components/CustomWidgetsAdminPanel';
import { EquipmentAdminPanel } from '@/components/EquipmentAdminPanel';
import { FoodAdminPanel } from '@/components/FoodAdminPanel';
import { PotionsSpellsAdminPanel } from '@/components/PotionsSpellsAdminPanel';
import { useI18n, localizeName } from '@/lib/i18n';

/** Formate une `Date` en "AAAA-MM-JJ" en heure LOCALE (contrairement à `Date.toISOString()`, qui
 * bascule en UTC et peut décaler d'un jour) — utilisé par les sélecteurs `<input type="date">` du
 * calendrier "Pleine lune" et de la date précise par quête (voir plus bas, section "Quêtes existantes"). */
function toLocalISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AdminPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const contract = CONTRACT_ADDRESSES[chainId];
  const { t } = useI18n();

  const { data: ownerAddr } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'owner', query: { enabled: !!contract },
  });
  const { data: treasuryAddr } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'treasury', query: { enabled: !!contract },
  });
  const { data: treasuryBalance } = useBalance({
    address: treasuryAddr as `0x${string}` | undefined,
    query: { enabled: !!treasuryAddr, refetchInterval: 15000 },
  });
  const { data: contractBalance } = useBalance({
    address: contract, query: { enabled: !!contract, refetchInterval: 15000 },
  });

  const isOwner = isConnected && ownerAddr && address &&
    (ownerAddr as string).toLowerCase() === address.toLowerCase();

  const { writeContract, isPending } = useWriteContract();

  const [itemKey, setItemKey] = useState('');
  const [itemLabel, setItemLabel] = useState('');
  const [itemPrice, setItemPrice] = useState('0.0001');

  const [questKey, setQuestKey] = useState('');
  const [questLabel, setQuestLabel] = useState('');
  const [questReq, setQuestReq] = useState('0');
  const [questRew, setQuestRew] = useState('100');
  const [questScore, setQuestScore] = useState('50');
  const [questAnswer, setQuestAnswer] = useState('');
  const [questHint, setQuestHint] = useState('');
  const [questNpcGiver, setQuestNpcGiver] = useState(false);
  const [questSaving, setQuestSaving] = useState(false);
  const [questSaved, setQuestSaved] = useState(false);
  const [allQuests, setAllQuests] = useState<QuestDef[] | null>(null);
  const [questAnswers, setQuestAnswers] = useState<Record<string, string>>({});
  const refreshQuests = () => {
    getQuestDefs().then(setAllQuests).catch(() => setAllQuests([]));
    getAllQuestAnswers().then(setQuestAnswers).catch(() => setQuestAnswers({}));
  };
  useEffect(() => { refreshQuests(); }, []);

  const [npcKey, setNpcKey] = useState('');
  const [npcName, setNpcName] = useState('');
  const [npcDialog, setNpcDialog] = useState('');
  const [npcXp, setNpcXp] = useState('30');
  const [npcQuest, setNpcQuest] = useState('');
  const [npcSaving, setNpcSaving] = useState(false);
  const [allNpcs, setAllNpcs] = useState<NpcDef[] | null>(null);
  const refreshNpcs = () => { getNpcDefs().then(setAllNpcs).catch(() => setAllNpcs([])); };
  useEffect(() => { refreshNpcs(); }, []);

  const [trsKey, setTrsKey] = useState('');
  const [trsName, setTrsName] = useState('');
  const [trsXpReq, setTrsXpReq] = useState('50');
  const [trsXp, setTrsXp] = useState('75');
  const [trsSaving, setTrsSaving] = useState(false);
  const [allTreasures, setAllTreasures] = useState<TreasureDef[] | null>(null);
  const refreshTreasures = () => { getTreasureDefs().then(setAllTreasures).catch(() => setAllTreasures([])); };
  useEffect(() => { refreshTreasures(); }, []);

  const [wldKey, setWldKey] = useState('');
  const [wldName, setWldName] = useState('');
  const [wldXp, setWldXp] = useState('500');
  const [wldMapX, setWldMapX] = useState('50');
  const [wldMapY, setWldMapY] = useState('50');
  const [wldVehicle, setWldVehicle] = useState('');
  const [wldSaving, setWldSaving] = useState(false);
  const [allWorlds, setAllWorlds] = useState<WorldDef[] | null>(null);
  const refreshWorlds = () => { getWorldDefs().then(setAllWorlds).catch(() => setAllWorlds([])); };
  useEffect(() => { refreshWorlds(); }, []);

  // Carte (mapmonde) — POI (terrain/décor) paramétrables, voir WorldMapWidget.tsx
  const [poiKey, setPoiKey] = useState('');
  const [poiType, setPoiType] = useState<MapPoiType>('plain');
  const [poiName, setPoiName] = useState('');
  const [poiIcon, setPoiIcon] = useState('');
  const [poiX, setPoiX] = useState('50');
  const [poiY, setPoiY] = useState('50');
  const [poiSeason, setPoiSeason] = useState<Season | ''>('');
  const [poiSaving, setPoiSaving] = useState(false);
  const [allPois, setAllPois] = useState<MapPoiDef[] | null>(null);
  const refreshPois = () => { getMapPoiDefs(DEFAULT_MAP_ID).then(setAllPois).catch(() => setAllPois([])); };
  useEffect(() => {
    refreshPois();
    // S'assure que la carte par défaut existe (idempotent) — évolutif : d'autres cartes pourront
    // être créées plus tard via cette même fonction.
    getMapDefs().then(maps => {
      if (!maps.some(m => m.id === DEFAULT_MAP_ID)) {
        addMapDef({ id: DEFAULT_MAP_ID, name: 'Territoire de Synk', active: true, createdAt: Date.now(), order: 0 }).catch(() => {});
      }
    }).catch(() => {});
  }, []);
  const POI_TYPES: MapPoiType[] = ['plain', 'stream', 'lake', 'mountain', 'forest', 'cave', 'beach', 'waterfall',
    'village_ally', 'village_enemy', 'path', 'bridge', 'tavern', 'stable', 'hut'];

  // Saisons (gestion tournante) — voir gameState.ts::Season/SeasonState/getCurrentSeason.
  const [seasonState, setSeasonStateLocal] = useState<SeasonState | null>(null);
  const [seasonMode, setSeasonMode] = useState<'auto' | 'manual'>('auto');
  const [seasonManual, setSeasonManual] = useState<Season>('spring');
  const [seasonSaving, setSeasonSaving] = useState(false);
  const [seasonSaved, setSeasonSaved] = useState(false);
  useEffect(() => {
    getSeasonState().then(s => {
      setSeasonStateLocal(s);
      setSeasonMode(s.mode);
      setSeasonManual(s.manualSeason ?? computeAutoSeason());
    }).catch(() => {});
  }, []);
  const effectiveSeason: Season = seasonState?.mode === 'manual' && seasonState.manualSeason
    ? seasonState.manualSeason : computeAutoSeason();
  const saveSeason = async () => {
    setSeasonSaving(true);
    try {
      await setSeasonState(seasonMode, seasonMode === 'manual' ? seasonManual : undefined);
      setSeasonStateLocal(await getSeasonState());
      setSeasonSaved(true);
      setTimeout(() => setSeasonSaved(false), 2000);
    } finally { setSeasonSaving(false); }
  };

  // Pleine lune (calendrier tournant, une par mois) — voir gameState.ts::MoonState/isFullMoonToday.
  const [moonState, setMoonStateLocal] = useState<MoonState | null>(null);
  const [moonMode, setMoonMode] = useState<'auto' | 'manual'>('auto');
  const [moonManualDay, setMoonManualDay] = useState('15');
  const [moonSaving, setMoonSaving] = useState(false);
  const [moonSaved, setMoonSaved] = useState(false);
  const [moonCalendar, setMoonCalendar] = useState<MoonMonthEntry[]>([]);
  const reloadMoon = () => {
    getMoonState().then(s => {
      setMoonStateLocal(s);
      setMoonMode(s.mode);
      setMoonManualDay(String(s.manualDay ?? 15));
    }).catch(() => {});
    getMoonCalendar(12).then(setMoonCalendar).catch(() => {});
  };
  useEffect(reloadMoon, []);
  const isFullMoonNow = moonState ? isFullMoonOnDate(moonState) : false;
  const nextFullMoonDate = moonState ? nextFullMoonDateFromState(moonState) : null;
  const saveMoon = async () => {
    setMoonSaving(true);
    try {
      await setMoonState(moonMode, moonMode === 'manual' ? parseInt(moonManualDay, 10) : undefined);
      reloadMoon();
      setMoonSaved(true);
      setTimeout(() => setMoonSaved(false), 2000);
    } finally { setMoonSaving(false); }
  };
  const setMoonCalendarDay = async (entry: MoonMonthEntry, isoDate: string) => {
    if (!isoDate) return;
    const day = new Date(isoDate + 'T00:00:00').getDate();
    await setMoonOverrideForMonth(entry.year, entry.month0, day);
    reloadMoon();
  };
  const resetMoonCalendarDay = async (entry: MoonMonthEntry) => {
    await setMoonOverrideForMonth(entry.year, entry.month0, null);
    reloadMoon();
  };

  const [difficulty, setDifficulty] = useState('50');
  const [weather, setWeather] = useState('0');
  // Fréquence des rencontres PNJ (RepRules.npcMaxPerDay) — 100% hors-chaîne, voir setNpcMaxPerDay.
  const [npcMax, setNpcMax] = useState('4');
  const [npcMaxSaving, setNpcMaxSaving] = useState(false);
  const [npcMaxSaved, setNpcMaxSaved] = useState(false);
  useEffect(() => { getRepRules().then((r) => setNpcMax(String(r.npcMaxPerDay))).catch(() => {}); }, []);

  const [feedIdx, setFeedIdx] = useState(0);
  const [feedNewPrice, setFeedNewPrice] = useState('0.0001');
  const [cooldownIdx, setCooldownIdx] = useState(0);
  const [cooldownSec, setCooldownSec] = useState('0');

  // Récupère la valeur actuelle du prix/cooldown pour l'index sélectionné (refresh à chaque changement)
  const { data: curFeedPrice } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'feedPrice',
    args: [feedIdx], query: { enabled: !!contract },
  });
  const { data: curCooldown } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'feedCooldown',
    args: [cooldownIdx], query: { enabled: !!contract },
  });

  // Met à jour l'input quand la valeur on-chain arrive ou quand on change de sélection
  useEffect(() => {
    if (curFeedPrice !== undefined) {
      setFeedNewPrice(formatEther(curFeedPrice as bigint));
    }
  }, [curFeedPrice, feedIdx]);
  useEffect(() => {
    if (curCooldown !== undefined) {
      setCooldownSec(String(curCooldown as bigint));
    }
  }, [curCooldown, cooldownIdx]);

  return (
    <main className="min-h-screen p-6 max-w-4xl mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <Link href="/" className="text-2xl font-bold text-voxlyn-crystal">🐉 {t('app.title')}</Link>
        <div className="flex flex-wrap gap-3 items-center">
          <Link href="/game" className="btn-secondary text-sm">{t('admin.backToGame')}</Link>
          <LanguageSwitcher />
          <NetworkSwitcher />
          <ConnectButton />
        </div>
      </header>

      <h1 className="text-3xl font-bold mb-6">⚙️ {t('admin.title')}</h1>

      {!isOwner ? (
        <div className="card"><p>{t('admin.notOwner')}</p></div>
      ) : (
        <div className="space-y-6">
          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.revenue.title')}</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-slate-800/60 rounded-lg p-4">
                <p className="text-xs text-slate-400 uppercase tracking-wide">{t('admin.revenue.treasury')}</p>
                <p className="text-2xl font-bold text-emerald-400 mt-1">
                  {treasuryBalance ? `${Number(formatEther(treasuryBalance.value)).toFixed(6)} ${treasuryBalance.symbol}` : '—'}
                </p>
                <p className="text-xs text-slate-500 mt-2 break-all">{treasuryAddr as string}</p>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-4">
                <p className="text-xs text-slate-400 uppercase tracking-wide">{t('admin.revenue.contract')}</p>
                <p className="text-2xl font-bold text-cyan-400 mt-1">
                  {contractBalance ? `${Number(formatEther(contractBalance.value)).toFixed(6)} ${contractBalance.symbol}` : '—'}
                </p>
                <p className="text-xs text-slate-500 mt-2 break-all">{contract}</p>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-3">{t('admin.revenue.hint')}</p>
          </section>

          {contract && <PlayerStats contract={contract} />}
          {contract && <ChatHistory contract={contract} />}
          <RepRulesPanel />
          <TopupPresetsPanel />
          <FamiliarsAdminPanel />
          <EquipmentAdminPanel />
          <FoodAdminPanel />
          <PotionsSpellsAdminPanel />
          <ChatScriptsAdminPanel />
          <CustomWidgetsAdminPanel />

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.item.title')}</h2>
            <div className="grid md:grid-cols-3 gap-3 mb-3">
              <input className="input" placeholder={t('admin.item.id')}    value={itemKey}   onChange={e => setItemKey(e.target.value)} />
              <input className="input" placeholder={t('admin.item.label')} value={itemLabel} onChange={e => setItemLabel(e.target.value)} />
              <input className="input" placeholder={t('admin.item.price')} value={itemPrice} onChange={e => setItemPrice(e.target.value)} />
            </div>
            <button className="btn-primary" disabled={isPending || !itemKey || !itemLabel}
              onClick={() => writeContract({
                address: contract, abi: HORIZON_ABI, functionName: 'addCatalogItem',
                args: [keccak256(toBytes(itemKey)), itemLabel, parseEther(itemPrice)],
              })}
            >{t('admin.actions.add')}</button>
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.quest.title')}</h2>
            <div className="grid md:grid-cols-4 gap-3 mb-3">
              <input className="input" placeholder={t('admin.quest.id')}            value={questKey}      onChange={e => setQuestKey(e.target.value)} />
              <input className="input" placeholder={t('admin.quest.label')}         value={questLabel}    onChange={e => setQuestLabel(e.target.value)} />
              <input className="input" placeholder={t('admin.quest.answer')}        value={questAnswer}   onChange={e => setQuestAnswer(e.target.value)} />
              <input className="input" placeholder={t('admin.quest.xpRequired')}    value={questReq}      onChange={e => setQuestReq(e.target.value)} />
              <input className="input" placeholder={t('admin.quest.xpReward')}      value={questRew}      onChange={e => setQuestRew(e.target.value)} />
              <input className="input" placeholder={t('admin.quest.scoreReward')}   value={questScore}    onChange={e => setQuestScore(e.target.value)} />
              <input className="input md:col-span-2" placeholder={t('admin.quest.hintField')} value={questHint} onChange={e => setQuestHint(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300 mb-3">
              <input type="checkbox" checked={questNpcGiver} onChange={e => setQuestNpcGiver(e.target.checked)} />
              {t('admin.quest.npcGiver')}
            </label>
            <button className="btn-primary" disabled={questSaving || !questKey || !questLabel || !questAnswer}
              onClick={async () => {
                setQuestSaving(true);
                setQuestSaved(false);
                try {
                  // 100% hors-chaîne : catalogue + hash de réponse écrits uniquement en base
                  // (Firebase). Aucune transaction blockchain, donc aucun gas pour créer la quête.
                  // `order` = position d'affichage explicite (évite un tri arbitraire quand
                  // plusieurs quêtes partagent le même horodatage — voir getQuestDefs()).
                  const existing = await getQuestDefs();
                  const nextOrder = existing.reduce((max, q) => Math.max(max, q.order ?? -1), -1) + 1;
                  const newQuestId = questIdOf(questKey);
                  await addQuestDef({
                    id: newQuestId,
                    label: questLabel,
                    xpRequired: Number(questReq),
                    xpReward: Number(questRew),
                    scoreReward: Number(questScore),
                    answerHash: keccak256(toBytes(normalizeAnswer(questAnswer))),
                    active: true,
                    createdAt: Date.now(),
                    order: nextOrder,
                    // Firebase RTDB rejette toute écriture contenant `undefined` : champs optionnels
                    // omis plutôt que mis à `undefined`.
                    ...(questHint.trim() ? { hint: questHint.trim() } : {}),
                    ...(questNpcGiver ? { npcGiver: true } : {}),
                  });
                  // Réponse en clair réservée à l'affichage Administration (jamais exposée aux
                  // joueurs — voir getAllQuestAnswers()/QuestList.tsx).
                  await seedQuestAnswer(newQuestId, normalizeAnswer(questAnswer));
                  setQuestKey(''); setQuestLabel(''); setQuestAnswer(''); setQuestHint(''); setQuestNpcGiver(false);
                  setQuestSaved(true);
                  setTimeout(() => setQuestSaved(false), 3000);
                  refreshQuests();
                } finally {
                  setQuestSaving(false);
                }
              }}
            >{questSaving ? '⏳' : t('admin.quest.submit')}</button>
            {questSaved && <p className="text-xs text-emerald-400 mt-2">✅ {t('admin.quest.saved')}</p>}
            <p className="text-xs text-slate-500 mt-2">{t('admin.quest.hint')}</p>

            {allQuests && (() => {
              const npcQuests = allQuests.filter(q => q.npcGiver);
              const classicQuests = allQuests.filter(q => !q.npcGiver);
              const sorted = [...allQuests].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
              return (
                <div className="mt-5 pt-4 border-t border-slate-700">
                  <h3 className="text-sm font-semibold mb-1">{t('admin.quest.list.title')}</h3>
                  <p className="text-xs text-slate-400 mb-3">
                    {t('admin.quest.list.total', {
                      total: allQuests.length, classic: classicQuests.length, npc: npcQuests.length,
                    })}
                  </p>
                  <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                    {sorted.map((q) => (
                      <QuestRow
                        key={q.id}
                        quest={q}
                        answer={questAnswers[q.id.toLowerCase()] ?? ''}
                        onSaved={refreshQuests}
                      />
                    ))}
                  </div>
                </div>
              );
            })()}
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.npc.title')}</h2>
            <div className="grid md:grid-cols-3 gap-3 mb-3">
              <input className="input" placeholder={t('admin.npc.id')}   value={npcKey}    onChange={e => setNpcKey(e.target.value)} />
              <input className="input" placeholder={t('admin.npc.name')} value={npcName}   onChange={e => setNpcName(e.target.value)} />
              <input className="input" placeholder={t('admin.npc.xp')}   value={npcXp}     onChange={e => setNpcXp(e.target.value)} />
              <input className="input md:col-span-2" placeholder={t('admin.npc.dialog')} value={npcDialog} onChange={e => setNpcDialog(e.target.value)} />
              <input className="input" placeholder={t('admin.npc.questId')} value={npcQuest} onChange={e => setNpcQuest(e.target.value)} />
            </div>
            <button className="btn-primary" disabled={npcSaving || !npcKey || !npcName}
              onClick={async () => {
                setNpcSaving(true);
                try {
                  // 100% hors-chaîne (Firebase) : aucune transaction blockchain, aucun gas — voir
                  // NpcDef dans gameState.ts. `addNpc` on-chain reste create-only (require(!active)),
                  // ce qui rendait ce catalogue impossible à modifier sans redéploiement du contrat.
                  const existing = await getNpcDefs();
                  const nextOrder = existing.reduce((mx, n) => Math.max(mx, n.order ?? -1), -1) + 1;
                  await addNpcDef({
                    id: npcKey.trim(), name: npcName.trim(), dialog: npcDialog.trim(),
                    xpReward: Number(npcXp) || 0, active: true, createdAt: Date.now(), order: nextOrder,
                    ...(npcQuest.trim() ? { questId: npcQuest.trim() } : {}),
                  });
                  setNpcKey(''); setNpcName(''); setNpcDialog(''); setNpcXp('30'); setNpcQuest('');
                  refreshNpcs();
                } finally {
                  setNpcSaving(false);
                }
              }}
            >{npcSaving ? '⏳' : t('admin.npc.submit')}</button>

            {allNpcs && (
              <div className="mt-5 pt-4 border-t border-slate-700">
                <h3 className="text-sm font-semibold mb-3">{t('admin.npc.list.title')}</h3>
                <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                  {allNpcs.map((n) => <NpcRow key={n.id} npc={n} onSaved={refreshNpcs} />)}
                </div>
              </div>
            )}
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.treasure.title')}</h2>
            <div className="grid md:grid-cols-4 gap-3 mb-3">
              <input className="input" placeholder={t('admin.treasure.id')}   value={trsKey}  onChange={e => setTrsKey(e.target.value)} />
              <input className="input" placeholder={t('admin.treasure.name')} value={trsName} onChange={e => setTrsName(e.target.value)} />
              <input className="input" placeholder={t('admin.treasure.xpRequired')} value={trsXpReq} onChange={e => setTrsXpReq(e.target.value)} />
              <input className="input" placeholder={t('admin.treasure.xp')}   value={trsXp}   onChange={e => setTrsXp(e.target.value)} />
            </div>
            <button className="btn-primary" disabled={trsSaving || !trsKey || !trsName}
              onClick={async () => {
                setTrsSaving(true);
                try {
                  const existing = await getTreasureDefs();
                  const nextOrder = existing.reduce((mx, w) => Math.max(mx, w.order ?? -1), -1) + 1;
                  await addTreasureDef({
                    id: trsKey.trim(), name: trsName.trim(), xpRequired: Number(trsXpReq) || 0,
                    xpReward: Number(trsXp) || 0, active: true, createdAt: Date.now(), order: nextOrder,
                  });
                  setTrsKey(''); setTrsName(''); setTrsXpReq('50'); setTrsXp('75');
                  refreshTreasures();
                } finally {
                  setTrsSaving(false);
                }
              }}
            >{trsSaving ? '⏳' : t('admin.actions.add')}</button>

            {allTreasures && (
              <div className="mt-5 pt-4 border-t border-slate-700">
                <h3 className="text-sm font-semibold mb-3">{t('admin.treasure.list.title')}</h3>
                <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                  {allTreasures.map((tr) => <TreasureRow key={tr.id} treasure={tr} onSaved={refreshTreasures} />)}
                </div>
              </div>
            )}
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.world.title')}</h2>
            <div className="grid md:grid-cols-3 gap-3 mb-3">
              <input className="input" placeholder={t('admin.world.id')}         value={wldKey}  onChange={e => setWldKey(e.target.value)} />
              <input className="input" placeholder={t('admin.world.name')}       value={wldName} onChange={e => setWldName(e.target.value)} />
              <input className="input" placeholder={t('admin.world.xpRequired')} value={wldXp}   onChange={e => setWldXp(e.target.value)} />
              <input className="input" placeholder={t('admin.world.mapX')}       value={wldMapX} onChange={e => setWldMapX(e.target.value)} />
              <input className="input" placeholder={t('admin.world.mapY')}       value={wldMapY} onChange={e => setWldMapY(e.target.value)} />
              <input className="input" placeholder={t('admin.world.vehicleItemId')} value={wldVehicle} onChange={e => setWldVehicle(e.target.value)} />
            </div>
            <button className="btn-primary" disabled={wldSaving || !wldKey || !wldName}
              onClick={async () => {
                setWldSaving(true);
                try {
                  const existing = await getWorldDefs();
                  const nextOrder = existing.reduce((mx, w) => Math.max(mx, w.order ?? -1), -1) + 1;
                  await addWorldDef({
                    id: wldKey.trim(), name: wldName.trim(), xpRequired: Number(wldXp) || 0,
                    active: true, createdAt: Date.now(), order: nextOrder,
                    mapId: DEFAULT_MAP_ID, mapX: Number(wldMapX) || 50, mapY: Number(wldMapY) || 50,
                    ...(wldVehicle.trim() ? { vehicleItemId: wldVehicle.trim() } : {}),
                  });
                  setWldKey(''); setWldName(''); setWldXp('500'); setWldMapX('50'); setWldMapY('50'); setWldVehicle('');
                  refreshWorlds();
                } finally {
                  setWldSaving(false);
                }
              }}
            >{wldSaving ? '⏳' : t('admin.actions.add')}</button>


            {allWorlds && (
              <div className="mt-5 pt-4 border-t border-slate-700">
                <h3 className="text-sm font-semibold mb-3">{t('admin.world.list.title')}</h3>
                <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                  {allWorlds.map((w) => <WorldRow key={w.id} world={w} onSaved={refreshWorlds} />)}
                </div>
              </div>
            )}
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">🗺️ {t('admin.map.title')}</h2>
            <p className="text-xs text-slate-400 mb-3">{t('admin.map.hint')}</p>
            <div className="grid md:grid-cols-3 gap-3 mb-3">
              <input className="input" placeholder={t('admin.map.id')}     value={poiKey}  onChange={e => setPoiKey(e.target.value)} />
              <input className="input" placeholder={t('admin.map.name')}   value={poiName} onChange={e => setPoiName(e.target.value)} />
              <input className="input" placeholder={t('admin.map.icon')}   value={poiIcon} onChange={e => setPoiIcon(e.target.value)} />
              <select className="input" value={poiType} onChange={e => setPoiType(e.target.value as MapPoiType)}>
                {POI_TYPES.map(pt => <option key={pt} value={pt}>{t(`admin.map.type.${pt}`)}</option>)}
              </select>
              <input className="input" placeholder={t('admin.map.x')} value={poiX} onChange={e => setPoiX(e.target.value)} />
              <input className="input" placeholder={t('admin.map.y')} value={poiY} onChange={e => setPoiY(e.target.value)} />
              <select className="input" value={poiSeason} onChange={e => setPoiSeason(e.target.value as Season | '')}>
                <option value="">{t('admin.season.allYear')}</option>
                {SEASONS.map(s => <option key={s} value={s}>{SEASON_ICONS[s]} {t(`season.${s}`)}</option>)}
              </select>
            </div>
            <button className="btn-primary" disabled={poiSaving || !poiKey || !poiName}
              onClick={async () => {
                setPoiSaving(true);
                try {
                  const existing = await getMapPoiDefs(DEFAULT_MAP_ID);
                  const nextOrder = existing.reduce((mx, p) => Math.max(mx, p.order ?? -1), -1) + 1;
                  await addMapPoiDef({
                    id: poiKey.trim(), mapId: DEFAULT_MAP_ID, type: poiType, name: poiName.trim(),
                    icon: poiIcon.trim(), x: Number(poiX) || 50, y: Number(poiY) || 50,
                    active: true, createdAt: Date.now(), order: nextOrder,
                    ...(poiSeason ? { season: poiSeason } : {}),
                  });
                  setPoiKey(''); setPoiName(''); setPoiIcon(''); setPoiX('50'); setPoiY('50'); setPoiSeason('');
                  refreshPois();
                } finally {
                  setPoiSaving(false);
                }
              }}
            >{poiSaving ? '⏳' : t('admin.actions.add')}</button>

            {allPois && (
              <div className="mt-5 pt-4 border-t border-slate-700">
                <h3 className="text-sm font-semibold mb-3">{t('admin.map.list.title')}</h3>
                <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                  {allPois.map((p) => (
                    <MapPoiRow key={p.id} poi={p} poiTypes={POI_TYPES} onSaved={refreshPois}
                      onDeleted={() => { removeMapPoiDef(p.id).then(refreshPois); }} />
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.difficulty.title')}</h2>
            <div className="flex gap-3 items-center mb-3">
              <input type="range" min="0" max="100" value={difficulty}
                onChange={e => setDifficulty(e.target.value)} className="flex-1" />
              <span className="w-16 text-center font-bold text-amber-400">{difficulty}/100</span>
              <button className="btn-primary" disabled={isPending}
                onClick={() => writeContract({
                  address: contract, abi: HORIZON_ABI, functionName: 'setDifficulty', args: [Number(difficulty)],
                })}
              >{t('admin.actions.apply')}</button>
            </div>
            <p className="text-xs text-slate-500">{t('admin.difficulty.hint')}</p>
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.weather.title')}</h2>
            <p className="text-xs text-slate-400 mb-3">{t('admin.weather.hint')}</p>
            <div className="flex gap-3 items-center mb-2">
              <select className="input flex-1" value={weather} onChange={e => setWeather(e.target.value)}>
                {WEATHER.map((w, i) => <option key={i} value={i}>{w.emoji} {t(`weather.${WEATHER_KEYS[i]}`)}</option>)}
              </select>
              <button className="btn-primary" disabled={isPending}
                onClick={() => writeContract({
                  address: contract, abi: HORIZON_ABI, functionName: 'setWeather', args: [Number(weather)],
                })}
              >{t('admin.weather.force')}</button>
              <button className="btn-secondary" disabled={isPending}
                onClick={() => writeContract({
                  address: contract, abi: HORIZON_ABI, functionName: 'clearWeatherOverride', args: [],
                })}
              >{t('admin.weather.auto')}</button>
            </div>
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.season.title')}</h2>
            <p className="text-xs text-slate-400 mb-3">{t('admin.season.hint')}</p>
            <p className="text-sm mb-3">
              {t('admin.season.effective')} : <span className="font-bold text-emerald-400">{SEASON_ICONS[effectiveSeason]} {t(`season.${effectiveSeason}`)}</span>
            </p>
            <div className="flex flex-wrap gap-3 items-center mb-2">
              <select className="input" value={seasonMode} onChange={e => setSeasonMode(e.target.value as 'auto' | 'manual')}>
                <option value="auto">{t('admin.season.auto')}</option>
                <option value="manual">{t('admin.season.manual')}</option>
              </select>
              {seasonMode === 'manual' && (
                <select className="input" value={seasonManual} onChange={e => setSeasonManual(e.target.value as Season)}>
                  {SEASONS.map(s => <option key={s} value={s}>{SEASON_ICONS[s]} {t(`season.${s}`)}</option>)}
                </select>
              )}
              <button className="btn-primary" disabled={seasonSaving} onClick={saveSeason}>
                {seasonSaving ? '⏳' : seasonSaved ? '✅' : t('admin.actions.apply')}
              </button>
            </div>
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.moon.title')}</h2>
            <p className="text-xs text-slate-400 mb-3">{t('admin.moon.hint')}</p>
            <p className="text-sm mb-1">
              {t('admin.moon.effective')} : <span className={`font-bold ${isFullMoonNow ? 'text-emerald-400' : 'text-slate-400'}`}>
                {isFullMoonNow ? `🌕 ${t('admin.moon.yes')}` : `🌑 ${t('admin.moon.no')}`}
              </span>
            </p>
            <p className="text-sm mb-3">
              {t('admin.moon.next')} : <span className="font-bold text-sky-300">
                🌕 {nextFullMoonDate ? nextFullMoonDate.toLocaleDateString() : '…'}
              </span>
            </p>
            <div className="flex flex-wrap gap-3 items-center mb-4">
              <select className="input" value={moonMode} onChange={e => setMoonMode(e.target.value as 'auto' | 'manual')}>
                <option value="auto">{t('admin.season.auto')}</option>
                <option value="manual">{t('admin.season.manual')}</option>
              </select>
              {moonMode === 'manual' && (
                <input type="number" min="1" max="31" className="input w-24" value={moonManualDay}
                  onChange={e => setMoonManualDay(e.target.value)} placeholder={t('admin.moon.dayOfMonth')} />
              )}
              <button className="btn-primary" disabled={moonSaving} onClick={saveMoon}>
                {moonSaving ? '⏳' : moonSaved ? '✅' : t('admin.actions.apply')}
              </button>
            </div>
            <h3 className="text-sm font-semibold mb-1">📅 {t('admin.moon.calendarTitle')}</h3>
            <p className="text-xs text-slate-400 mb-2">{t('admin.moon.calendarHint')}</p>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {moonCalendar.map(entry => {
                const first = new Date(entry.year, entry.month0, 1);
                const last = new Date(entry.year, entry.month0 + 1, 0);
                return (
                  <div key={`${entry.year}-${entry.month0}`} className="flex items-center gap-2 bg-slate-900/60 rounded px-2 py-1.5 text-xs">
                    <span className="w-32 shrink-0 capitalize">{entry.date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
                    <span className={`shrink-0 ${entry.overridden ? 'text-amber-400' : 'text-slate-400'}`}>
                      {entry.overridden ? '🔒' : '🔄'} {entry.date.toLocaleDateString()}
                    </span>
                    <input type="date" className="input py-0.5 px-1.5"
                      min={toLocalISODate(first)} max={toLocalISODate(last)}
                      value={toLocalISODate(entry.date)}
                      onChange={e => setMoonCalendarDay(entry, e.target.value)} />
                    {entry.overridden && (
                      <button className="btn-secondary text-xs px-2 py-0.5" onClick={() => resetMoonCalendarDay(entry)}>
                        ↺ {t('admin.moon.reset')}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.npcFreq.title')}</h2>
            <p className="text-xs text-slate-400 mb-3">{t('admin.npcFreq.hint')}</p>
            <div className="flex gap-3 items-center">
              <input type="range" min="1" max="10" value={npcMax}
                onChange={e => setNpcMax(e.target.value)} className="flex-1" />
              <span className="w-20 text-center font-bold text-cyan-400">
                {t('admin.npcFreq.perDay', { v: npcMax })}
              </span>
              <button className="btn-primary" disabled={npcMaxSaving}
                onClick={async () => {
                  setNpcMaxSaving(true);
                  setNpcMaxSaved(false);
                  try {
                    // 100% hors-chaîne (RepRules.npcMaxPerDay) : plus de transaction blockchain
                    // (anciennement setNpcMaxPerDay on-chain), donc gratuit et instantané.
                    await setNpcMaxPerDay(Number(npcMax));
                    setNpcMaxSaved(true);
                    setTimeout(() => setNpcMaxSaved(false), 3000);
                  } finally {
                    setNpcMaxSaving(false);
                  }
                }}
              >{npcMaxSaving ? '⏳' : t('admin.actions.apply')}</button>
            </div>
            {npcMaxSaved && <p className="text-xs text-emerald-400 mt-2">{t('admin.actions.saved')}</p>}
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.price.title')}</h2>
            <div className="grid md:grid-cols-3 gap-3 mb-3">
              <select className="input" value={feedIdx} onChange={e => setFeedIdx(Number(e.target.value))}>
                {FEED_TYPES.map((f, i) => <option key={f} value={i}>{t(`game.feed.${f}`)}</option>)}
              </select>
              <input className="input" placeholder={t('admin.price.value')} value={feedNewPrice} onChange={e => setFeedNewPrice(e.target.value)} />
              <button className="btn-primary" disabled={isPending}
                onClick={() => writeContract({
                  address: contract, abi: HORIZON_ABI, functionName: 'setFeedPrice',
                  args: [feedIdx, parseEther(feedNewPrice)],
                })}
              >{t('admin.actions.apply')}</button>
            </div>
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.cooldowns.title')}</h2>
            <p className="text-sm text-slate-400 mb-3">{t('admin.cooldowns.hint')}</p>
            <div className="grid md:grid-cols-3 gap-3 mb-3">
              <select className="input" value={cooldownIdx} onChange={e => setCooldownIdx(Number(e.target.value))}>
                {FEED_TYPES.map((f, i) => <option key={f} value={i}>{t(`game.feed.${f}`)}</option>)}
              </select>
              <input className="input" placeholder={t('admin.cooldowns.value')} value={cooldownSec} onChange={e => setCooldownSec(e.target.value)} />
              <button className="btn-primary" disabled={isPending}
                onClick={() => writeContract({
                  address: contract, abi: HORIZON_ABI, functionName: 'setFeedCooldown',
                  args: [cooldownIdx, BigInt(cooldownSec)],
                })}
              >{t('admin.actions.apply')}</button>
            </div>
          </section>

          <section className="card flex flex-wrap gap-3">
            <Link href="/game" className="btn-primary">{t('admin.backToGame')}</Link>
            <button className="btn-secondary" onClick={() => writeContract({
              address: contract, abi: HORIZON_ABI, functionName: 'withdraw', args: [],
            })}>{t('admin.actions.withdraw')}</button>
            <button className="btn-danger" onClick={() => writeContract({
              address: contract, abi: HORIZON_ABI, functionName: 'pause', args: [],
            })}>{t('admin.actions.pause')}</button>
            <button className="btn-secondary" onClick={() => writeContract({
              address: contract, abi: HORIZON_ABI, functionName: 'unpause', args: [],
            })}>{t('admin.actions.unpause')}</button>
          </section>
        </div>
      )}

      <style jsx>{`
        .input { background: #1e293b; border: 1px solid #475569; border-radius: 0.375rem; padding: 0.5rem 0.75rem; color: #e2e8f0; }
      `}</style>
    </main>
  );
}

/**
 * Ligne éditable de la liste "Quêtes existantes" (Administration) : type (classique/PNJ), nom de
 * l'énigme, réponse, XP requis/gagné et indice. La sauvegarde ré-écrit intégralement la quête
 * (`addQuestDef` → `set()` Firebase) SANS reporter `i18nKey`/`hintKey` : les libellés/indices
 * édités ici font désormais foi dans toutes les langues (voir `localizeName()`, qui retombe sur
 * `label`/`hint` dès que la clé i18n est absente). La réponse en clair (`answer`) n'est jamais
 * envoyée aux composants de jeu — uniquement lue/écrite ici et dans `getAllQuestAnswers()`.
 */
function QuestRow({ quest, answer, onSaved }: { quest: QuestDef; answer: string; onSaved: () => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [npcGiver, setNpcGiver] = useState(!!quest.npcGiver);
  const [label, setLabel] = useState(quest.label);
  const [ans, setAns] = useState(answer);
  const [xpReq, setXpReq] = useState(String(quest.xpRequired));
  const [xpRew, setXpRew] = useState(String(quest.xpReward));
  const [hint, setHint] = useState(quest.hint ?? '');
  const [season, setSeason] = useState<Season | ''>(quest.season ?? '');
  const [fullMoonOnly, setFullMoonOnly] = useState(!!quest.fullMoonOnly);
  const [fullMoonDate, setFullMoonDate] = useState(quest.fullMoonDate ?? '');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setNpcGiver(!!quest.npcGiver);
    setLabel(quest.label);
    setAns(answer);
    setXpReq(String(quest.xpRequired));
    setXpRew(String(quest.xpReward));
    setHint(quest.hint ?? '');
    setSeason(quest.season ?? '');
    setFullMoonOnly(!!quest.fullMoonOnly);
    setFullMoonDate(quest.fullMoonDate ?? '');
    setEditing(true);
  };

  const save = async () => {
    if (!label.trim() || !ans.trim() || saving) return;
    setSaving(true);
    try {
      await addQuestDef({
        id: quest.id,
        label: label.trim(),
        xpRequired: Number(xpReq) || 0,
        xpReward: Number(xpRew) || 0,
        scoreReward: quest.scoreReward,
        answerHash: hashAnswer(ans),
        active: quest.active,
        createdAt: quest.createdAt,
        order: quest.order,
        ...(hint.trim() ? { hint: hint.trim() } : {}),
        ...(npcGiver ? { npcGiver: true } : {}),
        ...(season ? { season } : {}),
        // Champs "Quêtes du Royaume" NON édités par ce formulaire (kingdomQuest/kingdomChapter/
        // kingdomOrder/mapX/mapY/itemReward) : reportés tels quels depuis `quest` pour éviter que
        // la sauvegarde d'un simple champ (ex. pleine lune ci-dessous) n'efface la position sur la
        // Mapmonde, la récompense en objet ou la place dans la chaîne narrative (voir addQuestDef,
        // qui ré-écrit intégralement le nœud Firebase — `set()`, pas de fusion partielle).
        ...(quest.kingdomQuest ? { kingdomQuest: true } : {}),
        ...(quest.kingdomChapter !== undefined ? { kingdomChapter: quest.kingdomChapter } : {}),
        ...(quest.kingdomOrder !== undefined ? { kingdomOrder: quest.kingdomOrder } : {}),
        ...(quest.mapX !== undefined ? { mapX: quest.mapX } : {}),
        ...(quest.mapY !== undefined ? { mapY: quest.mapY } : {}),
        ...(quest.itemReward ? { itemReward: quest.itemReward } : {}),
        ...(fullMoonOnly ? { fullMoonOnly: true } : {}),
        ...(fullMoonOnly && fullMoonDate ? { fullMoonDate } : {}),
      });
      await seedQuestAnswer(quest.id, normalizeAnswer(ans));
      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="bg-slate-900/80 rounded px-2 py-2 text-xs border border-emerald-700 space-y-2">
        <label className="flex items-center gap-2 text-slate-300">
          <input type="checkbox" checked={npcGiver} onChange={e => setNpcGiver(e.target.checked)} />
          {t('admin.quest.npcGiver')}
        </label>
        <input className="input w-full" placeholder={t('admin.quest.label')} value={label} onChange={e => setLabel(e.target.value)} />
        <input className="input w-full" placeholder={t('admin.quest.answer')} value={ans} onChange={e => setAns(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <input className="input" placeholder={t('admin.quest.xpRequired')} value={xpReq} onChange={e => setXpReq(e.target.value)} />
          <input className="input" placeholder={t('admin.quest.xpReward')} value={xpRew} onChange={e => setXpRew(e.target.value)} />
        </div>
        <input className="input w-full" placeholder={t('admin.quest.hintField')} value={hint} onChange={e => setHint(e.target.value)} />
        <select className="input w-full" value={season} onChange={e => setSeason(e.target.value as Season | '')}>
          <option value="">{t('admin.season.allYear')}</option>
          {SEASONS.map(s => <option key={s} value={s}>{SEASON_ICONS[s]} {t(`season.${s}`)}</option>)}
        </select>
        <label className="flex items-center gap-2 text-slate-300">
          <input type="checkbox" checked={fullMoonOnly} onChange={e => { setFullMoonOnly(e.target.checked); if (!e.target.checked) setFullMoonDate(''); }} />
          🌕 {t('admin.quest.fullMoonOnly')}
        </label>
        {fullMoonOnly && (
          <div className="flex items-center gap-2">
            <input type="date" className="input" value={fullMoonDate} onChange={e => setFullMoonDate(e.target.value)} />
            <span className="text-slate-500">{t('admin.quest.fullMoonDateHint')}</span>
          </div>
        )}
        <div className="flex gap-2">
          <button className="btn-primary text-xs px-3 py-1" disabled={saving || !label.trim() || !ans.trim()} onClick={save}>
            {saving ? '⏳' : t('admin.quest.list.save')}
          </button>
          <button className="btn-secondary text-xs px-3 py-1" disabled={saving} onClick={() => setEditing(false)}>
            {t('admin.quest.list.cancel')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/60 rounded px-2 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className={`shrink-0 font-bold uppercase tracking-wide rounded px-1.5 py-0.5 ${
          quest.npcGiver
            ? 'bg-fuchsia-900/50 text-fuchsia-300 border border-fuchsia-700'
            : 'bg-sky-900/50 text-sky-300 border border-sky-700'
        }`}
        >
          {quest.npcGiver ? t('admin.quest.list.npcBadge') : t('admin.quest.list.classicBadge')}
        </span>
        <span className="flex-1 truncate">{localizeName(t, quest.i18nKey, quest.label)}</span>
        {quest.season && <span className="shrink-0" title={t(`season.${quest.season}`)}>{SEASON_ICONS[quest.season]}</span>}
        {quest.fullMoonOnly && (
          <span className="shrink-0" title={quest.fullMoonDate ? `🌕 ${quest.fullMoonDate}` : t('admin.quest.fullMoonOnly')}>
            🌕{quest.fullMoonDate ? ` ${quest.fullMoonDate}` : ''}
          </span>
        )}
        <span className="shrink-0 text-slate-500">
          {t('admin.quest.xpRequired')} {quest.xpRequired} · +{quest.xpReward} XP
        </span>
        {!quest.active && <span className="shrink-0 text-red-400">{t('admin.quest.list.inactive')}</span>}
        <button className="shrink-0 btn-secondary text-xs px-2 py-0.5" onClick={startEdit}>
          {t('admin.quest.list.edit')}
        </button>
      </div>
      {/* Réponse en clair — réservée à l'Administration, jamais affichée aux joueurs. */}
      <p className="mt-1 text-emerald-400">
        🔑 {t('admin.quest.list.answer')} : <b>{answer || '—'}</b>
      </p>
    </div>
  );
}

/**
 * Ligne éditable de la liste "PNJ existants" (Administration) : nom, dialogue, XP donné et quête
 * liée. 100% hors-chaîne (`addNpcDef` → `set()` Firebase) — remplace l'ancien `addNpc` on-chain
 * qui ne permettait ni mise à jour ni consultation de la liste (create-only, voir HorizonZeldCraft.sol).
 */
function NpcRow({ npc, onSaved }: { npc: NpcDef; onSaved: () => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(npc.name);
  const [dialog, setDialog] = useState(npc.dialog);
  const [xp, setXp] = useState(String(npc.xpReward));
  const [questId, setQuestId] = useState(npc.questId ?? '');
  const [season, setSeason] = useState<Season | ''>(npc.season ?? '');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setName(npc.name); setDialog(npc.dialog); setXp(String(npc.xpReward)); setQuestId(npc.questId ?? '');
    setSeason(npc.season ?? '');
    setEditing(true);
  };

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await addNpcDef({
        id: npc.id, name: name.trim(), dialog: dialog.trim(), xpReward: Number(xp) || 0,
        active: npc.active, createdAt: npc.createdAt, order: npc.order,
        ...(npc.i18nKey ? { i18nKey: npc.i18nKey } : {}),
        ...(questId.trim() ? { questId: questId.trim() } : {}),
        ...(season ? { season } : {}),
      });
      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="bg-slate-900/80 rounded px-2 py-2 text-xs border border-emerald-700 space-y-2">
        <input className="input w-full" placeholder={t('admin.npc.name')} value={name} onChange={e => setName(e.target.value)} />
        <input className="input w-full" placeholder={t('admin.npc.dialog')} value={dialog} onChange={e => setDialog(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <input className="input" placeholder={t('admin.npc.xp')} value={xp} onChange={e => setXp(e.target.value)} />
          <input className="input" placeholder={t('admin.npc.questId')} value={questId} onChange={e => setQuestId(e.target.value)} />
        </div>
        <select className="input w-full" value={season} onChange={e => setSeason(e.target.value as Season | '')}>
          <option value="">{t('admin.season.allYear')}</option>
          {SEASONS.map(s => <option key={s} value={s}>{SEASON_ICONS[s]} {t(`season.${s}`)}</option>)}
        </select>
        <div className="flex gap-2">
          <button className="btn-primary text-xs px-3 py-1" disabled={saving || !name.trim()} onClick={save}>
            {saving ? '⏳' : t('admin.quest.list.save')}
          </button>
          <button className="btn-secondary text-xs px-3 py-1" disabled={saving} onClick={() => setEditing(false)}>
            {t('admin.quest.list.cancel')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/60 rounded px-2 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate">{localizeName(t, npc.i18nKey, npc.name)}</span>
        {npc.season && <span className="shrink-0" title={t(`season.${npc.season}`)}>{SEASON_ICONS[npc.season]}</span>}
        <span className="shrink-0 text-slate-500">+{npc.xpReward} XP</span>
        {!npc.active && <span className="shrink-0 text-red-400">{t('admin.quest.list.inactive')}</span>}
        <button className="shrink-0 btn-secondary text-xs px-2 py-0.5" onClick={startEdit}>
          {t('admin.quest.list.edit')}
        </button>
      </div>
      <p className="mt-1 text-slate-400 italic truncate">&ldquo;{npc.dialog}&rdquo;</p>
    </div>
  );
}

/**
 * Ligne éditable de la liste "Trésors existants" (Administration) : nom, XP requis pour ouvrir
 * et XP octroyé. 100% hors-chaîne — voir TreasureDef/addTreasureDef dans gameState.ts.
 */
function TreasureRow({ treasure, onSaved }: { treasure: TreasureDef; onSaved: () => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(treasure.name);
  const [xpReq, setXpReq] = useState(String(treasure.xpRequired));
  const [xpRew, setXpRew] = useState(String(treasure.xpReward));
  const [season, setSeason] = useState<Season | ''>(treasure.season ?? '');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setName(treasure.name); setXpReq(String(treasure.xpRequired)); setXpRew(String(treasure.xpReward));
    setSeason(treasure.season ?? '');
    setEditing(true);
  };

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await addTreasureDef({
        id: treasure.id, name: name.trim(), xpRequired: Number(xpReq) || 0, xpReward: Number(xpRew) || 0,
        active: treasure.active, createdAt: treasure.createdAt, order: treasure.order,
        ...(treasure.i18nKey ? { i18nKey: treasure.i18nKey } : {}),
        ...(treasure.itemReward ? { itemReward: treasure.itemReward } : {}),
        ...(season ? { season } : {}),
      });
      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="bg-slate-900/80 rounded px-2 py-2 text-xs border border-emerald-700 space-y-2">
        <input className="input w-full" placeholder={t('admin.treasure.name')} value={name} onChange={e => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <input className="input" placeholder={t('admin.treasure.xpRequired')} value={xpReq} onChange={e => setXpReq(e.target.value)} />
          <input className="input" placeholder={t('admin.treasure.xp')} value={xpRew} onChange={e => setXpRew(e.target.value)} />
        </div>
        <select className="input w-full" value={season} onChange={e => setSeason(e.target.value as Season | '')}>
          <option value="">{t('admin.season.allYear')}</option>
          {SEASONS.map(s => <option key={s} value={s}>{SEASON_ICONS[s]} {t(`season.${s}`)}</option>)}
        </select>
        <div className="flex gap-2">
          <button className="btn-primary text-xs px-3 py-1" disabled={saving || !name.trim()} onClick={save}>
            {saving ? '⏳' : t('admin.quest.list.save')}
          </button>
          <button className="btn-secondary text-xs px-3 py-1" disabled={saving} onClick={() => setEditing(false)}>
            {t('admin.quest.list.cancel')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/60 rounded px-2 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate">{localizeName(t, treasure.i18nKey, treasure.name)}</span>
        {treasure.season && <span className="shrink-0" title={t(`season.${treasure.season}`)}>{SEASON_ICONS[treasure.season]}</span>}
        <span className="shrink-0 text-slate-500">
          {t('admin.treasure.xpRequired')} {treasure.xpRequired} · +{treasure.xpReward} XP
        </span>
        {!treasure.active && <span className="shrink-0 text-red-400">{t('admin.quest.list.inactive')}</span>}
        <button className="shrink-0 btn-secondary text-xs px-2 py-0.5" onClick={startEdit}>
          {t('admin.quest.list.edit')}
        </button>
      </div>
    </div>
  );
}

/**
 * Ligne éditable de la liste "Mondes existants" (Administration) : nom et XP requis pour
 * débloquer. 100% hors-chaîne — voir WorldDef/addWorldDef dans gameState.ts.
 */
function WorldRow({ world, onSaved }: { world: WorldDef; onSaved: () => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(world.name);
  const [xpReq, setXpReq] = useState(String(world.xpRequired));
  const [mapX, setMapX] = useState(String(world.mapX ?? 50));
  const [mapY, setMapY] = useState(String(world.mapY ?? 50));
  const [vehicle, setVehicle] = useState(world.vehicleItemId ?? '');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setName(world.name); setXpReq(String(world.xpRequired));
    setMapX(String(world.mapX ?? 50)); setMapY(String(world.mapY ?? 50)); setVehicle(world.vehicleItemId ?? '');
    setEditing(true);
  };

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await addWorldDef({
        id: world.id, name: name.trim(), xpRequired: Number(xpReq) || 0,
        active: world.active, createdAt: world.createdAt, order: world.order,
        ...(world.i18nKey ? { i18nKey: world.i18nKey } : {}),
        mapId: world.mapId ?? DEFAULT_MAP_ID, mapX: Number(mapX) || 50, mapY: Number(mapY) || 50,
        ...(vehicle.trim() ? { vehicleItemId: vehicle.trim() } : {}),
      });
      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="bg-slate-900/80 rounded px-2 py-2 text-xs border border-emerald-700 space-y-2">
        <input className="input w-full" placeholder={t('admin.world.name')} value={name} onChange={e => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <input className="input" placeholder={t('admin.world.xpRequired')} value={xpReq} onChange={e => setXpReq(e.target.value)} />
          <input className="input" placeholder={t('admin.world.vehicleItemId')} value={vehicle} onChange={e => setVehicle(e.target.value)} />
          <input className="input" placeholder={t('admin.world.mapX')} value={mapX} onChange={e => setMapX(e.target.value)} />
          <input className="input" placeholder={t('admin.world.mapY')} value={mapY} onChange={e => setMapY(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button className="btn-primary text-xs px-3 py-1" disabled={saving || !name.trim()} onClick={save}>
            {saving ? '⏳' : t('admin.quest.list.save')}
          </button>
          <button className="btn-secondary text-xs px-3 py-1" disabled={saving} onClick={() => setEditing(false)}>
            {t('admin.quest.list.cancel')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/60 rounded px-2 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate">{localizeName(t, world.i18nKey, world.name)}</span>
        <span className="shrink-0 text-slate-500">{t('admin.world.xpRequired')} {world.xpRequired}</span>
        {world.vehicleItemId && <span className="shrink-0 text-cyan-400">🚗 {world.vehicleItemId}</span>}
        {!world.active && <span className="shrink-0 text-red-400">{t('admin.quest.list.inactive')}</span>}
        <button className="shrink-0 btn-secondary text-xs px-2 py-0.5" onClick={startEdit}>
          {t('admin.quest.list.edit')}
        </button>
      </div>
      <p className="mt-1 text-slate-500">📍 x:{world.mapX ?? 50}% y:{world.mapY ?? 50}%</p>
    </div>
  );
}

/**
 * Ligne éditable de la liste "Carte existants" (Administration) : type, nom, icône, position (%).
 * 100% hors-chaîne — voir MapPoiDef/addMapPoiDef dans gameState.ts.
 */
function MapPoiRow({ poi, poiTypes, onSaved, onDeleted }: {
  poi: MapPoiDef; poiTypes: MapPoiType[]; onSaved: () => void; onDeleted: () => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState<MapPoiType>(poi.type);
  const [name, setName] = useState(poi.name);
  const [icon, setIcon] = useState(poi.icon);
  const [x, setX] = useState(String(poi.x));
  const [y, setY] = useState(String(poi.y));
  const [season, setSeason] = useState<Season | ''>(poi.season ?? '');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setType(poi.type); setName(poi.name); setIcon(poi.icon); setX(String(poi.x)); setY(String(poi.y));
    setSeason(poi.season ?? '');
    setEditing(true);
  };

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await addMapPoiDef({
        id: poi.id, mapId: poi.mapId, type, name: name.trim(), icon: icon.trim(),
        x: Number(x) || 0, y: Number(y) || 0, active: poi.active, createdAt: poi.createdAt, order: poi.order,
        ...(season ? { season } : {}),
      });
      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="bg-slate-900/80 rounded px-2 py-2 text-xs border border-emerald-700 space-y-2">
        <input className="input w-full" placeholder={t('admin.map.name')} value={name} onChange={e => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <input className="input" placeholder={t('admin.map.icon')} value={icon} onChange={e => setIcon(e.target.value)} />
          <select className="input" value={type} onChange={e => setType(e.target.value as MapPoiType)}>
            {poiTypes.map(pt => <option key={pt} value={pt}>{t(`admin.map.type.${pt}`)}</option>)}
          </select>
          <input className="input" placeholder={t('admin.map.x')} value={x} onChange={e => setX(e.target.value)} />
          <input className="input" placeholder={t('admin.map.y')} value={y} onChange={e => setY(e.target.value)} />
        </div>
        <select className="input w-full" value={season} onChange={e => setSeason(e.target.value as Season | '')}>
          <option value="">{t('admin.season.allYear')}</option>
          {SEASONS.map(s => <option key={s} value={s}>{SEASON_ICONS[s]} {t(`season.${s}`)}</option>)}
        </select>
        <div className="flex gap-2">
          <button className="btn-primary text-xs px-3 py-1" disabled={saving || !name.trim()} onClick={save}>
            {saving ? '⏳' : t('admin.quest.list.save')}
          </button>
          <button className="btn-secondary text-xs px-3 py-1" disabled={saving} onClick={() => setEditing(false)}>
            {t('admin.quest.list.cancel')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/60 rounded px-2 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="shrink-0">{poi.icon}</span>
        <span className="flex-1 truncate">{poi.name}</span>
        {poi.season && <span className="shrink-0" title={t(`season.${poi.season}`)}>{SEASON_ICONS[poi.season]}</span>}
        <span className="shrink-0 text-slate-500">{t(`admin.map.type.${poi.type}`)}</span>
        <span className="shrink-0 text-slate-500">x:{poi.x}% y:{poi.y}%</span>
        <button className="shrink-0 btn-secondary text-xs px-2 py-0.5" onClick={startEdit}>
          {t('admin.quest.list.edit')}
        </button>
        <button className="shrink-0 btn-secondary text-xs px-2 py-0.5 text-red-400" onClick={onDeleted} title="Supprimer">✕</button>
      </div>
    </div>
  );
}
