'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { restAtHut, updatePlayer, type RepRules } from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';

/**
 * Pop-up de repos volontaire dans une hutte — déclenché en cliquant sur une hutte adjacente à
 * Synk dans le widget Plateforme 2D isométrique (voir GameCanvas2D.tsx). Reprend la mécanique de
 * SleepModal.tsx (verrouillage de l'interface pendant un compte à rebours) mais est déclenché
 * manuellement (et non automatiquement sur HP bas) et plafonné à une utilisation toutes les
 * `rules.hutRestCooldownHours` heures (voir gameState.ts::restAtHut/getHutRestRemainingMs).
 */
export function HutRestModal({
  active, rules, onDone,
}: {
  active: boolean;
  rules: RepRules;
  onDone: (result: 'ok' | 'cooldown') => void;
}) {
  const { t } = useI18n();
  const { address } = useAccount();
  const durationSec = Math.max(1, rules.hutRestDurationSec);
  const [remaining, setRemaining] = useState(durationSec);
  const timerRef = useRef<any>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    doneRef.current = false;
    setRemaining(durationSec);
    if (address) updatePlayer(address, { sleeping: true }).catch(() => {});
    timerRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(timerRef.current);
          finish();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const finish = async () => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (address) {
      const result = await restAtHut(address, rules);
      await updatePlayer(address, { sleeping: false });
      onDone(result);
    } else {
      onDone('cooldown');
    }
  };

  if (!active) return null;

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[100] p-4">
      <div className="bg-slate-900 border-2 border-amber-500 rounded-xl p-8 max-w-md w-full text-center">
        <div className="text-7xl mb-4 animate-pulse">🛖</div>
        <h3 className="text-2xl font-bold text-amber-300 mb-2">{t('hutRest.title')}</h3>
        <p className="text-sm text-slate-400 mb-6">{t('hutRest.description', { hp: rules.hutRestHp })}</p>
        <div className="bg-slate-800/60 rounded-lg p-4 mb-4">
          <p className="text-5xl font-mono text-amber-300">{remaining}s</p>
          <div className="w-full bg-slate-700 rounded-full h-2 mt-3">
            <div className="bg-amber-500 h-2 rounded-full transition-all"
              style={{ width: `${((durationSec - remaining) / durationSec) * 100}%` }} />
          </div>
        </div>
        <p className="text-xs text-slate-500">{t('hutRest.hint')}</p>
      </div>
    </div>
  );
}
