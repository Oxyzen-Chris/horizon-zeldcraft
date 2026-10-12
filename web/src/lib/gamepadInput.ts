'use client';

/**
 * Support manette de jeu (Gamepad API du navigateur, ex. Switch Pro Controller en Bluetooth) —
 * voir demande utilisateur « Connecter une gamepad [...] en bluetooth pour gérer les déplacements
 * de Synk [...] Configurer les touches spéciales du GamePad [...] Tu créeras un nouveau widget de
 * configuration du GamePad où le joueur pourra définir, programmer ces touches ». Module PUR
 * (indépendant de React, comme roamingActors.ts/platform3dActive.ts) partagé par GameCanvas2D.tsx
 * (Plateforme 2D isométrique, TOUJOURS montée — voir platform3dActive.ts) ET Platform3DWidget.tsx.
 *
 * ⚠️ Remarque Gamepad API importante (standard W3C) : la disposition `mapping: "standard"` indexe
 * les 4 boutons de façade par leur POSITION PHYSIQUE (bas/droite/gauche/haut), PAS par l'étiquette
 * imprimée dessus. Sur une manette Xbox, position = étiquette (0=A bas, 1=B droite, 2=X gauche,
 * 3=Y haut). Sur une manette Nintendo (Switch Pro Controller, losange inversé), l'étiquette imprimée
 * à CHAQUE position est différente : 0=bouton du BAS (étiqueté "B"), 1=bouton de DROITE (étiqueté
 * "A"), 2=bouton de GAUCHE (étiqueté "Y"), 3=bouton du HAUT (étiqueté "X"). `DEFAULT_BUTTON_ACTION_MAP`
 * ci-dessous est donc calé sur cette disposition Nintendo (celle de la manette de l'utilisateur, voir
 * captures d'écran « Pro Controller »/manette Zelda) afin que les valeurs par défaut (X:Sauter,
 * A:Confirmer, B:Annuler, Y:Besace) soient correctes SANS reconfiguration — tout en restant
 * intégralement reprogrammable bouton par bouton (voir GamepadSettingsWidget.tsx, capture "appuyer
 * sur un bouton") pour les manettes/navigateurs où l'association diffèrerait malgré tout.
 */

/** Identifiants d'action déclenchables par un bouton de manette (hors axes de déplacement, gérés
 * séparément par `readMoveDelta`, jamais reprogrammables — exactement comme les flèches du clavier). */
export type GamepadActionId =
  | 'none'
  | 'jump'
  | 'confirm'
  | 'cancel'
  | 'inventory'
  | 'quests'
  | 'equipment'
  | 'map'
  | 'shop'
  | 'stats'
  | 'gamepadSettings';

/** Liste ORDONNÉE des actions réellement assignables (exclut `'none'`, valeur de repli affichée
 * uniquement pour un bouton non assigné) — utilisée par GamepadSettingsWidget.tsx pour afficher
 * chaque ligne de la table de configuration dans un ordre stable. */
export const GAMEPAD_ACTION_IDS: GamepadActionId[] = [
  'jump', 'confirm', 'cancel', 'inventory', 'quests', 'equipment', 'map', 'shop', 'stats', 'gamepadSettings',
];

/** Nombre de boutons CONFIGURABLES (indices Gamepad API standard 0-9 : B/A/Y/X/L/R/ZL/ZR/-/+) — le
 * stick gauche ET le pavé directionnel (indices 12-15, voir `readMoveDelta`) restent RÉSERVÉS au
 * déplacement, jamais reprogrammables (exactement comme les flèches du clavier ne peuvent pas être
 * réaffectées à une autre action). Les sticks cliquables (L3/R3, 10-11) et Home/Capture (16-17) ne
 * sont volontairement pas exposés ici (peu présents/fiables selon navigateur/OS). */
export const CONFIGURABLE_BUTTON_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** Courte étiquette technique (indépendante de la langue, voir GamepadSettingsWidget.tsx pour la
 * combiner à une icône/description traduite) de chaque bouton configurable — disposition Nintendo
 * (voir remarque d'en-tête ci-dessus). */
export const GAMEPAD_BUTTON_SHORT_LABEL: Record<number, string> = {
  0: 'B', 1: 'A', 2: 'Y', 3: 'X', 4: 'L', 5: 'R', 6: 'ZL', 7: 'ZR', 8: '−', 9: '+',
};

/** Association PAR DÉFAUT bouton → action (voir remarque d'en-tête : disposition Nintendo) — reflète
 * exactement la demande utilisateur (X:Sauter, A:Confirmer, B:Annuler, Y:Besace) et des valeurs
 * raisonnables pour les 6 boutons restants (« Il reste encore les touches - et +, L et R, ZL et ZR
 * du GamePad a programmer et définir »), toutes reprogrammables depuis GamepadSettingsWidget.tsx. */
export const DEFAULT_BUTTON_ACTION_MAP: Record<number, GamepadActionId> = {
  0: 'cancel',          // B (bas)
  1: 'confirm',         // A (droite)
  2: 'inventory',       // Y (gauche) — Besace
  3: 'jump',            // X (haut) — Sauter (monter sur un rocher, voir jumpHeldRef)
  4: 'quests',          // L — Quêtes
  5: 'equipment',       // R — Équipement
  6: 'map',             // ZL — Carte du monde
  7: 'shop',            // ZR — Boutique
  8: 'stats',           // − (minus/select) — Statistiques
  9: 'gamepadSettings',  // + (plus/start) — Réglages manette
};

/** Association COURANTE (par défaut, overridée par `configureGamepadButtonMap` une fois les
 * préférences du joueur chargées depuis localStorage par GamepadSettingsWidget.tsx — même schéma
 * que `configureRoaming`/`configureStargates`). */
let buttonActionMap: Record<number, GamepadActionId> = { ...DEFAULT_BUTTON_ACTION_MAP };

/** Remplace intégralement l'association courante (ex. après chargement des préférences
 * localStorage du joueur, ou réinitialisation aux valeurs par défaut). */
export function configureGamepadButtonMap(map: Record<number, GamepadActionId>): void {
  buttonActionMap = { ...map };
}

/** Association courante — lue par GamepadSettingsWidget.tsx pour l'affichage et par les boucles de
 * sondage des 2 widgets (voir GameCanvas2D.tsx) pour résoudre l'action d'un bouton pressé. */
export function getGamepadButtonMap(): Record<number, GamepadActionId> {
  return buttonActionMap;
}

export function getActionForButton(index: number): GamepadActionId {
  return buttonActionMap[index] ?? 'none';
}

/** Réaffecte le bouton `index` à `action`, en désassignant d'abord tout AUTRE bouton qui portait
 * déjà cette action (une action ne peut être déclenchée que par un seul bouton à la fois — sans
 * cela, remapper « Sauter » sur un nouveau bouton laisserait l'ancien bouton déclencher LUI AUSSI un
 * saut, ce qui surprendrait le joueur). Renvoie la nouvelle association complète (à persister en
 * localStorage par l'appelant, voir GamepadSettingsWidget.tsx) SANS modifier l'état module courant
 * (laisse l'appelant décider d'appeler `configureGamepadButtonMap` — garde la fonction pure/testable). */
export function withButtonAction(
  map: Record<number, GamepadActionId>, index: number, action: GamepadActionId,
): Record<number, GamepadActionId> {
  const next: Record<number, GamepadActionId> = { ...map };
  for (const k of Object.keys(next)) {
    const i = Number(k);
    if (i !== index && next[i] === action) next[i] = 'none';
  }
  next[index] = action;
  return next;
}

/** Indices Gamepad API standard du pavé directionnel (toujours fixes, jamais reprogrammables). */
const DPAD_UP = 12, DPAD_DOWN = 13, DPAD_LEFT = 14, DPAD_RIGHT = 15;

/** Zone morte du stick analogique gauche — en-deçà, l'axe est considéré au repos (évite une dérive
 * de stick usé/mal calibré qui ferait avancer Synk tout seul). */
const STICK_DEADZONE = 0.4;

/** Renvoie le PREMIER gamepad connecté (`navigator.getGamepads()` doit être ré-interrogé à CHAQUE
 * frame — contrairement au clavier/souris, l'objet `Gamepad` renvoyé par l'événement
 * `gamepadconnected` est un INSTANTANÉ figé, jamais mis à jour ; seul un nouvel appel à
 * `getGamepads()` reflète l'état courant des boutons/axes). `null` en SSR ou si aucune manette
 * n'est actuellement connectée/autorisée par le navigateur (qui exige qu'au moins un bouton ait été
 * pressé une fois avant de l'exposer à la page, par mesure de confidentialité — voir
 * GamepadSettingsWidget.tsx::statusHint). */
export function getFirstConnectedGamepad(): Gamepad | null {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
  const pads = navigator.getGamepads();
  for (const p of pads) { if (p) return p; }
  return null;
}

/** Déplacement composite (dx, dy ∈ {-1, 0, 1}) à partir du stick analogique gauche (axes 0/1, avec
 * zone morte) ET/OU du pavé directionnel (boutons 12-15, non cumulable avec le stick : priorité au
 * pavé directionnel s'il est actionné, pour un pas net façon clavier plutôt qu'une valeur analogique
 * partielle) — MÊME sémantique `{-1,0,1}` que `keysDownRef`/`composite()` au clavier dans
 * GameCanvas2D.tsx/Platform3DWidget.tsx, consommée identiquement par `useHoldMovement`. */
export function readMoveDelta(gp: Gamepad): { dx: number; dy: number } {
  const dpadX = gp.buttons[DPAD_LEFT]?.pressed ? -1 : gp.buttons[DPAD_RIGHT]?.pressed ? 1 : 0;
  const dpadY = gp.buttons[DPAD_UP]?.pressed ? -1 : gp.buttons[DPAD_DOWN]?.pressed ? 1 : 0;
  if (dpadX !== 0 || dpadY !== 0) return { dx: dpadX, dy: dpadY };
  const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
  const dx = Math.abs(ax) > STICK_DEADZONE ? (ax > 0 ? 1 : -1) : 0;
  const dy = Math.abs(ay) > STICK_DEADZONE ? (ay > 0 ? 1 : -1) : 0;
  return { dx, dy };
}

/** 🆕 Axe horizontal du stick analogique DROIT (axes 2/3, standard Gamepad API — « le 3ème pad
 * directionnel » de la manette au sens de la demande utilisateur « active le 3ème pad directionnel
 * sur la manette de jeu [...] pour permettre à Synk de se retourner ou faire demi-tour dans le
 * labyrinthe ») : jusqu'ici totalement inutilisé par le jeu (le pavé directionnel ET le stick
 * GAUCHE sont déjà fusionnés en un seul axe de déplacement par `readMoveDelta` ci-dessus — stick
 * droit = la 3ᵉ source directionnelle disponible sur une manette standard, après pavé directionnel
 * et stick gauche). Renvoie `-1`/`0`/`1` (gauche/centre/droite), même zone morte que le stick
 * gauche, pour piloter un quart de tour de caméra dans le souterrain (voir
 * Platform3DWidget.tsx::cryptTurn) — deux appuis successifs dans le même sens permettent ainsi de
 * faire un demi-tour complet, EXACTEMENT comme les boutons ↺/↻ déjà existants, sans dupliquer leur
 * logique de rotation. */
export function readTurnAxis(gp: Gamepad): number {
  const ax = gp.axes[2] ?? 0;
  return Math.abs(ax) > STICK_DEADZONE ? (ax > 0 ? 1 : -1) : 0;
}

/** État de connexion manette (pour affichage dans GamepadSettingsWidget.tsx). */
export interface GamepadStatus { connected: boolean; id: string | null }

let currentStatus: GamepadStatus = { connected: false, id: null };
const statusListeners = new Set<(s: GamepadStatus) => void>();

function notifyStatus(): void { for (const cb of statusListeners) cb(currentStatus); }

let statusListenersAttached = false;
function ensureStatusListeners(): void {
  if (statusListenersAttached || typeof window === 'undefined') return;
  statusListenersAttached = true;
  window.addEventListener('gamepadconnected', (e) => {
    currentStatus = { connected: true, id: e.gamepad.id };
    notifyStatus();
  });
  window.addEventListener('gamepaddisconnected', () => {
    // Un AUTRE pad peut rester connecté (rare, mais couvert) — re-sonde plutôt que de forcer
    // `connected: false` à l'aveugle.
    const pad = getFirstConnectedGamepad();
    currentStatus = pad ? { connected: true, id: pad.id } : { connected: false, id: null };
    notifyStatus();
  });
}

/** Abonnement au statut de connexion manette — appelle immédiatement `cb` avec l'état courant (déjà
 * connue si la manette a été appairée/activée avant le montage du widget), puis à chaque
 * connexion/déconnexion. Retourne la fonction de désabonnement. */
export function subscribeGamepadStatus(cb: (s: GamepadStatus) => void): () => void {
  ensureStatusListeners();
  // Re-sonde activement au premier abonnement (une manette déjà appairée AVANT le chargement de la
  // page ne déclenche `gamepadconnected` qu'au prochain appui sur un bouton, selon certains
  // navigateurs — ce sondage ponctuel couvre le cas où un bouton a déjà été pressé entre-temps).
  const pad = getFirstConnectedGamepad();
  if (pad) currentStatus = { connected: true, id: pad.id };
  cb(currentStatus);
  statusListeners.add(cb);
  return () => { statusListeners.delete(cb); };
}

/** Nom (sans accent, CustomEvent) de l'évènement diffusé sur `window` à CHAQUE front montant/
 * descendant d'un bouton configuré (voir `GamepadActionEventDetail`) — unique émetteur :
 * GameCanvas2D.tsx (TOUJOURS monté, voir en-tête de fichier), consommé par Platform3DWidget.tsx
 * (action `jump`, tenue — voir jumpHeldRef) et les widgets à bascule (voir `WIDGET_TOGGLE_ACTIONS`
 * ci-dessous), qui l'écoutent tous indépendamment sans jamais le réémettre. */
export const GAMEPAD_ACTION_EVENT = 'zc:gamepadAction';

export interface GamepadActionEventDetail { action: GamepadActionId; pressed: boolean }

/** Actions qui font simplement basculer réduit/déplié d'un widget existant — voir les `useEffect`
 * ajoutés dans InventoryWidget.tsx/QuestsZeldaCraftWidget.tsx/EquipmentWidget.tsx/
 * WorldMapWidget.tsx/ShopWidget.tsx/StatsWidget.tsx/GamepadSettingsWidget.tsx, chacun s'abonnant à
 * SA PROPRE action ci-dessous. Centralisé ici en commentaire pour une vue d'ensemble. */
// inventory -> InventoryWidget, quests -> QuestsZeldaCraftWidget, equipment -> EquipmentWidget,
// map -> WorldMapWidget, shop -> ShopWidget, stats -> StatsWidget, gamepadSettings -> GamepadSettingsWidget.
