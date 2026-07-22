'use client';

import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { HORIZON_ABI } from '@/lib/contract';
import { getRepRules, type RepRules } from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';

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
  const [rules, setRules] = useState<RepRules | null>(null);

  useEffect(() => { getRepRules().then(setRules).catch(() => {}); }, []);

  const { writeContract, data: txHash, isPending, reset } = useWriteContract();
  const { isLoading: mining, isSuccess: mined } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (mined) { queryClient.invalidateQueries({ queryKey }); setTimeout(() => reset(), 1000); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mined]);

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-3">{t('game.teams.section')}</h3>

      {/* Info tarifaire (purement indicative pour l'instant — aucun paiement débité) */}
      {rules && (
        <p className="text-xs text-amber-300 bg-amber-900/20 border border-amber-700/40 rounded p-2 mb-3">
          💬 {t('game.teams.chatCostInfo', { eth: rules.teamChatCreationCostEth, fiat: rules.teamChatCreationCostFiatHint })}
        </p>
      )}

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
              </p>
            </div>
            <button className="btn-danger text-xs"
              disabled={isPending || mining}
              onClick={() => writeContract({
                address: contract, abi: HORIZON_ABI, functionName: 'leaveTeam', args: [],
              })}
            >{t('game.teams.leave')}</button>
          </div>
          <p className="text-xs text-slate-400">💬 {t('game.teams.useWidgetHint')}</p>
        </div>
      )}
    </div>
  );
}

