'use client';

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import {
  getQuestDefs, getSolvedQuest, submitQuestAnswerOffchain, getUnlockedQuestIds,
  getRepRules, type QuestDef,
} from '@/lib/gameState';
import { useI18n, localizeName } from '@/lib/i18n';

/**
 * Quêtes à énigmes — 100% hors-chaîne (Firebase) : catalogue, réponse (hash) et récompense
 * ne transitent plus jamais par la blockchain. Zéro gas pour créer une quête (admin) ou la
 * résoudre (joueur). Voir `gameState.ts` (`QuestDef`, `submitQuestAnswerOffchain`).
 *
 * Les quêtes `npcGiver: true` restent masquées tant qu'un PNJ ne les a pas proposées et que le
 * joueur ne les a pas acceptées (voir `NpcEncounterPopup` → `pickNpcQuestForPlayer`/
 * `unlockQuestForPlayer`) — le catalogue seul ne suffit pas à les rendre visibles.
 */
export function QuestList({ playerXp }: { playerXp: number }) {
  const { t } = useI18n();
  const { address } = useAccount();
  const [quests, setQuests] = useState<QuestDef[] | null>(null);
  const [unlocked, setUnlocked] = useState<Set<string> | null>(null);

  useEffect(() => { getQuestDefs().then(setQuests).catch(() => setQuests([])); }, []);
  useEffect(() => {
    if (!address) { setUnlocked(new Set()); return; }
    getUnlockedQuestIds(address).then(setUnlocked).catch(() => setUnlocked(new Set()));
  }, [address]);

  const visible = (quests ?? []).filter(q => q.active && (!q.npcGiver || unlocked?.has(q.id.toLowerCase())));

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-3">{t('game.quests.section')}</h3>
      {quests !== null && unlocked !== null && visible.length === 0 && (
        <p className="text-sm text-slate-400">{t('game.quests.empty')}</p>
      )}
      <div className="space-y-3">
        {visible.map((q) => <QuestCard key={q.id} quest={q} playerXp={playerXp} />)}
      </div>
    </div>
  );
}

function QuestCard({ quest, playerXp }: { quest: QuestDef; playerXp: number }) {
  const { t } = useI18n();
  const { address } = useAccount();
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [solvedAnswer, setSolvedAnswer] = useState<string | null>(null);

  // Charge l'état résolu depuis Firebase (persiste au redéploiement du contrat, indépendant
  // de toute transaction blockchain). Filet de sécurité : pour les quêtes historiques déjà
  // résolues on-chain avant cette migration, `catalog/riddleAnswers` reste une simple table
  // d'appoint pour compat descendante mais ne débloque pas l'affichage tant que ce joueur
  // n'a pas lui-même résolu la quête via Firebase.
  useEffect(() => {
    if (!address) return;
    getSolvedQuest(address, quest.id).then((r) => {
      if (r) { setCompleted(true); setSolvedAnswer(r.answer); }
      else { setCompleted(false); setSolvedAnswer(null); }
    });
  }, [address, quest.id]);

  const locked = playerXp < quest.xpRequired;

  const submit = async () => {
    if (!answer || !address || checking) return;
    setChecking(true);
    setFeedback(null);
    try {
      const rules = await getRepRules();
      const result = await submitQuestAnswerOffchain(address, quest, answer, rules.questSolved);
      if (result === 'correct') {
        setFeedback(t('game.quests.correct'));
        setCompleted(true);
        setSolvedAnswer(answer.trim());
        setAnswer('');
      } else if (result === 'already') {
        setCompleted(true);
        setFeedback(t('game.quests.correct'));
      } else {
        setFeedback(t('game.quests.wrong'));
      }
    } catch (e: any) {
      setFeedback(t('game.quests.error', { msg: e?.message?.slice(0, 120) ?? 'error' }));
    }
    setTimeout(() => setFeedback(null), 3500);
    setChecking(false);
  };

  return (
    <div className={`bg-slate-800/60 rounded-lg p-4 border ${completed ? 'border-emerald-600' : locked ? 'border-slate-700 opacity-60' : 'border-slate-600'}`}>
      <div className="flex justify-between items-start mb-2">
        <p className="font-semibold flex-1">{localizeName(t, quest.i18nKey, quest.label)}</p>
        {completed && <span className="text-emerald-400 text-sm ml-2">✅</span>}
      </div>
      {completed && solvedAnswer && (
        <p className="text-xs text-emerald-300 bg-emerald-900/20 rounded px-2 py-1 mb-2">
          💡 {t('game.quests.answerWas')} : <b>{solvedAnswer}</b>
        </p>
      )}
      <p className="text-xs text-slate-400 mb-3">
        {t('game.quests.xpRequired', { v: quest.xpRequired })} · {t('game.quests.reward', { xp: quest.xpReward, score: quest.scoreReward })}
        {' · '}<span className="text-emerald-500">{t('game.quests.noGas')}</span>
      </p>
      {!completed && !locked && (
        <div className="flex gap-2">
          <input
            value={answer} onChange={e => setAnswer(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && answer) submit(); }}
            placeholder={t('game.quests.placeholder')}
            className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm"
            disabled={checking}
          />
          <button
            className="btn-primary text-sm px-4"
            disabled={!answer || checking}
            onClick={submit}
          >
            {checking ? '⏳' : t('game.quests.submit')}
          </button>
        </div>
      )}
      {locked && <p className="text-xs text-amber-400">{t('game.quests.locked', { v: quest.xpRequired })}</p>}
      {checking && <p className="text-xs text-slate-400 mt-2">{t('game.quests.checking')}</p>}
      {feedback && <p className="text-sm mt-2">{feedback}</p>}
    </div>
  );
}
