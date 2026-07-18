'use client';

import { useState, useEffect, useRef } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { HORIZON_ABI } from '@/lib/contract';
import { getFirebaseDb, isFirebaseConfigured, ensureAnonSignIn } from '@/lib/firebase';
import { ref, push, query, orderByChild, limitToLast, onValue, off, serverTimestamp, update, remove } from 'firebase/database';
import { useI18n } from '@/lib/i18n';

type Msg = {
  key: string;               // Firebase message key (pour edit/delete)
  uid: string;               // Firebase uid (auteur)
  sender: string;            // Wallet address
  displayName?: string;      // Pseudo affiché
  message: string;
  ts: number;
  edited?: boolean;
  deleted?: boolean;
  replyToKey?: string;       // Ref au message cité
  replyToName?: string;
  replyToPreview?: string;
};

export function TeamsPanel({ contract }: { contract: `0x${string}` }) {
  const { t } = useI18n();
  const { address } = useAccount();
  const queryClient = useQueryClient();

  const { data: teamId, queryKey } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'teamOf',
    args: address ? [address] : undefined, query: { enabled: !!address },
  });
  const currentTeamId = Number(teamId ?? 0);
  const inTeam = currentTeamId > 0;

  const { data: team } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'teams', args: [BigInt(currentTeamId)],
    query: { enabled: inTeam },
  });
  const { data: members } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'getTeamMembers', args: [BigInt(currentTeamId)],
    query: { enabled: inTeam, refetchInterval: 15000 },
  });

  const [name, setName] = useState('');
  const [joinId, setJoinId] = useState('');
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
  const fbReady = isFirebaseConfigured();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('zc.displayName');
      if (saved) setDisplayName(saved);
    }
  }, []);
  const saveDisplayName = () => {
    if (typeof window !== 'undefined') localStorage.setItem('zc.displayName', displayName.slice(0, 24));
    setEditingName(false);
  };

  useEffect(() => {
    if (!fbReady) return;
    ensureAnonSignIn().then((u) => setFbUid(u?.uid ?? null));
  }, [fbReady]);

  const { writeContract, data: txHash, isPending, reset } = useWriteContract();
  const { isLoading: mining, isSuccess: mined } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (mined) { queryClient.invalidateQueries({ queryKey }); setTimeout(() => reset(), 1000); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mined]);

  const roomKey = inTeam ? `${contract.toLowerCase()}_${currentTeamId}` : null;

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
    }, (err) => console.error('[chat] read error:', err));
    return () => off(msgsRef, 'value', handler);
  }, [inTeam, fbReady, fbUid, roomKey]);

  const sendChat = async () => {
    if (!chatMsg.trim() || !address || !roomKey) return;
    const now = Date.now();
    if (now - lastSendAt.current < 2000 && !editing) {
      const remain = Math.ceil((2000 - (now - lastSendAt.current)) / 1000);
      setRateLimitMsg(t('chat.rateLimit', { s: remain }));
      setTimeout(() => setRateLimitMsg(null), 2000);
      return;
    }

    if (fbReady) {
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
          const payload: any = {
            uid:      user.uid,
            sender:   address,
            message:  trimmed,
            ts:       serverTimestamp(),
          };
          if (displayName) payload.displayName = displayName.slice(0, 24);
          if (replyTo) {
            payload.replyToKey     = replyTo.key;
            payload.replyToName    = replyTo.displayName ?? `${replyTo.sender.slice(0, 6)}…`;
            payload.replyToPreview = replyTo.message.slice(0, 80);
          }
          await push(ref(db, `chats/${roomKey}`), payload);
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
    } else {
      writeContract({
        address: contract, abi: HORIZON_ABI, functionName: 'sendTeamMessage', args: [chatMsg],
      });
      lastSendAt.current = now;
    }
  };

  const startEdit = (m: Msg) => {
    setEditing(m); setReplyTo(null); setChatMsg(m.message);
  };
  const cancelEdit = () => { setEditing(null); setChatMsg(''); };

  const doDelete = async (m: Msg) => {
    if (!roomKey || !fbReady) return;
    if (!window.confirm(t('chat.confirmDelete'))) return;
    const db = getFirebaseDb();
    if (!db) return;
    try {
      // Soft delete pour préserver l'historique côté admin
      await update(ref(db, `chats/${roomKey}/${m.key}`), {
        message: '', deleted: true, deletedAt: serverTimestamp(),
      });
    } catch (e) { console.error(e); }
  };

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-3">{t('game.teams.section')}</h3>

      {!inTeam ? (
        <div className="space-y-4">
          <div>
            <p className="text-sm text-slate-400 mb-2">{t('game.teams.createLabel')}</p>
            <div className="flex gap-2">
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder={t('game.teams.namePlaceholder')} maxLength={32}
                className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm" />
              <button className="btn-primary text-sm px-4"
                disabled={!name || isPending || mining}
                onClick={() => writeContract({
                  address: contract, abi: HORIZON_ABI, functionName: 'createTeam', args: [name],
                })}
              >{mining ? '⏳' : t('game.teams.create')}</button>
            </div>
          </div>
          <div>
            <p className="text-sm text-slate-400 mb-2">{t('game.teams.joinLabel')}</p>
            <div className="flex gap-2">
              <input value={joinId} onChange={e => setJoinId(e.target.value)}
                placeholder={t('game.teams.idPlaceholder')}
                className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm" />
              <button className="btn-secondary text-sm px-4"
                disabled={!joinId || isPending || mining}
                onClick={() => writeContract({
                  address: contract, abi: HORIZON_ABI, functionName: 'joinTeam', args: [BigInt(joinId)],
                })}
              >{mining ? '⏳' : t('game.teams.join')}</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <div>
              <p className="font-semibold text-cyan-300">🛡️ {(team as any)?.[0]}</p>
              <p className="text-xs text-slate-400">
                ID: {currentTeamId} · {t('game.teams.membersCount', { n: members ? (members as any[]).length : 0 })}
                {' · '}{fbReady ? t('game.teams.realtime') : t('game.teams.fallback')}
              </p>
            </div>
            <button className="btn-danger text-xs"
              disabled={isPending || mining}
              onClick={() => writeContract({
                address: contract, abi: HORIZON_ABI, functionName: 'leaveTeam', args: [],
              })}
            >{t('game.teams.leave')}</button>
          </div>

          {/* Pseudo */}
          <div className="flex gap-2 items-center text-xs">
            <span className="text-slate-400">👤</span>
            {editingName ? (
              <>
                <input value={displayName} onChange={e => setDisplayName(e.target.value)}
                  maxLength={24} placeholder={t('chat.namePrompt')}
                  className="flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs" />
                <button className="btn-secondary text-[10px] px-2 py-1" onClick={saveDisplayName}>
                  {t('chat.saveName')}
                </button>
              </>
            ) : (
              <button className="text-cyan-300 underline text-xs" onClick={() => setEditingName(true)}>
                {displayName || t('chat.namePrompt')}
              </button>
            )}
          </div>

          <div ref={scrollRef} className="bg-slate-950/60 rounded p-3 h-72 overflow-y-auto space-y-1 text-sm">
            {messages.length === 0 && (
              <p className="text-xs text-slate-500 italic">
                {fbReady ? t('chat.empty') : t('chat.emptyNoFirebase')}
              </p>
            )}
            {messages.map((m) => {
              const mine = address && m.sender.toLowerCase() === address.toLowerCase();
              const author = m.displayName || `${m.sender.slice(0, 6)}…${m.sender.slice(-4)}`;
              return (
                <div key={m.key} className={`flex ${mine ? 'justify-end' : 'justify-start'} group`}>
                  <div className={`max-w-[80%] rounded-lg px-3 py-1.5 ${mine ? 'bg-emerald-700/60' : 'bg-slate-800'}`}>
                    <p className="text-[10px] font-semibold text-cyan-300">{author}</p>
                    {m.replyToKey && (
                      <p className="text-[10px] italic text-slate-400 border-l-2 border-slate-500 pl-2 mb-1 truncate">
                        {t('chat.replyPreview', { name: m.replyToName ?? '?', msg: m.replyToPreview ?? '' })}
                      </p>
                    )}
                    {m.deleted ? (
                      <p className="text-slate-500 italic">{t('chat.deleted')}</p>
                    ) : (
                      <p className="text-slate-100 whitespace-pre-wrap break-words">
                        {m.message}
                        {m.edited && <span className="text-[9px] text-slate-400 ml-1">{t('chat.edited')}</span>}
                      </p>
                    )}
                    <div className="flex gap-2 items-center justify-between mt-0.5">
                      <p className="text-[9px] text-slate-400">
                        {m.ts ? new Date(m.ts).toLocaleTimeString() : '⏳'}
                      </p>
                      {!m.deleted && (
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button className="text-[9px] text-cyan-300 hover:underline" onClick={() => setReplyTo(m)}>
                            {t('chat.reply')}
                          </button>
                          {mine && (
                            <>
                              <button className="text-[9px] text-amber-300 hover:underline" onClick={() => startEdit(m)}>
                                {t('chat.edit')}
                              </button>
                              <button className="text-[9px] text-rose-400 hover:underline" onClick={() => doDelete(m)}>
                                {t('chat.delete')}
                              </button>
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
            <div className="bg-slate-800/60 rounded px-3 py-2 text-xs flex justify-between items-start">
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
              <button className="text-slate-400 hover:text-rose-400"
                onClick={() => { setReplyTo(null); if (editing) cancelEdit(); }}>✕</button>
            </div>
          )}

          <div className="flex gap-2">
            <input value={chatMsg} onChange={e => setChatMsg(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
              placeholder={t('chat.placeholder')} maxLength={280}
              className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm" />
            <button className="btn-primary text-sm px-4"
              disabled={!chatMsg.trim() || sending || (isPending && !fbReady) || (mining && !fbReady)}
              onClick={sendChat}
            >{sending || (mining && !fbReady) ? '⏳' : editing ? t('chat.save') : t('chat.send')}</button>
          </div>
          {fbReady ? (
            <p className="text-xs text-emerald-500">
              {t('chat.rtLatency')} {fbUid ? `(${fbUid.slice(0, 6)}…)` : '…'}
            </p>
          ) : (
            <p className="text-xs text-amber-400">{t('chat.fallbackHint')}</p>
          )}
          {rateLimitMsg && <p className="text-xs text-amber-400">{rateLimitMsg}</p>}
        </div>
      )}
    </div>
  );
}
