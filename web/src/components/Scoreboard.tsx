'use client';

import { useReadContract } from 'wagmi';
import { HORIZON_ABI } from '@/lib/contract';

export function Scoreboard({ contract, tokenId, level, xp }: {
  contract: `0x${string}`; tokenId: bigint; level: number; xp: number;
}) {
  const { data: score } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'playerScore',
    args: [tokenId], query: { enabled: !!contract, refetchInterval: 10000 },
  });
  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-3">🏆 Tableau des scores</h3>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Score total" value={Number(score ?? 0)} color="text-yellow-400" />
        <Stat label="Niveau"      value={level}              color="text-emerald-400" />
        <Stat label="XP totale"   value={xp}                 color="text-purple-400" />
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-slate-800/60 rounded-lg p-3 text-center">
      <p className="text-xs text-slate-400 uppercase">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value.toLocaleString()}</p>
    </div>
  );
}
