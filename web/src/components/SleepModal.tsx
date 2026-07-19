'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { updatePlayer, applyEffect, type PlayerState } from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';

/**
 * Popup de repos forcé : quand HP ≤ 20, verrouille l'interface pendant 50 s puis
 * ramène HP à 75 (ou hpMax si inférieur à 75). Aucun coût en gas — pur off-chain.
 */
export function SleepModal({ player }: { player: PlayerState | null }) {
  const { t } = useI18n();
  const { address } = useAccount();
  const [asleep, setAsleep] = useState(false);
  const [remaining, setRemaining] = useState(50);
  const timerRef = useRef<any>(null);
  // Anti-boucle : si HP remonté juste après un réveil, ne relance pas immédiatement
  const lastWakeAt = useRef<number>(0);

  useEffect(() => {
    if (!player || !address) return;
    if (asleep) return;
    if (Date.now() - lastWakeAt.current < 5000) return; // 5s de grâce
    if (player.hp > 20) return;
    // Déclenchement automatique
    setAsleep(true);
    setRemaining(50);
    updatePlayer(address, { sleeping: true }).catch(() => {});
  }, [player?.hp, address, asleep]);

  // Compte à rebours 50 → 0
  useEffect(() => {
    if (!asleep) return;
    timerRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(timerRef.current);
          wake();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asleep]);

  const wake = async () => {
    if (!address || !player) return;
    // Ramène HP à 75 (ou hpMax si joueur pauvre en cap)
    const target = Math.min(75, player.hpMax ?? 100);
    const deltaHp = Math.max(0, target - player.hp);
    await applyEffect(address, { hp: deltaHp, happiness: 5 });
    await updatePlayer(address, { sleeping: false });
    lastWakeAt.current = Date.now();
    setAsleep(false);
  };

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
              style={{ width: `${((50 - remaining) / 50) * 100}%` }} />
          </div>
        </div>
        <p className="text-xs text-slate-500">{t('sleep.hint')}</p>
      </div>
    </div>
  );
}
