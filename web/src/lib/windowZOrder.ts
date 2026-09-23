'use client';

import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Gestion partagée de l'empilement (z-index) des fenêtres widget flottantes (Dés, Chat d'équipe,
 * Équipement de Synk, Widgets personnalisés, etc.). Toutes ces fenêtres démarrent au même niveau
 * (BASE_Z) ; quand le joueur clique/glisse une fenêtre, `bringToFront()` la fait passer au premier
 * plan devant toutes les autres.
 *
 * v2 (corrige un bug remonté par le joueur : « en cliquant ou en déplaçant une fenêtre active,
 * elle passe parfois SOUS les autres » — reproduit et confirmé via Playwright). L'ancienne
 * implémentation utilisait un compteur global `sharedTopZ` incrémenté à chaque `bringToFront()` et
 * PLAFONNÉ à MAX_Z=89 (pour ne jamais dépasser le z-index des pop-up plein écran, voir plus bas) :
 * une fois le plafond atteint, le compteur revenait à BASE_Z+1 et REPARTAIT À ZÉRO — deux fenêtres
 * distinctes pouvaient alors se voir attribuer le MÊME z-index (ou un widget jamais retouché
 * récemment recevoir malgré tout un z-index supérieur à celui de la fenêtre réellement active),
 * auquel cas l'ordre d'affichage retombe sur l'ordre du DOM (le dernier widget monté dans l'arbre
 * React gagne, indépendamment du clic du joueur). Avec 16+ fenêtres flottantes et un plafond de
 * seulement 50 valeurs (40-89), ce rebouclage survenait au bout d'à peine ~50 clics/glissers
 * cumulés sur l'ensemble des widgets d'une partie — largement atteignable en quelques minutes de
 * jeu normal, d'où la fréquence du bug remonté.
 *
 * Nouvelle approche : une PILE partagée (`stack`, du plus ancien/arrière au plus récent/premier
 * plan) qui ne connaît PAS de plafond numérique — le z-index affiché de chaque fenêtre est
 * recalculé à chaque changement comme `BASE_Z + rang_dans_la_pile`, où le rang est toujours un
 * entier COMPACT et UNIQUE parmi les fenêtres actuellement montées (0, 1, 2, … sans trou ni
 * doublon). Amener une fenêtre au premier plan la déplace simplement en tête de pile ; démonter un
 * widget (fermeture définitive, changement de page) la retire de la pile, ce qui recompacte
 * automatiquement les rangs des autres. Le nombre de fenêtres flottantes RÉELLEMENT montées en même
 * temps restant très inférieur à 50 (16 widgets natifs + éventuels widgets personnalisés créés par
 * l'admin), `BASE_Z + rang` reste toujours confortablement sous MAX_Z — sans jamais pouvoir
 * dépasser le z-index des pop-up plein écran (rencontre PNJ, repos en hutte, etc., voir
 * NpcEncounterPopup.tsx à z-[95]/z-[96]) : `Math.min(..., MAX_Z)` reste en garde-fou de sécurité
 * si ce nombre venait un jour à exploser (des dizaines de widgets personnalisés ouverts en même
 * temps), auquel cas seul l'ordre RELATIF des widgets excédentaires redeviendrait indéterminé —
 * un cas extrême, sans commune mesure avec la fréquence du bug corrigé ici.
 *
 * Portée module (partagée par toutes les instances du hook côté client, pas de Context React
 * nécessaire puisque toutes les fenêtres sont montées dans le même arbre `/game`) : un petit
 * système pub/sub (`listeners`) notifie TOUTES les fenêtres montées à chaque changement de la
 * pile, pour qu'elles recalculent leur rang (et donc leur z-index affiché) — nécessaire car
 * amener UNE fenêtre au premier plan, ou en démonter une autre, peut décaler le rang de fenêtres
 * qui n'ont elles-mêmes reçu aucune interaction.
 */
const BASE_Z = 40;
const MAX_Z = 89; // < 90 : reste toujours sous la moindre pop-up plein écran (PoiInteractionModal etc.)

let stack: symbol[] = [];
const listeners = new Set<() => void>();
function notifyAll() { listeners.forEach(l => l()); }

export function useWindowZIndex() {
  // Identifiant stable de CETTE instance de fenêtre (une par widget monté), créé une seule fois.
  const [id] = useState<symbol>(() => Symbol('widget-z'));
  const [, forceRecompute] = useState(0);

  useEffect(() => {
    if (!stack.includes(id)) stack = [...stack, id]; // nouvelle fenêtre = tout en arrière au montage
    const listener = () => forceRecompute(n => n + 1);
    listeners.add(listener);
    return () => {
      stack = stack.filter(s => s !== id);
      listeners.delete(listener);
      notifyAll(); // recompacte le rang des fenêtres restantes après démontage de celle-ci
    };
  }, [id]);

  const bringToFront = useCallback(() => {
    stack = [...stack.filter(s => s !== id), id]; // ...ou tout en avant, en tête de pile
    notifyAll();
  }, [id]);

  const rank = stack.indexOf(id);
  const z = Math.min(BASE_Z + Math.max(0, rank), MAX_Z);
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
