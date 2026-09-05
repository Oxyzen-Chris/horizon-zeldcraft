'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  getMapPoiDefs, getWorldDefs, setPlayerMapPos, subscribePlayerMapPos, subscribeUnlockedWorldIds,
  getVisitedMapPoiIds, visitMapPoi, discoverWorldOffchain, getInventoryOnce, getRepRules,
  getOrCreatePlayer, computePlayerDiceBonus, rollD20, applyEffect, getCurrentSeason, RKEY, DEFAULT_MAP_ID,
  getAllMapMarkers, getMapFilterDefaults, KINGDOM_CHAPTERS,
  getKingdomQuestMarker, subscribeSolvedQuestIds,
  getZorghonEncounter, subscribeZorghonEncounter,
  getMapNavigationSettings, DEFAULT_MAP_NAVIGATION_SETTINGS,
  CORNER_POSITION_CLASSES,
  type MapPoiDef, type WorldDef, type RepRules, type Season, type MapMarker, type MapNavigationSettings, type ZorghonEncounterState,
} from '@/lib/gameState';
import { useI18n, localizeName } from '@/lib/i18n';
import { useWindowZIndex, handleWidgetPointerDownCapture } from '@/lib/windowZOrder';
import { useDraggableWidget } from '@/lib/useDraggableWidget';
import { WidgetContextMenu } from './WidgetContextMenu';
import {
  useMapFilters, markerMatchesFilters, resetMapFilters, applyAdminMapFilterDefaults,
  MAP_FILTER_CATEGORIES,
} from '@/lib/mapFilters';
import { ConfirmDialog } from './ConfirmDialog';
import { SynkSkin } from './SynkSkin';
import { NPC_SKINS } from '@/lib/contract';
import type { EncounterMarkerInfo } from './NpcEncounterPopup';
import { worldTileAt, TERRAIN_COLOR, WORLD_SIZE } from '@/lib/worldTerrain';
import { useEffectiveAccount } from '@/lib/effectiveAccount';
import { useRoamingActors, ensureRoamingIdentities } from '@/lib/roamingActors';

const POS_KEY = 'zc.mapWidgetPos';
const SIZE_KEY = 'zc.mapWidgetSize';
const COLLAPSED_KEY = 'zc.mapWidgetCollapsed';
interface Pos { x: number; y: number }
interface Size { w: number; h: number }

const MIN_W = 340, MIN_H = 260, MAX_W = 960, MAX_H = 720;
const BASE_W = 720, BASE_H = 480; // dimensions logiques de la carte (avant zoom) — voir rendu ci-dessous
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

/** Emoji par défaut d'un POI selon son type (repli si l'admin ne fournit pas d'icône). */
const POI_TYPE_FALLBACK_ICON: Record<string, string> = {
  plain: '🌾', stream: '💧', lake: '🌊', mountain: '⛰️', forest: '🌲', cave: '🕳️', beach: '🏖️',
  waterfall: '💦', village_ally: '🏘️', village_enemy: '🏚️', path: '🥾', bridge: '🌉',
  tavern: '🍺', stable: '🐴', hut: '🛖',
  sea: '🌊', ocean: '🌊', pond: '💧', island: '🏝️',
};

/**
 * Mapmonde du territoire de Synk — carte permanente flottante, style vieux parchemin, zoomable et
 * redimensionnable (glisser le coin ⤡ en bas à droite). Affiche les points d'intérêt (terrain/
 * décor, paramétrables en Administration → « Carte »), les 10 mondes (portails, verrouillés tant
 * que l'XP requis n'est pas atteint) et la position de Synk, qui se déplace librement en cliquant
 * sur la carte (petit bonus d'XP la première fois qu'un POI est découvert par hasard).
 *
 * Voyage vers un monde : instantané si l'engin requis (`WorldDef.vehicleItemId`) est dans la
 * besace ; sinon proposé à pied (plus long, risque de rencontre nocturne hostile — voir
 * RepRules.travel*). Évolutif : `mapId` fixé sur DEFAULT_MAP_ID pour l'instant, mais toute
 * l'infrastructure (MapDef/MapPoiDef) supporte déjà plusieurs cartes à l'avenir.
 */
export function WorldMapWidget({ playerXp, encounterNpc, enabled = true }: { playerXp: number; encounterNpc?: EncounterMarkerInfo; enabled?: boolean }) {
  const { t } = useI18n();
  const { address } = useEffectiveAccount();
  const { z, bringToFront } = useWindowZIndex();
  const {
    collapsed, pos, onPointerDown: onHeaderPointerDown, onPointerMove: onHeaderPointerMove,
    onPointerUp: onHeaderPointerUp, onToggleClick, toggleCollapsed,
    containerRef, menuPos, onContextMenu, closeContextMenu, resetPosition,
  } = useDraggableWidget({
    posKey: POS_KEY, collapsedKey: COLLAPSED_KEY,
    defaultPos: () => ({ x: 24, y: Math.max(20, window.innerHeight - 400) }),
    onExpand: bringToFront,
  });

  const [size, setSize] = useState<Size>({ w: 460, h: 360 });
  const [resizing, setResizing] = useState(false);
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLDivElement>(null);
  // Zone défilable (overflow-auto) — utilisée pour le glisser (clic droit + déplacement) et pour
  // recentrer le zoom molette sur la position du curseur (voir onMapWheel/onMapMouseDown ci-dessous).
  const scrollRef = useRef<HTMLDivElement>(null);

  const [pois, setPois] = useState<MapPoiDef[]>([]);
  const [worlds, setWorlds] = useState<WorldDef[]>([]);
  const [unlockedWorlds, setUnlockedWorlds] = useState<Set<string>>(new Set());
  const [visitedPois, setVisitedPois] = useState<Set<string>>(new Set());
  const [rules, setRules] = useState<RepRules | null>(null);
  const [mapPos, setMapPos] = useState<Pos>({ x: 50, y: 88 });
  const [season, setSeason] = useState<Season | null>(null);
  // Marqueurs PNJ/trésors/familiers/quêtes localisés (voir gameState.ts::getAllMapMarkers) — POI
  // terrain et mondes restent gérés séparément ci-dessus (logique de découverte/déverrouillage).
  const [entityMarkers, setEntityMarkers] = useState<MapMarker[]>([]);
  // Marqueur unique de la Quête du Royaume en cours (👑, voir getKingdomQuestMarker) — fusionné
  // avec entityMarkers au rendu ci-dessous, sans modifier getAllMapMarkers() (zéro régression).
  const [kingdomMarker, setKingdomMarker] = useState<MapMarker | null>(null);
  // État de la traque de Zorghon (voir RepRules::zorghon*, gameState.ts) — purement affiché ici
  // (survol = nom), la logique de proximité/relocalisation/délivrance vit dans GameCanvas2D.tsx
  // (seule source de vérité pour la position réelle de Synk) ; ce widget se contente de refléter en
  // temps réel la position courante de Zorghon/de ses prisonniers.
  const [zorghonEncounter, setZorghonEncounter] = useState<ZorghonEncounterState | null>(null);

  // ─── PNJ/Dragon errant (voir lib/roamingActors.ts) — même registre partagé que GameCanvas2D.tsx/
  // Platform3DWidget.tsx, en coordonnées MAPMONDE directement compatibles avec ce widget (aucune
  // conversion nécessaire, contrairement aux deux autres vues qui doivent soustraire une origine de
  // caméra locale). Corrige la demande utilisateur : « identifie clairement sur la mapmonde les
  // deux PNJ [...] afin de savoir où ils se trouvent [...] les ajouter dans le filtre d'affichage
  // des PNJ ». Voir `roamingLiveMarkers`/le rendu plus bas pour le détail. */
  const roamingActors = useRoamingActors();
  useEffect(() => { ensureRoamingIdentities(entityMarkers); }, [entityMarkers]);
  // Identité catalogue (nom/icône) du PNJ/Dragon errant — utilisée pour le libellé du marqueur
  // EN DIRECT ci-dessous ; leur marqueur CATALOGUE (position fixe, potentiellement très éloignée
  // de leur position réelle) est exclu du rendu principal (voir le filtre appliqué juste avant le
  // `.map()` des marqueurs statiques) pour ne jamais afficher deux fois le même PNJ/Dragon à deux
  // endroits différents de la carte.
  const roamingNpcMarker = useMemo(
    () => entityMarkers.find(m => m.kind === 'npc' && m.id === roamingActors.npcMarkerId) ?? null,
    [entityMarkers, roamingActors.npcMarkerId],
  );
  const roamingDragonMarker = useMemo(
    () => entityMarkers.find(m => m.kind === 'familiar' && m.id === roamingActors.dragonMarkerId) ?? null,
    [entityMarkers, roamingActors.dragonMarkerId],
  );
  // Marqueurs synthétiques à la position EN DIRECT (mise à jour toutes les 4s, voir STEP_MS dans
  // roamingActors.ts) — `kind: 'npc'`/`'familiar'` afin de respecter EXACTEMENT les mêmes filtres
  // d'affichage (boutons "PNJ"/"Familiers") que leurs homologues catalogue statiques.
  const roamingLiveMarkers = useMemo<MapMarker[]>(() => {
    const list: MapMarker[] = [];
    if (roamingActors.npcMarkerId) {
      list.push({
        id: 'roaming.npc.live', kind: 'npc',
        name: roamingNpcMarker?.name ?? t('canvas2d.npcLabel'),
        i18nKey: roamingNpcMarker?.i18nKey, icon: roamingNpcMarker?.icon ?? '🧙',
        x: roamingActors.npc.x, y: roamingActors.npc.y,
      });
    }
    if (roamingActors.dragonMarkerId) {
      list.push({
        id: 'roaming.dragon.live', kind: 'familiar',
        name: roamingDragonMarker?.name ?? t('canvas2d.dragonLabel'),
        i18nKey: roamingDragonMarker?.i18nKey, icon: roamingDragonMarker?.icon ?? '🐉',
        x: roamingActors.dragon.x, y: roamingActors.dragon.y,
      });
    }
    return list;
  }, [roamingActors.npcMarkerId, roamingActors.dragonMarkerId, roamingActors.npc.x, roamingActors.npc.y, roamingActors.dragon.x, roamingActors.dragon.y, roamingNpcMarker, roamingDragonMarker, t]);

  const [toast, setToast] = useState<string | null>(null);
  const [travelConfirm, setTravelConfirm] = useState<WorldDef | null>(null);
  const [traveling, setTraveling] = useState<{ world: WorldDef; progress: number } | null>(null);

  // Filtres d'affichage par catégorie (boutons "afficher/masquer", voir demande utilisateur et
  // lib/mapFilters.ts) — état partagé en temps réel avec GameCanvas2D.tsx (même module). Les
  // valeurs par défaut de l'admin ne sont appliquées qu'une fois, et seulement si ce joueur n'a
  // encore jamais personnalisé ses filtres dans ce navigateur (voir applyAdminMapFilterDefaults).
  const [mapFilters, setMapFilters] = useMapFilters();
  const [filtersBarOpen, setFiltersBarOpen] = useState(false);
  const [kingdomFilterOpen, setKingdomFilterOpen] = useState(false);
  useEffect(() => {
    getMapFilterDefaults().then(applyAdminMapFilterDefaults).catch(() => {});
  }, []);

  // Navigation de la carte (clic droit + glisser pour scroller, molette pour zoomer — voir demande
  // utilisateur) — paramétrable en Administration (voir lib/gameState.ts::MapNavigationSettings).
  // N'affecte que le confort de navigation : le clic gauche continue de déplacer Synk exactement
  // comme avant (onCanvasClick, inchangé) — zéro régression de jeu.
  const [navSettings, setNavSettings] = useState<MapNavigationSettings>(DEFAULT_MAP_NAVIGATION_SETTINGS);
  const [panning, setPanning] = useState(false);
  const panRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const zoomAnchorRef = useRef<{ clientX: number; clientY: number; contentX: number; contentY: number; oldZoom: number } | null>(null);
  useEffect(() => {
    getMapNavigationSettings().then(setNavSettings).catch(() => {});
  }, []);

  // Refs miroir des états ci-dessus — utilisés dans le scan de découverte (voir runDiscoveryScan)
  // pour éviter les fermetures (closures) obsolètes dans l'écouteur temps réel de position.
  const poisRef = useRef<MapPoiDef[]>([]);
  const visitedRef = useRef<Set<string>>(new Set());
  const rulesRef = useRef<RepRules | null>(null);
  const seasonRef = useRef<Season | null>(null);
  useEffect(() => { poisRef.current = pois; }, [pois]);
  useEffect(() => { visitedRef.current = visitedPois; }, [visitedPois]);
  useEffect(() => { rulesRef.current = rules; }, [rules]);
  useEffect(() => { seasonRef.current = season; }, [season]);

  useEffect(() => {
    const savedSize = localStorage.getItem(SIZE_KEY);
    if (savedSize) { try { setSize(JSON.parse(savedSize)); } catch { /* ignore */ } }
  }, []);

  useEffect(() => {
    getMapPoiDefs(DEFAULT_MAP_ID).then(setPois).catch(() => {});
    getWorldDefs().then(setWorlds).catch(() => {});
    getRepRules().then(setRules).catch(() => {});
    getCurrentSeason().then(setSeason).catch(() => {});
    getAllMapMarkers(DEFAULT_MAP_ID).then(list => setEntityMarkers(list.filter(m => m.kind === 'npc' || m.kind === 'treasure' || m.kind === 'familiar' || m.kind === 'quest'))).catch(() => {});
  }, []);

  const refreshPlayerBits = useCallback(() => {
    if (!address) return;
    getVisitedMapPoiIds(address).then(setVisitedPois).catch(() => {});
  }, [address]);
  useEffect(() => { refreshPlayerBits(); }, [refreshPlayerBits]);
  useEffect(() => {
    if (!address) { setKingdomMarker(null); return; }
    const refreshKingdomMarker = () => getKingdomQuestMarker(address).then(setKingdomMarker).catch(() => {});
    refreshKingdomMarker();
    // Temps réel : dès qu'une quête (classique/PNJ/Royaume) est résolue ailleurs, la Quête du
    // Royaume affichée ici avance automatiquement — voir subscribeSolvedQuestIds.
    return subscribeSolvedQuestIds(address, refreshKingdomMarker);
  }, [address]);
  useEffect(() => {
    if (!address) { setZorghonEncounter(null); return; }
    const refreshZorghon = () => getZorghonEncounter(address).then(s => { if (s) setZorghonEncounter(s); }).catch(() => {});
    refreshZorghon();
    const unsubProgress = subscribeSolvedQuestIds(address, refreshZorghon);
    const unsubLive = subscribeZorghonEncounter(address, s => { if (s) setZorghonEncounter(s); });
    return () => { unsubProgress(); unsubLive(); };
  }, [address]);
  // Marqueurs synthétiques Zorghon/prisonniers (voir zorghonEncounter ci-dessus), fusionnés au
  // rendu ci-dessous exactement comme kingdomMarker — jamais écrits dans getAllMapMarkers().
  const zorghonMarkers = useMemo<MapMarker[]>(() => {
    if (!zorghonEncounter || zorghonEncounter.rescued) return [];
    return [
      { id: 'zorghon.boss', kind: 'zorghon', name: t('zorghon.marker.zorghon'), icon: '👹', x: zorghonEncounter.zorghonX, y: zorghonEncounter.zorghonY },
      { id: 'zorghon.captives', kind: 'captive', name: t('zorghon.marker.captives'), icon: '🧝‍♀️', x: zorghonEncounter.captiveX, y: zorghonEncounter.captiveY },
    ];
  }, [zorghonEncounter, t]);
  useEffect(() => {
    if (!address) { setUnlockedWorlds(new Set()); return; }
    // Abonnement temps réel : un monde découvert depuis PoiInteractionModal (plateforme
    // isométrique) doit apparaître débloqué ici sans recharger la page.
    return subscribeUnlockedWorldIds(address, setUnlockedWorlds);
  }, [address]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 5000); };

  // Un POI tagué `season` reste masqué/non-découvrable hors de sa saison tant qu'il n'a pas déjà
  // été découvert par ce joueur (voir gameState.ts::MapPoiDef.season).
  const visiblePois = pois.filter(p => !p.season || p.season === season || visitedPois.has(RKEY(p.id)));

  // ─── Calque de terrain (arrière-plan) ─────────────────────────────────────────────────────────
  // Réutilise EXACTEMENT le même générateur déterministe (worldTerrain.ts) que la plateforme 2D
  // isométrique (GameCanvas2D.tsx), biaisé par les mêmes POI-décor actifs, afin que les lacs,
  // montagnes, sentiers, plages, etc. affichés ici correspondent PIXEL POUR PIXEL (même position
  // relative) à ce que le joueur retrouve en vue isométrique — répond à la demande de « replacer
  // les petits sentiers, montagnes, lacs, etc. de la mapmonde que je retrouve sur la plateforme 2D
  // isométrique ». Échantillonné à une résolution plus grossière (48×32) qu'en vue isométrique
  // (tuile par tuile visible) car ici toute la carte 0-100% est affichée d'un coup.
  const terrainPoiPoints = useMemo(
    () => pois.filter(p => p.active !== false).map(p => ({ x: p.x, y: p.y, poiType: p.type, radius: p.radius })),
    [pois],
  );
  const TERRAIN_COLS = 48, TERRAIN_ROWS = 32;
  const terrainGrid = useMemo(() => {
    const grid: string[][] = [];
    for (let r = 0; r < TERRAIN_ROWS; r++) {
      const row: string[] = [];
      for (let c = 0; c < TERRAIN_COLS; c++) {
        const wc = (c + 0.5) * (WORLD_SIZE / TERRAIN_COLS);
        const wr = (r + 0.5) * (WORLD_SIZE / TERRAIN_ROWS);
        row.push(TERRAIN_COLOR[worldTileAt(wc, wr, terrainPoiPoints).terrain]);
      }
      grid.push(row);
    }
    return grid;
  }, [terrainPoiPoints]);

  // Tuile actuellement sous Synk sur la Mapmonde (miroir d'affichage de GameCanvas2D.tsx::currentTile
  // — même générateur déterministe, mêmes coordonnées 0-100%) : sert uniquement au pop-up
  // profondeur/altitude ci-dessous (voir RepRules::depthAltitudePopupEnabled), aucun impact sur les
  // statistiques ni sur la logique de jeu (celle-ci reste entièrement pilotée par GameCanvas2D.tsx).
  const currentMapTile = useMemo(
    () => worldTileAt(mapPos.x, mapPos.y, terrainPoiPoints),
    [mapPos.x, mapPos.y, terrainPoiPoints],
  );

  // Découverte fortuite d'un POI proche (rayon 6%) — appelée à chaque changement de position,
  // quelle que soit son origine (clic sur la carte ICI, ou flèches/pavé directionnel dans le
  // widget Plateforme 2D isométrique — voir subscribePlayerMapPos ci-dessous). `visitMapPoi` est
  // idempotent côté serveur (vérifie « déjà visité » avant d'attribuer l'XP), donc sans risque
  // même si le scan tourne plusieurs fois pour la même position.
  const runDiscoveryScan = useCallback(async (xPct: number, yPct: number) => {
    if (!address) return;
    const visible = poisRef.current.filter(p => !p.season || p.season === seasonRef.current || visitedRef.current.has(RKEY(p.id)));
    for (const poi of visible) {
      if (visitedRef.current.has(RKEY(poi.id))) continue;
      const d = Math.hypot(poi.x - xPct, poi.y - yPct);
      if (d <= 6) {
        const res = await visitMapPoi(address, poi, rulesRef.current?.mapPoiDiscoveryXp ?? 5);
        if (res === 'discovered') {
          visitedRef.current = new Set(visitedRef.current).add(RKEY(poi.id));
          setVisitedPois(new Set(visitedRef.current));
          showToast(`🧭 ${t('map.discovered')} : ${poi.icon} ${poi.name} (+${rulesRef.current?.mapPoiDiscoveryXp ?? 5} XP)`);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, t]);

  // Écoute temps réel de la position de Synk (voir gameState.ts::subscribePlayerMapPos) : se
  // synchronise instantanément avec les déplacements effectués depuis le widget Plateforme 2D
  // isométrique (flèches clavier ou pavé directionnel virtuel — voir GameCanvas2D.tsx), et
  // réciproquement les clics sur cette carte s'y reflètent en direct.
  useEffect(() => {
    if (!address) return;
    return subscribePlayerMapPos(address, p => {
      if (p && p.mapId === DEFAULT_MAP_ID) {
        setMapPos({ x: p.x, y: p.y });
        runDiscoveryScan(p.x, p.y);
      }
    });
  }, [address, runDiscoveryScan]);

  // ─── Redimensionnement (glisser le coin ⤡) ───
  const onResizePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    setResizing(true);
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onResizePointerMove = (e: React.PointerEvent) => {
    if (!resizing) return;
    const dx = e.clientX - resizeStart.current.x;
    const dy = e.clientY - resizeStart.current.y;
    setSize({
      w: Math.max(MIN_W, Math.min(MAX_W, resizeStart.current.w + dx)),
      h: Math.max(MIN_H, Math.min(MAX_H, resizeStart.current.h + dy)),
    });
  };
  const onResizePointerUp = () => {
    if (!resizing) return;
    setResizing(false);
    localStorage.setItem(SIZE_KEY, JSON.stringify(size));
  };

  // ─── Déplacement libre de Synk (clic sur la carte) ───
  // Le scan de découverte de POI proches est désormais géré par l'écouteur temps réel
  // subscribePlayerMapPos (voir plus haut), déclenché par cette écriture elle-même — ainsi le
  // même code de découverte s'applique quel que soit le widget à l'origine du déplacement.
  const moveSynkTo = async (xPct: number, yPct: number) => {
    if (!address) return;
    setMapPos({ x: xPct, y: yPct });
    await setPlayerMapPos(address, DEFAULT_MAP_ID, xPct, yPct);
  };

  const onCanvasClick = (e: React.MouseEvent) => {
    if (!canvasRef.current || traveling) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    if (xPct < 0 || xPct > 100 || yPct < 0 || yPct > 100) return;
    moveSynkTo(xPct, yPct);
  };

  // ─── Navigation carte : clic droit + glisser pour scroller, molette pour zoomer ───
  // Empêche le menu contextuel natif du clic droit uniquement si l'option est active (Administration).
  const onMapContextMenu = (e: React.MouseEvent) => {
    if (navSettings.rightClickPanEnabled) e.preventDefault();
  };
  const onMapMouseDown = (e: React.MouseEvent) => {
    if (!navSettings.rightClickPanEnabled || e.button !== 2 || !scrollRef.current) return;
    e.preventDefault();
    panRef.current = {
      startX: e.clientX, startY: e.clientY,
      scrollLeft: scrollRef.current.scrollLeft, scrollTop: scrollRef.current.scrollTop,
    };
    setPanning(true);
  };
  // Écouteurs globaux (window) pour continuer/arrêter le glisser même si le curseur quitte la
  // zone de la carte pendant le déplacement (comportement standard d'un glisser-déposer).
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const p = panRef.current;
      if (!p || !scrollRef.current) return;
      scrollRef.current.scrollLeft = p.scrollLeft - (e.clientX - p.startX) * navSettings.panSpeed;
      scrollRef.current.scrollTop = p.scrollTop - (e.clientY - p.startY) * navSettings.panSpeed;
    };
    const onUp = () => {
      if (panRef.current) { panRef.current = null; setPanning(false); }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [navSettings.panSpeed]);
  // Molette : zoome/dézoome en recentrant sur la position du curseur (voir effet ci-dessous, qui
  // ajuste le scroll une fois le nouveau `zoom` appliqué) — n'affecte pas les boutons 🔍-/🔍+.
  const onMapWheel = (e: React.WheelEvent) => {
    if (!navSettings.wheelZoomEnabled || !scrollRef.current) return;
    e.preventDefault();
    const rect = scrollRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left, clientY = e.clientY - rect.top;
    zoomAnchorRef.current = {
      clientX, clientY,
      contentX: clientX + scrollRef.current.scrollLeft, contentY: clientY + scrollRef.current.scrollTop,
      oldZoom: zoom,
    };
    const delta = e.deltaY < 0 ? navSettings.zoomStep : -navSettings.zoomStep;
    setZoom(z2 => Math.max(navSettings.zoomMin, Math.min(navSettings.zoomMax, +(z2 + delta).toFixed(2))));
  };
  useEffect(() => {
    const anchor = zoomAnchorRef.current;
    if (!anchor || !scrollRef.current) return;
    const ratio = zoom / anchor.oldZoom;
    scrollRef.current.scrollLeft = anchor.contentX * ratio - anchor.clientX;
    scrollRef.current.scrollTop = anchor.contentY * ratio - anchor.clientY;
    zoomAnchorRef.current = null;
  }, [zoom]);

  // ─── Voyage vers un monde ───
  const instantTravel = async (w: WorldDef, vehicleName: string) => {
    await discoverWorldOffchain(address!, w);
    const x = w.mapX ?? 50, y = w.mapY ?? 50;
    setMapPos({ x, y });
    await setPlayerMapPos(address!, DEFAULT_MAP_ID, x, y);
    setUnlockedWorlds(prev => new Set(prev).add(RKEY(w.id)));
    showToast(`🎈 ${t('map.travelFast', { name: localizeName(t, w.i18nKey, w.name), vehicle: vehicleName })}`);
  };

  const onClickWorld = async (e: React.MouseEvent, w: WorldDef) => {
    e.stopPropagation();
    if (!address || !rules) return;
    if (playerXp < w.xpRequired) {
      showToast(`🔒 ${t('map.locked', { xp: w.xpRequired })}`);
      return;
    }
    const inv = await getInventoryOnce(address);
    const vehicle = w.vehicleItemId
      ? inv.find(i => i.itemId === w.vehicleItemId && i.qty > 0)
      : inv.find(i => i.category === 'vehicle' && i.qty > 0);
    if (vehicle) {
      await instantTravel(w, vehicle.name);
    } else {
      setTravelConfirm(w);
    }
  };

  const onConfirmWalk = async () => {
    const w = travelConfirm;
    setTravelConfirm(null);
    if (!w || !address) return;
    setTraveling({ world: w, progress: 0 });
    const durationMs = Math.max(1, rules?.travelWalkDurationSec ?? 6) * 1000;
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      await sleep(durationMs / steps);
      setTraveling(prev => (prev ? { ...prev, progress: i / steps } : prev));
    }
    let msg = '';
    const chance = rules?.travelNightEncounterChancePct ?? 30;
    if (Math.random() * 100 < chance) {
      const player = await getOrCreatePlayer(address);
      const bonus = computePlayerDiceBonus(player, rules!);
      const playerRoll = rollD20();
      const monsterForce = 5 + Math.floor(Math.random() * 40);
      const monsterBonus = Math.round(Math.min(1, monsterForce / 45) * 12);
      const monsterRoll = rollD20();
      const win = (playerRoll + bonus) > (monsterRoll + monsterBonus);
      if (win) {
        msg = `⚔️ ${t('map.nightEncounterWin')}`;
      } else {
        const dmg = rules?.travelNightMonsterDamage ?? 15;
        await applyEffect(address, { hp: -dmg });
        msg = `💥 ${t('map.nightEncounterLose', { dmg })}`;
      }
    }
    await discoverWorldOffchain(address, w);
    const x = w.mapX ?? 50, y = w.mapY ?? 50;
    setMapPos({ x, y });
    await setPlayerMapPos(address, DEFAULT_MAP_ID, x, y);
    setUnlockedWorlds(prev => new Set(prev).add(RKEY(w.id)));
    setTraveling(null);
    showToast(`${msg ? msg + ' — ' : '🥾 '}${t('map.arrived', { name: localizeName(t, w.i18nKey, w.name) })}`);
  };

  // ─── Pop-up profondeur/altitude (miroir de GameCanvas2D.tsx — voir RepRules::depthAltitudePopup*)
  // Même indicateur non bloquant/clignotant, purement informatif, affiché tant que Synk se trouve
  // sur une dalle d'eau (profondeur) ou de montagne/roche (altitude) sur la Mapmonde.
  const currentMapTerrain = currentMapTile.terrain;
  const depthAltitudeUi = (rules?.depthAltitudePopupEnabled === false || (currentMapTerrain !== 'water' && currentMapTerrain !== 'rock')) ? null : (() => {
    const isWater = currentMapTerrain === 'water';
    const value = Math.round(isWater ? (currentMapTile.depthM ?? 0) : (currentMapTile.altitudeM ?? 0));
    const template = isWater ? rules?.depthAltitudePopupWaterTemplate : rules?.depthAltitudePopupMountainTemplate;
    const text = template && template.trim().length > 0
      ? template.replace('{value}', String(value))
      : t(isWater ? 'game.depthAltitude.water' : 'game.depthAltitude.mountain', { value });
    const corner = CORNER_POSITION_CLASSES[rules?.depthAltitudePopupPosition ?? 'top-left'];
    return (
      <div className={`fixed z-[90] ${corner} bg-slate-900/90 border-2 border-cyan-500 rounded-xl px-3 py-2 shadow-xl pointer-events-none animate-pulse`}>
        <p className="text-xs text-cyan-200 whitespace-nowrap">{isWater ? '🌊' : '🏔️'} {text}</p>
      </div>
    );
  })();

  if (!enabled || !address || !pos) return null;

  if (collapsed) {
    return (
      <>
        <button
          ref={containerRef}
          className="fixed z-40 w-14 h-14 rounded-full bg-amber-950 border-2 border-amber-600 text-2xl shadow-lg flex items-center justify-center"
          style={{ left: pos.x, top: pos.y, zIndex: z }}
          onPointerDownCapture={(e) => handleWidgetPointerDownCapture(e, bringToFront)}
          onPointerDown={onHeaderPointerDown} onPointerMove={onHeaderPointerMove} onPointerUp={onHeaderPointerUp}
          onClick={onToggleClick}
          onContextMenu={onContextMenu}
          title={t('map.title')}
        >🗺️</button>
        <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
        {depthAltitudeUi}
      </>
    );
  }

  const scaledW = BASE_W * zoom, scaledH = BASE_H * zoom;

  return (
    <div
      ref={containerRef}
      className="fixed z-40 bg-amber-950 border-2 border-amber-700 rounded-xl shadow-2xl select-none flex flex-col"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h, zIndex: z }}
      onPointerDownCapture={(e) => handleWidgetPointerDownCapture(e, bringToFront)}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-amber-900/60 rounded-t-xl cursor-move shrink-0"
        onPointerDown={onHeaderPointerDown} onPointerMove={onHeaderPointerMove} onPointerUp={onHeaderPointerUp}
        onContextMenu={onContextMenu}
      >
        <span className="text-sm font-semibold text-amber-100">🗺️ {t('map.title')}</span>
        <div className="flex items-center gap-1">
          <button
            className={`text-xs px-1.5 py-0.5 rounded hover:bg-amber-700 ${filtersBarOpen ? 'bg-amber-600' : 'bg-amber-800/60'}`}
            title={t('map.filters.title')}
            onClick={(e) => { e.stopPropagation(); setFiltersBarOpen(o => !o); }}
          >🔧</button>
          <button className="text-xs px-1.5 py-0.5 bg-amber-800/60 rounded hover:bg-amber-700" onClick={() => setZoom(z2 => Math.max(0.6, +(z2 - 0.2).toFixed(1)))}>🔍-</button>
          <span className="text-[10px] text-amber-300 w-8 text-center">{Math.round(zoom * 100)}%</span>
          <button className="text-xs px-1.5 py-0.5 bg-amber-800/60 rounded hover:bg-amber-700" onClick={() => setZoom(z2 => Math.min(2.6, +(z2 + 0.2).toFixed(1)))}>🔍+</button>
          <button className="text-xs opacity-70 hover:opacity-100 ml-1" data-widget-close onClick={toggleCollapsed}>✕</button>
        </div>
      </div>
      <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />

      {/* Barre de filtres d'affichage par catégorie (voir demande utilisateur : boutons pour
          afficher/masquer décors, mondes, PNJ, trésors, familiers, quêtes classiques/PNJ/Royaume)
          — synchronisée en temps réel avec GameCanvas2D.tsx via lib/mapFilters.ts. */}
      {filtersBarOpen && (
        <div className="px-2 py-1.5 bg-amber-950/80 border-b border-amber-800/60 shrink-0 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1">
            {MAP_FILTER_CATEGORIES.map(cat => (
              <button
                key={cat.key}
                onClick={() => setMapFilters({ [cat.key]: !mapFilters[cat.key] } as Partial<typeof mapFilters>)}
                title={t(cat.i18nKey)}
                className={`text-xs px-1.5 py-0.5 rounded border ${
                  mapFilters[cat.key] ? 'bg-emerald-800/70 border-emerald-500 text-emerald-100' : 'bg-slate-800/60 border-slate-600 text-slate-400 opacity-60'
                }`}
              >{cat.icon}</button>
            ))}
            <button
              className="text-[10px] px-1.5 py-0.5 rounded bg-amber-700/70 hover:bg-amber-600 text-amber-50 ml-1"
              onClick={() => resetMapFilters()}
            >{t('map.filters.all')}</button>
            {mapFilters.showQuestsKingdom && (
              <button
                className={`text-[10px] px-1.5 py-0.5 rounded border ml-1 ${kingdomFilterOpen ? 'bg-amber-600 border-amber-400' : 'bg-amber-800/60 border-amber-700'}`}
                onClick={() => setKingdomFilterOpen(o => !o)}
              >👑⚙️</button>
            )}
          </div>
          {mapFilters.showQuestsKingdom && kingdomFilterOpen && (
            <div className="flex flex-col gap-1 border-t border-amber-800/50 pt-1">
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-[10px] text-amber-300">{t('map.filters.kingdomFullMoon')}:</span>
                {(['all', 'onlyFullMoon', 'onlyNormal'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setMapFilters({ kingdomFullMoonMode: mode })}
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${
                      mapFilters.kingdomFullMoonMode === mode ? 'bg-fuchsia-800/70 border-fuchsia-500 text-fuchsia-100' : 'bg-slate-800/60 border-slate-600 text-slate-400'
                    }`}
                  >{t(mode === 'all' ? 'map.filters.kingdomFullMoonAll' : mode === 'onlyFullMoon' ? 'map.filters.kingdomFullMoonOnly' : 'map.filters.kingdomFullMoonNormal')}</button>
                ))}
              </div>
              <div className="flex items-center gap-1 flex-wrap max-h-20 overflow-y-auto">
                <span className="text-[10px] text-amber-300 shrink-0">{t('map.filters.kingdomChapters')}:</span>
                <button
                  onClick={() => setMapFilters({ kingdomChapters: null })}
                  className={`text-[9px] px-1 py-0.5 rounded border ${
                    mapFilters.kingdomChapters == null ? 'bg-fuchsia-800/70 border-fuchsia-500 text-fuchsia-100' : 'bg-slate-800/60 border-slate-600 text-slate-400'
                  }`}
                >{t('map.filters.kingdomChaptersAll')}</button>
                {KINGDOM_CHAPTERS.map(ch => {
                  const active = mapFilters.kingdomChapters?.includes(ch.chapter) ?? false;
                  return (
                    <button
                      key={ch.chapter}
                      title={localizeName(t, ch.i18nKey, ch.title)}
                      onClick={() => {
                        const cur = mapFilters.kingdomChapters ?? [];
                        const next = active ? cur.filter(c => c !== ch.chapter) : [...cur, ch.chapter];
                        setMapFilters({ kingdomChapters: next.length ? next : null });
                      }}
                      className={`text-[9px] px-1 py-0.5 rounded border ${
                        active ? 'bg-fuchsia-800/70 border-fuchsia-500 text-fuchsia-100' : 'bg-slate-800/60 border-slate-600 text-slate-400'
                      }`}
                    >{ch.chapter}</button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Zone défilable/zoomable de la carte — style vieux parchemin. Clic droit + glisser pour
          scroller dans toutes les directions, molette pour zoomer/dézoomer (paramétrable en
          Administration → « Navigation de la carte », voir MapNavigationSettings). */}
      <div
        ref={scrollRef}
        onContextMenu={onMapContextMenu}
        onMouseDown={onMapMouseDown}
        onWheel={onMapWheel}
        className={`relative flex-1 overflow-auto rounded-b-xl ${panning ? 'cursor-grabbing select-none' : ''}`}
        style={{
          background: 'radial-gradient(ellipse at 30% 20%, #e8d3a0 0%, #d8bd82 35%, #c4a465 65%, #a9884f 100%)',
        }}>
        <div
          ref={canvasRef}
          onClick={onCanvasClick}
          className="relative cursor-crosshair"
          style={{
            width: scaledW, height: scaledH,
            backgroundImage: 'repeating-linear-gradient(0deg, rgba(120,90,40,0.05) 0px, rgba(120,90,40,0.05) 2px, transparent 2px, transparent 40px), repeating-linear-gradient(90deg, rgba(120,90,40,0.05) 0px, rgba(120,90,40,0.05) 2px, transparent 2px, transparent 40px)',
            boxShadow: 'inset 0 0 60px 20px rgba(90,60,20,0.35)',
          }}
        >
          <p className="absolute top-1 left-2 text-[10px] italic text-amber-900/60 pointer-events-none" style={{ fontFamily: 'serif' }}>
            {t('map.parchmentCaption')}
          </p>

          {/* Calque de terrain (lacs, montagnes, sentiers, plages…) — même générateur déterministe
              que la plateforme 2D isométrique, en arrière-plan et sans interférer avec les clics. */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${TERRAIN_COLS}, 1fr)`,
              gridTemplateRows: `repeat(${TERRAIN_ROWS}, 1fr)`,
              opacity: 0.45,
            }}
          >
            {terrainGrid.map((row, r) => row.map((color, c) => (
              <div key={`${r}-${c}`} style={{ backgroundColor: color }} />
            )))}
          </div>

          {/* Points d'intérêt (terrain/décor) — masqués si le bouton "Décors" est désactivé (voir
              lib/mapFilters.ts) */}
          {mapFilters.showPois && visiblePois.map(poi => (
            <div
              key={poi.id}
              title={poi.name}
              className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none"
              style={{ left: `${poi.x}%`, top: `${poi.y}%` }}
            >
              <span style={{ fontSize: 14 + zoom * 6 }}>{poi.icon || POI_TYPE_FALLBACK_ICON[poi.type] || '📍'}</span>
              {zoom >= 1.2 && <span className="text-[9px] text-amber-950/80 font-semibold whitespace-nowrap" style={{ fontFamily: 'serif' }}>{poi.name}</span>}
            </div>
          ))}

          {/* PNJ, trésors, familiers et quêtes révélées par PNJ, localisés sur la carte (voir
              gameState.ts::getAllMapMarkers/poiFallbackPos) — informatif seulement (survol = nom).
              La Quête du Royaume en cours (👑, getKingdomQuestMarker) est fusionnée ici avec un
              léger effet pulsant pour bien la distinguer des marqueurs classiques. Filtré par
              catégorie (PNJ/trésors/familiers/quêtes classiques-PNJ-Royaume) selon les boutons de
              filtre — voir markerMatchesFilters(). Le PNJ/Dragon errant (voir roamingLiveMarkers
              ci-dessous) est exclu ICI (`m.id !== roamingActors.npcMarkerId && ...`) pour ne jamais
              afficher deux fois le même personnage : une fois à sa position CATALOGUE figée, une
              fois à sa position EN DIRECT — seule cette dernière doit apparaître. */}
          {[...entityMarkers.filter(m => m.id !== roamingActors.npcMarkerId && m.id !== roamingActors.dragonMarkerId), ...(kingdomMarker ? [kingdomMarker] : []), ...zorghonMarkers].filter(m => markerMatchesFilters(m, mapFilters)).map(m => (
            <div key={`${m.kind}-${m.id}`} title={`${m.icon} ${localizeName(t, m.i18nKey, m.name)}`}
              className={`absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none ${m.isKingdom ? 'animate-pulse' : ''}`}
              style={{ left: `${m.x}%`, top: `${m.y}%` }}>
              <span style={{ fontSize: (m.isKingdom ? 16 : 13) + zoom * 5 }}>{m.icon}</span>
            </div>
          ))}

          {/* PNJ/Dragon errant — position EN DIRECT sur toute la mapmonde (voir lib/roamingActors.ts),
              pour que le joueur sache TOUJOURS où ils se trouvent actuellement (répond à la demande
              utilisateur « identifie clairement [...] afin de savoir où ils se trouvent »). Anneau
              pulsant + nom TOUJOURS visible (indépendamment du niveau de zoom, contrairement aux POI
              ci-dessus) pour bien les distinguer des marqueurs catalogue figés. Respecte les mêmes
              filtres « PNJ »/« Familiers » que leurs homologues statiques (voir roamingLiveMarkers :
              kind 'npc'/'familiar') — répond à « les ajouter dans le filtre d'affichage des PNJ ». */}
          {roamingLiveMarkers.filter(m => markerMatchesFilters(m, mapFilters)).map(m => (
            <div key={`roaming-${m.kind}-${m.id}`}
              title={`${m.icon} ${localizeName(t, m.i18nKey, m.name)} · ${m.kind === 'npc' ? t('canvas2d.npcLabel') : t('canvas2d.dragonLabel')}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none transition-all duration-[1500ms]"
              style={{ left: `${m.x}%`, top: `${m.y}%` }}>
              <span className="absolute rounded-full border-2 border-amber-400 animate-ping" style={{ width: 20 + zoom * 8, height: 20 + zoom * 8 }} />
              <span style={{ fontSize: 15 + zoom * 6 }}>{m.icon}</span>
              <span className="text-[9px] text-amber-950 font-bold whitespace-nowrap bg-amber-100/80 px-1 rounded shadow-sm">
                {localizeName(t, m.i18nKey, m.name)}
              </span>
            </div>
          ))}

          {/* Mondes (portails) — masqués si le bouton "Mondes" est désactivé */}
          {mapFilters.showWorlds && worlds.map(w => {
            const locked = playerXp < w.xpRequired;
            return (
              <button
                key={w.id}
                onClick={(e) => onClickWorld(e, w)}
                title={locked ? `🔒 ${t('map.locked', { xp: w.xpRequired })}` : localizeName(t, w.i18nKey, w.name)}
                className={`absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center rounded-full border-2 shadow-md ${
                  locked ? 'border-slate-600 bg-slate-800/70 opacity-60' : 'border-fuchsia-400 bg-fuchsia-950/70 animate-pulse'
                }`}
                style={{ left: `${w.mapX ?? 50}%`, top: `${w.mapY ?? 50}%`, width: 20 + zoom * 10, height: 20 + zoom * 10 }}
              >
                <span style={{ fontSize: 10 + zoom * 6 }}>{locked ? '🔒' : '🌀'}</span>
              </button>
            );
          })}

          {/* PNJ "en approche" — matérialise la rencontre (pop-up NpcEncounterPopup ouvert) juste au
              nord de Synk, tant que le pop-up reste affiché (voir encounterNpc/onEncounterChange) */}
          {encounterNpc && (
            <div
              className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none flex flex-col items-center animate-bounce"
              style={{ left: `${mapPos.x}%`, top: `${Math.max(0, mapPos.y - 1)}%` }}
              title={`${NPC_SKINS[encounterNpc.skin]} ${localizeName(t, `npc.archetype.${encounterNpc.baseKey}`, encounterNpc.baseKey)} · ${localizeName(t, `npc.offer.${encounterNpc.offer}`, encounterNpc.offer)}`}
            >
              <span className="text-[10px] leading-none">❗</span>
              <span style={{ fontSize: 14 + zoom * 6 }}>{NPC_SKINS[encounterNpc.skin]}</span>
            </div>
          )}

          {/* Position de Synk */}
          <div
            className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-all duration-700 ease-out flex flex-col items-center"
            style={{ left: `${mapPos.x}%`, top: `${mapPos.y}%` }}
          >
            <SynkSkin stage={0} size={18 + zoom * 10} />
          </div>
        </div>
      </div>

      {/* Coin de redimensionnement */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize text-amber-400/70 flex items-center justify-center text-[10px]"
        onPointerDown={onResizePointerDown} onPointerMove={onResizePointerMove} onPointerUp={onResizePointerUp}
      >⤡</div>

      {toast && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-slate-900/95 border border-amber-500 rounded px-3 py-1.5 text-xs text-amber-100 shadow-xl max-w-[90%] text-center">
          {toast}
        </div>
      )}

      {traveling && (
        <div className="absolute inset-x-3 bottom-3 bg-slate-900/95 border border-amber-500 rounded p-2 text-xs text-amber-100">
          <p className="mb-1">🥾 {t('map.walking', { name: localizeName(t, traveling.world.i18nKey, traveling.world.name) })}</p>
          <div className="h-1.5 bg-slate-700 rounded overflow-hidden">
            <div className="h-full bg-amber-500 transition-all" style={{ width: `${traveling.progress * 100}%` }} />
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!travelConfirm}
        title={t('map.travelConfirmTitle')}
        message={travelConfirm ? t('map.travelConfirmMsg', { name: localizeName(t, travelConfirm.i18nKey, travelConfirm.name) }) : ''}
        onConfirm={onConfirmWalk}
        onCancel={() => setTravelConfirm(null)}
      />
      {depthAltitudeUi}
    </div>
  );
}
