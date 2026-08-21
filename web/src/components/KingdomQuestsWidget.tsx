'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  computeKingdomProgress, subscribeSolvedQuestIds, submitQuestAnswerOffchain, getRepRules,
  getNextFullMoonDisplayDate, KINGDOM_CHAPTERS,
  type KingdomProgress, type KingdomQuestStatus,
} from '@/lib/gameState';
import { useI18n, localizeName } from '@/lib/i18n';
import { useWindowZIndex, handleWidgetPointerDownCapture } from '@/lib/windowZOrder';
import { useDraggableWidget } from '@/lib/useDraggableWidget';
import { WidgetContextMenu } from './WidgetContextMenu';
import { useEffectiveAccount } from '@/lib/effectiveAccount';

const POS_KEY = 'zc.kingdomWidgetPos';
const COLLAPSED_KEY = 'zc.kingdomWidgetCollapsed';

const STATUS_ICON: Record<KingdomQuestStatus, string> = {
  solved: '✅', unlocked: '👑', 'locked-intermediate': '🔒', 'locked-previous': '🔒', 'locked-moon': '🌑',
};

/**
 * Fenêtre flottante et déplaçable "Quêtes du Royaume" — affiche la progression du joueur dans le
 * fil narratif principal (400 énigmes, 40 chapitres, voir computeKingdomProgress() dans
 * gameState.ts) : quête actuellement débloquée (avec formulaire de réponse, même mécanique que
 * QuestList.tsx), raison du verrouillage sinon (XP intermédiaire manquant, quête précédente non
 * résolue, ou en attente de la prochaine pleine lune), et un récapitulatif par chapitre (10
 * quêtes chacun) pour visualiser l'avancée globale vers la libération de PocaPoka et El Pipo.
 * 100% indépendant de QuestList.tsx (quêtes classiques/PNJ, qui filtre désormais `kingdomQuest`).
 */
export function KingdomQuestsWidget({ enabled = true }: { enabled?: boolean } = {}) {
  const { t } = useI18n();
  const { address } = useEffectiveAccount();
  const { z, bringToFront } = useWindowZIndex();
  const {
    collapsed, pos, onPointerDown, onPointerMove, onPointerUp, onToggleClick, toggleCollapsed,
    containerRef, menuPos, onContextMenu, closeContextMenu, resetPosition,
  } = useDraggableWidget({
    posKey: POS_KEY, collapsedKey: COLLAPSED_KEY,
    defaultPos: () => ({ x: 24, y: 140 }),
    onExpand: bringToFront,
  });

  const [progress, setProgress] = useState<KingdomProgress | null>(null);
  const [nextMoonDate, setNextMoonDate] = useState<Date | null>(null);
  const [minIntermediate, setMinIntermediate] = useState(3);
  const [openChapter, setOpenChapter] = useState<number | null>(null);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(() => {
    if (!address) { setProgress(null); return; }
    computeKingdomProgress(address).then(setProgress).catch(() => {});
  }, [address]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!address) return;
    // Rafraîchit la progression en temps réel dès qu'une quête (classique, PNJ ou Royaume) est
    // résolue ailleurs (QuestList, PoiInteractionModal, NpcEncounterPopup…) — zéro rechargement.
    return subscribeSolvedQuestIds(address, () => refresh());
  }, [address, refresh]);
  useEffect(() => { getRepRules().then(r => setMinIntermediate(r.kingdomMinIntermediateSolved ?? 3)).catch(() => {}); }, []);
  useEffect(() => { getNextFullMoonDisplayDate().then(setNextMoonDate).catch(() => {}); }, [progress?.nextQuest?.id]);

  const submit = async () => {
    const q = progress?.nextQuest;
    if (!answer || !address || !q || checking) return;
    setChecking(true);
    setFeedback(null);
    try {
      const rules = await getRepRules();
      const result = await submitQuestAnswerOffchain(address, q, answer, rules.questSolved);
      if (result === 'correct' || result === 'already') {
        setFeedback(t('game.quests.correct'));
        setAnswer('');
        refresh();
      } else if (result === 'missing-items') {
        setFeedback(t('game.quests.missingItems'));
      } else {
        setFeedback(t('game.quests.wrong'));
      }
    } catch (e: any) {
      setFeedback(t('game.quests.error', { msg: e?.message?.slice(0, 120) ?? 'error' }));
    }
    setTimeout(() => setFeedback(null), 3500);
    setChecking(false);
  };

  if (!enabled || !pos) return null;

  if (collapsed) {
    return (
      <>
        <button
          ref={containerRef}
          className="fixed z-40 w-14 h-14 rounded-full bg-slate-900 border-2 border-amber-500 text-2xl shadow-lg flex items-center justify-center"
          style={{ left: pos.x, top: pos.y, zIndex: z }}
          onPointerDownCapture={(e) => handleWidgetPointerDownCapture(e, bringToFront)}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onClick={onToggleClick}
          onContextMenu={onContextMenu}
          title={t('game.kingdom.title')}
        >👑</button>
        <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      </>
    );
  }

  const entry = progress?.chain.find(e => e.quest.id === progress?.nextQuest?.id);
  const lockedEntry = !progress?.nextQuest ? progress?.chain.find(e => e.status !== 'solved') : undefined;
  const lockStatus = lockedEntry?.status;

  return (
    <div
      ref={containerRef}
      className="fixed z-40 w-80 max-h-[70vh] bg-slate-900 border-2 border-amber-500 rounded-xl shadow-xl select-none flex flex-col"
      style={{ left: pos.x, top: pos.y, zIndex: z }}
      onPointerDownCapture={(e) => handleWidgetPointerDownCapture(e, bringToFront)}
      onContextMenu={onContextMenu}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-amber-900/30 rounded-t-xl cursor-move shrink-0"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      >
        <span className="text-sm font-semibold">👑 {t('game.kingdom.title')}</span>
        <button className="text-xs opacity-70 hover:opacity-100" data-widget-close onClick={toggleCollapsed}>✕</button>
      </div>
      <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      <div className="p-3 overflow-y-auto">
        {!address && <p className="text-xs text-slate-400">{t('game.kingdom.connectFirst')}</p>}
        {address && !progress && <p className="text-xs text-slate-400">⏳</p>}
        {address && progress && (
          <>
            <div className="mb-3">
              <div className="flex justify-between text-xs mb-1">
                <span>{t('game.kingdom.progress')}</span>
                <span className="text-slate-400">{progress.solvedCount} / {progress.totalCount}</span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded overflow-hidden">
                <div className="h-full bg-amber-500" style={{ width: `${(progress.solvedCount / Math.max(1, progress.totalCount)) * 100}%` }} />
              </div>
            </div>

            {progress.nextQuest && entry && (
              <div className="bg-slate-800/60 border border-amber-600 rounded-lg p-3 mb-3">
                <p className="text-[10px] uppercase tracking-wide text-amber-400 font-bold mb-1">
                  👑 {t('game.kingdom.badge')} · {t('game.kingdom.chapterLabel', { n: progress.nextQuest.kingdomChapter ?? '?' })}
                  {progress.nextQuest.fullMoonOnly && <span className="ml-1">🌕</span>}
                </p>
                <p className="text-sm font-semibold mb-2">{localizeName(t, progress.nextQuest.i18nKey, progress.nextQuest.label)}</p>
                <p className="text-xs text-slate-400 mb-2">
                  {t('game.quests.reward', { xp: progress.nextQuest.xpReward, score: progress.nextQuest.scoreReward })}
                  {' · '}<span className="text-emerald-500">{t('game.quests.noGas')}</span>
                </p>
                {!!progress.nextQuest.requiresItems?.length && (
                  <p className="text-xs text-amber-300 bg-amber-900/20 rounded px-2 py-1 mb-2">
                    🧩 {t('game.quests.requiresItems', { items: progress.nextQuest.requiresItems.map(r => `${r.name} ×${r.qty}`).join(', ') })}
                  </p>
                )}
                <div className="flex gap-2">
                  <input
                    value={answer} onChange={e => setAnswer(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && answer) submit(); }}
                    placeholder={t('game.quests.placeholder')}
                    className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm"
                    disabled={checking}
                  />
                  <button className="btn-primary text-sm px-4" disabled={!answer || checking} onClick={submit}>
                    {checking ? '⏳' : t('game.quests.submit')}
                  </button>
                </div>
                {feedback && <p className="text-sm mt-2">{feedback}</p>}
              </div>
            )}

            {!progress.nextQuest && lockedEntry && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-3 mb-3">
                <p className="text-xs text-amber-400">
                  {lockStatus === 'locked-intermediate' && t('game.kingdom.lockedIntermediate', { v: minIntermediate })}
                  {lockStatus === 'locked-previous' && t('game.kingdom.lockedPrevious')}
                  {lockStatus === 'locked-moon' && t('game.kingdom.lockedMoon', {
                    // Une quête peut avoir sa propre date de pleine lune précise (admin, "Quêtes
                    // existantes" → calendrier) au lieu de la prochaine pleine lune globale.
                    date: lockedEntry.quest.fullMoonDate ?? (nextMoonDate ? nextMoonDate.toLocaleDateString() : '…'),
                  })}
                </p>
              </div>
            )}
            {!progress.nextQuest && !lockedEntry && (
              <div className="bg-emerald-900/30 border border-emerald-600 rounded-lg p-3 mb-3">
                <p className="text-sm text-emerald-300">🎉 {t('game.kingdom.complete')}</p>
              </div>
            )}

            <div className="space-y-1">
              {KINGDOM_CHAPTERS.map(ch => {
                const entries = progress.chain.filter(e => e.quest.kingdomChapter === ch.chapter);
                const solved = entries.filter(e => e.status === 'solved').length;
                const isOpen = openChapter === ch.chapter;
                return (
                  <div key={ch.chapter} className="border border-slate-700 rounded">
                    <button
                      className="w-full flex items-center justify-between px-2 py-1.5 text-xs hover:bg-slate-800/60"
                      onClick={() => setOpenChapter(isOpen ? null : ch.chapter)}
                    >
                      <span>{ch.icon} {localizeName(t, ch.i18nKey, ch.title)}</span>
                      <span className="text-slate-500">{solved}/{entries.length || 10}</span>
                    </button>
                    {isOpen && (
                      <div className="px-2 pb-2 flex flex-wrap gap-1">
                        {entries.map(e => (
                          <span
                            key={e.quest.id}
                            title={e.status === 'solved' || e.status === 'unlocked' ? localizeName(t, e.quest.i18nKey, e.quest.label) : t('game.kingdom.hidden')}
                            className="text-sm"
                          >
                            {STATUS_ICON[e.status]}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
