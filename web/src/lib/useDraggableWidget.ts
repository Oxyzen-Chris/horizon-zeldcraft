'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEffectiveAccount } from './effectiveAccount';
import { trackWidgetUsage } from './gameState';

export interface Pos { x: number; y: number }

/** Distance (px) au-delà de laquelle un pointerdown→pointerup est considéré comme un glissement
 * (et non un simple clic) — voir `onToggleClick` ci-dessous, cœur du correctif du bug
 * "ouverture involontaire du widget après un glisser-déposer". */
const MOVE_THRESHOLD = 6;

/** Marge (px) garantissant qu'au moins le coin haut-gauche (icône réduite ou en-tête) reste
 * visible/atteignable à l'écran — filet de sécurité au chargement, complémentaire de l'action
 * explicite "Recentrer" du menu contextuel (clic droit) pour le cas où un widget serait
 * repositionné hors-écran (fenêtre redimensionnée, résolution différente, etc.). */
const VIEWPORT_MARGIN = 56;

/**
 * Clé localStorage "scopée" par joueur (demande utilisateur : « sauvegarder [la position des
 * widgets] en fonction de chaque utilisateur pour customiser [...] l'expérience utilisateur
 * lorsqu'il reprend sa session ») — un même navigateur/appareil peut voir se succéder plusieurs
 * comptes (portefeuille crypto A puis B, ou Démo puis portefeuille réel) ; sans ce suffixe, TOUS
 * partageaient auparavant la même disposition de fenêtres (clé `posKey`/`collapsedKey` brute,
 * globale au navigateur). `address` provient de `useEffectiveAccount()` (adresse réelle OU adresse
 * virtuelle Démo/Fiat stable, voir effectiveAccount.tsx) : chaque compte — crypto ou non — a donc
 * bien SA PROPRE disposition mémorisée, restaurée automatiquement à la reprise de sa session.
 * Volontairement un stockage 100% local (pas de synchronisation entre appareils) : la disposition
 * des fenêtres est une préférence d'affichage propre à CET écran/navigateur (résolution, taille de
 * fenêtre) — la resynchroniser entre appareils de tailles différentes serait d'ailleurs
 * contre-productif (une position pensée pour un écran large déborderait sur un petit écran).
 * Exportée : également utilisée directement par les 3 widgets redimensionnables gérant leur
 * propre `SIZE_KEY` en dehors de ce hook (Platform3DWidget/GameCanvas2D/WorldMapWidget), pour que
 * la TAILLE mémorisée d'une fenêtre soit elle aussi propre à chaque joueur, comme sa position.
 */
export function scopedKey(base: string, address?: string): string {
  return address ? `${base}::${address.toLowerCase()}` : base;
}

/** Lit `scopedKey(base, address)` avec repli sur l'ancienne clé globale non-scopée `base` si la
 * clé par-joueur n'existe pas encore — préserve à l'identique la disposition déjà mémorisée par les
 * joueurs existants (aucune réinitialisation surprise lors du déploiement de ce correctif), tout en
 * faisant en sorte que chaque compte reçoive ensuite bien sa propre clé dès la prochaine
 * sauvegarde (glissement, bascule réduit/déplié, recentrage — voir plus bas). */
export function readScoped(base: string, address?: string): string | null {
  if (typeof window === 'undefined') return null;
  const scoped = localStorage.getItem(scopedKey(base, address));
  if (scoped != null) return scoped;
  return localStorage.getItem(base);
}

/**
 * Clampe une position dans le viewport. `size` — quand connu (mesure réelle du widget affiché,
 * via `getBoundingClientRect()`) — remplace la marge fixe `VIEWPORT_MARGIN` par la vraie
 * largeur/hauteur du widget, pour que TOUT son cadre (pas seulement son coin haut-gauche) reste
 * visible à l'écran. Corrige le bug remonté sur "Dice Roll" (mais générique à tous les widgets) :
 * une position proche du bord bas-droit, valable pour une icône réduite (~56px), débordait sous le
 * viewport une fois le widget déplié (fenêtre bien plus haute), ce qui ajoutait un ascenseur de
 * page — alors que ces fenêtres `position: fixed` doivent rester indépendantes du scroll de page.
 */
function clampToViewport(p: Pos, size?: { w: number; h: number }): Pos {
  if (typeof window === 'undefined') return p;
  const w = size?.w ?? VIEWPORT_MARGIN;
  const h = size?.h ?? VIEWPORT_MARGIN;
  const maxX = Math.max(0, window.innerWidth - w);
  const maxY = Math.max(0, window.innerHeight - h);
  return { x: Math.min(Math.max(p.x, 0), maxX), y: Math.min(Math.max(p.y, 0), maxY) };
}

export interface UseDraggableWidgetOptions {
  /** Clé localStorage pour la position (ex. `'zc.statsWidgetPos'`). */
  posKey: string;
  /** Clé localStorage pour l'état réduit/déplié. Omise si le widget gère seul son `collapsed`. */
  collapsedKey?: string;
  /** Position par défaut si rien n'est encore enregistré en localStorage. */
  defaultPos: () => Pos;
  /** État réduit par défaut au tout premier affichage (icône réduite par défaut). */
  defaultCollapsed?: boolean;
  /** Appelé quand le widget passe de réduit à déplié (icône cliquée) — utilisé pour forcer
   * `bringToFront()` au dépliage, en complément du `onPointerDownCapture` déjà posé sur le
   * conteneur, afin de garantir que la fenêtre qui vient de s'ouvrir passe TOUJOURS au premier
   * plan même si un autre widget se trouvait déjà au-dessus d'elle (voir bug remonté : fenêtre
   * active parfois recouverte par un widget ouvert ou réduit). */
  onExpand?: () => void;
}

export interface DraggableWidgetState {
  collapsed: boolean;
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  toggleCollapsed: () => void;
  pos: Pos | null;
  setPos: React.Dispatch<React.SetStateAction<Pos | null>>;
  /** À poser sur la poignée de glissement (icône réduite et/ou en-tête de la fenêtre dépliée). */
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  /** Remplace `onClick={() => !dragging && toggleCollapsed()}` — se base sur un ref (pas un state)
   * pour lire de façon fiable et synchrone si un glissement a eu lieu durant le geste en cours. */
  onToggleClick: () => void;
  /** Ref-callback à poser sur le nœud DOM racine du widget (icône réduite ET fenêtre dépliée),
   * utilisée par `resetPosition()` pour mesurer la taille réellement affichée. */
  containerRef: (el: HTMLElement | null) => void;
  /** Position du menu contextuel (clic droit) ouvert, ou `null` si fermé. */
  menuPos: Pos | null;
  onContextMenu: (e: React.MouseEvent) => void;
  closeContextMenu: () => void;
  /** Recentre le widget au milieu de l'écran (option "🎯 Recentrer" du menu contextuel). */
  resetPosition: () => void;
}

/**
 * Hook partagé consolidant la logique de position/glissement/réduction/menu-contextuel commune
 * aux 12 fenêtres flottantes du jeu (StatsWidget, InventoryWidget, EquipmentWidget, etc.). Corrige
 * un bug présent identiquement dans les 12 widgets : `onClick={() => !dragging && toggleCollapsed()}`
 * lisait un état React `dragging` déjà remis à `false` par `onPointerUp` avant que l'événement
 * `click` natif (qui suit toujours `pointerup`) ne se déclenche — le widget s'ouvrait donc
 * systématiquement après un glissement. Ici, `movedRef` (un ref, lu/écrit de façon synchrone dans
 * le même contexte d'exécution JS) élimine cette course d'états.
 *
 * Ajoute aussi la possibilité de "recentrer" un widget via clic droit (voir `WidgetContextMenu`),
 * pour le cas où il deviendrait inaccessible hors de l'écran visible.
 */
export function useDraggableWidget(opts: UseDraggableWidgetOptions): DraggableWidgetState {
  const { posKey, collapsedKey, defaultPos, defaultCollapsed = true, onExpand } = opts;
  const { address } = useEffectiveAccount();

  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [pos, setPos] = useState<Pos | null>(null);
  const [menuPos, setMenuPos] = useState<Pos | null>(null);

  const dragOffset = useRef<Pos>({ x: 0, y: 0 });
  const pointerStart = useRef<Pos>({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const movedRef = useRef(false);
  const elRef = useRef<HTMLElement | null>(null);
  // Intelligence IA GamePlay — instant d'ouverture du widget (ref, pas de state : ne doit jamais
  // provoquer de re-render) et adresse courante en ref (accédée depuis un effet de démontage qui
  // ne doit pas dépendre de `address`).
  const openStartRef = useRef<number | null>(null);
  const addressRef = useRef<string | undefined>(undefined);
  useEffect(() => { addressRef.current = address; }, [address]);

  /**
   * Position CANONIQUE ("vraie" position voulue par le joueur, celle qui doit être mémorisée et
   * restaurée) — DÉCOUPLÉE de `pos` (la position réellement RENDUE à l'écran, voir `pos` ci-
   * dessous). Corrige un bug remonté : rétrécir la fenêtre du navigateur (ou juste passer par une
   * résolution/orientation plus petite) faisait glisser les widgets vers le bord de l'écran ET
   * PERSISTAIT cette position rétrécie en localStorage (l'ancien `reclampToRenderedSize` appelait
   * `localStorage.setItem` à chaque `resize`) — ré-agrandir ensuite la fenêtre ne restaurait donc
   * JAMAIS la disposition d'origine, alors que le joueur ne l'avait jamais lui-même déplacée.
   * Désormais : `canonicalPosRef` ne change QUE sur une action explicite du joueur (glisser une
   * fenêtre jusqu'à `onPointerUp`, ou "🎯 Recentrer" du menu contextuel) — c'est CETTE valeur qui
   * est lue/écrite en localStorage. `pos` (l'état React, utilisé pour `style={{ left, top }}`) est
   * lui recalculé à CHAQUE rendu pertinent (chargement, redimensionnement de fenêtre, bascule
   * réduit/déplié) comme `clampToViewport(canonicalPosRef.current, tailleRéelle)` — un simple
   * ajustement VISUEL et TEMPORAIRE pour rester atteignable si le viewport actuel est trop petit,
   * qui ne touche jamais à la valeur mémorisée. Élargir à nouveau la fenêtre fait donc réapparaître
   * le widget exactement là où le joueur l'avait laissé.
   */
  const canonicalPosRef = useRef<Pos | null>(null);

  useEffect(() => {
    if (collapsedKey) {
      setCollapsed((readScoped(collapsedKey, address) ?? (defaultCollapsed ? '1' : '0')) === '1');
    }
    const saved = readScoped(posKey, address);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Pos;
        canonicalPosRef.current = parsed;
        setPos(clampToViewport(parsed));
      } catch { /* ignore */ }
    } else if (typeof window !== 'undefined') {
      const d = defaultPos();
      canonicalPosRef.current = d;
      setPos(d);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  /** Recalcule `pos` (affichage) d'après la position CANONIQUE mémorisée et la taille RÉELLEMENT
   * affichée (icône réduite ou fenêtre dépliée, mesurée via `elRef`) pour la CONTENIR dans le
   * viewport ACTUEL — sans jamais modifier `canonicalPosRef` ni le localStorage (voir commentaire
   * ci-dessus). Couvre à la fois : une position valable pour l'icône réduite (~56px) qui déborderait
   * une fois la fenêtre dépliée (bien plus grande), et un viewport devenu trop petit (fenêtre du
   * navigateur rétrécie) pour la position d'origine — dans les deux cas un simple ajustement
   * d'affichage, réversible dès que la taille/le viewport le permet à nouveau. */
  const reclampToRenderedSize = useCallback(() => {
    const base = canonicalPosRef.current;
    if (!base) return;
    const rect = elRef.current?.getBoundingClientRect();
    const size = rect && rect.width > 0 && rect.height > 0 ? { w: rect.width, h: rect.height } : undefined;
    const clamped = clampToViewport(base, size);
    setPos(prev => (prev && prev.x === clamped.x && prev.y === clamped.y) ? prev : clamped);
  }, []);

  // Re-clampe juste après chaque bascule réduit/déplié (une fois le DOM à jour, donc la taille
  // réelle mesurable) — couvre à la fois l'ouverture (icône → fenêtre, peut déborder en bas/droite)
  // et la fermeture (fenêtre → icône, redevient minuscule).
  useEffect(() => {
    const raf = requestAnimationFrame(reclampToRenderedSize);
    return () => cancelAnimationFrame(raf);
  }, [collapsed, reclampToRenderedSize]);

  // Re-clampe aussi au redimensionnement de la fenêtre du navigateur (résolution différente,
  // rotation d'écran, panneau latéral du navigateur, etc.).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.addEventListener('resize', reclampToRenderedSize);
    return () => window.removeEventListener('resize', reclampToRenderedSize);
  }, [reclampToRenderedSize]);

  // Intelligence IA GamePlay — mesure le temps passé fenêtre dépliée par widget (fire-and-forget,
  // jamais bloquant/ne modifie aucun comportement existant). `widgetId` = `posKey`, déjà unique et
  // stable par widget, pas besoin d'un identifiant dédié. Couvre les 12 widgets flottants du jeu
  // depuis ce point d'injection unique (voir trackWidgetUsage dans gameState.ts).
  useEffect(() => {
    if (!collapsed) {
      openStartRef.current = Date.now();
    } else if (openStartRef.current != null) {
      const duration = Date.now() - openStartRef.current;
      openStartRef.current = null;
      if (addressRef.current) trackWidgetUsage(addressRef.current, posKey, duration).catch(() => {});
    }
  }, [collapsed, posKey]);

  useEffect(() => () => {
    if (openStartRef.current != null && addressRef.current) {
      trackWidgetUsage(addressRef.current, posKey, Date.now() - openStartRef.current).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Marqué juste avant tout `setCollapsed` déclenché par une VRAIE action utilisateur (clic sur
  // l'icône/le bouton "✕"), et lu/consommé par l'effet ci-dessous — permet de distinguer ce cas de
  // la restauration automatique de l'état réduit/déplié depuis localStorage au montage (effet
  // ci-dessus), qui ne doit surtout PAS déclencher `bringToFront()` (sinon un widget resté déplié
  // d'une session précédente repasserait systématiquement au premier plan au rechargement, sans
  // action du joueur — régression que ce garde-fou évite).
  const userToggledRef = useRef(false);

  const toggleCollapsed = useCallback(() => {
    userToggledRef.current = true;
    setCollapsed(prev => {
      const next = !prev;
      if (collapsedKey) localStorage.setItem(scopedKey(collapsedKey, addressRef.current), next ? '1' : '0');
      return next;
    });
  }, [collapsedKey]);

  // Le widget vient de se déplier (collapsed: true → false) SUITE À UN CLIC (`toggleCollapsed`) :
  // force le premier plan, en complément défensif du `onPointerDownCapture={bringToFront}` déjà
  // posé sur le conteneur, qui devrait déjà suffire mais peut être court-circuité selon l'ordre
  // exact des gestionnaires d'événements natifs — voir bug remonté (widget parfois recouvert au
  // dépliage). Volontairement un `useEffect` réagissant à `collapsed` plutôt qu'un appel direct
  // dans l'updater de `setCollapsed` ci-dessus : un updater DOIT rester pur (aucun effet de bord)
  // — en React 18 avec `reactStrictMode` (activé ici, voir next.config.js), un updater impur est
  // invoqué deux fois en développement, ce qui appelait `bringToFront()` deux fois par simple
  // ouverture et faussait le compteur d'empilement partagé (voir windowZOrder.ts), l'une des
  // causes des bugs de superposition remontés.
  const prevCollapsedRef = useRef(collapsed);
  useEffect(() => {
    const wasUserToggle = userToggledRef.current;
    userToggledRef.current = false;
    if (wasUserToggle && prevCollapsedRef.current && !collapsed) onExpand?.();
    prevCollapsedRef.current = collapsed;
  }, [collapsed, onExpand]);

  const onToggleClick = useCallback(() => {
    if (movedRef.current) { movedRef.current = false; return; }
    toggleCollapsed();
  }, [toggleCollapsed]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!pos) return;
    isDraggingRef.current = true;
    movedRef.current = false;
    pointerStart.current = { x: e.clientX, y: e.clientY };
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - pointerStart.current.x;
    const dy = e.clientY - pointerStart.current.y;
    if (!movedRef.current && (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD)) {
      movedRef.current = true;
    }
    const next = { x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y };
    // Un glissement EXPLICITE du joueur redéfinit immédiatement la position canonique (pas
    // seulement à `onPointerUp`) : un redimensionnement de fenêtre survenant EN PLEIN glissement
    // (cas limite) doit re-clamper autour de la position déjà en train d'être déplacée, pas de
    // l'ancienne position pré-glissement.
    canonicalPosRef.current = next;
    setPos(next);
  }, []);

  const onPointerUp = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setPos(current => {
      if (current) {
        canonicalPosRef.current = current;
        localStorage.setItem(scopedKey(posKey, addressRef.current), JSON.stringify(current));
      }
      return current;
    });
  }, [posKey]);

  const containerRef = useCallback((el: HTMLElement | null) => { elRef.current = el; }, []);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuPos({ x: e.clientX, y: e.clientY });
  }, []);
  const closeContextMenu = useCallback(() => setMenuPos(null), []);

  const resetPosition = useCallback(() => {
    if (typeof window === 'undefined') return;
    const rect = elRef.current?.getBoundingClientRect();
    const w = rect?.width ?? 260;
    const h = rect?.height ?? 200;
    const next = {
      x: Math.max(0, Math.round((window.innerWidth - w) / 2)),
      y: Math.max(0, Math.round((window.innerHeight - h) / 2)),
    };
    canonicalPosRef.current = next;
    setPos(next);
    localStorage.setItem(scopedKey(posKey, addressRef.current), JSON.stringify(next));
    setMenuPos(null);
  }, [posKey]);

  return {
    collapsed, setCollapsed, toggleCollapsed,
    pos, setPos,
    onPointerDown, onPointerMove, onPointerUp, onToggleClick,
    containerRef,
    menuPos, onContextMenu, closeContextMenu,
    resetPosition,
  };
}
