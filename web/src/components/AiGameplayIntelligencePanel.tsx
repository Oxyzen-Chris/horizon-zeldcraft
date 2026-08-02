'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  getAiAnalyticsSettings, setAiAnalyticsSettings, DEFAULT_AI_ANALYTICS_SETTINGS,
  getDauSeries, getRetentionEstimate, getWidgetUsageGlobal, getQuestFunnelGlobal,
  getMapHeatmap, getFaintHeatmap, getFaintCauseBreakdown, getMonetizationOverview,
  getNpcEncounterOverview, getPlayerAnalyticsSummary, listPlayers,
  getAiInsightsCache, setAiInsightsCache, DEFAULT_MAP_ID,
  type AiAnalyticsSettings, type WidgetUsageAgg, type QuestFunnelSummary, type HeatCell,
  type MonetizationOverview, type PlayerAnalyticsSummary, type AiInsightsCache,
} from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';

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

  const [insights, setInsights] = useState<AiInsightsCache | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => { getAiAnalyticsSettings().then(setSettings).catch(() => {}); }, []);
  useEffect(() => { getAiInsightsCache().then(setInsights).catch(() => {}); }, []);

  const loadSnapshot = async () => {
    setLoading(true);
    try {
      const players = await listPlayers().catch(() => []);
      const [
        dau, retention7, retention30, widgetUsage, questFunnel, mapHeatmap, faintHeatmap,
        faintCause, monetization, npcOverview,
      ] = await Promise.all([
        getDauSeries(14), getRetentionEstimate(7), getRetentionEstimate(30),
        getWidgetUsageGlobal(), getQuestFunnelGlobal(),
        getMapHeatmap(DEFAULT_MAP_ID), getFaintHeatmap(DEFAULT_MAP_ID), getFaintCauseBreakdown(),
        getMonetizationOverview(), getNpcEncounterOverview(),
      ]);
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
        topMapHeatCells: snap.mapHeatmap.slice(0, 15),
        topFaintHeatCells: snap.faintHeatmap.slice(0, 15),
        faintCauseBreakdown: snap.faintCause,
        monetization: snap.monetization,
        npcEncounterOverview: snap.npcOverview,
        avgChurnScore: snap.players.length ? Math.round(snap.players.reduce((s, p) => s + p.churnScore, 0) / snap.players.length) : 0,
        highRiskPlayers: snap.players.filter(p => p.churnScore >= 60).length,
      };
      const res = await fetch('/api/ai/insights', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stats: statsPayload, locale, model: settings.aiModel }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiError(data?.message || t('admin.aiGameplay.ai.error'));
        return;
      }
      const cache: AiInsightsCache = { text: data.text, generatedAt: data.generatedAt ?? Date.now(), model: data.model ?? settings.aiModel };
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
                  {snap.mapHeatmap.slice(0, 12).map(c => (
                    <div key={`${c.gx}_${c.gy}`} className="flex items-center gap-2 text-xs">
                      <span className="w-16 text-slate-400">({c.gx},{c.gy})</span>
                      <Bar pct={(c.count / maxHeat) * 100} />
                      <span className="w-10 text-right text-slate-400">{c.count}</span>
                    </div>
                  ))}
                  {snap.mapHeatmap.length === 0 && <p className="text-xs text-slate-500 italic">{t('admin.aiGameplay.empty')}</p>}
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">{t('admin.aiGameplay.heatmap.faint')}</p>
                <p className="text-[11px] text-slate-500 mb-1">
                  💧 {snap.faintCause.oxygen} · 🥵 {snap.faintCause.fatigue}
                </p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {snap.faintHeatmap.slice(0, 10).map(c => (
                    <div key={`${c.gx}_${c.gy}`} className="flex items-center gap-2 text-xs">
                      <span className="w-16 text-slate-400">({c.gx},{c.gy})</span>
                      <Bar pct={(c.count / maxFaintHeat) * 100} color="bg-rose-500" />
                      <span className="w-10 text-right text-slate-400">{c.count}</span>
                    </div>
                  ))}
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
                <select className="input" value={settings.aiProvider} onChange={e => setSettings(prev => ({ ...prev, aiProvider: e.target.value as AiAnalyticsSettings['aiProvider'] }))}>
                  <option value="gemini">Google Gemini</option>
                  <option value="groq">Groq</option>
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
