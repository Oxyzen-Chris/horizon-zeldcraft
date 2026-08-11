'use client';

import { useEffect, useState } from 'react';
import {
  subscribeDemoAccessRequests, pauseAccountAccess, deletePlayerAccount, getRepRules,
  countActiveDemoSessions, type DemoAccessRequest, type RepRules,
} from '@/lib/gameState';
import { deleteFirebaseAuthUser } from '@/lib/adminActions';
import { useI18n } from '@/lib/i18n';

/**
 * Panneau admin — registre des comptes Démo/fiat (Google/e-mail) connectés au jeu sans
 * portefeuille crypto (voir docs/DEMO_FIAT.md). L'accès est désormais accordé IMMÉDIATEMENT dès la
 * connexion (plus de file d'attente à valider) : ce panneau sert à AUDITER (e-mail, mode d'accès,
 * dates de connexion) et, si besoin, à mettre en pause ou supprimer un compte a posteriori (abus,
 * tricherie suspectée). Affiche aussi en direct le nombre de sessions actives par rapport aux
 * plafonds paramétrés (RepRules.demoMaxConcurrentSessions / demoAnonymousMaxConcurrentSessions).
 */
export function DemoAccessRequestsPanel() {
  const { t } = useI18n();
  const [requests, setRequests] = useState<DemoAccessRequest[]>([]);
  const [rules, setRules] = useState<RepRules | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [demoCount, setDemoCount] = useState(0);
  const [anonCount, setAnonCount] = useState(0);

  useEffect(() => {
    getRepRules().then(setRules).catch(() => {});
    return subscribeDemoAccessRequests(setRequests);
  }, []);

  const refreshCounts = () => {
    countActiveDemoSessions('demo').then(setDemoCount).catch(() => {});
    countActiveDemoSessions('anon').then(setAnonCount).catch(() => {});
  };
  useEffect(() => {
    refreshCounts();
    const id = setInterval(refreshCounts, 15_000);
    return () => clearInterval(id);
  }, []);

  const demoCap = rules?.demoMaxConcurrentSessions ?? 90;
  const anonCap = rules?.demoAnonymousMaxConcurrentSessions ?? 40;

  const togglePause = async (r: DemoAccessRequest) => {
    setBusyUid(r.uid);
    try { await pauseAccountAccess(r.uid, !r.paused); } finally { setBusyUid(null); }
  };
  const remove = async (r: DemoAccessRequest) => {
    if (!window.confirm(t('admin.demoRequests.deleteConfirm'))) return;
    setBusyUid(r.uid);
    try {
      // Supprime AUSSI le compte Firebase Authentication (e-mail/mot de passe OU Google) — sans
      // ça, un compte "Jouer sans portefeuille" par e-mail/mot de passe ne pouvait plus jamais
      // recréer de compte avec la même adresse e-mail après suppression (bug corrigé, voir
      // lib/adminActions.ts::deleteFirebaseAuthUser).
      const res = await deleteFirebaseAuthUser(r.uid);
      if (!res.ok && res.notConfigured) alert(t('admin.stats.deleteAuthNotConfigured'));
      await deletePlayerAccount(r.address);
      refreshCounts();
    } finally { setBusyUid(null); }
  };

  const methodEmoji = (m: DemoAccessRequest['method']) => (m === 'google' ? '🔵' : m === 'apple' ? '🍎' : '✉️');

  return (
    <section className="card">
      <h2 className="text-xl font-semibold mb-2">📋 {t('admin.demoRequests.title')}</h2>
      <p className="text-xs text-slate-400 mb-4">{t('admin.demoRequests.description')}</p>

      {/* Compteur de sessions actives / plafonds — voir RepRules.demoMaxConcurrentSessions et
          demoAnonymousMaxConcurrentSessions (menu Administration §Accès Démo & fiat). */}
      <div className="bg-slate-800/60 rounded p-3 mb-4 text-sm flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-semibold">{t('admin.demoRequests.sessionsSummary')}</span>{' '}
          <span className={demoCount >= demoCap ? 'text-rose-400' : 'text-emerald-400'}>{demoCount} / {demoCap}</span>
          <span className="text-slate-500"> ({t('admin.demoRequests.ofWhichAnonymous')} </span>
          <span className={anonCount >= anonCap ? 'text-rose-400' : 'text-emerald-400'}>{anonCount} / {anonCap}</span>
          <span className="text-slate-500">)</span>
          <span className="text-slate-400 ml-2 text-xs">
            — {t('admin.demoRequests.remaining')}: {Math.max(0, demoCap - demoCount)} ({Math.max(0, anonCap - anonCount)} {t('admin.demoRequests.anonymousShort')})
          </span>
        </div>
        <button className="btn-secondary text-xs" onClick={refreshCounts}>🔄 {t('admin.demoRequests.refresh')}</button>
      </div>

      {requests.length === 0 ? (
        <p className="text-sm text-slate-500">{t('admin.demoRequests.empty')}</p>
      ) : (
        <div className="space-y-2">
          {requests.map(r => (
            <div key={r.uid} className="flex flex-wrap items-center justify-between gap-2 bg-slate-800/60 rounded p-2">
              <div className="text-sm">
                <span className="font-semibold">{r.email || r.displayName || r.uid.slice(0, 10)}</span>
                <span className="text-slate-500 ml-2 text-xs">
                  {methodEmoji(r.method)} {t(r.accessMode === 'demo' ? 'admin.accessMode.demo' : 'admin.accessMode.fiat')}
                  {' · '}{t('admin.demoRequests.firstSeen')} {new Date(r.requestedAt).toLocaleDateString()}
                  {r.lastLoginAt && <> · {t('admin.demoRequests.lastLogin')} {new Date(r.lastLoginAt).toLocaleString()}</>}
                  {r.loginCount ? <> · {r.loginCount}×</> : null}
                </span>
                {r.paused && (
                  <span className="ml-2 text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded bg-rose-900 text-rose-300">
                    ⏸ {t('admin.demoRequests.pausedBadge')}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button className="btn-secondary text-xs" disabled={busyUid === r.uid} onClick={() => togglePause(r)}>
                  {r.paused ? `▶️ ${t('admin.demoRequests.resume')}` : `⏸ ${t('admin.demoRequests.pause')}`}
                </button>
                <button className="btn-secondary text-xs text-rose-400" disabled={busyUid === r.uid} onClick={() => remove(r)}>
                  🗑️ {t('admin.demoRequests.delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
