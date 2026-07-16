'use client';

import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { HORIZON_ABI } from '@/lib/contract';
import { parseAbiItem } from 'viem';

type Msg = { sender: string; message: string; ts: number };

export function TeamsPanel({ contract }: { contract: `0x${string}` }) {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const publicClient = usePublicClient();

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

  const { writeContract, data: txHash, isPending, reset } = useWriteContract();
  const { isLoading: mining, isSuccess: mined } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (mined) {
      queryClient.invalidateQueries({ queryKey });
      setChatMsg('');
      setTimeout(() => reset(), 1000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mined]);

  // Charge les messages du chat (events des 10 000 derniers blocs)
  useEffect(() => {
    if (!inTeam || !publicClient) return;
    let cancelled = false;
    const load = async () => {
      try {
        const latest = await publicClient.getBlockNumber();
        const fromBlock = latest > 10000n ? latest - 10000n : 0n;
        const logs = await publicClient.getLogs({
          address: contract,
          event: parseAbiItem('event TeamMessage(uint256 indexed teamId, address indexed sender, string message, uint64 timestamp)'),
          args: { teamId: BigInt(currentTeamId) },
          fromBlock, toBlock: 'latest',
        });
        if (cancelled) return;
        const msgs: Msg[] = logs.map((l: any) => ({
          sender: l.args.sender, message: l.args.message, ts: Number(l.args.timestamp),
        }));
        msgs.sort((a, b) => a.ts - b.ts);
        setMessages(msgs.slice(-50));
      } catch { /* ignore */ }
    };
    load();
    const id = setInterval(load, 8000);
    return () => { cancelled = true; clearInterval(id); };
  }, [inTeam, currentTeamId, contract, publicClient]);

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
              <p className="text-xs text-slate-400">ID: {currentTeamId} · {members ? (members as any[]).length : 0} membre(s)</p>
            </div>
            <button className="btn-danger text-xs"
              disabled={isPending || mining}
              onClick={() => writeContract({
                address: contract, abi: HORIZON_ABI, functionName: 'leaveTeam', args: [],
              })}
            >Quitter</button>
          </div>
          <div className="bg-slate-950/60 rounded p-3 max-h-48 overflow-y-auto space-y-1 text-sm">
            {messages.length === 0 && <p className="text-xs text-slate-500 italic">Aucun message. Sois le premier !</p>}
            {messages.map((m, i) => (
              <p key={i}>
                <span className="text-cyan-400 text-xs font-mono">{m.sender.slice(0, 6)}…</span>
                {' '}<span className="text-slate-200">{m.message}</span>
              </p>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={chatMsg} onChange={e => setChatMsg(e.target.value)}
              placeholder="Message d'équipe (max 280 car)…" maxLength={280}
              className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm" />
            <button className="btn-primary text-sm px-4"
              disabled={!chatMsg || isPending || mining}
              onClick={() => writeContract({
                address: contract, abi: HORIZON_ABI, functionName: 'sendTeamMessage', args: [chatMsg],
              })}
            >{mining ? '⏳' : 'Envoyer'}</button>
          </div>
          <p className="text-xs text-slate-500">💡 Chat on-chain — chargé toutes les 8s.</p>
        </div>
      )}
    </div>
  );
}
