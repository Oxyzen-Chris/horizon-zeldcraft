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

  useEffect(() => {
    if (collapsedKey) {
      setCollapsed((localStorage.getItem(collapsedKey) ?? (defaultCollapsed ? '1' : '0')) === '1');
    }
    const saved = localStorage.getItem(posKey);
    if (saved) {
      try { setPos(clampToViewport(JSON.parse(saved))); } catch { /* ignore */ }
    } else if (typeof window !== 'undefined') {
      setPos(defaultPos());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Re-clampe `pos` d'après la taille RÉELLEMENT affichée (icône réduite ou fenêtre dépliée),
   * mesurée via `elRef`. Complète le clamp "à l'aveugle" (marge fixe) fait au montage ci-dessus :
   * corrige le bug où une position valable pour l'icône réduite (~56px) fait déborder la fenêtre
   * une fois dépliée (bien plus grande), ce qui ajoutait un ascenseur de page inattendu — ces
   * widgets `position: fixed` doivent rester strictement indépendants du scroll de la page. */
  const reclampToRenderedSize = useCallback(() => {
    const rect = elRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    setPos(prev => {
      if (!prev) return prev;
      const clamped = clampToViewport(prev, { w: rect.width, h: rect.height });
      if (clamped.x === prev.x && clamped.y === prev.y) return prev;
      localStorage.setItem(posKey, JSON.stringify(clamped));
      return clamped;
    });
  }, [posKey]);

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

  const toggleCollapsed = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      if (collapsedKey) localStorage.setItem(collapsedKey, next ? '1' : '0');
      // Le widget vient de se déplier (prev=true → next=false) : force le premier plan, en
      // complément défensif du `onPointerDownCapture={bringToFront}` déjà posé sur le conteneur,
      // qui devrait déjà suffire mais peut être court-circuité selon l'ordre exact des gestion-
      // naires d'événements natifs — voir bug remonté (widget parfois recouvert au dépliage).
      if (prev && !next) onExpand?.();
      return next;
    });
  }, [collapsedKey, onExpand]);

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
    setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
  }, []);

  const onPointerUp = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setPos(current => {
      if (current) localStorage.setItem(posKey, JSON.stringify(current));
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
    setPos(next);
    localStorage.setItem(posKey, JSON.stringify(next));
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
