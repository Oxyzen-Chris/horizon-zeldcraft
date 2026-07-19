'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { ref, onValue, off } from 'firebase/database';
import { getFirebaseDb, isFirebaseConfigured, ensureAnonSignIn } from '@/lib/firebase';
import { NPC_SKINS } from '@/lib/contract';
import { useI18n } from '@/lib/i18n';
import type { EncounterRecord } from '@/lib/gameState';

const ALIGN_ICONS = { friendly: '😇', neutral: '🙂', hostile: '👿', unknown: '❓' };
const OFFER_ICONS = { trade: '💰', quest: '📜', fight: '⚔️', chat: '💬' };

/**
 * Journal des rencontres PNJ du joueur :
 * - Section "Rencontres du jour" : les 5 rencontres du jour courant
 * - Liste déroulante : historique complet (paginé 100)
 * Souscription temps réel via Firebase RTDB.
 */
export function EncountersLog() {
  const { t } = useI18n();
  const { address } = useAccount();
  const [all, setAll] = useState<EncounterRecord[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<string>(''); // timestamp de la rencontre choisie
  const fbReady = isFirebaseConfigured();

  useEffect(() => {
    if (!fbReady || !address) return;
    let cancelled = false;
    (async () => {
      await ensureAnonSignIn();
      if (cancelled) return;
      const db = getFirebaseDb();
      if (!db) return;
      const r = ref(db, `players/${address.toLowerCase()}/encounters`);
      const cb = onValue(r, (snap) => {
        const v = snap.val() as Record<string, EncounterRecord> | null;
        const list = v ? Object.values(v) : [];
        list.sort((a, b) => b.timestamp - a.timestamp);
        setAll(list);
      });
      return () => off(r, 'value', cb);
    })();
    return () => { cancelled = true; };
  }, [fbReady, address]);

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const today = all.filter(e => e.timestamp >= startOfDay.getTime()).slice(0, 5);

  const describe = (e: EncounterRecord): string => {
    const outc = e.outcome ? t(`encounter.outcome.${e.outcome}`) : '';
    const parts: string[] = [outc];
    if (e.itemName) parts.push(`+ ${e.itemName}`);
    if (typeof e.walletDelta === 'number' && e.walletDelta !== 0) {
      parts.push(`${e.walletDelta > 0 ? '+' : ''}${e.walletDelta} 💰`);
    }
    if (typeof e.hpDelta === 'number' && e.hpDelta !== 0) {
      parts.push(`${e.hpDelta} ❤️`);
    }
    if (e.xpGained) parts.push(`+${e.xpGained} XP`);
    if (typeof e.repDelta === 'number' && e.repDelta !== 0) {
      parts.push(`${e.repDelta > 0 ? '+' : ''}${e.repDelta} ⭐`);
    }
    return parts.filter(Boolean).join(' · ');
  };

  if (!fbReady) return null;

  const selectedEntry = selected ? all.find(e => String(e.timestamp) === selected) : null;

  return (
    <section className="card">
      <h2 className="text-xl font-semibold mb-2">🎭 {t('encounters.title')}</h2>
      <p className="text-xs text-slate-400 mb-3">{t('encounters.description')}</p>

      {/* Rencontres du jour (5 dernières) */}
      <h3 className="text-sm font-semibold text-cyan-300 mb-2">
        {t('encounters.today')} <span className="text-slate-400">({today.length}/5)</span>
      </h3>
      {today.length === 0 ? (
        <p className="text-xs text-slate-500 italic mb-4">{t('encounters.noneToday')}</p>
      ) : (
        <ul className="space-y-2 mb-4">
          {today.map((e) => (
            <li key={e.timestamp} className="bg-slate-800/60 rounded p-2 text-xs flex gap-3 items-start">
              <span className="text-2xl leading-none">{NPC_SKINS[e.npcSkin] ?? '🧑'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-100 truncate">{e.npcName}</span>
                  <span className="text-[10px]">{ALIGN_ICONS[e.alignment]}</span>
                  <span className="text-[10px]">{OFFER_ICONS[e.offer]}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 uppercase">
                    {t(`npc.offer.${e.offer}`)}
                  </span>
                </div>
                <p className="text-slate-300 mt-0.5">{describe(e)}</p>
                <p className="text-[10px] text-slate-500">
                  {new Date(e.timestamp).toLocaleString()}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Historique complet */}
      <div className="border-t border-slate-700 pt-3">
        <button className="btn-secondary text-xs mb-2" onClick={() => setShowAll(v => !v)}>
          {showAll ? '▾' : '▸'} {t('encounters.history')} ({all.length})
        </button>
        {showAll && (
          <>
            <select className="input mb-2" value={selected} onChange={e => setSelected(e.target.value)}>
              <option value="">{t('encounters.pick')}</option>
              {all.slice(0, 100).map(e => (
                <option key={e.timestamp} value={String(e.timestamp)}>
                  {new Date(e.timestamp).toLocaleString()} — {e.npcName} ({t(`npc.offer.${e.offer}`)}){e.itemName ? ` · ${e.itemName}` : ''}
                </option>
              ))}
            </select>
            {selectedEntry && (
              <div className="bg-slate-800/60 rounded p-3 text-xs">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-2xl">{NPC_SKINS[selectedEntry.npcSkin] ?? '🧑'}</span>
                  <span className="font-semibold text-cyan-300">{selectedEntry.npcName}</span>
                </div>
                <p className="text-slate-300">{describe(selectedEntry)}</p>
                <p className="text-[10px] text-slate-500 mt-1">
                  {new Date(selectedEntry.timestamp).toLocaleString()}
                </p>
              </div>
            )}
            {all.length === 0 && (
              <p className="text-xs text-slate-500 italic">{t('encounters.emptyHistory')}</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
