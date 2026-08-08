'use client';

/**
 * Registre partagé (portée module, aucun Context nécessaire — les deux widgets sont montés dans le
 * même arbre `/game`) indiquant si le widget "Plateforme 3D" est actuellement déplié ET activé.
 *
 * Corrige le bug rapporté « déplacement erratique qui bloque Synk, dans la Plateforme 3D ET la
 * Plateforme 2D isométrique, sauf à réorienter la caméra 3D » : GameCanvas2D.tsx (2D isométrique,
 * toujours monté) ET Platform3DWidget.tsx possèdent CHACUN leur PROPRE écouteur `window.keydown`
 * des flèches directionnelles, tous deux actifs simultanément dès que les deux widgets sont
 * dépliés (comportement par défaut). Or Platform3DWidget applique une rotation « caméra-relative »
 * (voir rotateInputByCameraYaw) à la même touche physique, alors que GameCanvas2D interprète
 * TOUJOURS cette touche comme une direction MONDE fixe : dès que la caméra 3D est orientée à un
 * angle différent de 0° (ce qui arrive dès qu'on regarde autour de soi), une même pression de
 * touche produit donc DEUX déplacements DIFFÉRENTS calculés indépendamment, chacun écrivant sa
 * propre position vers `players/{addr}/mapPos` (voir setPlayerMapPos) : les deux widgets se
 * "battent" pour la position de Synk à chaque pas, d'où les sauts erratiques/blocages observés.
 * Recentrer la caméra à 0° masquait le symptôme (les deux calculs redeviennent alors identiques par
 * coïncidence) sans corriger la cause.
 *
 * Le correctif : tant que la Plateforme 3D est dépliée et activée, elle devient la SEULE source de
 * déplacement clavier (elle gère aussi bien le monde fixe que la rotation caméra) ; l'écouteur
 * clavier de GameCanvas2D s'efface et se contente d'afficher la position reçue via
 * `subscribePlayerMapPos` (déjà le mécanisme existant de synchronisation, inchangé). Dès que la
 * Plateforme 3D est repliée/désactivée, GameCanvas2D reprend intégralement la main sur le clavier
 * exactement comme avant (comportement historique inchangé pour qui n'ouvre jamais ce widget —
 * aucune régression). Les pavés directionnels virtuels/souris de chaque widget restent, eux,
 * strictement indépendants (pas de conflit possible, ils ne partagent pas la même touche physique).
 */
let active = false;
export function setPlatform3DActive(v: boolean): void { active = v; }
export function isPlatform3DActive(): boolean { return active; }
