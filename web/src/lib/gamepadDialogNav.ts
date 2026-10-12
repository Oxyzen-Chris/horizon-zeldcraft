'use client';

import { useEffect } from 'react';

/**
 * Navigation manette À L'INTÉRIEUR des boîtes de dialogue/pop-up (PoiInteractionModal.tsx,
 * ConfirmDialog.tsx, pop-up de retour de la Porte des étoiles dans Platform3DWidget.tsx, etc.) —
 * voir demande utilisateur « quand j'ai voulu ramasser la hache [...] place la boîte de dialogue
 * en avant-plan de telle manière qu'en utilisant les touches de direction, je puisse passer sur
 * chacune des actions possibles de cette dernière [...] Dès qu'une action via le GamePad déclenche
 * l'ouverture d'une fenêtre, les touches directionnelles doivent permettre de se déplacer dans le
 * popup [...] Place un focus visuel [...] sur l'action [...] quand le joueur se déplace dessus ».
 *
 * Module PUR (comme gamepadInput.ts/roamingActors.ts) + un petit hook React ci-dessous, partagé par
 * TOUTE boîte de dialogue susceptible d'être ouverte pendant une session manette. Principe : une
 * PILE de conteneurs de dialogue actuellement montés — le SOMMET (dialogue le plus récemment
 * ouvert, ex. un ConfirmDialog ouvert PAR-DESSUS un PoiInteractionModal) est seul "actif". Tant que
 * la pile n'est pas vide, le pavé directionnel/stick gauche — normalement lu par `readMoveDelta()`
 * pour déplacer Synk (voir GameCanvas2D.tsx, seul sondeur de la manette) — déplace à la place le
 * focus clavier parmi les éléments interactifs (`<button>`, liens, champs) du dialogue actif, et le
 * bouton Confirmer (A) clique l'élément actuellement focus au lieu de déclencher l'action
 * contextuelle habituelle (ramassage d'objet/ouverture de porte, voir handleGamepadInteract).
 */

let dialogStack: HTMLElement[] = [];

function activeDialog(): HTMLElement | null {
  return dialogStack.length ? dialogStack[dialogStack.length - 1] : null;
}

export function isGamepadDialogActive(): boolean {
  return dialogStack.length > 0;
}

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), a[href], [role="button"]:not([aria-disabled="true"]), ' +
  'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function focusableElements(container: HTMLElement): HTMLElement[] {
  // `offsetParent !== null` écarte les éléments masqués (ex. un onglet interne non actif) — ne
  // retient que ce qui est réellement visible/cliquable à l'écran.
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((el) => el.offsetParent !== null);
}

function focusFirst(container: HTMLElement): void {
  // 🆕 Priorité au bouton d'ACTION PRINCIPALE du dialogue (`.btn-primary`, ex. « Enter the crypt »,
  // « Tame », « Pick up », « Open », « Enter », « Rest »...) plutôt qu'au premier élément focusable
  // en ordre DOM — qui est très souvent la petite croix « ✕ » de fermeture, placée en premier dans
  // le markup (en-tête du dialogue) mais rarement l'action que le joueur souhaite réellement
  // effectuer. Voir demande utilisateur « positionne le focus du curseur du GamePad par défaut sur
  // le bouton de l'action principale [...] pour que le joueur ait juste à valider en actionnant la
  // touche A [...] et si son choix est de fermer la boîte de dialogue, il se déplacera lui-même
  // avec les touches directionnelles ». Chaque corps de `PoiInteractionModal.tsx` (Npc/Familiar/
  // Drop/Treasure/Quest/World/Hut/Crypt) utilise déjà `className="btn-primary ..."` EXCLUSIVEMENT
  // pour son action principale (jamais pour ✕/Fermer/Annuler, voir grep) — aucun changement requis
  // dans ces composants, un simple ordre de préférence ici suffit. Si aucun `.btn-primary` visible/
  // activable n'existe (ex. `ConfirmDialog`/le pop-up de retour de Porte des étoiles, qui n'ont pas
  // cette classe), comportement INCHANGÉ : premier élément focusable en ordre DOM (déjà correct
  // pour `ConfirmDialog`, dont le bouton "Oui" est déjà le premier élément du markup).
  const els = focusableElements(container);
  if (!els.length) return;
  const primary = els.find((el) => el.classList.contains('btn-primary'));
  (primary ?? els[0]).focus();
}

/** Enregistre un conteneur de dialogue comme actif (sommet de pile) — à appeler au MONTAGE (voir
 * `useGamepadDialogFocusTrap` ci-dessous), désinscrit au DÉMONTAGE. Focus automatiquement le
 * premier élément interactif trouvé pour que le joueur voie IMMÉDIATEMENT où se trouve le curseur
 * manette, sans attendre un premier appui directionnel. */
export function registerGamepadDialog(el: HTMLElement): () => void {
  dialogStack.push(el);
  focusFirst(el);
  return () => {
    dialogStack = dialogStack.filter((d) => d !== el);
    const next = activeDialog();
    if (next) focusFirst(next);
  };
}

/** Déplace le focus clavier vers l'élément interactif précédent/suivant du dialogue ACTIF (sommet
 * de pile) — Haut/Gauche = précédent, Bas/Droite = suivant, avec rebouclage en fin de liste. Ne
 * fait rien si aucun dialogue n'est actif (l'appelant doit alors laisser le déplacement normal de
 * Synk s'exécuter, voir le `if (isGamepadDialogActive())` de GameCanvas2D.tsx). */
export function moveDialogFocus(dir: 'up' | 'down' | 'left' | 'right'): void {
  const dialog = activeDialog();
  if (!dialog) return;
  const els = focusableElements(dialog);
  if (!els.length) return;
  const current = document.activeElement as HTMLElement | null;
  const idx = current ? els.indexOf(current) : -1;
  const delta = (dir === 'up' || dir === 'left') ? -1 : 1;
  const nextIdx = idx === -1 ? 0 : (idx + delta + els.length) % els.length;
  els[nextIdx].focus();
}

/** Bouton A (confirmer) alors qu'un dialogue est actif : clique l'élément actuellement focus.
 * Renvoie `true` si un dialogue était actif (et donc qu'une activation a bien eu lieu), pour que
 * l'appelant SAUTE l'action contextuelle normale (handleGamepadInteract) à la place. */
export function confirmGamepadDialogFocus(): boolean {
  const dialog = activeDialog();
  if (!dialog) return false;
  const current = document.activeElement as HTMLElement | null;
  if (current && dialog.contains(current)) { current.click(); return true; }
  const els = focusableElements(dialog);
  if (els.length) { els[0].click(); return true; }
  return false;
}

/** Bouton B (annuler) alors qu'un dialogue est actif : clique sur son contrôle de fermeture
 * explicite (voir `data-gamepad-close` posé sur la croix "✕"/le bouton Annuler de chaque dialogue
 * adapté) — plus fiable qu'une recherche par texte traduit (4 langues). Renvoie `true` si un tel
 * contrôle a été trouvé et cliqué ; sinon `false` (l'appelant peut alors se rabattre sur la frappe
 * Échap déjà émise, voir ConfirmDialog.tsx qui l'écoute nativement). */
export function cancelGamepadDialogFocus(): boolean {
  const dialog = activeDialog();
  if (!dialog) return false;
  const closeBtn = dialog.querySelector<HTMLElement>('[data-gamepad-close]');
  if (closeBtn) { closeBtn.click(); return true; }
  return false;
}

/**
 * Hook d'intégration pour un composant de dialogue : enregistre `ref.current` tant que `active`
 * est vrai. Usage minimal dans un composant existant (voir PoiInteractionModal.tsx/
 * ConfirmDialog.tsx) : `const dialogRef = useRef<HTMLDivElement>(null);
 * useGamepadDialogFocusTrap(dialogRef, !!marker);` puis poser `ref={dialogRef}` sur le conteneur
 * (carte) du dialogue — zéro autre changement requis pour bénéficier de la navigation manette.
 */
export function useGamepadDialogFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active || !ref.current) return;
    return registerGamepadDialog(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
