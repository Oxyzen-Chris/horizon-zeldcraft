'use client';

import { useEffect } from 'react';
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { HORIZON_ABI, NPC_SKINS, NPC_NAME_SUFFIXES, NPC_SUFFIX_KEYS, NPC_ID_TO_KEY } from '@/lib/contract';
import { useI18n, localizeName } from '@/lib/i18n';

export function NpcList({ contract, tokenId }: { contract: `0x${string}`; tokenId: bigint }) {
  const { t } = useI18n();
  const { data: ids, queryKey: idsKey } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'todaysNpcs',
    args: [tokenId], query: { enabled: !!contract, refetchInterval: 60000 },
  });
  const { data: maxPerDay } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'npcMaxPerDay',
    query: { enabled: !!contract, refetchInterval: 60000 },
  });
  const list = (ids ?? []) as `0x${string}`[];

  return (
    <div className="card">
      <div className="flex justify-between items-baseline mb-3">
        <h3 className="text-lg font-semibold">{t('game.npcs.section')}</h3>
        <span className="text-xs text-slate-400">
          {t('game.npcs.today', { n: list.length, max: Number(maxPerDay ?? 4) })}
        </span>
      </div>
      {list.length === 0 && <p className="text-sm text-slate-400">{t('game.npcs.empty')}</p>}
      <div className="grid md:grid-cols-2 gap-3">
        {list.map((id) => (
          <NpcCard key={id} contract={contract} npcId={id} tokenId={tokenId} idsKey={idsKey} />
        ))}
      </div>
    </div>
  );
}

function NpcCard({ contract, npcId, tokenId, idsKey }: {
  contract: `0x${string}`; npcId: `0x${string}`; tokenId: bigint; idsKey: any;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { data: n } = useReadContract({ address: contract, abi: HORIZON_ABI, functionName: 'npcs', args: [npcId] });
  const { data: skinIdx } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'npcSkinFor', args: [tokenId, npcId],
  });
  const { data: met, queryKey } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'npcMet', args: [tokenId, npcId],
  });
  const { writeContract, data: txHash, isPending, reset } = useWriteContract();
  const { isLoading: mining, isSuccess: mined } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (mined) {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: idsKey });
      setTimeout(() => reset(), 1500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mined]);

  if (!n) return null;
  const [baseName, dialog, xp, , active] = n as any;
  if (!active) return null;
  const isMet = !!met;
  const skinI = Math.min(3, Number(skinIdx ?? 0));
  const emoji = NPC_SKINS[skinI];
  const npcKey = NPC_ID_TO_KEY[npcId.toLowerCase()];
  const localizedBase = localizeName(t, npcKey ? `npc.official.${npcKey}` : undefined, baseName);
  const suffix = localizeName(t, `npc.suffix.${NPC_SUFFIX_KEYS[skinI]}`, NPC_NAME_SUFFIXES[skinI]);
  const displayName = `${localizedBase} ${suffix}`;

  return (
    <div className={`bg-slate-800/60 rounded-lg p-3 border ${isMet ? 'border-emerald-600' : 'border-slate-600'}`}>
      <div className="flex items-start gap-3">
        <span className="text-4xl">{emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-cyan-300 truncate">
            {displayName} {isMet && '✅'}
          </p>
          <p className="text-xs italic text-slate-400 my-1">&ldquo;{dialog}&rdquo;</p>
          <p className="text-xs text-slate-500 mb-2">{t('game.npcs.xpReward', { v: Number(xp) })}</p>
          {!isMet && (
            <button
              className="btn-primary text-xs w-full"
              disabled={isPending || mining}
              onClick={() => writeContract({
                address: contract, abi: HORIZON_ABI, functionName: 'meetNpc', args: [tokenId, npcId],
              })}
            >{mining ? '⏳' : t('game.npcs.meet')}</button>
          )}
        </div>
      </div>
    </div>
  );
}
