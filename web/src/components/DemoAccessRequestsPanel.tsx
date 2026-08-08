'use client';

import { useEffect, useState } from 'react';
import {
  subscribeDemoAccessRequests, approveDemoAccess, rejectDemoAccess, getRepRules,
  type DemoAccessRequest, type RepRules,
} from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';

/** Panneau admin — file d'attente des demandes d'accès Démo (Google/e-mail) à valider/rejeter. */
export function DemoAccessRequestsPanel() {
  const { t } = useI18n();
  const [requests, setRequests] = useState<DemoAccessRequest[]>([]);
  const [rules, setRules] = useState<RepRules | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);

  useEffect(() => {
    getRepRules().then(setRules).catch(() => {});
    return subscribeDemoAccessRequests(setRequests);
  }, []);

  const pending = requests.filter(r => r.status === 'pending');
  const decided = requests.filter(r => r.status !== 'pending').slice(0, 20);

  const approve = async (uid: string) => {
    if (!rules) return;
    setBusyUid(uid);
    try { await approveDemoAccess(uid, rules); } finally { setBusyUid(null); }
  };
  const reject = async (uid: string) => {
    setBusyUid(uid);
    try { await rejectDemoAccess(uid); } finally { setBusyUid(null); }
  };

  return (
    <section className="card">
      <h2 className="text-xl font-semibold mb-2">📋 {t('admin.demoRequests.title')}</h2>
      <p className="text-xs text-slate-400 mb-4">{t('admin.demoRequests.description')}</p>

      {pending.length === 0 ? (
        <p className="text-sm text-slate-500">{t('admin.demoRequests.empty')}</p>
      ) : (
        <div className="space-y-2 mb-4">
          {pending.map(r => (
            <div key={r.uid} className="flex flex-wrap items-center justify-between gap-2 bg-slate-800/60 rounded p-2">
              <div className="text-sm">
                <span className="font-semibold">{r.displayName || r.email || r.uid.slice(0, 10)}</span>
                <span className="text-slate-500 ml-2 text-xs">{r.method} · {new Date(r.requestedAt).toLocaleString()}</span>
              </div>
              <div className="flex gap-2">
                <button className="btn-primary text-xs" disabled={busyUid === r.uid} onClick={() => approve(r.uid)}>
                  ✅ {t('admin.demoRequests.approve')}
                </button>
                <button className="btn-secondary text-xs" disabled={busyUid === r.uid} onClick={() => reject(r.uid)}>
                  ❌ {t('admin.demoRequests.reject')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {decided.length > 0 && (
        <details className="text-xs text-slate-400">
          <summary className="cursor-pointer">{t('admin.demoRequests.history')} ({decided.length})</summary>
          <div className="mt-2 space-y-1">
            {decided.map(r => (
              <div key={r.uid} className="flex justify-between">
                <span>{r.displayName || r.email || r.uid.slice(0, 10)}</span>
                <span>{r.status === 'approved' ? '✅' : '❌'} {r.decidedAt ? new Date(r.decidedAt).toLocaleDateString() : ''}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
