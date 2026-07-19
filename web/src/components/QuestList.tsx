'use client';

import { useState, useEffect } from 'react';
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient, useAccount } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { HORIZON_ABI, normalizeAnswer, decodeContractError } from '@/lib/contract';
import { markQuestSolved, getSolvedQuest, applyEffect, getRepRules } from '@/lib/gameState';
import { useIdsList } from './useIdsList';
import { useI18n } from '@/lib/i18n';

export function QuestList({ contract, tokenId, playerXp }: {
  contract: `0x${string}`; tokenId: bigint; playerXp: number;
}) {
  const { t } = useI18n();
  const ids = useIdsList(contract, 'questsLength', 'questIds', 20);
  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-3">{t('game.quests.section')}</h3>
      {ids.length === 0 && <p className="text-sm text-slate-400">{t('game.quests.empty')}</p>}
      <div className="space-y-3">
        {ids.map((id) => <QuestCard key={id} contract={contract} questId={id} tokenId={tokenId} playerXp={playerXp} />)}
      </div>
    </div>
  );
}

function QuestCard({ contract, questId, tokenId, playerXp }: {
  contract: `0x${string}`; questId: `0x${string}`; tokenId: bigint; playerXp: number;
}) {
  const { t } = useI18n();
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [solvedAnswer, setSolvedAnswer] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const publicClient = usePublicClient();
  const { address } = useAccount();

  const { data: q, queryKey } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'quests', args: [questId],
  });
  const { data: done, queryKey: doneKey } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'questCompleted', args: [tokenId, questId],
  });
  const { writeContract, data: txHash, isPending, reset } = useWriteContract();
  const { isSuccess: mined } = useWaitForTransactionReceipt({ hash: txHash });

  // Charge la réponse depuis Firebase si la quête est déjà résolue (persiste au redéploiement)
  useEffect(() => {
    if (done && address) {
      getSolvedQuest(address, questId).then((r) => r && setSolvedAnswer(r.answer));
    }
  }, [done, address, questId]);

  useEffect(() => {
    if (mined && address) {
      setFeedback(t('game.quests.correct'));
      // Enregistre en DB la réponse pour révélation + bonus étendu (bonheur, force, sorts, faim, wallet)
      const normalized = normalizeAnswer(answer);
      markQuestSolved(address, questId, normalized).catch(() => {});
      getRepRules().then(r => applyEffect(address, {
        happiness: 8, force: 2, spells: 3, hunger: 5, wallet: 25, reputation: r.questSolved,
      })).catch(() => {});
      setSolvedAnswer(normalized);
      queryClient.invalidateQueries({ queryKey: doneKey });
      queryClient.invalidateQueries({ queryKey });
      setTimeout(() => { reset(); setFeedback(null); }, 3000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mined]);

  if (!q) return null;
  const [label, xpRequired, xpReward, scoreReward, , , , active] = q as any;
  if (!active) return null;
  const locked = playerXp < Number(xpRequired);
  const completed = !!done;

  // Pré-simule la transaction pour détecter la revert AVANT MetaMask (évite l'écran d'erreur cryptique)
  const submit = async () => {
    if (!answer || !publicClient || !address) return;
    setChecking(true);
    setFeedback(null);
    const normalized = normalizeAnswer(answer);
    try {
      await publicClient.simulateContract({
        address: contract, abi: HORIZON_ABI, functionName: 'submitQuestAnswer',
        args: [tokenId, questId, normalized], account: address,
      });
      // Simulation OK → on lance la vraie transaction (MetaMask va ouvrir)
      writeContract({
        address: contract, abi: HORIZON_ABI, functionName: 'submitQuestAnswer',
        args: [tokenId, questId, normalized],
      });
    } catch (err: any) {
      const reason = decodeContractError(err);
      if (/wrong answer/i.test(reason)) {
        setFeedback(t('game.quests.wrong'));
      } else {
        setFeedback(t('game.quests.error', { msg: reason }));
      }
      setTimeout(() => setFeedback(null), 4500);
    }
    setChecking(false);
  };

  return (
    <div className={`bg-slate-800/60 rounded-lg p-4 border ${completed ? 'border-emerald-600' : locked ? 'border-slate-700 opacity-60' : 'border-slate-600'}`}>
      <div className="flex justify-between items-start mb-2">
        <p className="font-semibold flex-1">{label}</p>
        {completed && <span className="text-emerald-400 text-sm ml-2">✅</span>}
      </div>
      {completed && solvedAnswer && (
        <p className="text-xs text-emerald-300 bg-emerald-900/20 rounded px-2 py-1 mb-2">
          💡 {t('game.quests.answerWas')} : <b>{solvedAnswer}</b>
        </p>
      )}
      <p className="text-xs text-slate-400 mb-3">
        {t('game.quests.xpRequired', { v: Number(xpRequired) })} · {t('game.quests.reward', { xp: Number(xpReward), score: Number(scoreReward) })}
      </p>
      {!completed && !locked && (
        <div className="flex gap-2">
          <input
            value={answer} onChange={e => setAnswer(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && answer) submit(); }}
            placeholder={t('game.quests.placeholder')}
            className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm"
            disabled={isPending || checking}
          />
          <button
            className="btn-primary text-sm px-4"
            disabled={!answer || isPending || checking}
            onClick={submit}
          >
            {checking || isPending ? '⏳' : t('game.quests.submit')}
          </button>
        </div>
      )}
      {locked && <p className="text-xs text-amber-400">{t('game.quests.locked', { v: Number(xpRequired) })}</p>}
      {checking && <p className="text-xs text-slate-400 mt-2">{t('game.quests.checking')}</p>}
      {feedback && <p className="text-sm mt-2">{feedback}</p>}
    </div>
  );
}
