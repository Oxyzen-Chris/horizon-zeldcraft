'use client';

import { useState, useEffect } from 'react';
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { HORIZON_ABI } from '@/lib/contract';
import { useIdsList } from './useIdsList';

export function QuestList({ contract, tokenId, playerXp }: {
  contract: `0x${string}`; tokenId: bigint; playerXp: number;
}) {
  const ids = useIdsList(contract, 'questsLength', 'questIds', 20);
  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-3">📜 Quêtes à énigmes</h3>
      {ids.length === 0 && <p className="text-sm text-slate-400">Aucune quête disponible pour l&apos;instant.</p>}
      <div className="space-y-3">
        {ids.map((id) => <QuestCard key={id} contract={contract} questId={id} tokenId={tokenId} playerXp={playerXp} />)}
      </div>
    </div>
  );
}

function QuestCard({ contract, questId, tokenId, playerXp }: {
  contract: `0x${string}`; questId: `0x${string}`; tokenId: bigint; playerXp: number;
}) {
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: q, queryKey } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'quests', args: [questId],
  });
  const { data: done, queryKey: doneKey } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'questCompleted', args: [tokenId, questId],
  });
  const { writeContract, data: txHash, isPending, reset, error } = useWriteContract();
  const { isLoading: mining, isSuccess: mined, isError: minedErr } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (mined) {
      setFeedback('✅ Bonne réponse ! Récompense reçue.');
      queryClient.invalidateQueries({ queryKey: doneKey });
      queryClient.invalidateQueries({ queryKey });
      setTimeout(() => { reset(); setFeedback(null); }, 3000);
    }
    if (minedErr) {
      setFeedback('❌ Mauvaise réponse, essaie encore !');
      setTimeout(() => { reset(); setFeedback(null); }, 3000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mined, minedErr]);

  useEffect(() => {
    if (error) {
      setFeedback('❌ ' + (error.message.includes('wrong answer') ? 'Mauvaise réponse' : error.message.slice(0, 80)));
      setTimeout(() => { reset(); setFeedback(null); }, 4000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  if (!q) return null;
  const [label, xpRequired, xpReward, scoreReward, , , , active] = q as any;
  if (!active) return null;
  const locked = playerXp < Number(xpRequired);
  const completed = !!done;

  return (
    <div className={`bg-slate-800/60 rounded-lg p-4 border ${completed ? 'border-emerald-600' : locked ? 'border-slate-700 opacity-60' : 'border-slate-600'}`}>
      <div className="flex justify-between items-start mb-2">
        <p className="font-semibold flex-1">{label}</p>
        {completed && <span className="text-emerald-400 text-sm ml-2">✅</span>}
      </div>
      <p className="text-xs text-slate-400 mb-3">
        XP requis : {Number(xpRequired)} · Récompense : +{Number(xpReward)} XP, +{Number(scoreReward)} score
      </p>
      {!completed && !locked && (
        <div className="flex gap-2">
          <input
            value={answer} onChange={e => setAnswer(e.target.value)}
            placeholder="Ta réponse (minuscules)…"
            className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm"
            disabled={isPending || mining}
          />
          <button
            className="btn-primary text-sm px-4"
            disabled={!answer || isPending || mining}
            onClick={() => writeContract({
              address: contract, abi: HORIZON_ABI, functionName: 'submitQuestAnswer',
              args: [tokenId, questId, answer.toLowerCase().trim()],
            })}
          >
            {mining ? '⏳' : 'Valider'}
          </button>
        </div>
      )}
      {locked && <p className="text-xs text-amber-400">🔒 Il te faut {Number(xpRequired)} XP pour tenter cette énigme.</p>}
      {feedback && <p className="text-sm mt-2">{feedback}</p>}
    </div>
  );
}
