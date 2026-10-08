'use client';

import { useEffect, useState } from 'react';

/**
 * Hook partagé — conteneur cible pour `createPortal`, à utiliser par TOUT composant qui portale
 * vers le DOM (ConfirmDialog, EnvStatusPopupLayer, FightResultModal, HiddenFamiliarPopup,
 * ParchmentPopup, PoiInteractionModal, le popup `stargateFeedback` de Platform3DWidget, WalletPanel…).
 *
 * Bug corrigé (voir demande utilisateur « le clic gauche de la souris ne fonctionne plus pour
 * ramasser les objets » en plein écran) : l'API Fullscreen native place l'élément en plein écran
 * (ex. le conteneur du widget Plateforme 3D, `fullscreenRef`) dans le « top layer » du navigateur,
 * qui s'affiche TOUJOURS au-dessus du reste du document — y compris des éléments portalés vers
 * `document.body` avec un très grand `z-index` (`z-[90]`, `z-[100]`, `z-[101]`…), puisque ce
 * dernier n'appartient pas lui-même au top layer. Résultat : cliquer sur un objet au sol en plein
 * écran déclenchait bien l'ouverture du popup (`setInteractionMarker(...)`), mais celui-ci restait
 * rendu INVISIBLE, caché derrière le canvas plein écran — donnant l'impression que le clic ne
 * faisait rien.
 *
 * Correctif : porter chaque popup vers `document.fullscreenElement` quand un élément est
 * actuellement en plein écran (il entre alors lui aussi dans le top layer, au-dessus du canvas),
 * et retomber sur `document.body` sinon (comportement identique à avant en mode fenêtré — aucune
 * régression). Se réabonne à l'évènement global `fullscreenchange` pour rester réactif, quel que
 * soit le widget qui bascule en plein écran (mécanisme générique, pas spécifique à la Plateforme 3D).
 */
export function usePortalContainer(): Element {
  const [container, setContainer] = useState<Element>(() =>
    typeof document !== 'undefined' ? (document.fullscreenElement ?? document.body) : (null as unknown as Element));

  useEffect(() => {
    const update = () => setContainer(document.fullscreenElement ?? document.body);
    update();
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  return container;
}
