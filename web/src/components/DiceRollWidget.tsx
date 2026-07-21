'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import {
  getRepRules, getOrCreatePlayer, computePlayerDiceBonus, rollD20,
  hasRolledDailyLuck, markDailyLuckRolled, applyEffect, type RepRules,
} from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';

const POS_KEY = 'zc.diceWidgetPos';
const COLLAPSED_KEY = 'zc.diceWidgetCollapsed';
const TUMBLE_MS = 900;    // durée de l'animation de tirage avant révélation du résultat
const TUMBLE_TICK = 70;   // fréquence de rafraîchissement du chiffre pendant le tumbling

interface Pos { x: number; y: number }

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

/**
 * Dé animé (façon d20 "diamant") : tumbling (rotation + chiffre aléatoire qui défile) pendant le
 * tirage, puis petit "pop" d'atterrissage une fois le résultat révélé. `landKey` change à chaque
 * tirage complet pour rejouer l'animation de pop (remount via `key`).
 */
function Die({ value, rolling, landKey, tone }: { value: number; rolling: boolean; landKey: number; tone: 'neutral' | 'win' | 'lose' }) {
  const toneClass = tone === 'win' ? 'from-emerald-600 to-emerald-800 border-emerald-300'
    : tone === 'lose' ? 'from-rose-600 to-rose-800 border-rose-300'
    : 'from-amber-600 to-amber-800 border-amber-300';
  return (
    <div
      key={rolling ? 'rolling' : landKey}
      className={`w-12 h-12 rotate-45 rounded-lg border-2 shadow-lg bg-gradient-to-br ${toneClass} flex items-center justify-center ${rolling ? 'animate-dice-tumble' : 'animate-dice-land'}`}
    >
      <span className="-rotate-45 text-base font-black text-white">{value}</span>
    </div>
  );
}

/** Tirage sans enjeu (façon "brouillon") : PNJ fictif de Force aléatoire 5-40, comme rollNpc(). */
function rollQuickTest(playerBonus: number): { playerRoll: number; npcRoll: number; npcBonus: number; win: boolean } {
  const npcForce = 5 + Math.floor(Math.random() * 40);
  const npcBonus = Math.round(Math.min(1, npcForce / 45) * 12);
  const playerRoll = rollD20();
  const npcRoll = rollD20();
  return { playerRoll, npcRoll, npcBonus, win: (playerRoll + playerBonus) > (npcRoll + npcBonus) };
}

/**
 * Fenêtre flottante et déplaçable, toujours montée sur `/game`, sans arrière-plan bloquant
 * (le joueur reste libre d'interagir avec le reste du jeu en dessous). Réutilise le même tirage
 * 1d20 pondéré (Force/Vie/Faim/Sortilèges) que les combats PNJ (`computePlayerDiceBonus`,
 * partagé via gameState.ts) — pensé comme une brique générique pour de futurs événements
 * déclenchés par un lancer de dés (voir commentaire sur `rollDaily` ci-dessous).
 *
 * Deux usages concrets déjà câblés :
 *  - "Test rapide" : lancer sans enjeu, pour s'entraîner/s'amuser (aucun effet sur le joueur).
 *  - "Destin quotidien" : 1x/jour, seuil/récompenses paramétrables (menu Administration → RepRules
 *    dailyLuckThreshold/dailyLuckWalletReward/dailyLuckRepReward/dailyLuckXpConsolation).
 */
export function DiceRollWidget() {
  const { t } = useI18n();
  const { address } = useAccount();
  const [rules, setRules] = useState<RepRules | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const [pos, setPos] = useState<Pos | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef<Pos>({ x: 0, y: 0 });

  const [bonus, setBonus] = useState(0);
  const [dailyDone, setDailyDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rolling, setRolling] = useState<'quick' | 'daily' | null>(null);
  const [spinPlayer, setSpinPlayer] = useState(1);
  const [spinNpc, setSpinNpc] = useState(1);
  const [landKey, setLandKey] = useState(0);
  const tumbleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [result, setResult] = useState<
    | { kind: 'quick'; playerRoll: number; npcRoll: number; playerBonus: number; npcBonus: number; win: boolean }
    | { kind: 'daily'; playerRoll: number; total: number; threshold: number; win: boolean; reward: string }
    | null
  >(null);

  useEffect(() => {
    getRepRules().then(setRules).catch(() => {});
    setCollapsed((localStorage.getItem(COLLAPSED_KEY) ?? '1') === '1');
    const saved = localStorage.getItem(POS_KEY);
    if (saved) { try { setPos(JSON.parse(saved)); } catch { /* ignore */ } }
    else if (typeof window !== 'undefined') setPos({ x: window.innerWidth - 88, y: window.innerHeight - 140 });
  }, []);

  useEffect(() => {
    if (!address) return;
    getOrCreatePlayer(address).then(p => {
      if (rules) setBonus(computePlayerDiceBonus(p, rules));
    }).catch(() => {});
    hasRolledDailyLuck(address).then(setDailyDone).catch(() => {});
  }, [address, rules]);

  // Coupe l'intervalle de tumbling si le widget se démonte pendant une animation en cours.
  useEffect(() => () => { if (tumbleRef.current) clearInterval(tumbleRef.current); }, []);

  // ─── Drag (pointer events) ───
  const onPointerDown = (e: React.PointerEvent) => {
    if (!pos) return;
    setDragging(true);
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const next = { x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y };
    setPos(next);
  };
  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    if (pos) localStorage.setItem(POS_KEY, JSON.stringify(pos));
  };

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      localStorage.setItem(COLLAPSED_KEY, prev ? '0' : '1');
      return !prev;
    });
  };

  /** Démarre le tumbling visuel (chiffres aléatoires qui défilent sur le/les dés). */
  const startTumble = (twoDice: boolean) => {
    setResult(null);
    setSpinPlayer(1 + Math.floor(Math.random() * 20));
    if (twoDice) setSpinNpc(1 + Math.floor(Math.random() * 20));
    tumbleRef.current = setInterval(() => {
      setSpinPlayer(1 + Math.floor(Math.random() * 20));
      if (twoDice) setSpinNpc(1 + Math.floor(Math.random() * 20));
    }, TUMBLE_TICK);
  };
  const stopTumble = () => {
    if (tumbleRef.current) { clearInterval(tumbleRef.current); tumbleRef.current = null; }
  };

  const rollQuick = async () => {
    if (rolling || busy) return;
    setRolling('quick');
    startTumble(true);
    const r = rollQuickTest(bonus);
    await sleep(TUMBLE_MS);
    stopTumble();
    setSpinPlayer(r.playerRoll);
    setSpinNpc(r.npcRoll);
    setResult({ kind: 'quick', playerRoll: r.playerRoll, npcRoll: r.npcRoll, playerBonus: bonus, npcBonus: r.npcBonus, win: r.win });
    setLandKey(k => k + 1);
    setRolling(null);
  };

  /**
   * Lancer du destin quotidien (1x/jour) : premier hook concret du widget générique de dés.
   * D'autres mécaniques (événements aléatoires, saisons, etc.) pourront réutiliser la même
   * infrastructure (bonus pondéré + tirage 1d20 + résultat affiché dans ce widget).
   */
  const rollDaily = async () => {
    if (!address || busy || rolling || dailyDone || !rules) return;
    setBusy(true);
    setRolling('daily');
    startTumble(false);
    try {
      const playerRoll = rollD20();
      const total = playerRoll + bonus;
      const win = total >= rules.dailyLuckThreshold;
      let reward: string;
      const applyPromise = (async () => {
        if (win) {
          await applyEffect(address, { wallet: rules.dailyLuckWalletReward, reputation: rules.dailyLuckRepReward });
          return `+${rules.dailyLuckWalletReward} 💰 · +${rules.dailyLuckRepReward} ⭐`;
        }
        await applyEffect(address, { xpBonus: rules.dailyLuckXpConsolation });
        return `+${rules.dailyLuckXpConsolation} XP`;
      })();
      [reward] = await Promise.all([applyPromise, sleep(TUMBLE_MS)]);
      await markDailyLuckRolled(address, win);
      stopTumble();
      setSpinPlayer(playerRoll);
      setDailyDone(true);
      setResult({ kind: 'daily', playerRoll, total, threshold: rules.dailyLuckThreshold, win, reward });
      setLandKey(k => k + 1);
    } finally {
      stopTumble();
      setBusy(false);
      setRolling(null);
    }
  };

  if (!address || !pos) return null;

  if (collapsed) {
    return (
      <button
        className="fixed z-40 w-14 h-14 rounded-full bg-slate-900 border-2 border-amber-500 text-2xl shadow-lg flex items-center justify-center"
        style={{ left: pos.x, top: pos.y }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onClick={() => !dragging && toggleCollapsed()}
        title={t('dice.title')}
      >🎲</button>
    );
  }

  return (
    <div
      className="fixed z-40 w-64 bg-slate-900 border-2 border-amber-500 rounded-xl shadow-xl select-none"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-amber-900/30 rounded-t-xl cursor-move"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      >
        <span className="text-sm font-semibold">🎲 {t('dice.title')}</span>
        <button className="text-xs opacity-70 hover:opacity-100" onClick={toggleCollapsed}>✕</button>
      </div>
      <div className="p-3 text-xs space-y-2">
        <p className="text-slate-400">{t('dice.bonusPreview', { v: bonus })}</p>

        {(rolling === 'quick' || result?.kind === 'quick') && (
          <div className="flex items-center justify-center gap-4 py-2">
            <div className="flex flex-col items-center gap-1">
              <Die
                value={spinPlayer}
                rolling={rolling === 'quick'}
                landKey={landKey}
                tone={rolling === 'quick' || !result || result.kind !== 'quick' ? 'neutral' : (result.win ? 'win' : 'lose')}
              />
              <span className="text-[10px] text-slate-500">{t('dice.you')}</span>
            </div>
            <span className="text-slate-500">vs</span>
            <div className="flex flex-col items-center gap-1">
              <Die
                value={spinNpc}
                rolling={rolling === 'quick'}
                landKey={landKey}
                tone={rolling === 'quick' || !result || result.kind !== 'quick' ? 'neutral' : (result.win ? 'lose' : 'win')}
              />
              <span className="text-[10px] text-slate-500">{t('dice.rival')}</span>
            </div>
          </div>
        )}
        {(rolling === 'daily' || result?.kind === 'daily') && (
          <div className="flex items-center justify-center py-2">
            <Die
              value={spinPlayer}
              rolling={rolling === 'daily'}
              landKey={landKey}
              tone={rolling === 'daily' || !result || result.kind !== 'daily' ? 'neutral' : (result.win ? 'win' : 'lose')}
            />
          </div>
        )}

        <button className="btn-secondary text-xs w-full disabled:opacity-40" disabled={!!rolling || busy} onClick={rollQuick}>
          {rolling === 'quick' ? '🎲…' : `🎲 ${t('dice.quickTest')}`}
        </button>
        <button className="btn-primary text-xs w-full disabled:opacity-40" disabled={busy || !!rolling || dailyDone} onClick={rollDaily}>
          {rolling === 'daily' ? '🎲…' : busy ? '⏳' : dailyDone ? t('dice.alreadyRolled') : t('dice.dailyLuck')}
        </button>

        {result && result.kind === 'quick' && (
          <div className="bg-slate-800/60 rounded p-2 mt-1">
            <p className={result.win ? 'text-emerald-400' : 'text-rose-400'}>
              {result.win ? t('dice.win') : t('dice.lose')}
            </p>
            <p className="text-slate-400">
              {t('dice.you')} {result.playerRoll}+{result.playerBonus} vs {t('dice.rival')} {result.npcRoll}+{result.npcBonus}
            </p>
          </div>
        )}
        {result && result.kind === 'daily' && (
          <div className="bg-slate-800/60 rounded p-2 mt-1">
            <p className={result.win ? 'text-emerald-400' : 'text-rose-400'}>
              {result.win ? t('dice.win') : t('dice.lose')} ({result.total} / {result.threshold})
            </p>
            <p className="text-slate-400">{result.reward}</p>
          </div>
        )}
        <p className="text-slate-500">{t('dice.hint')}</p>
      </div>
    </div>
  );
}
