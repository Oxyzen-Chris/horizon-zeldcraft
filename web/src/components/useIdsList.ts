'use client';

import { useReadContract } from 'wagmi';
import { HORIZON_ABI } from '@/lib/contract';

/**
 * Charge et affiche jusqu'à N items d'une liste dynamique (questIds, npcIds…)
 * Callback render permet d'afficher chaque item selon son type.
 */
export function useIdsList(
  contract: `0x${string}` | undefined,
  lengthFn: 'questsLength' | 'npcsLength' | 'treasuresLength' | 'worldsLength',
  idFn:     'questIds'     | 'npcIds'     | 'treasureIds'     | 'worldIds',
  max = 20
) {
  const { data: len } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: lengthFn,
    query: { enabled: !!contract, refetchInterval: 30000 },
  });
  const count = Math.min(Number(len ?? 0), max);
  const ids: (`0x${string}` | undefined)[] = [];
  for (let i = 0; i < max; i++) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { data } = useReadContract({
      address: contract, abi: HORIZON_ABI, functionName: idFn,
      args: [BigInt(i)], query: { enabled: !!contract && i < count },
    });
    ids.push(data as `0x${string}` | undefined);
  }
  return ids.slice(0, count).filter(Boolean) as `0x${string}`[];
}
