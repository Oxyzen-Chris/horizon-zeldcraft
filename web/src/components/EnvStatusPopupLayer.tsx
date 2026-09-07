'use client';

import { createPortal } from 'react-dom';

/**
 * Enveloppe les pop-up d'état environnemental (Altitude/Profondeur, Manque d'oxygène, Récupération
 * d'oxygène — voir GameCanvas2D.tsx/WorldMapWidget.tsx) pour les faire passer AU-DESSUS de TOUS les
 * widgets flottants, exactement comme le compte à rebours Démo (voir DemoSessionTimerWidget.tsx),
 * au lieu de rester piégées dans le contexte d'empilement LOCAL du widget qui les héberge.
 *
 * Cause du bug corrigé : chaque widget flottant (GameCanvas2D, WorldMapWidget, Platform3DWidget…)
 * est un conteneur `position: fixed` avec un `z-index` géré par `lib/windowZOrder.ts` (plage
 * 40-89, voir `useWindowZIndex`/`bringToFront`). Un `position:fixed` + `z-index` établit toujours
 * une NOUVELLE pile d'empilement CSS — donc même si un pop-up interne porte lui-même `z-[90]`
 * (`position:fixed`), il n'est comparé QU'AUX AUTRES ENFANTS DE SON PROPRE WIDGET : tout le
 * sous-arbre du widget est ensuite peint comme un seul bloc, au niveau du z-index DU WIDGET
 * (40-89) face aux AUTRES widgets. Résultat : si un autre widget vient d'être mis au premier plan
 * (clic dessus → `bringToFront()`), il peut cacher ENTIÈREMENT le pop-up d'un widget resté en
 * arrière-plan, quelle que soit la valeur `z-[90]` de ce pop-up — un bug silencieux similaire à
 * celui déjà corrigé pour `NpcEncounterPopup.tsx` (voir commentaire de `MAX_Z` dans
 * `lib/windowZOrder.ts`).
 *
 * Correctif : un `React.createPortal` fait sortir le pop-up de l'arbre DOM du widget pour le
 * monter directement sous `document.body` — il n'hérite alors plus AUCUNE pile d'empilement de
 * widget, et son propre `z-[90]` (déjà présent sur chaque pop-up concerné) est comparé directement
 * à la racine, au-dessus de TOUS les widgets (plafonnés à 89) et sous les bannières globales
 * (Démo/annonces/élixirs, `z-[9997]` à `z-[9999]`, qui ne se chevauchent de toute façon jamais
 * spatialement avec ces indicateurs bas-d'écran/coin d'écran).
 *
 * Paramétrable via `RepRules.envStatusPopupsOnTop` (Administration, section « 🚨 Pop-up d'état
 * environnemental ») : si désactivé, restitue EXACTEMENT le comportement historique (rendu local,
 * peut être recouvert par un autre widget mis au premier plan) — utile pour un admin qui préfère
 * l'ancien comportement ou qui rencontre un cas d'usage particulier.
 */
export function EnvStatusPopupLayer({ onTop, children }: { onTop: boolean; children: React.ReactNode }) {
  if (onTop && typeof document !== 'undefined') return createPortal(<>{children}</>, document.body);
  return <>{children}</>;
}
