'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { getTreasureDefs, subscribeFoundTreasureIds, openTreasureOffchain, claimMissingTreasureItem, getCurrentSeason, RKEY, type TreasureDef, type Season } from '@/lib/gameState';
import { useI18n, localizeName } from '@/lib/i18n';

/**
 * Trésors — 100% hors-chaîne (voir gameState.ts::TreasureDef). Ouverture manuelle une fois le
 * seuil `xpRequired` atteint (même mécanique que WorldList). Remplace l'ancienne version on-chain
 * dont l'ouverture (`treasureFound`) n'était déclenchée que par l'ancien `submitQuestAnswer`
 * on-chain — devenu obsolète depuis la migration des quêtes vers `submitQuestAnswerOffchain`
 * (aucun trésor ne pouvait donc plus jamais être trouvé).
 */
export function TreasureList({ playerXp }: { playerXp: number }) {
  const { t } = useI18n();
  const { address } = useAccount();
  const [defs, setDefs] = useState<TreasureDef[] | null>(null);
  const [found, setFound] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [season, setSeason] = useState<Season | null>(null);

  useEffect(() => {
    getTreasureDefs().then((all) => {
      setDefs(all);
      // Rattrapage silencieux : les trésors déjà "trouvés" avant l'ajout d'itemReward (ou avant la
      // correction du bug de clé RTDB avec points) n'avaient jamais reçu leur objet en besace.
      if (address) all.forEach((tr) => claimMissingTreasureItem(address, tr).catch(() => {}));
    }).catch(() => setDefs([]));
  }, [address]);
  useEffect(() => {
    if (!address) { setFound(new Set()); return; }
    // Abonnement temps réel : un coffre ouvert depuis la plateforme isométrique
    // (PoiInteractionModal) doit se refléter ici sans recharger la page.
    return subscribeFoundTreasureIds(address, setFound);
  }, [address]);
  useEffect(() => { getCurrentSeason().then(setSeason).catch(() => {}); }, []);

  // Un trésor tagué `season` reste masqué hors de sa saison tant qu'il n'a pas déjà été trouvé.
  const active = (defs ?? []).filter((d) => d.active
    && (!d.season || d.season === season || found.has(RKEY(d.id))));

  const open = async (treasure: TreasureDef) => {
    if (!address || busy) return;
    setBusy(treasure.id);
    try {
      const res = await openTreasureOffchain(address, treasure);
      if (res === 'found') setFound((prev) => new Set(prev).add(RKEY(treasure.id)));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-3">{t('game.treasures.section')}</h3>
      {active.length === 0 && <p className="text-sm text-slate-400">{t('game.treasures.empty')}</p>}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {active.map((tr) => {
          const owned = found.has(RKEY(tr.id));
          const canOpen = !owned && playerXp >= tr.xpRequired;
          const label = localizeName(t, tr.i18nKey, tr.name);
          return (
            <div key={tr.id} className={`rounded p-2 text-center text-xs ${owned ? 'bg-yellow-900/40 border border-yellow-600' : 'bg-slate-800/40 border border-slate-700'}`}>
              <div className="text-2xl">{owned ? '💎' : '🔒'}</div>
              <p className="mt-1 font-semibold truncate">{owned ? label : '???'}</p>
              {!owned && <p className="text-slate-500 mt-0.5">{t('game.treasures.xpRequired', { v: tr.xpRequired })}</p>}
              {canOpen && (
                <button className="btn-primary text-xs w-full mt-1.5" disabled={busy === tr.id} onClick={() => open(tr)}>
                  {busy === tr.id ? '⏳' : t('game.treasures.open')}
                </button>
              )}
              {owned && <p className="text-emerald-400 mt-0.5">{t('game.treasures.found')}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
