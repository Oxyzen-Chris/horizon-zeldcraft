'use client';

import { useEffect } from 'react';
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { HORIZON_ABI } from '@/lib/contract';
import { useIdsList } from './useIdsList';

export function NpcList({ contract, tokenId }: { contract: `0x${string}`; tokenId: bigint }) {
  const ids = useIdsList(contract, 'npcsLength', 'npcIds', 20);
  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-3">🧙 Personnages (PNJ)</h3>
      {ids.length === 0 && <p className="text-sm text-slate-400">Personne à rencontrer pour l&apos;instant.</p>}
      <div className="grid md:grid-cols-2 gap-3">
        {ids.map((id) => <NpcCard key={id} contract={contract} npcId={id} tokenId={tokenId} />)}
      </div>
    </div>
  );
}

function NpcCard({ contract, npcId, tokenId }: { contract: `0x${string}`; npcId: `0x${string}`; tokenId: bigint }) {
  const queryClient = useQueryClient();
  const { data: n } = useReadContract({ address: contract, abi: HORIZON_ABI, functionName: 'npcs', args: [npcId] });
  const { data: met, queryKey } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'npcMet', args: [tokenId, npcId],
  });
  const { writeContract, data: txHash, isPending, reset } = useWriteContract();
  const { isLoading: mining, isSuccess: mined } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (mined) { queryClient.invalidateQueries({ queryKey }); setTimeout(() => reset(), 1500); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mined]);

  if (!n) return null;
  const [name, dialog, xp, , active] = n as any;
  if (!active) return null;
  const isMet = !!met;

  return (
    <div className={`bg-slate-800/60 rounded-lg p-3 border ${isMet ? 'border-emerald-600' : 'border-slate-600'}`}>
      <p className="font-semibold text-cyan-300">{name} {isMet && '✅'}</p>
      <p className="text-xs italic text-slate-400 my-2">&ldquo;{dialog}&rdquo;</p>
      <p className="text-xs text-slate-500 mb-2">+{Number(xp)} XP à la rencontre</p>
      {!isMet && (
        <button
          className="btn-primary text-xs w-full"
          disabled={isPending || mining}
          onClick={() => writeContract({
            address: contract, abi: HORIZON_ABI, functionName: 'meetNpc', args: [tokenId, npcId],
          })}
        >{mining ? '⏳' : 'Rencontrer'}</button>
      )}
    </div>
  );
}
