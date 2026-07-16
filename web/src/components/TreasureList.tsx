'use client';

import { useReadContract } from 'wagmi';
import { HORIZON_ABI } from '@/lib/contract';
import { useIdsList } from './useIdsList';

export function TreasureList({ contract, tokenId }: { contract: `0x${string}`; tokenId: bigint }) {
  const ids = useIdsList(contract, 'treasuresLength', 'treasureIds', 20);
  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-3">💎 Trésors trouvés</h3>
      {ids.length === 0 && <p className="text-sm text-slate-400">Aucun trésor défini.</p>}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {ids.map((id) => <Chest key={id} contract={contract} treasureId={id} tokenId={tokenId} />)}
      </div>
    </div>
  );
}

function Chest({ contract, treasureId, tokenId }: { contract: `0x${string}`; treasureId: `0x${string}`; tokenId: bigint }) {
  const { data: t } = useReadContract({ address: contract, abi: HORIZON_ABI, functionName: 'treasures', args: [treasureId] });
  const { data: found } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'treasureFound', args: [tokenId, treasureId],
    query: { refetchInterval: 10000 },
  });
  if (!t) return null;
  const [name, , active] = t as any;
  if (!active) return null;
  const owned = !!found;
  return (
    <div className={`rounded p-2 text-center text-xs ${owned ? 'bg-yellow-900/40 border border-yellow-600' : 'bg-slate-800/40 border border-slate-700 opacity-50'}`}>
      <div className="text-2xl">{owned ? '💎' : '❔'}</div>
      <p className="mt-1 font-semibold truncate">{owned ? name : '???'}</p>
    </div>
  );
}
