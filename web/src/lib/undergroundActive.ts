'use client';

/**
 * Registre partagé (portée module, même pattern que `platform3dActive.ts` — aucun Context
 * nécessaire, les deux composants sont montés dans le même arbre `/game`) indiquant si Synk est
 * actuellement "sous terre" : dans le couloir d'un souterrain de crypte, une salle d'arrivée
 * (chambre/pièce à parchemin) ou en haut d'une tour de donjon (voir Platform3DWidget.tsx::
 * `cryptMode`, non-`null` dans les trois cas).
 *
 * Répond à la demande utilisateur « désactive ou arrête d'afficher les pop-up de quêtes (combats,
 * quêtes, troc, discussion, etc...) quand je suis dans un souterrain [...] je ne rencontre pas de
 * PNJ à l'intérieur du souterrain [...] réactive les pop-up une fois à l'extérieur » : le
 * planificateur "battement de cœur" de rencontres PNJ aléatoires (NpcEncounterPopup.tsx) n'a
 * aucune autre façon de savoir que la Plateforme 3D est passée en vue souterraine (état interne,
 * privé à ce widget) — il consulte donc ce registre pour (a) ne JAMAIS tirer une nouvelle rencontre
 * pendant qu'on est sous terre, et (b) fermer immédiatement toute rencontre déjà affichée dès que
 * le joueur entre dans un souterrain (voir `subscribeUndergroundActive` ci-dessous, utilisé en
 * plus du simple polling de `isUndergroundActive()` dans le battement de cœur).
 */
type Listener = (active: boolean) => void;
let active = false;
const listeners = new Set<Listener>();

export function setUndergroundActive(v: boolean): void {
  if (active === v) return;
  active = v;
  for (const l of listeners) l(v);
}

export function isUndergroundActive(): boolean {
  return active;
}

/** Notifié immédiatement avec la valeur courante à l'abonnement, puis à chaque changement. */
export function subscribeUndergroundActive(cb: Listener): () => void {
  listeners.add(cb);
  cb(active);
  return () => { listeners.delete(cb); };
}
