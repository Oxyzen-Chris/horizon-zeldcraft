'use client';

import { useEffect, useRef, useState } from 'react';
import { updatePlayer, applyEffect, DEFAULT_REP_RULES, type PlayerState, type RepRules } from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';
import { useEffectiveAccount } from '@/lib/effectiveAccount';

/**
 * Popup de repos forcé : quand HP ≤ `rules.sleepHpThreshold`, verrouille l'interface pendant
 * `rules.sleepDurationSec` puis ramène HP à `rules.sleepWakeHp` (ou hpMax si inférieur) et accorde
 * `rules.sleepHappinessBonus` de Bonheur. Aucun coût en gas — pur off-chain. Tous ces réglages sont
 * paramétrables dans le menu Administration (voir RepRulesPanel.tsx).
 *
 * Voir demande utilisateur « Pendant que Synk se repose de force, il a 1 chance sur 6 (1/6) qu'on
 * lui vole 100 coins [...] S'il a moins de 100 coins, cela sera 50% de ces coins [...] Affiche un
 * pop-up une fois le repos terminé [...] » : au réveil, un tirage "1 chance sur `sleepTheftOneInN`"
 * détermine si un voleur est passé pendant le sommeil — un handicap pour ne pas avoir géré
 * correctement son état de fatigue/santé. Si c'est le cas, un second pop-up s'affiche juste après
 * le réveil pour l'en informer (montant volé fixe ou en pourcentage selon le solde, voir `wake()`).
 */
export function SleepModal({ player, rules }: { player: PlayerState | null; rules?: RepRules | null }) {
  const { t } = useI18n();
  const { address } = useEffectiveAccount();
  const r = rules ?? DEFAULT_REP_RULES;
  const durationSec = Math.max(1, r.sleepDurationSec ?? 50);
  const [asleep, setAsleep] = useState(false);
  const [remaining, setRemaining] = useState(durationSec);
  const timerRef = useRef<any>(null);
  // Anti-boucle : si HP remonté juste après un réveil, ne relance pas immédiatement
  const lastWakeAt = useRef<number>(0);
  // Montant dérobé pendant ce sommeil (voir wake() ci-dessous) — `null` tant qu'aucun pop-up de vol
  // n'est à afficher ; affiché APRÈS la fermeture du pop-up de sommeil (jamais en même temps).
  const [theftAmount, setTheftAmount] = useState<number | null>(null);

  useEffect(() => {
    if (!player || !address) return;
    if (asleep) return;
    const graceMs = Math.max(0, r.sleepGraceSec ?? 5) * 1000;
    if (Date.now() - lastWakeAt.current < graceMs) return;
    if (player.hp > (r.sleepHpThreshold ?? 20)) return;
    // Déclenchement automatique
    setAsleep(true);
    setRemaining(durationSec);
    updatePlayer(address, { sleeping: true }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player?.hp, address, asleep, r.sleepGraceSec, r.sleepHpThreshold, durationSec]);

  // Compte à rebours durationSec → 0
  useEffect(() => {
    if (!asleep) return;
    timerRef.current = setInterval(() => {
      setRemaining((rem) => {
        if (rem <= 1) {
          clearInterval(timerRef.current);
          wake();
          return 0;
        }
        return rem - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asleep]);

  const wake = async () => {
    if (!address || !player) return;
    // Ramène HP à sleepWakeHp (ou hpMax si joueur pauvre en cap)
    const target = Math.min(r.sleepWakeHp ?? 75, player.hpMax ?? 100);
    const deltaHp = Math.max(0, target - player.hp);
    // Vol pendant le sommeil (voir en-tête de fichier) — tirage "1 chance sur sleepTheftOneInN"
    // (0 = désactivé, même convention que `fightLootMaxItems`). Montant fixe `sleepTheftAmount` si
    // le solde le permet, sinon `sleepTheftPoorPct`% du solde actuel (jamais négatif : `applyEffect`
    // plafonne de toute façon le portefeuille à 0 minimum, mais le calcul ci-dessous ne dépasse de
    // toute façon jamais le solde réellement possédé).
    const oneInN = Math.floor(r.sleepTheftOneInN ?? 6);
    let stolen = 0;
    if (oneInN > 0 && player.wallet > 0 && Math.random() < 1 / oneInN) {
      const threshold = Math.max(0, r.sleepTheftAmount ?? 100);
      if (player.wallet >= threshold) {
        stolen = threshold;
      } else {
        const pct = Math.max(0, Math.min(100, r.sleepTheftPoorPct ?? 50)) / 100;
        stolen = Math.max(1, Math.floor(player.wallet * pct));
      }
    }
    await applyEffect(address, {
      hp: deltaHp, happiness: r.sleepHappinessBonus ?? 5,
      ...(stolen > 0 ? { wallet: -stolen } : {}),
    });
    await updatePlayer(address, { sleeping: false });
    lastWakeAt.current = Date.now();
    setAsleep(false);
    if (stolen > 0) setTheftAmount(stolen);
  };

  if (theftAmount != null) {
    return (
      <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[100] p-4">
        <div className="bg-slate-900 border-2 border-rose-500 rounded-xl p-8 max-w-md w-full text-center">
          <div className="text-7xl mb-4">🥷</div>
          <h3 className="text-2xl font-bold text-rose-300 mb-2">{t('sleep.theft.title')}</h3>
          <p className="text-sm text-slate-300 mb-6">{t('sleep.theft.message', { amount: theftAmount })}</p>
          <button
            className="px-6 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 text-white font-semibold"
            onClick={() => setTheftAmount(null)}
          >{t('sleep.theft.close')}</button>
        </div>
      </div>
    );
  }

  if (!asleep) return null;

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[100] p-4">
      <div className="bg-slate-900 border-2 border-indigo-500 rounded-xl p-8 max-w-md w-full text-center">
        <div className="text-7xl mb-4 animate-pulse">🛌</div>
        <h3 className="text-2xl font-bold text-indigo-300 mb-2">{t('sleep.title')}</h3>
        <p className="text-sm text-slate-400 mb-6">{t('sleep.description')}</p>
        <div className="bg-slate-800/60 rounded-lg p-4 mb-4">
          <p className="text-5xl font-mono text-cyan-300">{remaining}s</p>
          <div className="w-full bg-slate-700 rounded-full h-2 mt-3">
            <div className="bg-indigo-500 h-2 rounded-full transition-all"
              style={{ width: `${((durationSec - remaining) / durationSec) * 100}%` }} />
          </div>
        </div>
        <p className="text-xs text-slate-500">{t('sleep.hint')}</p>
      </div>
    </div>
  );
}
