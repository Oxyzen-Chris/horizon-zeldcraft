'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  getAiAnalyticsSettings, setAiAnalyticsSettings, DEFAULT_AI_ANALYTICS_SETTINGS,
  getDauSeries, getRetentionEstimate, getWidgetUsageGlobal, getQuestFunnelGlobal,
  getMapHeatmap, getFaintHeatmap, getFaintCauseBreakdown, getMonetizationOverview,
  getNpcEncounterOverview, getPlayerAnalyticsSummary, listPlayers,
  getAiInsightsCache, setAiInsightsCache, DEFAULT_MAP_ID,
  getPlayerAnalyticsOverride, setPlayerAnalyticsOverride,
  getPlayerWidgetUsageDetail, getPlayerQuestFunnelDetail, getPlayerFaintEventsDetail,
  getMapPoiDefs, getWorldDefs, getQuestDefs,
  type AiAnalyticsSettings, type WidgetUsageAgg, type QuestFunnelSummary, type HeatCell,
  type MonetizationOverview, type PlayerAnalyticsSummary, type AiInsightsCache,
  type PlayerAnalyticsOverride, type PlayerQuestFunnelEntry, type FaintEventRecord,
} from '@/lib/gameState';
import { useI18n, localizeName } from '@/lib/i18n';

/**
 * Banque de noms de zones évocateurs façon lore (« Prairie des 3 cerfs », « Abreuvoir originel de
 * Perrughias »…) utilisée pour rendre la « carte des zones fréquentées » et le « suivi ciblé par
 * joueur » plus lisibles que de simples coordonnées `(gx, gy)`. Un même index (icône ⟷ nom) est
 * partagé par les 4 langues pour garder une identité visuelle cohérente quelle que soit la langue
 * choisie à la connexion — voir `pickFlavorZoneName()` ci-dessous.
 */
const ZONE_ICON_BANK = [
  '🦌', '🏞️', '🌸', '🌳', '🌫️', '🧝', '💧', '🧌', '🐉', '🏝️', '🍃', '🛖', '⛏️', '🐙', '🪨', '👑', '🔥', '🌲', '🔭', '💎', '🐑', '🗼', '🌷', '🏕️',
];
const ZONE_NAME_BANK: Record<string, string[]> = {
  fr: [
    'Prairie des 3 Cerfs', 'Abreuvoir originel de Perrughias', 'Clairière des Lucioles', 'Combe du Vieux Chêne',
    'Sentier des Brumes', 'Bosquet des Elfes Rieurs', 'Confluent des Deux Rivières', 'Val des Trolls Endormis',
    'Crête du Dragon Assoupi', 'Anse du Kraken Placide', 'Fourré des Esprits', 'Camp des Voyageurs',
    'Galerie des Gnomes Bâtisseurs', 'Récif de la Pieuvre Ancienne', 'Éboulis du Vieux Phare', 'Terrasse de la Reine Elfe',
    'Marais des Feux-Follets', 'Pinède Argentée', 'Observatoire des Astronomes', 'Grotte aux Cristaux',
    'Vallon des Bergers', 'Tour du Guet Oubliée', 'Prairie Fleurie de Synk', 'Campement des Nomades',
  ],
  en: [
    'Three Stags Meadow', 'Perrughias\' First Spring', 'Firefly Glade', 'Old Oak Hollow',
    'Mist Trail', 'Laughing Elves Grove', 'Twin Rivers Confluence', 'Sleeping Trolls Vale',
    'Slumbering Dragon Ridge', 'Placid Kraken Cove', 'Spirit Thicket', 'Wanderers\' Camp',
    'Gnome Builders Gallery', 'Ancient Octopus Reef', 'Old Lighthouse Scree', 'Elf Queen\'s Terrace',
    'Will-o\'-the-Wisp Marsh', 'Silver Pine Forest', 'Astronomers\' Observatory', 'Crystal Cave',
    'Shepherds\' Vale', 'Forgotten Watchtower', 'Synk\'s Blooming Meadow', 'Nomads\' Encampment',
  ],
  es: [
    'Pradera de los 3 Ciervos', 'Manantial originario de Perrughias', 'Claro de las Luciérnagas', 'Hondonada del Viejo Roble',
    'Sendero de las Brumas', 'Bosquecillo de los Elfos Risueños', 'Confluencia de los Dos Ríos', 'Valle de los Trolls Dormidos',
    'Cresta del Dragón Dormido', 'Cala del Kraken Apacible', 'Espesura de los Espíritus', 'Campamento de los Viajeros',
    'Galería de los Gnomos Constructores', 'Arrecife del Pulpo Antiguo', 'Pedregal del Viejo Faro', 'Terraza de la Reina Elfa',
    'Pantano de los Fuegos Fatuos', 'Pinar Plateado', 'Observatorio de los Astrónomos', 'Cueva de Cristal',
    'Valle de los Pastores', 'Torre de Vigía Olvidada', 'Pradera Florida de Synk', 'Campamento Nómada',
  ],
  pt: [
    'Prado dos 3 Cervos', 'Nascente original de Perrughias', 'Clareira dos Vaga-lumes', 'Vale do Velho Carvalho',
    'Trilha das Brumas', 'Bosque dos Elfos Risonhos', 'Confluência dos Dois Rios', 'Vale dos Trols Adormecidos',
    'Crista do Dragão Adormecido', 'Enseada do Kraken Plácido', 'Mata dos Espíritos', 'Acampamento dos Viajantes',
    'Galeria dos Gnomos Construtores', 'Recife do Polvo Antigo', 'Pedregulho do Velho Farol', 'Terraço da Rainha Élfica',
    'Pântano dos Fogos-Fátuos', 'Pinhal Prateado', 'Observatório dos Astrônomos', 'Gruta de Cristal',
    'Vale dos Pastores', 'Torre de Vigia Esquecida', 'Prado Florido de Synk', 'Acampamento Nômade',
  ],
};

/** Hash déterministe simple (aucune dépendance) : la même case (gx,gy) donne toujours le même nom
 * de zone « inventé » — stable entre deux rafraîchissements tant qu'aucune quête/PNJ/monde connu
 * ne se trouve à proximité (auquel cas ce landmark réel est utilisé à la place, voir plus bas). */
function zoneHash(gx: number, gy: number): number {
  return Math.abs((gx * 73_856_093) ^ (gy * 19_349_663));
}

interface MapLandmark { name: string; x: number; y: number; icon?: string }

/**
 * Nom lisible d'une case de heatmap `(gx, gy)` : si une quête/PNJ/monde/POI actif de la carte se
 * trouve à proximité du centre de la case, on reprend directement son nom (« lié aux quêtes, etc. »
 * — demande explicite) ; sinon on pioche un nom de zone évocateur dans la banque ci-dessus, stable
 * pour cette case. Retourne aussi une icône (mini « bitmap » visuel de la zone).
 */
function zoneLabelForCell(
  gx: number, gy: number, gridSize: number, landmarks: MapLandmark[], locale: string,
): { name: string; icon: string } {
  const cx = gx * gridSize + gridSize / 2;
  const cy = gy * gridSize + gridSize / 2;
  let nearest: MapLandmark | null = null;
  let nearestDist = Infinity;
  for (const lm of landmarks) {
    const d = Math.hypot(lm.x - cx, lm.y - cy);
    if (d < nearestDist) { nearestDist = d; nearest = lm; }
  }
  // Rayon de rattachement : la case doit être "collée" au landmark réel pour reprendre son nom —
  // au-delà, mieux vaut un nom de zone inventé que d'attribuer arbitrairement le nom d'un point
  // d'intérêt lointain à une case sans rapport.
  if (nearest && nearestDist <= gridSize * 1.2) {
    return { name: nearest.name, icon: nearest.icon ?? '📍' };
  }
  const bank = ZONE_NAME_BANK[locale] ?? ZONE_NAME_BANK.fr;
  const idx = zoneHash(gx, gy) % bank.length;
  return { name: bank[idx], icon: ZONE_ICON_BANK[idx % ZONE_ICON_BANK.length] };
}

/** Idem `zoneLabelForCell` mais à partir d'une position exacte `(x, y)` en % (pas d'une case de
 * heatmap agrégée) — utilisé par le « suivi ciblé par joueur » (évanouissements individuels). */
function zoneLabelForPosition(
  x: number, y: number, gridSize: number, landmarks: MapLandmark[], locale: string,
): { name: string; icon: string } {
  return zoneLabelForCell(Math.floor(x / Math.max(1, gridSize)), Math.floor(y / Math.max(1, gridSize)), gridSize, landmarks, locale);
}

/** Petite barre horizontale (0-100%) — pas de dépendance à une lib de graphiques (aucune installée
 * dans le projet, voir package.json), cohérent avec `ProgressBar` (ProgressLedgerView.tsx). */
function Bar({ pct, color = 'bg-cyan-500' }: { pct: number; color?: string }) {
  return (
    <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

function CollapsibleSection({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="border border-slate-700 rounded-lg overflow-hidden">
      <button className="w-full flex items-center gap-2 px-3 py-2 bg-slate-800/60 hover:bg-slate-800 text-left" onClick={() => setOpen(o => !o)}>
        <span>{open ? '▾' : '▸'}</span>
        <span className="text-sm font-semibold">{title}</span>
      </button>
      {open && <div className="p-3 space-y-3">{children}</div>}
    </div>
  );
}

function fmtAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function fmtMs(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${(min / 60).toFixed(1)} h`;
}

interface Snapshot {
  dau: { day: string; count: number }[];
  retention7: { cohort: number; retained: number; pct: number };
  retention30: { cohort: number; retained: number; pct: number };
  totalPlayers: number;
  widgetUsage: Record<string, WidgetUsageAgg>;
  questFunnel: QuestFunnelSummary[];
  mapHeatmap: HeatCell[];
  faintHeatmap: HeatCell[];
  faintCause: { oxygen: number; fatigue: number };
  monetization: MonetizationOverview;
  npcOverview: { byOffer: Record<string, number>; byOutcome: Record<string, number>; total: number };
  players: PlayerAnalyticsSummary[];
}

/**
 * Panneau admin « 🤖 Intelligence IA GamePlay » — analyse fine et évolutive du comportement des
 * joueurs (habitudes, parcours, temps passé/perdu par zone) + assistant IA basé sur un LLM
 * 100% GRATUIT (voir web/src/app/api/ai/insights/route.ts). Toutes les données affichées ici sont
 * lues via des fonctions `gameState.ts` dédiées (voir section « Intelligence IA GamePlay » de ce
 * fichier) — aucune nouvelle dépendance npm, uniquement des visualisations CSS/Tailwind.
 */
export function AiGameplayIntelligencePanel() {
  const { t, locale } = useI18n();
  const [settings, setSettings] = useState<AiAnalyticsSettings>(DEFAULT_AI_ANALYTICS_SETTINGS);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsFeedback, setSettingsFeedback] = useState<string | null>(null);

  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [landmarks, setLandmarks] = useState<MapLandmark[]>([]);

  const [insights, setInsights] = useState<AiInsightsCache | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // ─── Suivi ciblé par joueur (opt-in/opt-out individuel + focus d'analyse) ───
  const [focusAddress, setFocusAddress] = useState('');
  const [focusOverride, setFocusOverride] = useState<PlayerAnalyticsOverride>('default');
  const [focusOverrideLoading, setFocusOverrideLoading] = useState(false);
  const [focusOverrideFeedback, setFocusOverrideFeedback] = useState<string | null>(null);
  const [focusSummary, setFocusSummary] = useState<PlayerAnalyticsSummary | null>(null);
  const [focusWidgets, setFocusWidgets] = useState<Record<string, WidgetUsageAgg>>({});
  const [focusQuests, setFocusQuests] = useState<PlayerQuestFunnelEntry[]>([]);
  const [focusFaints, setFocusFaints] = useState<FaintEventRecord[]>([]);
  const [focusLoading, setFocusLoading] = useState(false);
  const [focusLoaded, setFocusLoaded] = useState(false);
  const [allAddresses, setAllAddresses] = useState<string[]>([]);

  useEffect(() => { getAiAnalyticsSettings().then(setSettings).catch(() => {}); }, []);
  useEffect(() => { getAiInsightsCache().then(setInsights).catch(() => {}); }, []);

  const analyzeFocusPlayer = async () => {
    const addr = focusAddress.trim();
    if (!addr) return;
    setFocusLoading(true);
    setFocusOverrideFeedback(null);
    try {
      const [override, summary, widgets, quests, faints] = await Promise.all([
        getPlayerAnalyticsOverride(addr),
        getPlayerAnalyticsSummary(addr),
        getPlayerWidgetUsageDetail(addr),
        getPlayerQuestFunnelDetail(addr, 30),
        getPlayerFaintEventsDetail(addr, 30),
      ]);
      setFocusOverride(override);
      setFocusSummary(summary);
      setFocusWidgets(widgets);
      setFocusQuests(quests);
      setFocusFaints(faints);
      setFocusLoaded(true);
    } finally {
      setFocusLoading(false);
    }
  };

  const applyFocusOverride = async (value: PlayerAnalyticsOverride) => {
    const addr = focusAddress.trim();
    if (!addr) return;
    setFocusOverrideLoading(true);
    try {
      await setPlayerAnalyticsOverride(addr, value);
      setFocusOverride(value);
      setFocusOverrideFeedback('✅ ' + t('common.success'));
    } catch (e: any) {
      setFocusOverrideFeedback('❌ ' + (e?.message ?? 'error'));
    } finally {
      setFocusOverrideLoading(false);
      setTimeout(() => setFocusOverrideFeedback(null), 2500);
    }
  };

  const loadSnapshot = async () => {
    setLoading(true);
    try {
      const players = await listPlayers().catch(() => []);
      setAllAddresses(players);
      const [
        dau, retention7, retention30, widgetUsage, questFunnel, mapHeatmap, faintHeatmap,
        faintCause, monetization, npcOverview, pois, worlds, quests,
      ] = await Promise.all([
        getDauSeries(14), getRetentionEstimate(7), getRetentionEstimate(30),
        getWidgetUsageGlobal(), getQuestFunnelGlobal(),
        getMapHeatmap(DEFAULT_MAP_ID), getFaintHeatmap(DEFAULT_MAP_ID), getFaintCauseBreakdown(),
        getMonetizationOverview(), getNpcEncounterOverview(),
        getMapPoiDefs(DEFAULT_MAP_ID).catch(() => []), getWorldDefs().catch(() => []), getQuestDefs().catch(() => []),
      ]);
      // Points de repère réels (POI décoratifs, portails de monde, quêtes positionnées sur la
      // mapmonde) utilisés pour nommer les zones fréquentées par leur nom véritable plutôt qu'un
      // nom inventé quand ils sont assez proches (voir zoneLabelForCell ci-dessus).
      const lm: MapLandmark[] = [
        ...pois.filter(p => p.active).map(p => ({ name: p.name, x: p.x, y: p.y, icon: p.icon })),
        ...worlds.filter(w => w.active && w.mapX != null && w.mapY != null)
          .map(w => ({ name: localizeName(t, w.i18nKey, w.name), x: w.mapX as number, y: w.mapY as number, icon: '🌀' })),
        ...quests.filter(q => q.active && q.kingdomQuest && q.mapX != null && q.mapY != null)
          .map(q => ({ name: localizeName(t, q.i18nKey, q.label), x: q.mapX as number, y: q.mapY as number, icon: '📜' })),
      ];
      setLandmarks(lm);
      // Score de décrochage par joueur — échantillon plafonné à 50 pour rester réactif (voir
      // getPlayerAnalyticsSummary, même logique de coût que PlayerStats).
      const sample = players.slice(0, 50);
      const summaries = await Promise.all(sample.map(a => getPlayerAnalyticsSummary(a).catch(() => null)));
      const playerSummaries = summaries.filter((s): s is PlayerAnalyticsSummary => !!s)
        .sort((a, b) => b.churnScore - a.churnScore);
      setSnap({
        dau, retention7, retention30, totalPlayers: players.length, widgetUsage, questFunnel,
        mapHeatmap, faintHeatmap, faintCause, monetization, npcOverview, players: playerSummaries,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSnapshot(); }, []);

  const setNum = (k: keyof AiAnalyticsSettings, v: string) => {
    const n = parseFloat(v);
    setSettings(prev => ({ ...prev, [k]: isNaN(n) ? 0 : n }));
  };
  const setBool = (k: keyof AiAnalyticsSettings, v: boolean) => setSettings(prev => ({ ...prev, [k]: v }));

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      await setAiAnalyticsSettings(settings);
      setSettingsFeedback('✅ ' + t('common.success'));
    } catch (e: any) {
      setSettingsFeedback('❌ ' + (e?.message ?? 'error'));
    } finally {
      setSavingSettings(false);
      setTimeout(() => setSettingsFeedback(null), 2500);
    }
  };

  const widgetRows = useMemo(() => {
    if (!snap) return [];
    const entries = Object.entries(snap.widgetUsage);
    const maxMs = Math.max(1, ...entries.map(([, v]) => v.totalMs));
    return entries.map(([id, v]) => ({ id, ...v, pct: Math.round((v.totalMs / maxMs) * 100) }))
      .sort((a, b) => b.totalMs - a.totalMs);
  }, [snap]);

  const cooldownRemainingH = useMemo(() => {
    if (!insights) return 0;
    const elapsedH = (Date.now() - insights.generatedAt) / 3_600_000;
    return Math.max(0, settings.aiAutoRefreshHours - elapsedH);
  }, [insights, settings.aiAutoRefreshHours]);

  const generateInsights = async () => {
    if (!snap) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const statsPayload = {
        totalPlayers: snap.totalPlayers,
        dauLast14Days: snap.dau,
        retention7d: snap.retention7,
        retention30d: snap.retention30,
        widgetUsage: widgetRows.map(w => ({ widget: w.id, opens: w.opens, totalMinutes: Math.round(w.totalMs / 60000) })),
        questFunnel: snap.questFunnel.slice(0, 20),
        topMapHeatCells: snap.mapHeatmap.slice(0, 15).map(c => ({ ...c, zone: zoneLabelForCell(c.gx, c.gy, settings.mapHeatmapGridSize, landmarks, locale).name })),
        topFaintHeatCells: snap.faintHeatmap.slice(0, 15).map(c => ({ ...c, zone: zoneLabelForCell(c.gx, c.gy, settings.mapHeatmapGridSize, landmarks, locale).name })),
        faintCauseBreakdown: snap.faintCause,
        monetization: snap.monetization,
        npcEncounterOverview: snap.npcOverview,
        avgChurnScore: snap.players.length ? Math.round(snap.players.reduce((s, p) => s + p.churnScore, 0) / snap.players.length) : 0,
        highRiskPlayers: snap.players.filter(p => p.churnScore >= 60).length,
      };
      const res = await fetch('/api/ai/insights', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stats: statsPayload, locale, model: settings.aiModel, provider: settings.aiProvider }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiError(data?.message || t('admin.aiGameplay.ai.error'));
        return;
      }
      const cache: AiInsightsCache = {
        text: data.text,
        generatedAt: data.generatedAt ?? Date.now(),
        model: data.model ?? settings.aiModel,
        provider: data.provider === 'groq' ? 'groq' : 'gemini',
      };
      await setAiInsightsCache(cache);
      setInsights(cache);
    } catch (e: any) {
      setAiError(e?.message || t('admin.aiGameplay.ai.error'));
    } finally {
      setAiLoading(false);
    }
  };

  const maxDau = snap ? Math.max(1, ...snap.dau.map(d => d.count)) : 1;
  const maxHeat = snap ? Math.max(1, ...snap.mapHeatmap.map(c => c.count)) : 1;
  const maxFaintHeat = snap ? Math.max(1, ...snap.faintHeatmap.map(c => c.count)) : 1;

  return (
    <section className="card">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-xl font-semibold">🤖 {t('admin.aiGameplay.title')}</h2>
        <button className="btn-secondary text-xs" disabled={loading} onClick={loadSnapshot}>
          {loading ? '⏳' : '🔄'} {t('admin.aiGameplay.refresh')}
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-4">{t('admin.aiGameplay.hint')}</p>

      {!snap ? (
        <p className="text-sm text-slate-400">⏳ {t('common.loading')}</p>
      ) : (
        <div className="space-y-3">
          <CollapsibleSection title={`📊 ${t('admin.aiGameplay.overview.title')}`} defaultOpen>
            <div className="grid md:grid-cols-3 gap-3">
              <div className="bg-slate-800/60 rounded-lg p-3">
                <p className="text-xs text-slate-400">{t('admin.aiGameplay.overview.totalPlayers')}</p>
                <p className="text-2xl font-bold text-cyan-400">{snap.totalPlayers}</p>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-3">
                <p className="text-xs text-slate-400">{t('admin.aiGameplay.overview.retention7')}</p>
                <p className="text-2xl font-bold text-emerald-400">{snap.retention7.pct}%</p>
                <p className="text-[10px] text-slate-500">{t('admin.aiGameplay.overview.cohort', { n: snap.retention7.cohort })}</p>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-3">
                <p className="text-xs text-slate-400">{t('admin.aiGameplay.overview.retention30')}</p>
                <p className="text-2xl font-bold text-amber-400">{snap.retention30.pct}%</p>
                <p className="text-[10px] text-slate-500">{t('admin.aiGameplay.overview.cohort', { n: snap.retention30.cohort })}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-1">{t('admin.aiGameplay.overview.dauChart')}</p>
              <div className="flex items-end gap-1 h-20">
                {snap.dau.map(d => (
                  <div key={d.day} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${d.day}: ${d.count}`}>
                    <div className="w-full bg-cyan-500 rounded-t" style={{ height: `${Math.max(2, (d.count / maxDau) * 100)}%` }} />
                  </div>
                ))}
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title={`🎯 ${t('admin.aiGameplay.playerFocus.title')}`}>
            <p className="text-xs text-slate-500 mb-2">{t('admin.aiGameplay.playerFocus.hint')}</p>
            <div className="flex flex-wrap items-end gap-2 mb-3">
              <label className="text-xs flex flex-col gap-1 flex-1 min-w-[220px]">
                {t('admin.aiGameplay.playerFocus.addressLabel')}
                <input
                  className="input"
                  list="ai-gameplay-focus-players"
                  placeholder={t('admin.aiGameplay.playerFocus.addressPlaceholder')}
                  value={focusAddress}
                  onChange={e => { setFocusAddress(e.target.value); setFocusLoaded(false); }}
                />
                <datalist id="ai-gameplay-focus-players">
                  {allAddresses.map(a => <option key={a} value={a} />)}
                </datalist>
              </label>
              <button className="btn-primary text-xs" disabled={!focusAddress.trim() || focusLoading} onClick={analyzeFocusPlayer}>
                {focusLoading ? '⏳' : '🔍'} {t('admin.aiGameplay.playerFocus.analyze')}
              </button>
            </div>

            {focusLoaded && (
              <>
                <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
                  <span className="text-slate-400">{t('admin.aiGameplay.playerFocus.status')} :</span>
                  <span className={`px-2 py-0.5 rounded-full font-semibold ${
                    focusOverride === 'enabled' ? 'bg-emerald-600/30 text-emerald-300' :
                    focusOverride === 'disabled' ? 'bg-rose-600/30 text-rose-300' :
                    'bg-slate-700 text-slate-300'
                  }`}>
                    {focusOverride === 'enabled' ? t('admin.aiGameplay.playerFocus.statusEnabled')
                      : focusOverride === 'disabled' ? t('admin.aiGameplay.playerFocus.statusDisabled')
                      : t('admin.aiGameplay.playerFocus.statusDefault')}
                  </span>
                  <button className="btn-secondary text-xs" disabled={focusOverrideLoading} onClick={() => applyFocusOverride('enabled')}>
                    ✅ {t('admin.aiGameplay.playerFocus.forceEnable')}
                  </button>
                  <button className="btn-secondary text-xs" disabled={focusOverrideLoading} onClick={() => applyFocusOverride('disabled')}>
                    🚫 {t('admin.aiGameplay.playerFocus.forceDisable')}
                  </button>
                  <button className="btn-secondary text-xs" disabled={focusOverrideLoading} onClick={() => applyFocusOverride('default')}>
                    ↩️ {t('admin.aiGameplay.playerFocus.reset')}
                  </button>
                  {focusOverrideFeedback && <span>{focusOverrideFeedback}</span>}
                </div>

                {focusSummary && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-xs">
                    <div className="bg-slate-800/60 rounded-lg p-2">
                      <p className="text-slate-400">{t('admin.aiGameplay.playerFocus.churnScore')}</p>
                      <p className="text-lg font-bold">{focusSummary.churnScore}</p>
                    </div>
                    <div className="bg-slate-800/60 rounded-lg p-2">
                      <p className="text-slate-400">{t('admin.aiGameplay.playerFocus.daysActive30')}</p>
                      <p className="text-lg font-bold">{focusSummary.daysActiveLast30}</p>
                    </div>
                    <div className="bg-slate-800/60 rounded-lg p-2">
                      <p className="text-slate-400">{t('admin.aiGameplay.playerFocus.lastSeen')}</p>
                      <p className="text-sm font-semibold">{focusSummary.lastSeenAt ? new Date(focusSummary.lastSeenAt).toLocaleString() : '—'}</p>
                    </div>
                    <div className="bg-slate-800/60 rounded-lg p-2">
                      <p className="text-slate-400">{t('admin.aiGameplay.playerFocus.totalWidgetTime')}</p>
                      <p className="text-lg font-bold">{fmtMs(focusSummary.totalWidgetTimeMs)}</p>
                    </div>
                  </div>
                )}

                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-slate-400 mb-1">{t('admin.aiGameplay.playerFocus.widgetTimes')}</p>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {Object.entries(focusWidgets).sort((a, b) => b[1].totalMs - a[1].totalMs).map(([id, v]) => (
                        <div key={id} className="flex items-center gap-2 text-[11px]">
                          <span className="w-32 truncate text-slate-300" title={id}>{id}</span>
                          <span className="text-slate-400">{fmtMs(v.totalMs)} · {v.opens}×</span>
                        </div>
                      ))}
                      {Object.keys(focusWidgets).length === 0 && <p className="text-xs text-slate-500 italic">{t('admin.aiGameplay.empty')}</p>}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-1">{t('admin.aiGameplay.playerFocus.questEvents')}</p>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {focusQuests.map((q, i) => (
                        <div key={i} className="flex items-center gap-2 text-[11px]">
                          <span className={q.event === 'solved' ? 'text-emerald-400' : q.event === 'fail' ? 'text-rose-400' : 'text-amber-400'}>
                            {q.event === 'solved' ? '✅' : q.event === 'fail' ? '❌' : '🔒'}
                          </span>
                          <span className="w-24 truncate text-slate-300" title={q.questId}>{q.questId}</span>
                          <span className="text-slate-500">{q.category} · {new Date(q.timestamp).toLocaleDateString()}</span>
                        </div>
                      ))}
                      {focusQuests.length === 0 && <p className="text-xs text-slate-500 italic">{t('admin.aiGameplay.empty')}</p>}
                    </div>
                  </div>
                </div>

                <div className="mt-2">
                  <p className="text-xs text-slate-400 mb-1">{t('admin.aiGameplay.playerFocus.faintEvents')}</p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {focusFaints.map((f, i) => {
                      const zone = zoneLabelForPosition(f.x, f.y, settings.mapHeatmapGridSize, landmarks, locale);
                      return (
                        <div key={i} className="flex items-center gap-2 text-[11px]">
                          <span>{f.cause === 'oxygen' ? '💧' : '😮‍💨'}</span>
                          <span className="text-slate-300" title={`${f.mapId} (${f.x}, ${f.y})`}>{zone.icon} {zone.name}</span>
                          <span className="text-slate-500">{new Date(f.timestamp).toLocaleString()}</span>
                        </div>
                      );
                    })}
                    {focusFaints.length === 0 && <p className="text-xs text-slate-500 italic">{t('admin.aiGameplay.empty')}</p>}
                  </div>
                </div>
              </>
            )}
          </CollapsibleSection>

          <CollapsibleSection title={`🪟 ${t('admin.aiGameplay.widgets.title')}`}>
            {widgetRows.length === 0 && <p className="text-xs text-slate-500 italic">{t('admin.aiGameplay.empty')}</p>}
            {widgetRows.map(w => (
              <div key={w.id} className="flex items-center gap-2 text-xs">
                <span className="w-40 truncate text-slate-300" title={w.id}>{w.id}</span>
                <Bar pct={w.pct} />
                <span className="w-24 shrink-0 text-slate-400 text-right">{fmtMs(w.totalMs)} · {w.opens}×</span>
              </div>
            ))}
          </CollapsibleSection>

          <CollapsibleSection title={`🧩 ${t('admin.aiGameplay.questFunnel.title')}`}>
            {snap.questFunnel.length === 0 && <p className="text-xs text-slate-500 italic">{t('admin.aiGameplay.empty')}</p>}
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {snap.questFunnel.slice(0, 25).map(q => {
                const total = q.blocked + q.fail + q.solved;
                const convPct = total > 0 ? Math.round((q.solved / total) * 100) : 0;
                return (
                  <div key={q.questId} className="flex items-center gap-2 text-xs">
                    <span className="w-32 truncate text-slate-300" title={q.questId}>{q.questId}</span>
                    <Bar pct={convPct} color="bg-emerald-500" />
                    <span className="w-40 shrink-0 text-slate-400 text-right">
                      ✅{q.solved} · ❌{q.fail} · 🔒{q.blocked}
                    </span>
                  </div>
                );
              })}
            </div>
          </CollapsibleSection>

          <CollapsibleSection title={`🗺️ ${t('admin.aiGameplay.heatmap.title')}`}>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-slate-400 mb-1">{t('admin.aiGameplay.heatmap.map')}</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {snap.mapHeatmap.slice(0, 12).map(c => {
                    const zone = zoneLabelForCell(c.gx, c.gy, settings.mapHeatmapGridSize, landmarks, locale);
                    return (
                      <div key={`${c.gx}_${c.gy}`} className="flex items-center gap-2 text-xs">
                        <span className="w-32 shrink-0 truncate text-slate-300" title={`(${c.gx},${c.gy})`}>{zone.icon} {zone.name}</span>
                        <Bar pct={(c.count / maxHeat) * 100} />
                        <span className="w-10 text-right text-slate-400">{c.count}</span>
                      </div>
                    );
                  })}
                  {snap.mapHeatmap.length === 0 && <p className="text-xs text-slate-500 italic">{t('admin.aiGameplay.empty')}</p>}
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">{t('admin.aiGameplay.heatmap.faint')}</p>
                <p className="text-[11px] text-slate-500 mb-1">
                  💧 {snap.faintCause.oxygen} · 🥵 {snap.faintCause.fatigue}
                </p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {snap.faintHeatmap.slice(0, 10).map(c => {
                    const zone = zoneLabelForCell(c.gx, c.gy, settings.mapHeatmapGridSize, landmarks, locale);
                    return (
                      <div key={`${c.gx}_${c.gy}`} className="flex items-center gap-2 text-xs">
                        <span className="w-32 shrink-0 truncate text-slate-300" title={`(${c.gx},${c.gy})`}>{zone.icon} {zone.name}</span>
                        <Bar pct={(c.count / maxFaintHeat) * 100} color="bg-rose-500" />
                        <span className="w-10 text-right text-slate-400">{c.count}</span>
                      </div>
                    );
                  })}
                  {snap.faintHeatmap.length === 0 && <p className="text-xs text-slate-500 italic">{t('admin.aiGameplay.empty')}</p>}
                </div>
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title={`⚠️ ${t('admin.aiGameplay.churn.title')}`}>
            <p className="text-[11px] text-slate-500 mb-2">{t('admin.aiGameplay.churn.hint')}</p>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {snap.players.slice(0, 25).map(p => (
                <div key={p.address} className="flex items-center gap-2 text-xs">
                  <span className="w-28 truncate text-slate-300" title={p.address}>{fmtAddr(p.address)}</span>
                  <Bar pct={p.churnScore} color={p.churnScore >= 60 ? 'bg-rose-500' : p.churnScore >= 30 ? 'bg-amber-500' : 'bg-emerald-500'} />
                  <span className="w-10 text-right font-semibold">{p.churnScore}</span>
                  <span className="w-48 shrink-0 text-slate-500 text-[10px]">
                    {t('admin.aiGameplay.churn.days30', { n: p.daysActiveLast30 })} · ✅{p.questSolved} ❌{p.questFail} 🔒{p.questBlocked} · 💫{p.faintCount}
                  </span>
                </div>
              ))}
              {snap.players.length === 0 && <p className="text-xs text-slate-500 italic">{t('admin.aiGameplay.empty')}</p>}
            </div>
          </CollapsibleSection>

          <CollapsibleSection title={`💰 ${t('admin.aiGameplay.monetization.title')}`}>
            <div className="grid md:grid-cols-3 gap-3 mb-2">
              <div className="bg-slate-800/60 rounded-lg p-3">
                <p className="text-xs text-slate-400">{t('admin.aiGameplay.monetization.confirmed')}</p>
                <p className="text-xl font-bold text-emerald-400">{snap.monetization.totalConfirmed}</p>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-3">
                <p className="text-xs text-slate-400">{t('admin.aiGameplay.monetization.failed')}</p>
                <p className="text-xl font-bold text-rose-400">{snap.monetization.totalFailed}</p>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-3">
                <p className="text-xs text-slate-400">{t('admin.aiGameplay.monetization.ethApprox')}</p>
                <p className="text-xl font-bold text-amber-400">{snap.monetization.totalEthSpentApprox.toFixed(6)} ETH</p>
              </div>
            </div>
            <div className="space-y-1">
              {Object.entries(snap.monetization.byType).map(([type, count]) => (
                <div key={type} className="flex items-center gap-2 text-xs">
                  <span className="w-20 text-slate-300">{type}</span>
                  <Bar pct={(count / Math.max(1, snap.monetization.totalConfirmed)) * 100} color="bg-amber-500" />
                  <span className="w-10 text-right text-slate-400">{count}</span>
                </div>
              ))}
            </div>
          </CollapsibleSection>

          <CollapsibleSection title={`🧙 ${t('admin.aiGameplay.npc.title')}`}>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-slate-400 mb-1">{t('admin.aiGameplay.npc.byOffer')}</p>
                {Object.entries(snap.npcOverview.byOffer).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 text-xs">
                    <span className="w-16 text-slate-300">{k}</span>
                    <Bar pct={(v / Math.max(1, snap.npcOverview.total)) * 100} />
                    <span className="w-10 text-right text-slate-400">{v}</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">{t('admin.aiGameplay.npc.byOutcome')}</p>
                {Object.entries(snap.npcOverview.byOutcome).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 text-xs">
                    <span className="w-16 text-slate-300">{k}</span>
                    <Bar pct={(v / Math.max(1, snap.npcOverview.total)) * 100} color="bg-fuchsia-500" />
                    <span className="w-10 text-right text-slate-400">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title={`✨ ${t('admin.aiGameplay.ai.title')}`} defaultOpen>
            <p className="text-xs text-slate-500">{t('admin.aiGameplay.ai.hint')}</p>
            {!settings.aiEnabled ? (
              <p className="text-xs text-amber-400">⚠️ {t('admin.aiGameplay.ai.disabled')}</p>
            ) : (
              <>
                <button
                  className="btn-primary text-xs"
                  disabled={aiLoading || cooldownRemainingH > 0}
                  onClick={generateInsights}
                >
                  {aiLoading ? '⏳' : '✨'} {t('admin.aiGameplay.ai.generate')}
                </button>
                {cooldownRemainingH > 0 && (
                  <p className="text-[11px] text-slate-500 mt-1">{t('admin.aiGameplay.ai.cooldown', { h: cooldownRemainingH.toFixed(1) })}</p>
                )}
                {aiError && <p className="text-xs text-rose-400 mt-2">❌ {aiError}</p>}
                {insights && (
                  <div className="mt-3 bg-slate-800/60 rounded-lg p-3">
                    <p className="text-[10px] text-slate-500 mb-2">
                      {t('admin.aiGameplay.ai.generatedAt', { date: new Date(insights.generatedAt).toLocaleString(), model: insights.model })}
                      {insights.provider
                        ? ` · ${
                            { gemini: 'Google Gemini', groq: 'Groq', cerebras: 'Cerebras', openrouter: 'OpenRouter' }[
                              insights.provider as 'gemini' | 'groq' | 'cerebras' | 'openrouter'
                            ] ?? insights.provider
                          }`
                        : ''}
                    </p>
                    <pre className="text-xs text-slate-300 whitespace-pre-wrap font-sans">{insights.text}</pre>
                  </div>
                )}
              </>
            )}
          </CollapsibleSection>

          <CollapsibleSection title={`⚙️ ${t('admin.aiGameplay.settings.title')}`}>
            <div className="grid md:grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={settings.enabled} onChange={e => setBool('enabled', e.target.checked)} />
                {t('admin.aiGameplay.settings.enabled')}
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={settings.aiEnabled} onChange={e => setBool('aiEnabled', e.target.checked)} />
                {t('admin.aiGameplay.settings.aiEnabled')}
              </label>
              <label className="text-xs flex flex-col gap-1">
                {t('admin.aiGameplay.settings.gridSize')}
                <input className="input" type="number" min={1} max={25} value={settings.mapHeatmapGridSize} onChange={e => setNum('mapHeatmapGridSize', e.target.value)} />
              </label>
              <label className="text-xs flex flex-col gap-1">
                {t('admin.aiGameplay.settings.retentionDays')}
                <input className="input" type="number" min={1} value={settings.faintEventsRetentionDays} onChange={e => setNum('faintEventsRetentionDays', e.target.value)} />
              </label>
              <label className="text-xs flex flex-col gap-1">
                {t('admin.aiGameplay.settings.aiProvider')}
                <select
                  className="input"
                  value={settings.aiProvider}
                  onChange={e => {
                    const next = e.target.value as AiAnalyticsSettings['aiProvider'];
                    // Le champ modèle est repris directement par la route API : on le remet à une
                    // valeur par défaut cohérente avec le nouveau fournisseur pour éviter d'envoyer
                    // par erreur un nom de modèle d'un autre fournisseur (ex : Gemini à Groq).
                    const defaultModelByProvider: Record<AiAnalyticsSettings['aiProvider'], string> = {
                      gemini: 'gemini-2.0-flash',
                      groq: 'llama-3.3-70b-versatile',
                      cerebras: 'llama-3.3-70b',
                      openrouter: 'meta-llama/llama-3.3-70b-instruct:free',
                    };
                    setSettings(prev => ({
                      ...prev,
                      aiProvider: next,
                      aiModel: defaultModelByProvider[next],
                    }));
                  }}
                >
                  <option value="gemini">Google Gemini</option>
                  <option value="groq">Groq</option>
                  <option value="cerebras">Cerebras</option>
                  <option value="openrouter">OpenRouter</option>
                </select>
              </label>
              <label className="text-xs flex flex-col gap-1">
                {t('admin.aiGameplay.settings.aiModel')}
                <input className="input" value={settings.aiModel} onChange={e => setSettings(prev => ({ ...prev, aiModel: e.target.value }))} />
              </label>
              <label className="text-xs flex flex-col gap-1">
                {t('admin.aiGameplay.settings.aiAutoRefreshHours')}
                <input className="input" type="number" min={0} value={settings.aiAutoRefreshHours} onChange={e => setNum('aiAutoRefreshHours', e.target.value)} />
              </label>
            </div>
            <button className="btn-primary text-xs mt-2" disabled={savingSettings} onClick={saveSettings}>
              {savingSettings ? '⏳' : '💾'} {t('admin.actions.apply')}
            </button>
            {settingsFeedback && <p className="text-xs mt-2">{settingsFeedback}</p>}
          </CollapsibleSection>
        </div>
      )}
    </section>
  );
}
