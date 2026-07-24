'use client';

import { useCallback, useState } from 'react';

/**
 * Gestion partagée de l'empilement (z-index) des fenêtres widget flottantes (Dés, Chat d'équipe,
 * Équipement de Synk, Widgets personnalisés, etc.). Toutes ces fenêtres démarrent au même niveau
 * (BASE_Z) ; quand le joueur clique/glisse une fenêtre, `bringToFront()` lui attribue le z-index
 * le plus élevé du moment, la faisant passer au premier plan devant toutes les autres.
 *
 * Compteur en portée module (partagé par toutes les instances du hook côté client) : pas besoin
 * de Context React puisque toutes les fenêtres sont montées dans le même arbre `/game`.
 */
const BASE_Z = 40;
let sharedTopZ = BASE_Z;

export function useWindowZIndex() {
  const [z, setZ] = useState(BASE_Z);

  const bringToFront = useCallback(() => {
    sharedTopZ += 1;
    setZ(sharedTopZ);
  }, []);

  return { z, bringToFront };
}
