'use client';

import { useEffect, useMemo, useState } from 'react';
import { subscribeFoundTreasureEntries, isTreasureCurrentlyHidden, type TreasureFoundEntry } from './gameState';

/**
 * Hook partagé (voir demande utilisateur « il doit [...] surtout disparaitre de l'endroit précis
 * où il a été récupéré par Synk pour faire plus naturel. Il pourra réapparaitre à cet endroit mais
 * seulement quelques temps plus tard (48 heures par exemple) ») — factorise la logique de masquage
 * des marqueurs `kind === 'treasure'` déjà ramassés par CE joueur et pas encore réapparus, pour
 * éviter de la dupliquer dans GameCanvas2D.tsx / Platform3DWidget.tsx / WorldMapWidget.tsx qui
 * partagent tous les trois le même flux `getAllMapMarkers()` (voir MapMarker/TreasureDef dans
 * lib/gameState.ts). Réactif : s'abonne à `players/{address}/treasuresFound` (Firebase RTDB) via
 * `subscribeFoundTreasureEntries`, donc un ramassage se reflète immédiatement dans les 3 vues sans
 * recharger la page ni re-fetcher le catalogue.
 *
 * Retourne un `Set<string>` de CLÉS Firebase (RKEY(treasure.id), pas l'id brut — voir
 * `lib/gameState.ts::RKEY`/`openTreasureOffchain`) actuellement masquées — chaque widget filtre ses
 * marqueurs bruts via `markers.filter(m => m.kind !== 'treasure' || !hiddenTreasureIds.has(RKEY(m.id)))`.
 */
export function useHiddenTreasureIds(address: string | null | undefined, respawnHours: number): Set<string> {
  const [entries, setEntries] = useState<Record<string, TreasureFoundEntry>>({});
  useEffect(() => {
    if (!address) { setEntries({}); return; }
    return subscribeFoundTreasureEntries(address, setEntries);
  }, [address]);
  return useMemo(() => {
    const hidden = new Set<string>();
    for (const [id, entry] of Object.entries(entries)) {
      if (isTreasureCurrentlyHidden(entry, respawnHours)) hidden.add(id);
    }
    return hidden;
  }, [entries, respawnHours]);
}
