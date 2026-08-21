'use client';

import { useCallback, useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Gestion partagée de l'empilement (z-index) des fenêtres widget flottantes (Dés, Chat d'équipe,
 * Équipement de Synk, Widgets personnalisés, etc.). Toutes ces fenêtres démarrent au même niveau
 * (BASE_Z) ; quand le joueur clique/glisse une fenêtre, `bringToFront()` lui attribue le z-index
 * le plus élevé du moment, la faisant passer au premier plan devant toutes les autres.
 *
 * Plafonné à MAX_Z : sans plafond, un compteur qui grimpe indéfiniment (une simple session de jeu
 * normale suffit à dépasser 50-60 clics/glissers) finissait par dépasser le z-index des pop-up
 * plein écran (rencontre PNJ, repos en hutte, etc.), qui se retrouvaient alors rendues MAIS
 * invisibles, cachées derrière une fenêtre widget — un bug silencieux à l'origine, entre autres,
 * de la disparition des pop-up de rencontre PNJ (voir NpcEncounterPopup.tsx, désormais à z-[95]/
 * z-[96], au-dessus de ce plafond). Une fois le plafond atteint, le compteur revient juste après
 * BASE_Z : cela ne fait que recycler l'ordre d'empilement entre widgets (effet cosmétique mineur),
 * sans jamais pouvoir dépasser une pop-up plein écran.
 *
 * Compteur en portée module (partagé par toutes les instances du hook côté client) : pas besoin
 * de Context React puisque toutes les fenêtres sont montées dans le même arbre `/game`.
 */
const BASE_Z = 40;
const MAX_Z = 89; // < 90 : reste toujours sous la moindre pop-up plein écran (PoiInteractionModal etc.)
let sharedTopZ = BASE_Z;

export function useWindowZIndex() {
  const [z, setZ] = useState(BASE_Z);

  const bringToFront = useCallback(() => {
    sharedTopZ = sharedTopZ >= MAX_Z ? BASE_Z + 1 : sharedTopZ + 1;
    setZ(sharedTopZ);
  }, []);

  return { z, bringToFront };
}

/**
 * À poser en `onPointerDownCapture` sur le conteneur racine (icône réduite ET fenêtre dépliée) de
 * CHAQUE widget flottant, à la place d'un `bringToFront` brut. Corrige le bug remonté : cliquer
 * sur le bouton "✕" (réduire/fermer) d'une fenêtre déclenchait quand même `bringToFront()` — via
 * ce même gestionnaire posé sur tout le conteneur, capturé AVANT que le clic n'atteigne le bouton
 * lui-même — ce qui faisait passer l'icône résultante AU-DESSUS de la fenêtre réellement "au
 * focus" (celle sur laquelle le joueur venait de cliquer/glisser juste avant). Réduire une fenêtre
 * ne doit jamais changer l'ordre d'empilement : ce garde-fou ignore tout pointerdown dont la cible
 * porte (ou descend de) l'attribut `data-widget-close`, que les 16 widgets doivent poser sur leur
 * bouton "✕" pour bénéficier du correctif.
 */
export function handleWidgetPointerDownCapture(e: ReactPointerEvent, bringToFront: () => void) {
  if ((e.target as HTMLElement | null)?.closest?.('[data-widget-close]')) return;
  bringToFront();
}

