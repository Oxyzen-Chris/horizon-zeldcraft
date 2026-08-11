'use client';

/**
 * Sous-panneau e-mail/annonces de "Statistiques par joueur" (menu Administration) — voir
 * docs/EMAIL_NOTIFICATIONS.md. Trois blocs :
 *  1. Rapport de progression (immédiat + programmation récurrente) pour le joueur sélectionné.
 *  2. Message personnalisé (texte + image), envoyable à CE joueur ou à TOUS les joueurs (envoi de
 *     masse, ex. maintenance planifiée) — et bandeau "annonce en direct" équivalent en jeu.
 *  3. Rien d'autre : la suppression de compte reste dans la "Zone de danger" de PlayerStats.tsx.
 *
 * Toutes les actions sont best-effort et ne bloquent jamais l'UI admin : un échec d'envoi affiche
 * juste un message, sans jamais empêcher la suite du travail d'administration.
 */
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import {
  setPlayerScheduledReport, setPlayerAnnouncement, clearPlayerAnnouncement,
  setGlobalAnnouncement, clearGlobalAnnouncement, setPlayerWelcomeEmailStatus,
  type PlayerState, type PlayerListEntry,
} from '@/lib/gameState';

export interface ReportStats {
  level: number; xp: number; stage: string; wallet: number;
  quests: string; npcs: string; playtime: string;
}

const WEEKDAYS = [
  { value: 0, key: 'sun' }, { value: 1, key: 'mon' }, { value: 2, key: 'tue' }, { value: 3, key: 'wed' },
  { value: 4, key: 'thu' }, { value: 5, key: 'fri' }, { value: 6, key: 'sat' },
];

function toDateInputValue(ts?: number): string {
  const d = ts ? new Date(ts) : new Date();
  return d.toISOString().slice(0, 10);
}

export function PlayerEmailPanel({
  target, dbPlayer, reportStats, players, onScheduleSaved,
}: {
  target: `0x${string}` | null;
  dbPlayer: PlayerState | null;
  reportStats: ReportStats | null;
  players: PlayerListEntry[];
  onScheduleSaved?: () => void;
}) {
  const { t, locale } = useI18n();
  const [sendingReport, setSendingReport] = useState(false);
  const [reportFeedback, setReportFeedback] = useState<string | null>(null);
  const [resendingWelcome, setResendingWelcome] = useState(false);
  const [welcomeFeedback, setWelcomeFeedback] = useState<string | null>(null);

  // ─── Programmation d'un rapport récurrent ───
  const cfg = dbPlayer?.scheduledReport;
  const [schedEnabled, setSchedEnabled] = useState(false);
  const [schedStartDate, setSchedStartDate] = useState(toDateInputValue());
  const [schedCycle, setSchedCycle] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('weekly');
  const [schedWeeklyDays, setSchedWeeklyDays] = useState<number[]>([1]);
  const [schedMonthlyDay, setSchedMonthlyDay] = useState(1);
  const [schedMessage, setSchedMessage] = useState('');
  const [schedImageUrl, setSchedImageUrl] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleFeedback, setScheduleFeedback] = useState<string | null>(null);

  useEffect(() => {
    setSchedEnabled(cfg?.enabled ?? false);
    setSchedStartDate(toDateInputValue(cfg?.startDate));
    setSchedCycle(cfg?.cycle ?? 'weekly');
    setSchedWeeklyDays(cfg?.weeklyDays ?? [1]);
    setSchedMonthlyDay(cfg?.monthlyDay ?? 1);
    setSchedMessage(cfg?.customMessage ?? '');
    setSchedImageUrl(cfg?.imageUrl ?? '');
    setScheduleFeedback(null);
    setWelcomeFeedback(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // ─── Message personnalisé (ciblé ou masse) ───
  const [msgText, setMsgText] = useState('');
  const [msgImageUrl, setMsgImageUrl] = useState('');
  const [msgSubject, setMsgSubject] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const [msgFeedback, setMsgFeedback] = useState<string | null>(null);

  // ─── Annonce en direct (bandeau en jeu) ───
  const [announceText, setAnnounceText] = useState('');
  const [announceImageUrl, setAnnounceImageUrl] = useState('');
  const [announceBusy, setAnnounceBusy] = useState(false);
  const [announceFeedback, setAnnounceFeedback] = useState<string | null>(null);

  const sendReportNow = async () => {
    if (!target || !dbPlayer?.email || !reportStats) return;
    setSendingReport(true); setReportFeedback(null);
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'report', to: dbPlayer.email, locale: dbPlayer.lang ?? locale, stats: reportStats,
        }),
      });
      const data = await res.json();
      setReportFeedback(data.ok ? t('admin.email.sentOk') : `${t('admin.email.sentFail')} ${data.message ?? data.error ?? ''}`);
    } catch {
      setReportFeedback(t('admin.email.sentFail'));
    } finally {
      setSendingReport(false);
    }
  };

  // ─── Renvoi de l'e-mail de bienvenue (voir PlayerState.welcomeEmailStatus, correctif du bug de
  // silence total sur échec — l'e-mail échoue le plus souvent tant que RESEND_FROM_EMAIL reste
  // l'adresse "bac à sable" par défaut de Resend, voir avertissement dans RepRulesPanel.tsx). */
  const resendWelcomeEmail = async () => {
    if (!target || !dbPlayer?.email) return;
    setResendingWelcome(true); setWelcomeFeedback(null);
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'welcome', to: dbPlayer.email, locale: dbPlayer.lang ?? locale }),
      });
      if (res.ok) {
        await setPlayerWelcomeEmailStatus(target, 'sent');
        setWelcomeFeedback(t('admin.email.sentOk'));
      } else {
        const data = await res.json().catch(() => null);
        const reason = (data && (data.error || data.message)) || `HTTP ${res.status}`;
        await setPlayerWelcomeEmailStatus(target, 'failed', String(reason));
        setWelcomeFeedback(`${t('admin.email.sentFail')} ${reason}`);
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      await setPlayerWelcomeEmailStatus(target, 'failed', reason);
      setWelcomeFeedback(`${t('admin.email.sentFail')} ${reason}`);
    } finally {
      setResendingWelcome(false);
    }
  };

  const toggleWeeklyDay = (d: number) => {
    setSchedWeeklyDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));
  };

  const saveSchedule = async () => {
    if (!target) return;
    setSavingSchedule(true); setScheduleFeedback(null);
    try {
      if (!schedEnabled) {
        await setPlayerScheduledReport(target, null);
      } else {
        await setPlayerScheduledReport(target, {
          enabled: true,
          startDate: new Date(schedStartDate).getTime() || Date.now(),
          cycle: schedCycle,
          ...(schedCycle === 'weekly' ? { weeklyDays: schedWeeklyDays.length ? schedWeeklyDays : [1] } : {}),
          ...(schedCycle === 'monthly' ? { monthlyDay: schedMonthlyDay } : {}),
          ...(schedMessage ? { customMessage: schedMessage } : {}),
          ...(schedImageUrl ? { imageUrl: schedImageUrl } : {}),
        });
      }
      setScheduleFeedback(t('admin.email.scheduleSaved'));
      onScheduleSaved?.();
    } catch {
      setScheduleFeedback(t('admin.email.sentFail'));
    } finally {
      setSavingSchedule(false);
    }
  };

  const sendMessageToTarget = async () => {
    if (!target || !dbPlayer?.email || !msgText.trim()) return;
    setSendingMsg(true); setMsgFeedback(null);
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'broadcast',
          recipients: [{ to: dbPlayer.email, locale: dbPlayer.lang ?? locale }],
          message: msgText, imageUrl: msgImageUrl || undefined, subject: msgSubject || undefined,
        }),
      });
      const data = await res.json();
      setMsgFeedback(data.ok ? t('admin.email.sentOk') : `${t('admin.email.sentFail')} ${data.message ?? data.error ?? ''}`);
    } catch {
      setMsgFeedback(t('admin.email.sentFail'));
    } finally {
      setSendingMsg(false);
    }
  };

  const sendMassEmail = async () => {
    const recipients = players.filter((p) => p.email).map((p) => ({ to: p.email as string, locale: p.lang ?? 'fr' }));
    if (recipients.length === 0 || !msgText.trim()) return;
    if (!window.confirm(t('admin.email.massConfirm', { count: String(recipients.length) }))) return;
    setSendingMsg(true); setMsgFeedback(null);
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'broadcast', recipients, message: msgText, imageUrl: msgImageUrl || undefined, subject: msgSubject || undefined }),
      });
      const data = await res.json();
      setMsgFeedback(data.ok ? t('admin.email.massSentOk', { sent: String(data.sent ?? 0), total: String(data.total ?? recipients.length) }) : `${t('admin.email.sentFail')} ${data.message ?? data.error ?? ''}`);
    } catch {
      setMsgFeedback(t('admin.email.sentFail'));
    } finally {
      setSendingMsg(false);
    }
  };

  const publishAnnounceToTarget = async () => {
    if (!target || !announceText.trim()) return;
    setAnnounceBusy(true); setAnnounceFeedback(null);
    try {
      await setPlayerAnnouncement(target, announceText, announceImageUrl || undefined);
      setAnnounceFeedback(t('admin.email.announceSent'));
    } finally { setAnnounceBusy(false); }
  };
  const publishAnnounceGlobal = async () => {
    if (!announceText.trim()) return;
    if (!window.confirm(t('admin.email.announceGlobalConfirm'))) return;
    setAnnounceBusy(true); setAnnounceFeedback(null);
    try {
      await setGlobalAnnouncement(announceText, announceImageUrl || undefined);
      setAnnounceFeedback(t('admin.email.announceSent'));
    } finally { setAnnounceBusy(false); }
  };
  const clearAnnounceTarget = async () => {
    if (!target) return;
    setAnnounceBusy(true);
    try { await clearPlayerAnnouncement(target); setAnnounceFeedback(t('admin.email.announceCleared')); }
    finally { setAnnounceBusy(false); }
  };
  const clearAnnounceGlobal = async () => {
    setAnnounceBusy(true);
    try { await clearGlobalAnnouncement(); setAnnounceFeedback(t('admin.email.announceCleared')); }
    finally { setAnnounceBusy(false); }
  };

  return (
    <div className="mt-6 border-t border-slate-700 pt-4 space-y-6">
      <h3 className="text-sm font-semibold">✉️ {t('admin.email.title')}</h3>

      {/* ── Rapport de progression (joueur sélectionné) ── */}
      {target && (
        <div className="bg-slate-800/40 rounded p-3">
          <p className="text-xs font-semibold mb-2 text-slate-300">📜 {t('admin.email.reportSection')}</p>
          {!dbPlayer?.email ? (
            <p className="text-xs text-slate-500">{t('admin.email.noEmailForPlayer')}</p>
          ) : (
            <>
              {dbPlayer.welcomeEmailStatus && (
                <p className={`text-xs mb-2 ${dbPlayer.welcomeEmailStatus === 'sent' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {dbPlayer.welcomeEmailStatus === 'sent'
                    ? `✅ ${t('admin.email.welcomeSent')}${dbPlayer.welcomeEmailSentAt ? ` (${new Date(dbPlayer.welcomeEmailSentAt).toLocaleString(locale)})` : ''}`
                    : `❌ ${t('admin.email.welcomeFailed')}${dbPlayer.welcomeEmailError ? ` — ${dbPlayer.welcomeEmailError}` : ''}`}
                </p>
              )}
              <button className="btn-secondary text-xs mb-3" disabled={resendingWelcome} onClick={resendWelcomeEmail}>
                {resendingWelcome ? '⏳' : '🔁'} {t('admin.email.resendWelcome')}
              </button>
              {welcomeFeedback && <p className="text-xs text-amber-300 mb-3">{welcomeFeedback}</p>}
              <button className="btn-secondary text-xs mb-3" disabled={sendingReport || !reportStats} onClick={sendReportNow}>
                {sendingReport ? '⏳' : '📤'} {t('admin.email.sendReportNow')}
              </button>
              {reportFeedback && <p className="text-xs text-amber-300 mb-3">{reportFeedback}</p>}

              <p className="text-xs font-semibold mb-2 text-slate-300">🔁 {t('admin.email.scheduleSection')}</p>
              <label className="flex items-center gap-2 text-xs mb-2">
                <input type="checkbox" checked={schedEnabled} onChange={(e) => setSchedEnabled(e.target.checked)} />
                {t('admin.email.scheduleEnable')}
              </label>
              {schedEnabled && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2 items-center">
                    <label className="text-xs text-slate-400">{t('admin.email.scheduleStartDate')}</label>
                    <input type="date" className="input text-xs" value={schedStartDate} onChange={(e) => setSchedStartDate(e.target.value)} />
                    <select className="input text-xs" value={schedCycle} onChange={(e) => setSchedCycle(e.target.value as typeof schedCycle)}>
                      <option value="daily">{t('admin.email.cycleDaily')}</option>
                      <option value="weekly">{t('admin.email.cycleWeekly')}</option>
                      <option value="monthly">{t('admin.email.cycleMonthly')}</option>
                      <option value="yearly">{t('admin.email.cycleYearly')}</option>
                    </select>
                  </div>
                  {schedCycle === 'weekly' && (
                    <div className="flex flex-wrap gap-2">
                      {WEEKDAYS.map((d) => (
                        <label key={d.value} className={`text-[10px] px-2 py-1 rounded border cursor-pointer ${schedWeeklyDays.includes(d.value) ? 'bg-purple-700 border-purple-500' : 'bg-slate-800 border-slate-600 text-slate-400'}`}>
                          <input type="checkbox" className="hidden" checked={schedWeeklyDays.includes(d.value)} onChange={() => toggleWeeklyDay(d.value)} />
                          {t(`admin.email.day.${d.key}`)}
                        </label>
                      ))}
                    </div>
                  )}
                  {schedCycle === 'monthly' && (
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-400">{t('admin.email.scheduleMonthlyDay')}</label>
                      <input type="number" min={1} max={31} className="input text-xs w-20" value={schedMonthlyDay}
                        onChange={(e) => setSchedMonthlyDay(Math.min(31, Math.max(1, Number(e.target.value) || 1)))} />
                    </div>
                  )}
                  <textarea className="input text-xs w-full" rows={2} placeholder={t('admin.email.customMessagePlaceholder')}
                    value={schedMessage} onChange={(e) => setSchedMessage(e.target.value)} />
                  <input className="input text-xs w-full" placeholder={t('admin.email.imageUrlPlaceholder')}
                    value={schedImageUrl} onChange={(e) => setSchedImageUrl(e.target.value)} />
                </div>
              )}
              <button className="btn-primary text-xs mt-2" disabled={savingSchedule} onClick={saveSchedule}>
                {savingSchedule ? '⏳' : '💾'} {t('admin.email.scheduleSave')}
              </button>
              {scheduleFeedback && <p className="text-xs text-amber-300 mt-2">{scheduleFeedback}</p>}
            </>
          )}
        </div>
      )}

      {/* ── Message personnalisé — ciblé ou envoi de masse ── */}
      <div className="bg-slate-800/40 rounded p-3">
        <p className="text-xs font-semibold mb-2 text-slate-300">💬 {t('admin.email.messageSection')}</p>
        <input className="input text-xs w-full mb-2" placeholder={t('admin.email.subjectPlaceholder')}
          value={msgSubject} onChange={(e) => setMsgSubject(e.target.value)} />
        <textarea className="input text-xs w-full mb-2" rows={3} placeholder={t('admin.email.customMessagePlaceholder')}
          value={msgText} onChange={(e) => setMsgText(e.target.value)} />
        <input className="input text-xs w-full mb-3" placeholder={t('admin.email.imageUrlPlaceholder')}
          value={msgImageUrl} onChange={(e) => setMsgImageUrl(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          {target && dbPlayer?.email && (
            <button className="btn-secondary text-xs" disabled={sendingMsg || !msgText.trim()} onClick={sendMessageToTarget}>
              📤 {t('admin.email.sendToPlayer')}
            </button>
          )}
          <button className="btn-secondary text-xs text-amber-400" disabled={sendingMsg || !msgText.trim()} onClick={sendMassEmail}>
            📢 {t('admin.email.sendToAll', { count: String(players.filter((p) => p.email).length) })}
          </button>
        </div>
        {msgFeedback && <p className="text-xs text-amber-300 mt-2">{msgFeedback}</p>}
      </div>

      {/* ── Annonce en direct (bandeau clignotant en jeu) ── */}
      <div className="bg-slate-800/40 rounded p-3">
        <p className="text-xs font-semibold mb-2 text-slate-300">📢 {t('admin.email.announceSection')}</p>
        <textarea className="input text-xs w-full mb-2" rows={2} placeholder={t('admin.email.announcePlaceholder')}
          value={announceText} onChange={(e) => setAnnounceText(e.target.value)} />
        <input className="input text-xs w-full mb-3" placeholder={t('admin.email.imageUrlPlaceholder')}
          value={announceImageUrl} onChange={(e) => setAnnounceImageUrl(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          {target && (
            <>
              <button className="btn-secondary text-xs" disabled={announceBusy || !announceText.trim()} onClick={publishAnnounceToTarget}>
                📤 {t('admin.email.announceToPlayer')}
              </button>
              <button className="btn-secondary text-xs" disabled={announceBusy} onClick={clearAnnounceTarget}>
                🧹 {t('admin.email.announceClearPlayer')}
              </button>
            </>
          )}
          <button className="btn-secondary text-xs text-amber-400" disabled={announceBusy || !announceText.trim()} onClick={publishAnnounceGlobal}>
            📢 {t('admin.email.announceToAll')}
          </button>
          <button className="btn-secondary text-xs text-rose-400" disabled={announceBusy} onClick={clearAnnounceGlobal}>
            🧹 {t('admin.email.announceClearAll')}
          </button>
        </div>
        {announceFeedback && <p className="text-xs text-amber-300 mt-2">{announceFeedback}</p>}
      </div>
    </div>
  );
}
