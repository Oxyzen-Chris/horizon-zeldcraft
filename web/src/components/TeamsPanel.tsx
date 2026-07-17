'use client';

import { useState, useEffect, useRef } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { HORIZON_ABI } from '@/lib/contract';
import { getFirebaseDb, isFirebaseConfigured, ensureAnonSignIn } from '@/lib/firebase';
import { ref, push, query, orderByChild, limitToLast, onValue, off, serverTimestamp } from 'firebase/database';

type Msg = { sender: string; message: string; ts: number };

export function TeamsPanel({ contract }: { contract: `0x${string}` }) {
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
  const lastSendAt = useRef<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fbReady = isFirebaseConfigured();

  // Authentification anonyme Firebase (une fois par session)
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

  // ─── Chat temps réel via Firebase RTDB (nécessite auth anonyme) ───
  useEffect(() => {
    if (!inTeam || !fbReady || !fbUid) return;
    const db = getFirebaseDb();
    if (!db) return;
    const roomKey = `${contract.toLowerCase()}_${currentTeamId}`;
    const msgsRef = query(ref(db, `chats/${roomKey}`), orderByChild('ts'), limitToLast(50));
    const handler = onValue(msgsRef, (snap) => {
      const list: Msg[] = [];
      snap.forEach((child) => {
        const v = child.val() as any;
        if (v && typeof v.message === 'string') {
          list.push({ sender: v.sender ?? '?', message: v.message, ts: v.ts ?? 0 });
        }
      });
      list.sort((a, b) => a.ts - b.ts);
      setMessages(list);
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
    }, (err) => console.error('[chat] read error:', err));
    return () => off(msgsRef, 'value', handler);
  }, [inTeam, currentTeamId, contract, fbReady, fbUid]);

  const sendChat = async () => {
    if (!chatMsg.trim() || !address) return;

    // Rate limit client : 1 message toutes les 2 secondes
    const now = Date.now();
    if (now - lastSendAt.current < 2000) {
      const remain = Math.ceil((2000 - (now - lastSendAt.current)) / 1000);
      setRateLimitMsg(`⏳ Attends ${remain}s avant d'envoyer un autre message`);
      setTimeout(() => setRateLimitMsg(null), 2000);
      return;
    }

    if (fbReady) {
      const db = getFirebaseDb();
      if (!db) return;
      // S'assure d'être authentifié avant l'écriture (règles exigent auth != null)
      const user = await ensureAnonSignIn();
      if (!user) { setRateLimitMsg('❌ Impossible de s\'authentifier'); return; }

      setSending(true);
      try {
        const roomKey = `${contract.toLowerCase()}_${currentTeamId}`;
        await push(ref(db, `chats/${roomKey}`), {
          uid:     user.uid,             // Vérifié par les règles Firebase (anti-spoof)
          sender:  address,              // Adresse wallet pour l'affichage
          message: chatMsg.slice(0, 280),
          ts:      serverTimestamp(),
        });
        lastSendAt.current = now;
        setChatMsg('');
      } catch (e: any) {
        console.error(e);
        setRateLimitMsg('❌ ' + (e?.message?.slice(0, 80) ?? 'Envoi refusé'));
        setTimeout(() => setRateLimitMsg(null), 4000);
      }
      setSending(false);
    } else {
      // Fallback on-chain (lent, cher, kept for compat)
      writeContract({
        address: contract, abi: HORIZON_ABI, functionName: 'sendTeamMessage', args: [chatMsg],
      });
      lastSendAt.current = now;
    }
  };

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-3">👥 Équipe multi-joueurs</h3>

      {!inTeam ? (
        <div className="space-y-4">
          <div>
            <p className="text-sm text-slate-400 mb-2">Crée ta propre équipe :</p>
            <div className="flex gap-2">
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="Nom de l'équipe" maxLength={32}
                className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm" />
              <button className="btn-primary text-sm px-4"
                disabled={!name || isPending || mining}
                onClick={() => writeContract({
                  address: contract, abi: HORIZON_ABI, functionName: 'createTeam', args: [name],
                })}
              >{mining ? '⏳' : 'Créer'}</button>
            </div>
          </div>
          <div>
            <p className="text-sm text-slate-400 mb-2">Ou rejoins une équipe existante (ID numérique) :</p>
            <div className="flex gap-2">
              <input value={joinId} onChange={e => setJoinId(e.target.value)}
                placeholder="ID d'équipe (ex: 1)"
                className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm" />
              <button className="btn-secondary text-sm px-4"
                disabled={!joinId || isPending || mining}
                onClick={() => writeContract({
                  address: contract, abi: HORIZON_ABI, functionName: 'joinTeam', args: [BigInt(joinId)],
                })}
              >{mining ? '⏳' : 'Rejoindre'}</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <div>
              <p className="font-semibold text-cyan-300">🛡️ {(team as any)?.[0]}</p>
              <p className="text-xs text-slate-400">
                ID: {currentTeamId} · {members ? (members as any[]).length : 0} membre(s)
                {fbReady ? ' · 🟢 Chat temps réel' : ' · 🟡 Chat on-chain (fallback)'}
              </p>
            </div>
            <button className="btn-danger text-xs"
              disabled={isPending || mining}
              onClick={() => writeContract({
                address: contract, abi: HORIZON_ABI, functionName: 'leaveTeam', args: [],
              })}
            >Quitter</button>
          </div>

          <div ref={scrollRef} className="bg-slate-950/60 rounded p-3 h-64 overflow-y-auto space-y-1 text-sm">
            {messages.length === 0 && (
              <p className="text-xs text-slate-500 italic">
                {fbReady ? 'Aucun message. Sois le premier !' : 'Configure Firebase pour activer le chat temps réel (voir docs).'}
              </p>
            )}
            {messages.map((m, i) => {
              const mine = address && m.sender.toLowerCase() === address.toLowerCase();
              return (
                <div key={i} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] rounded-lg px-3 py-1.5 ${mine ? 'bg-emerald-700/60' : 'bg-slate-800'}`}>
                    <p className="text-[10px] font-mono text-cyan-300">{m.sender.slice(0, 6)}…{m.sender.slice(-4)}</p>
                    <p className="text-slate-100 whitespace-pre-wrap break-words">{m.message}</p>
                    <p className="text-[9px] text-slate-400 text-right">
                      {m.ts ? new Date(m.ts).toLocaleTimeString() : '⏳'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex gap-2">
            <input value={chatMsg} onChange={e => setChatMsg(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
              placeholder="Message d'équipe (max 280 car)…" maxLength={280}
              className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm" />
            <button className="btn-primary text-sm px-4"
              disabled={!chatMsg.trim() || sending || (isPending && !fbReady) || (mining && !fbReady)}
              onClick={sendChat}
            >{sending || (mining && !fbReady) ? '⏳' : 'Envoyer'}</button>
          </div>
          {fbReady ? (
            <p className="text-xs text-emerald-500">
              ⚡ Firebase Realtime DB · latence &lt; 500 ms · 🔒 Auth anonyme {fbUid ? `(${fbUid.slice(0, 6)}…)` : '…'}
            </p>
          ) : (
            <p className="text-xs text-amber-400">
              💡 Ajoute <code>NEXT_PUBLIC_FIREBASE_*</code> dans <code>.env.local</code> pour activer le chat temps réel.
              Sinon fallback on-chain (transaction pour chaque message).
            </p>
          )}
          {rateLimitMsg && <p className="text-xs text-amber-400">{rateLimitMsg}</p>}
        </div>
      )}
    </div>
  );
}
