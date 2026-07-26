'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { getWorldDefs, subscribeUnlockedWorldIds, discoverWorldOffchain, RKEY, type WorldDef } from '@/lib/gameState';
import { useI18n, localizeName } from '@/lib/i18n';

/**
 * Mondes — 100% hors-chaîne (voir gameState.ts::WorldDef). Remplace l'ancienne version on-chain
 * (`addWorld`/`discoverWorld`/`worldUnlocked`) qui n'offrait aucune fonction de mise à jour — voir
 * la note dans HorizonZeldCraft.sol (`addWorld` = create-only, `require(!active)`).
 */
export function WorldList({ playerXp }: { playerXp: number }) {
  const { t } = useI18n();
  const { address } = useAccount();
  const [defs, setDefs] = useState<WorldDef[] | null>(null);
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    getWorldDefs().then(setDefs).catch(() => setDefs([]));
  }, []);
  useEffect(() => {
    if (!address) { setUnlocked(new Set()); return; }
    // Abonnement temps réel : un monde découvert via PoiInteractionModal (plateforme isométrique)
    // doit apparaître débloqué ici sans recharger la page (même bug que celui des quêtes PNJ).
    return subscribeUnlockedWorldIds(address, setUnlocked);
  }, [address]);

  const active = (defs ?? []).filter((w) => w.active);

  const discover = async (world: WorldDef) => {
    if (!address || busy) return;
    setBusy(world.id);
    try {
      const res = await discoverWorldOffchain(address, world);
      if (res === 'unlocked') setUnlocked((prev) => new Set(prev).add(RKEY(world.id)));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-3">{t('game.worlds.section')}</h3>
      <div className="grid md:grid-cols-2 gap-3">
        {active.map((world) => {
          const isUnlocked = unlocked.has(RKEY(world.id));
          const canUnlock = !isUnlocked && playerXp >= world.xpRequired;
          const label = localizeName(t, world.i18nKey, world.name);
          return (
            <div key={world.id} className={`bg-slate-800/60 rounded-lg p-3 border ${isUnlocked ? 'border-emerald-600' : 'border-slate-600'}`}>
              <p className="font-semibold">{isUnlocked ? '🌍' : '🔒'} {label}</p>
              <p className="text-xs text-slate-400 mb-2">{t('game.worlds.xpRequired', { v: world.xpRequired })}</p>
              {canUnlock && (
                <button
                  className="btn-primary text-xs w-full"
                  disabled={busy === world.id}
                  onClick={() => discover(world)}
                >{busy === world.id ? '⏳' : t('game.worlds.discover')}</button>
              )}
              {isUnlocked && <p className="text-xs text-emerald-400">{t('game.worlds.unlocked')}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
