'use client';

import { useState, useEffect } from 'react';
import { getFirebaseDb, isFirebaseConfigured, ensureAnonSignIn } from '@/lib/firebase';
import { ref, get, query, orderByChild } from 'firebase/database';
import { useI18n } from '@/lib/i18n';

type HistoryEntry = {
  roomKey: string;
  msgKey: string;
  sender: string;
  displayName?: string;
  message: string;
  ts: number;
  edited?: boolean;
  deleted?: boolean;
};

/**
 * Historique complet des messages Firebase pour l'administration.
 * Filtre optionnel par adresse wallet (sender) pour tracer un joueur précis.
 */
export function ChatHistory({ contract }: { contract: `0x${string}` }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState('');
  const [room, setRoom] = useState('');
  const [rooms, setRooms] = useState<{ key: string; count: number }[]>([]);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const fbReady = isFirebaseConfigured();

  useEffect(() => { if (fbReady) ensureAnonSignIn(); }, [fbReady]);

  // Charge la liste des salons du contrat au montage (pour peupler la dropdown)
  useEffect(() => {
    if (!fbReady) return;
    (async () => {
      await ensureAnonSignIn();
      const db = getFirebaseDb();
      if (!db) return;
      const snap = await get(ref(db, 'chats'));
      const list: { key: string; count: number }[] = [];
      const prefix = contract.toLowerCase() + '_';
      snap.forEach((rs) => {
        const k = rs.key || '';
        if (!k.startsWith(prefix)) return;
        let c = 0; rs.forEach(() => { c++; });
        list.push({ key: k, count: c });
      });
      setRooms(list.sort((a, b) => b.count - a.count));
    })();
  }, [fbReady, contract]);

  const load = async () => {
    if (!fbReady) return;
    setLoading(true);
    setLoaded(false);
    try {
      await ensureAnonSignIn();
      const db = getFirebaseDb();
      if (!db) { setLoading(false); return; }
      const all: HistoryEntry[] = [];
      const prefix = contract.toLowerCase() + '_';
      const filterLower = filter.trim().toLowerCase();

      // Si un salon précis est sélectionné, on lit uniquement celui-là
      if (room) {
        const rSnap = await get(ref(db, `chats/${room}`));
        rSnap.forEach((msgSnap) => {
          const v = msgSnap.val() as any;
          if (!v || typeof v.message !== 'string') return;
          const sender = (v.sender ?? '').toLowerCase();
          if (filterLower && sender !== filterLower) return;
          all.push({
            roomKey: room, msgKey: msgSnap.key!, sender: v.sender ?? '?',
            displayName: v.displayName, message: v.message,
            ts: typeof v.ts === 'number' ? v.ts : 0,
            edited: !!v.edited, deleted: !!v.deleted,
          });
        });
      } else {
        const snap = await get(ref(db, 'chats'));
        snap.forEach((roomSnap) => {
          const roomKey = roomSnap.key || '';
          if (!roomKey.startsWith(prefix)) return;
          roomSnap.forEach((msgSnap) => {
            const v = msgSnap.val() as any;
            if (!v || typeof v.message !== 'string') return;
            const sender = (v.sender ?? '').toLowerCase();
            if (filterLower && sender !== filterLower) return;
            all.push({
              roomKey, msgKey: msgSnap.key!, sender: v.sender ?? '?',
              displayName: v.displayName, message: v.message,
              ts: typeof v.ts === 'number' ? v.ts : 0,
              edited: !!v.edited, deleted: !!v.deleted,
            });
          });
        });
      }

      all.sort((a, b) => b.ts - a.ts);
      setEntries(all.slice(0, 500));
      setLoaded(true);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  return (
    <section className="card">
      <h2 className="text-xl font-semibold mb-2">{t('admin.chatHistory.title')}</h2>
      <p className="text-xs text-slate-400 mb-3">{t('admin.chatHistory.description')}</p>

      {!fbReady ? (
        <p className="text-amber-400 text-sm">{t('admin.chatHistory.needsFirebase')}</p>
      ) : (
        <>
          <div className="grid md:grid-cols-3 gap-2 mb-4">
            <select className="input" value={room} onChange={e => setRoom(e.target.value)}>
              <option value="">{t('admin.chatHistory.allRooms')} ({rooms.length})</option>
              {rooms.map(r => <option key={r.key} value={r.key}>{r.key.slice(-16)} · {r.count} msg</option>)}
            </select>
            <input className="input" placeholder={t('admin.chatHistory.filter')}
              value={filter} onChange={e => setFilter(e.target.value)} />
            <button className="btn-primary" disabled={loading} onClick={load}>
              {loading ? '⏳' : t('admin.chatHistory.load')}
            </button>
          </div>

          {loaded && entries.length === 0 && (
            <p className="text-sm text-slate-400">{t('admin.chatHistory.empty')}</p>
          )}

          {entries.length > 0 && (
            <div className="bg-slate-950/60 rounded p-3 max-h-96 overflow-y-auto space-y-2 text-xs">
              {entries.map((e) => (
                <div key={e.msgKey} className="border-b border-slate-800 pb-2">
                  <div className="flex justify-between gap-2">
                    <span className="text-cyan-300 font-semibold">
                      {e.displayName || `${e.sender.slice(0, 6)}…${e.sender.slice(-4)}`}
                    </span>
                    <span className="text-slate-500">
                      {e.ts ? new Date(e.ts).toLocaleString() : '—'}
                    </span>
                  </div>
                  <p className={`mt-0.5 ${e.deleted ? 'italic text-slate-500' : 'text-slate-200'}`}>
                    {e.deleted ? t('chat.deleted') : e.message}
                    {e.edited && !e.deleted && <span className="text-[9px] text-slate-400 ml-1">{t('chat.edited')}</span>}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {t('admin.chatHistory.room')}: <code>{e.roomKey}</code>
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
