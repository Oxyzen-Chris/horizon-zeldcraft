'use client';

import { useEffect } from 'react';
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { HORIZON_ABI } from '@/lib/contract';
import { useIdsList } from './useIdsList';

export function WorldList({ contract, tokenId, playerXp }: {
  contract: `0x${string}`; tokenId: bigint; playerXp: number;
}) {
  const ids = useIdsList(contract, 'worldsLength', 'worldIds', 20);
  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-3">🗺️ Mondes à découvrir</h3>
      <div className="grid md:grid-cols-2 gap-3">
        {ids.map((id) => <WorldCard key={id} contract={contract} worldId={id} tokenId={tokenId} playerXp={playerXp} />)}
      </div>
    </div>
  );
}

function WorldCard({ contract, worldId, tokenId, playerXp }: {
  contract: `0x${string}`; worldId: `0x${string}`; tokenId: bigint; playerXp: number;
}) {
  const queryClient = useQueryClient();
  const { data: w } = useReadContract({ address: contract, abi: HORIZON_ABI, functionName: 'worlds', args: [worldId] });
  const { data: unlocked, queryKey } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'worldUnlocked', args: [tokenId, worldId],
  });
  const { writeContract, data: txHash, isPending, reset } = useWriteContract();
  const { isLoading: mining, isSuccess: mined } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (mined) { queryClient.invalidateQueries({ queryKey }); setTimeout(() => reset(), 1500); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mined]);

  if (!w) return null;
  const [name, xpRequired, active] = w as any;
  if (!active) return null;
  const isUnlocked = !!unlocked;
  const canUnlock = playerXp >= Number(xpRequired);

  return (
    <div className={`bg-slate-800/60 rounded-lg p-3 border ${isUnlocked ? 'border-emerald-600' : 'border-slate-600'}`}>
      <p className="font-semibold">{isUnlocked ? '🌍' : '🔒'} {name}</p>
      <p className="text-xs text-slate-400 mb-2">Requiert {Number(xpRequired)} XP</p>
      {!isUnlocked && canUnlock && (
        <button
          className="btn-primary text-xs w-full"
          disabled={isPending || mining}
          onClick={() => writeContract({
            address: contract, abi: HORIZON_ABI, functionName: 'discoverWorld', args: [tokenId, worldId],
          })}
        >{mining ? '⏳' : 'Découvrir'}</button>
      )}
      {isUnlocked && <p className="text-xs text-emerald-400">✅ Débloqué</p>}
    </div>
  );
}
