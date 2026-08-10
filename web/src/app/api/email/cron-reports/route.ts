/**
 * Tâche planifiée (Vercel Cron, voir vercel.json) : envoie automatiquement un rapport de
 * progression par e-mail à chaque joueur ayant activé `PlayerState.scheduledReport` (voir
 * PlayerStats.tsx → section "Rapport programmé", docs/EMAIL_NOTIFICATIONS.md).
 *
 * Contrairement aux autres routes `/api/email/*` (appelées depuis le navigateur, avec une session
 * Firebase déjà authentifiée), ce job tourne SEUL côté serveur, sans utilisateur connecté : il lit
 * donc directement Realtime Database via l'API REST + secret de base de données (voir
 * `lib/email/firebaseAdminRest.ts`), au lieu du SDK client Firebase utilisé partout ailleurs.
 *
 * Sécurité : protégée par `CRON_SECRET` — Vercel Cron Jobs envoie automatiquement l'en-tête
 * `Authorization: Bearer <CRON_SECRET>` sur les requêtes déclenchées par le planificateur dès que
 * cette variable d'environnement est définie (voir
 * https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs). Si `CRON_SECRET` n'est
 * pas configuré, l'endpoint reste appelable sans protection : acceptable ici car il ne fait
 * qu'envoyer des e-mails déjà programmés par l'admin (pas de donnée sensible exposée), mais un
 * avertissement est renvoyé pour inciter à le configurer.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isEmailConfigured, sendEmail } from '@/lib/email/resend';
import { buildPlayerReportEmail, translateStage, type EmailLocale } from '@/lib/email/templates';
import { isCronConfigured, fetchRtdbPath, patchRtdbPath } from '@/lib/email/firebaseAdminRest';
import { computeOffchainStageLevel } from '@/lib/gameState';
import { STAGE_NAMES } from '@/lib/contract';

export const runtime = 'nodejs';

interface ScheduledReportCfg {
  enabled: boolean;
  startDate: number;
  cycle: 'daily' | 'weekly' | 'monthly' | 'yearly';
  weeklyDays?: number[];
  monthlyDay?: number;
  customMessage?: string;
  imageUrl?: string;
  lastSentAt?: number;
}
interface RawPlayerNode {
  email?: string; lang?: EmailLocale; wallet?: number; xpBonus?: number;
  quests?: Record<string, unknown>; encounters?: Record<string, { npcId: string; outcome: string }>;
  treasuresFound?: Record<string, unknown>; playtime?: { totalMs?: number };
  scheduledReport?: ScheduledReportCfg;
}

const DAY_MS = 86_400_000;

/** Détermine si un rapport programmé doit être envoyé MAINTENANT, en évitant tout doublon via
 * `lastSentAt`. Volontairement tolérant (fenêtre de quelques heures) car le cron ne s'exécute
 * qu'à un intervalle fixe (voir vercel.json, typiquement toutes les heures). */
function isDue(cfg: ScheduledReportCfg, now: number): boolean {
  if (!cfg.enabled || now < cfg.startDate) return false;
  const last = cfg.lastSentAt ?? 0;
  const nowD = new Date(now);
  switch (cfg.cycle) {
    case 'daily':
      return now - last >= DAY_MS - 3_600_000; // au moins ~23h depuis le dernier envoi
    case 'weekly': {
      const days = cfg.weeklyDays && cfg.weeklyDays.length > 0 ? cfg.weeklyDays : [nowD.getDay()];
      if (!days.includes(nowD.getDay())) return false;
      return now - last >= DAY_MS - 3_600_000;
    }
    case 'monthly': {
      const target = Math.min(cfg.monthlyDay ?? 1, new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).getDate());
      if (nowD.getDate() !== target) return false;
      return now - last >= 27 * DAY_MS;
    }
    case 'yearly': {
      const start = new Date(cfg.startDate);
      if (nowD.getMonth() !== start.getMonth() || nowD.getDate() !== start.getDate()) return false;
      return now - last >= 300 * DAY_MS;
    }
    default:
      return false;
  }
}

function fmtDuration(ms: number): string {
  if (!ms || ms <= 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if (days > 0) return `${days} j ${hours} h`;
  if (hours > 0) return `${hours} h ${mins} min`;
  return `${mins} min`;
}

async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  if (!isEmailConfigured() || !isCronConfigured()) {
    return NextResponse.json(
      { error: 'not-configured', message: 'RESEND_API_KEY et/ou FIREBASE_DB_SECRET absents côté serveur — voir docs/EMAIL_NOTIFICATIONS.md.' },
      { status: 501 },
    );
  }

  const players = await fetchRtdbPath<Record<string, RawPlayerNode>>('players');
  if (!players) return NextResponse.json({ ok: true, sent: 0, checked: 0, note: 'Aucun joueur / lecture impossible.' });

  const now = Date.now();
  let sent = 0;
  let checked = 0;
  const errors: string[] = [];

  for (const [addr, p] of Object.entries(players)) {
    const cfg = p.scheduledReport;
    if (!cfg?.enabled || !p.email) continue;
    checked++;
    if (!isDue(cfg, now)) continue;

    const { level, stageIndex } = computeOffchainStageLevel(p.xpBonus ?? 0);
    const encounters = p.encounters ? Object.values(p.encounters) : [];
    const uniqueNpcs = new Set(encounters.filter((e) => e.outcome !== 'refused').map((e) => e.npcId)).size;
    const { subject, html } = buildPlayerReportEmail({
      locale: p.lang ?? 'fr',
      email: p.email,
      stats: {
        level, xp: Math.max(0, p.xpBonus ?? 0), stage: translateStage(p.lang ?? 'fr', STAGE_NAMES[stageIndex] ?? 'egg'),
        wallet: p.wallet ?? 0,
        quests: `${p.quests ? Object.keys(p.quests).length : 0}`,
        npcs: `${uniqueNpcs}`,
        playtime: fmtDuration(p.playtime?.totalMs ?? 0),
      },
      customMessage: cfg.customMessage,
      customImageUrl: cfg.imageUrl,
    });
    const result = await sendEmail({ to: p.email, subject, html });
    if (result.ok) {
      sent++;
      await patchRtdbPath(`players/${addr}/scheduledReport`, { lastSentAt: now });
    } else {
      errors.push(`${addr}: ${result.error}`);
    }
  }

  return NextResponse.json({ ok: true, checked, sent, errors: errors.slice(0, 20) });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
