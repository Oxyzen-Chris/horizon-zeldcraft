'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { HORIZON_ABI } from '@/lib/contract';
import { getFirebaseDb, isFirebaseConfigured, ensureAnonSignIn } from '@/lib/firebase';
import { ref, push, query, orderByChild, limitToLast, onValue, off, serverTimestamp, update } from 'firebase/database';
import { useI18n } from '@/lib/i18n';

const POS_KEY = 'zc.teamChatWidgetPos';
const COLLAPSED_KEY = 'zc.teamChatWidgetCollapsed';

interface Pos { x: number; y: number }

type Msg = {
  key: string;
  uid: string;
  sender: string;
  displayName?: string;
  message: string;
  ts: number;
  edited?: boolean;
  deleted?: boolean;
  replyToKey?: string;
  replyToName?: string;
  replyToPreview?: string;
};

/**
 * Fenêtre flottante et déplaçable pour le chat de l'Équipe multi-joueurs (même esprit/mécanique
 * que `DiceRollWidget` : position + état réduit persistés en localStorage, toujours montée sur
 * `/game`, sans arrière-plan bloquant). Permet d'écrire/répondre à son équipe sans quitter le
 * reste de l'écran de jeu. La création/gestion d'équipe reste dans `TeamsPanel`.
 */
export function TeamChatWidget({ contract, defaultName }: { contract: `0x${string}`; defaultName?: string }) {
  const { t } = useI18n();
  const { address } = useAccount();

  const [collapsed, setCollapsed] = useState(true);
  const [pos, setPos] = useState<Pos | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef<Pos>({ x: 0, y: 0 });
  const fbReady = isFirebaseConfigured();

  const { data: teamId } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'teamOf',
    args: address ? [address] : undefined, query: { enabled: !!address },
  });
  const currentTeamId = Number(teamId ?? 0);
  const inTeam = currentTeamId > 0;
  const { data: team } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'teams', args: [BigInt(currentTeamId)],
    query: { enabled: inTeam },
  });
  const roomKey = inTeam ? `${contract.toLowerCase()}_${currentTeamId}` : null;

  const [chatMsg, setChatMsg] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [sending, setSending] = useState(false);
  const [fbUid, setFbUid] = useState<string | null>(null);
  const [rateLimitMsg, setRateLimitMsg] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>('');
  const [editingName, setEditingName] = useState(false);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [editing, setEditing] = useState<Msg | null>(null);
  const lastSendAt = useRef<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCollapsed((localStorage.getItem(COLLAPSED_KEY) ?? '1') === '1');
    const saved = localStorage.getItem(POS_KEY);
    if (saved) { try { setPos(JSON.parse(saved)); } catch { /* ignore */ } }
    else if (typeof window !== 'undefined') setPos({ x: window.innerWidth - 340, y: window.innerHeight - 420 });
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('zc.displayName');
      if (saved) setDisplayName(saved);
      else if (defaultName) setDisplayName(defaultName); // pré-remplit avec le nom du Voxlyn
    }
  }, [defaultName]);
  const saveDisplayName = () => {
    if (typeof window !== 'undefined') localStorage.setItem('zc.displayName', displayName.slice(0, 24));
    setEditingName(false);
  };

  useEffect(() => {
    if (!fbReady) return;
    ensureAnonSignIn().then((u) => setFbUid(u?.uid ?? null));
  }, [fbReady]);

  useEffect(() => {
    if (!inTeam || !fbReady || !fbUid || !roomKey) return;
    const db = getFirebaseDb();
    if (!db) return;
    const msgsRef = query(ref(db, `chats/${roomKey}`), orderByChild('ts'), limitToLast(50));
    const handler = onValue(msgsRef, (snap) => {
      const list: Msg[] = [];
      snap.forEach((child) => {
        const v = child.val() as any;
        if (v && typeof v.message === 'string') {
          list.push({
            key: child.key!,
            uid: v.uid ?? '',
            sender: v.sender ?? '?',
            displayName: v.displayName,
            message: v.message,
            ts: typeof v.ts === 'number' ? v.ts : 0,
            edited: !!v.edited,
            deleted: !!v.deleted,
            replyToKey: v.replyToKey,
            replyToName: v.replyToName,
            replyToPreview: v.replyToPreview,
          });
        }
      });
      list.sort((a, b) => a.ts - b.ts);
      setMessages(list);
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
    }, (err) => console.error('[teamChatWidget] read error:', err));
    return () => off(msgsRef, 'value', handler);
  }, [inTeam, fbReady, fbUid, roomKey]);

  // ─── Drag (pointer events) ───
  const onPointerDown = (e: React.PointerEvent) => {
    if (!pos) return;
    setDragging(true);
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
  };
  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    if (pos) localStorage.setItem(POS_KEY, JSON.stringify(pos));
  };
  const toggleCollapsed = () => {
    setCollapsed(prev => {
      localStorage.setItem(COLLAPSED_KEY, prev ? '0' : '1');
      return !prev;
    });
  };

  const sendChat = async () => {
    if (!chatMsg.trim() || !address || !roomKey) return;
    if (!displayName.trim()) {
      setRateLimitMsg(t('chat.needName'));
      setEditingName(true);
      setTimeout(() => setRateLimitMsg(null), 3000);
      return;
    }
    const now = Date.now();
    if (now - lastSendAt.current < 2000 && !editing) {
      const remain = Math.ceil((2000 - (now - lastSendAt.current)) / 1000);
      setRateLimitMsg(t('chat.rateLimit', { s: remain }));
      setTimeout(() => setRateLimitMsg(null), 2000);
      return;
    }
    if (!fbReady) return;
    const db = getFirebaseDb();
    if (!db) return;
    const user = await ensureAnonSignIn();
    if (!user) { setRateLimitMsg('❌ Auth failed'); return; }

    setSending(true);
    try {
      const trimmed = chatMsg.slice(0, 280);
      if (editing) {
        await update(ref(db, `chats/${roomKey}/${editing.key}`), {
          message: trimmed, edited: true, editedAt: serverTimestamp(),
        });
        setEditing(null);
      } else {
        const payload: any = { uid: user.uid, sender: address, message: trimmed, ts: serverTimestamp() };
        if (displayName) payload.displayName = displayName.slice(0, 24);
        if (replyTo) {
          payload.replyToKey = replyTo.key;
          payload.replyToName = replyTo.displayName ?? `${replyTo.sender.slice(0, 6)}…`;
          payload.replyToPreview = replyTo.message.slice(0, 80);
        }
        await push(ref(db, `chats/${roomKey}`), payload);
        try {
          await update(ref(db, `chatIndex/${contract.toLowerCase()}/${roomKey}`), {
            lastTs: serverTimestamp(), teamId: currentTeamId,
          });
        } catch (idxErr) {
          console.warn('[chatIndex] update failed (add .write rule):', idxErr);
        }
        setReplyTo(null);
        lastSendAt.current = now;
      }
      setChatMsg('');
    } catch (e: any) {
      console.error(e);
      setRateLimitMsg('❌ ' + (e?.message?.slice(0, 80) ?? 'Refused'));
      setTimeout(() => setRateLimitMsg(null), 4000);
    }
    setSending(false);
  };

  const startEdit = (m: Msg) => { setEditing(m); setReplyTo(null); setChatMsg(m.message); };
  const cancelEdit = () => { setEditing(null); setChatMsg(''); };

  const doDelete = async (m: Msg) => {
    if (!roomKey || !fbReady) return;
    if (!window.confirm(t('chat.confirmDelete'))) return;
    const db = getFirebaseDb();
    if (!db) return;
    try {
      await update(ref(db, `chats/${roomKey}/${m.key}`), { message: '', deleted: true, deletedAt: serverTimestamp() });
    } catch (e) { console.error(e); }
  };

  if (!address || !pos) return null;

  if (collapsed) {
    return (
      <button
        className="fixed z-40 w-14 h-14 rounded-full bg-slate-900 border-2 border-emerald-500 text-2xl shadow-lg flex items-center justify-center"
        style={{ left: pos.x, top: pos.y }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onClick={() => !dragging && toggleCollapsed()}
        title={t('teamchat.title')}
      >💬</button>
    );
  }

  return (
    <div
      className="fixed z-40 w-80 bg-slate-900 border-2 border-emerald-500 rounded-xl shadow-xl select-none flex flex-col"
      style={{ left: pos.x, top: pos.y, maxHeight: '70vh' }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-emerald-900/30 rounded-t-xl cursor-move"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      >
        <span className="text-sm font-semibold truncate">
          💬 {t('teamchat.title')}{inTeam ? ` · ${(team as any)?.[0] ?? ''}` : ''}
        </span>
        <button className="text-xs opacity-70 hover:opacity-100 shrink-0" onClick={toggleCollapsed}>✕</button>
      </div>

      <div className="p-3 text-xs flex flex-col gap-2 overflow-hidden">
        {!inTeam ? (
          <p className="text-slate-400">{t('teamchat.noTeam')}</p>
        ) : (
          <>
            <div className={`flex gap-2 items-center ${!displayName ? 'bg-amber-900/40 rounded p-2 border border-amber-600' : ''}`}>
              <span className="text-slate-400">👤</span>
              {!displayName && <span className="text-amber-300 font-semibold">{t('chat.needName')}</span>}
              {editingName || !displayName ? (
                <>
                  <input value={displayName} onChange={e => setDisplayName(e.target.value)}
                    maxLength={24} placeholder={t('chat.namePrompt')} autoFocus={!displayName}
                    className="flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs" />
                  <button className="btn-primary text-[10px] px-2 py-1" disabled={!displayName.trim()} onClick={saveDisplayName}>
                    {t('chat.saveName')}
                  </button>
                </>
              ) : (
                <button className="text-cyan-300 underline text-xs" onClick={() => setEditingName(true)}>
                  {displayName}
                </button>
              )}
            </div>

            <div ref={scrollRef} className="bg-slate-950/60 rounded p-2 h-56 overflow-y-auto space-y-1">
              {messages.length === 0 && (
                <p className="text-slate-500 italic">{fbReady ? t('chat.empty') : t('chat.emptyNoFirebase')}</p>
              )}
              {messages.map((m) => {
                const mine = address && m.sender.toLowerCase() === address.toLowerCase();
                const author = m.displayName || `${m.sender.slice(0, 6)}…${m.sender.slice(-4)}`;
                return (
                  <div key={m.key} className={`flex ${mine ? 'justify-end' : 'justify-start'} group`}>
                    <div className={`max-w-[85%] rounded-lg px-2 py-1 ${mine ? 'bg-emerald-700/60' : 'bg-slate-800'}`}>
                      <p className="text-[9px] font-semibold text-cyan-300">{author}</p>
                      {m.replyToKey && (
                        <p className="text-[9px] italic text-slate-400 border-l-2 border-slate-500 pl-1.5 mb-0.5 truncate">
                          {t('chat.replyPreview', { name: m.replyToName ?? '?', msg: m.replyToPreview ?? '' })}
                        </p>
                      )}
                      {m.deleted ? (
                        <p className="text-slate-500 italic">{t('chat.deleted')}</p>
                      ) : (
                        <p className="text-slate-100 whitespace-pre-wrap break-words">
                          {m.message}
                          {m.edited && <span className="text-[8px] text-slate-400 ml-1">{t('chat.edited')}</span>}
                        </p>
                      )}
                      <div className="flex gap-2 items-center justify-between mt-0.5">
                        <p className="text-[8px] text-slate-400">{m.ts ? new Date(m.ts).toLocaleTimeString() : '⏳'}</p>
                        {!m.deleted && (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button className="text-[8px] text-cyan-300 hover:underline" onClick={() => setReplyTo(m)}>{t('chat.reply')}</button>
                            {mine && (
                              <>
                                <button className="text-[8px] text-amber-300 hover:underline" onClick={() => startEdit(m)}>{t('chat.edit')}</button>
                                <button className="text-[8px] text-rose-400 hover:underline" onClick={() => doDelete(m)}>{t('chat.delete')}</button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {(replyTo || editing) && (
              <div className="bg-slate-800/60 rounded px-2 py-1.5 flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  {editing && <p className="text-amber-300 font-semibold">✎ {t('chat.editing')}</p>}
                  {replyTo && (
                    <>
                      <p className="text-cyan-300 font-semibold">
                        {t('chat.replyingTo', { name: replyTo.displayName ?? `${replyTo.sender.slice(0, 6)}…` })}
                      </p>
                      <p className="text-slate-400 italic truncate">&ldquo;{replyTo.message}&rdquo;</p>
                    </>
                  )}
                </div>
                <button className="text-slate-400 hover:text-rose-400" onClick={() => { setReplyTo(null); if (editing) cancelEdit(); }}>✕</button>
              </div>
            )}

            <div className="flex gap-2">
              <input value={chatMsg} onChange={e => setChatMsg(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                placeholder={t('chat.placeholder')} maxLength={280}
                className="flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1.5" />
              <button className="btn-primary px-3"
                disabled={!chatMsg.trim() || sending}
                onClick={sendChat}
              >{sending ? '⏳' : editing ? t('chat.save') : t('chat.send')}</button>
            </div>
            {!fbReady && <p className="text-amber-400">{t('chat.fallbackHint')}</p>}
            {rateLimitMsg && <p className="text-amber-400">{rateLimitMsg}</p>}
          </>
        )}
      </div>
    </div>
  );
}
