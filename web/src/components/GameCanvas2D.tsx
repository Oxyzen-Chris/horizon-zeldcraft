'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import {
  getAllMapMarkers, setPlayerMapPos, subscribePlayerMapPos, DEFAULT_MAP_ID, getRepRules,
  getOrCreatePlayer, subscribePlayer, applyEffect, removeRandomInventoryItem, subscribeInventory,
  getKingdomQuestMarker, subscribeSolvedQuestIds,
  getZorghonEncounter, subscribeZorghonEncounter, relocateZorghonCaptives, rescuePocaPoka,
  CORNER_POSITION_CLASSES, trackFaintEvent,
  type MapMarker, type MapPoiType, type RepRules, type PlayerState, type InventoryItem, type ZorghonEncounterState,
  type SynkDirection,
} from '@/lib/gameState';
import {
  TERRAIN_COLOR, PROP_ICON, TERRAIN_I18N_KEY, PROP_I18N_KEY, worldTileAt, clamp100, WORLD_SIZE, hashRand,
  isObstacleAt,
  type Tile,
} from '@/lib/worldTerrain';
import { useI18n, localizeName, itemLabel } from '@/lib/i18n';
import { useWindowZIndex } from '@/lib/windowZOrder';
import { useDraggableWidget } from '@/lib/useDraggableWidget';
import { useHoldMovement } from '@/lib/useHoldMovement';
import { WidgetContextMenu } from './WidgetContextMenu';
import { useMapFilters, markerMatchesFilters } from '@/lib/mapFilters';
import { SynkSkin } from './SynkSkin';
import { PoiInteractionModal } from './PoiInteractionModal';
import { HutRestModal } from './HutRestModal';
import { NPC_SKINS } from '@/lib/contract';
import type { EncounterMarkerInfo } from './NpcEncounterPopup';

const POS_KEY = 'zc.iso2dWidgetPos';
const SIZE_KEY = 'zc.iso2dWidgetSize';
const COLLAPSED_KEY = 'zc.iso2dWidgetCollapsed';
interface Pos { x: number; y: number }
interface Size { w: number; h: number }

const MIN_W = 380, MIN_H = 300, MAX_W = 900, MAX_H = 680;
const COLS = 10, ROWS = 8;
const TILE_W = 56, TILE_H = 28;
// Le viewport isométrique est une fenêtre COLSxROWS glissant sur l'espace complet de la mapmonde
// (0-100 en x/y, même échelle en % que WorldMapWidget.tsx) — un pas de flèche/pavé directionnel
// déplace Synk de STEP_PCT sur cette échelle, ce qui garde les deux widgets parfaitement cohérents
// (même source de vérité : players/{addr}/mapPos, voir gameState.ts::setPlayerMapPos).
const STEP_PCT = 1; // Synk avance d'une case (= 1 unité mapmonde) à chaque pression/clic — voir move()
const MARGIN = 1; // marge (en cellules) avant que la caméra ne recadre le décor
// Délai d'inactivité (ms) après le dernier pas avant de considérer que Synk s'est arrêté et de
// couper l'animation de marche (voir isWalking/walkStopTimerRef dans le composant) — assez court
// pour un arrêt visuel réactif, assez long pour ne pas "hacher" l'animation entre deux appuis
// répétés (auto-repeat clavier) d'un même déplacement continu.
const WALK_STOP_DELAY_MS = 220;

/** Déduit la direction de marche à 8 valeurs (voir SynkDirection) à partir d'un delta (dx,dy). */
function directionFromDelta(dx: number, dy: number): SynkDirection | null {
  if (dx === 0 && dy === 0) return null;
  if (dx === 0) return dy < 0 ? 'up' : 'down';
  if (dy === 0) return dx < 0 ? 'left' : 'right';
  if (dx < 0) return dy < 0 ? 'up-left' : 'down-left';
  return dy < 0 ? 'up-right' : 'down-right';
}

interface Actor { id: string; col: number; row: number; icon: string; label: string }

/** Construit la grille COLSxROWS visible à partir du coin (originCol, originRow) de la caméra. */
function buildViewportGrid(originCol: number, originRow: number, poiPoints: { x: number; y: number; poiType?: MapPoiType; radius?: number }[]): Tile[][] {
  const grid: Tile[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const row: Tile[] = [];
    for (let c = 0; c < COLS; c++) row.push(worldTileAt(originCol + c, originRow + r, poiPoints));
    grid.push(row);
  }
  return grid;
}

const projX = (col: number, row: number) => (col - row) * (TILE_W / 2);
const projY = (col: number, row: number) => (col + row) * (TILE_H / 2);

/** Cherche la dalle verte (terre) la plus proche de (wc, wr) par anneaux concentriques croissants
 * (les cases immédiatement voisines pouvant elles-mêmes être de l'eau) — utilisé pour reposer Synk
 * sur la terre ferme après un évanouissement par noyade (voir mécanique Oxygène). */
function findNearestGrassTile(wc: number, wr: number, poiPoints: { x: number; y: number; poiType?: MapPoiType; radius?: number }[]): Pos | null {
  for (let radius = 0; radius <= 12; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue; // ne parcourt que l'anneau
        const x = clamp100(wc + dx), y = clamp100(wr + dy);
        if (worldTileAt(x, y, poiPoints).terrain === 'grass') return { x, y };
      }
    }
  }
  return null;
}

/** Calcule le pourcentage de Fatigue à retirer au prochain palier de décroissance, en tenant
 * compte de la pondération "moins d'énergie" (RepRules::fatigueLowStats*) : Synk se fatigue un peu
 * plus vite en se déplaçant quand sa Vie, sa Faim, sa Force OU son Oxygène sont sous
 * `fatigueLowStatsThresholdPct` (% de leur plafond respectif) — chaque statistique basse ajoute
 * `fatigueLowStatsExtraDrainPerStat` au drain de base `fatigueDrainPct`, le tout plafonné à
 * `fatigueLowStatsMaxExtraPct` pour que la pénalité reste toujours raisonnable. */
function computeFatigueDrainPct(rules: RepRules, player: PlayerState | null): number {
  const base = Math.max(0, rules.fatigueDrainPct ?? 2);
  if (!player || rules.fatigueLowStatsPenaltyEnabled === false) return base;
  const thresholdPct = rules.fatigueLowStatsThresholdPct ?? 30;
  const pctOf = (v: number | undefined, max: number | undefined) =>
    Math.max(0, Math.min(100, ((v ?? 0) / (max || 100)) * 100));
  let lowCount = 0;
  if (pctOf(player.hp, player.hpMax) < thresholdPct) lowCount++;
  if (pctOf(player.hunger, player.hungerMax) < thresholdPct) lowCount++;
  if (pctOf(player.force, player.forceMax) < thresholdPct) lowCount++;
  if (pctOf(player.oxygen, player.oxygenMax) < thresholdPct) lowCount++;
  const extraPerStat = Math.max(0, rules.fatigueLowStatsExtraDrainPerStat ?? 1);
  const maxExtra = Math.max(0, rules.fatigueLowStatsMaxExtraPct ?? 4);
  return base + Math.min(lowCount * extraPerStat, maxExtra);
}

/** Facteur multiplicatif (0 < f <= 1) appliqué à l'intervalle de décroissance Oxygène/Fatigue selon
 * l'altitude (dalle de montagne/roche, RepRules::altitude*) ou la profondeur (dalle d'eau,
 * RepRules::waterDepth*) de la tuile fournie — plus Synk grimpe haut ou plonge dans une eau
 * profonde, plus l'air se raréfie et plus l'intervalle se réduit (décroissance accélérée). Renvoie
 * 1 (aucun effet) si la mécanique concernée est désactivée ou si la tuile n'a pas d'altitude/
 * profondeur (terrain plat, dalle d'eau ambiante peu profonde, etc). */
function computeRarefactionFactor(rules: RepRules, tile: Tile): number {
  if (tile.altitudeM != null && rules.altitudeEnabled !== false) {
    const start = Math.max(0, rules.altitudeRarefactionStartM ?? 1500);
    const max = Math.max(start + 1, rules.altitudeMaxM ?? 6000);
    if (tile.altitudeM > start) {
      const ratio = Math.min(1, (tile.altitudeM - start) / (max - start));
      const minFactor = Math.max(0.05, Math.min(1, rules.altitudeRarefactionMinIntervalFactor ?? 0.4));
      return 1 - ratio * (1 - minFactor);
    }
    return 1;
  }
  if (tile.depthM != null && rules.waterDepthEnabled !== false) {
    const max = Math.max(1, rules.waterDepthMaxM ?? 6000);
    const ratio = Math.min(1, tile.depthM / max);
    const minFactor = Math.max(0.05, Math.min(1, rules.waterDepthRarefactionMinIntervalFactor ?? 0.5));
    return 1 - ratio * (1 - minFactor);
  }
  return 1;
}

/**
 * Plateforme de jeu 2D en vue isométrique — fenêtre widget permanente, redimensionnable (glisser
 * le coin ⤡). Conçue comme le SOCLE ÉVOLUTIF de gestion des déplacements/rencontres/décor de Synk,
 * des PNJ, dragons, etc., à l'image des univers Zelda/Minecraft/WoW demandés.
 *
 * IMPORTANT (choix d'architecture) : un vrai moteur Godot/Unity ne peut pas être « embarqué » tel
 * quel dans une session de développement assistée sur ce dépôt Next.js/Vercel (pas de pipeline
 * d'assets/export WebGL/WASM disponible ici). Ce composant fournit donc une implémentation
 * pragmatique et 100% fonctionnelle en React/CSS (grille isométrique, terrain procédural
 * DÉTERMINISTE par coordonnée mapmonde, déplacement clavier/pavé virtuel/clic, PNJ/dragon qui
 * évoluent) exposant le même contrat de données (entités positionnées sur une grille, terrain
 * dérivé des POI de la mapmonde) qu'un futur export Godot/Unity WebGL pourrait consommer sans tout
 * réécrire — voir `worldTileAt()`/`Actor` ci-dessus.
 *
 * Synchronisation avec la mapmonde (voir WorldMapWidget.tsx) : la position de Synk est désormais
 * partagée en TEMPS RÉEL entre les deux widgets via `players/{addr}/mapPos` (0-100% en x/y, même
 * échelle dans les deux vues — voir `subscribePlayerMapPos`/`setPlayerMapPos` dans gameState.ts).
 * Déplacer Synk ici (flèches clavier ↑↓←→, pavé directionnel virtuel, ou clic sur une tuile) met
 * à jour cette position partagée, immédiatement répercutée sur le widget Mapmonde — et
 * réciproquement un déplacement sur la Mapmonde recentre instantanément la caméra isométrique ici.
 * Quand Synk approche du bord de la fenêtre COLSxROWS affichée, la caméra recadre (pan) le décor
 * dans la direction du déplacement pour continuer à explorer tout l'espace de la mapmonde.
 */
export function GameCanvas2D({ stage, playerXp = 0, encounterNpc }: { stage: number; playerXp?: number; encounterNpc?: EncounterMarkerInfo }) {
  const { t } = useI18n();
  const { address } = useAccount();
  const { z, bringToFront } = useWindowZIndex();
  const {
    collapsed, pos, onPointerDown: onHeaderPointerDown, onPointerMove: onHeaderPointerMove,
    onPointerUp: onHeaderPointerUp, onToggleClick, toggleCollapsed,
    containerRef, menuPos, onContextMenu, closeContextMenu, resetPosition,
  } = useDraggableWidget({
    posKey: POS_KEY, collapsedKey: COLLAPSED_KEY,
    defaultPos: () => ({ x: window.innerWidth - 520, y: 90 }),
    onExpand: bringToFront,
  });

  const [size, setSize] = useState<Size>({ w: 480, h: 380 });
  const [resizing, setResizing] = useState(false);
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 0, h: 0 });

  // Règles admin (voir gameState.ts::RepRules) — récupérées une fois pour les interactions POI
  // (repos en hutte notamment : hutRestHp/hutRestCooldownHours/hutRestDurationSec).
  const [rules, setRules] = useState<RepRules | null>(null);
  useEffect(() => { getRepRules().then(setRules).catch(() => {}); }, []);

  // Marqueur cliqué (PNJ/familier/trésor/quête/monde/hutte) alors que Synk est sur sa case ou une
  // case adjacente — voir handleMarkerClick() plus bas. `hutResting` bascule sur la fenêtre plein
  // écran de repos (voir HutRestModal.tsx) une fois le pop-up d'interaction refermé.
  const [interactionMarker, setInteractionMarker] = useState<MapMarker | null>(null);
  const [hutResting, setHutResting] = useState(false);
  const [hutFeedback, setHutFeedback] = useState<string | null>(null);

  // Fiche joueur (HP/oxygène/…) — abonnement dédié à ce widget (comme WorldMapWidget/DiceRollWidget
  // le font déjà chacun de leur côté) pour ne pas coupler GameCanvas2D à game/page.tsx via des props.
  const [player, setPlayer] = useState<PlayerState | null>(null);
  useEffect(() => {
    if (!address) { setPlayer(null); return; }
    return subscribePlayer(address, setPlayer);
  }, [address]);
  // Miroir de `player` en ref (comme worldPosRef) pour lire l'oxygène/oxygenMax LIVE depuis
  // l'intérieur d'un setInterval (récupération d'oxygène ci-dessous) SANS dépendre de `player` dans
  // le tableau de dépendances de l'effet — sinon l'intervalle serait relancé (et donc réinitialisé)
  // à chaque palier de récupération puisque celui-ci modifie justement `player.oxygen`.
  const playerRef = useRef(player);
  useEffect(() => { playerRef.current = player; }, [player]);

  // ─── Mécanique Oxygène (voir RepRules::oxygen*) ───────────────────────────────────────────────
  // `oxygenTimer` = secondes restantes avant le prochain palier de décroissance tant que Synk reste
  // sur une dalle d'eau OU de montagne/roche (null = ni l'un ni l'autre). `oxygenRecovering` = true
  // tant que Synk est sur une dalle de terre (verte) ET que son oxygène n'est pas encore au maximum
  // (palier de récupération en cours, voir effet dédié plus bas). `fainting` = évanouissement en
  // cours (compteur de récupération, interface bloquée comme SleepModal/HutRestModal). `faintResult`
  // = résumé des pertes affiché une fois Synk réveillé.
  const [oxygenTimer, setOxygenTimer] = useState<number | null>(null);
  const [oxygenRecovering, setOxygenRecovering] = useState(false);
  const [fainting, setFainting] = useState<{ remaining: number } | null>(null);
  const [faintResult, setFaintResult] = useState<{ xp: number; hp: number; itemName: string | null } | null>(null);
  const oxygenIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const oxygenRecoverIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const faintIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const faintingRef = useRef(false); // anti double-déclenchement pendant qu'un évanouissement est déjà en cours

  // ─── Mécanique Fatigue (voir RepRules::fatigue*) ──────────────────────────────────────────────
  // `isMoving` = vrai tant que Synk enchaîne des déplacements sans marquer de pause d'au moins
  // `fatigueStopGraceSec` secondes (voir effet dédié juste après worldPos, plus bas) — recalculé à
  // CHAQUE changement de position, quel que soit le widget à l'origine du déplacement (Plateforme 2D
  // isométrique OU Mapmonde, même source de vérité players/{addr}/mapPos). `fatigueTimer` = secondes
  // restantes avant le prochain palier de décroissance tant que `isMoving`. `fatigueRecovering` =
  // palier de récupération en cours tant que Synk est arrêté/ralenti et pas encore à 100 %.
  const [isMoving, setIsMoving] = useState(false);
  const [fatigueTimer, setFatigueTimer] = useState<number | null>(null);
  const [fatigueRecovering, setFatigueRecovering] = useState(false);
  const moveStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fatigueIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fatigueRecoverIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // `fatigueFainting` = évanouissement d'épuisement en cours (compteur de blocage, comme `fainting`
  // pour l'oxygène mais SÉPARÉ : perte de Vie uniquement, pas de XP/objet, pas de téléportation —
  // l'épuisement est lié au mouvement, pas au terrain). `fatigueFaintResult` = résumé de la perte de
  // Vie affiché une fois Synk réveillé (pop-up désactivable via RepRules::fatigueFaintResultPopupEnabled).
  const [fatigueFainting, setFatigueFainting] = useState<{ remaining: number } | null>(null);
  const [fatigueFaintResult, setFatigueFaintResult] = useState<{ hp: number } | null>(null);
  const fatigueFaintIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fatigueFaintingRef = useRef(false); // anti double-déclenchement pendant qu'un évanouissement d'épuisement est déjà en cours

  // ─── Traque de Zorghon, PocaPoka & El Pipo (voir RepRules::zorghon*, gameState.ts) ────────────
  // `zorghonEncounter` = état courant (position de Zorghon/des prisonniers, nb de relocalisations,
  // délivré ou non), abonné en temps réel pour rester synchronisé avec WorldMapWidget.tsx.
  // `zorghonNotice` = petit bandeau non bloquant affiché quelques secondes lors d'une relocalisation
  // (« Zorghon a senti Synk approcher… »). `zorghonRescueResult` = pop-up de célébration affiché une
  // fois PocaPoka et El Pipo délivrés (XP gagnée), fermé manuellement par le joueur.
  const [zorghonEncounter, setZorghonEncounter] = useState<ZorghonEncounterState | null>(null);
  const [zorghonNotice, setZorghonNotice] = useState<string | null>(null);
  const [zorghonRescueResult, setZorghonRescueResult] = useState<{ xp: number } | null>(null);
  const zorghonEncounterRef = useRef(zorghonEncounter);
  useEffect(() => { zorghonEncounterRef.current = zorghonEncounter; }, [zorghonEncounter]);
  const zorghonNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zorghonRescuingRef = useRef(false); // anti double-déclenchement pendant l'appel rescuePocaPoka()

  const [biasLabel, setBiasLabel] = useState<string>('');
  // Tous les marqueurs de la mapmonde (décor/terrain, mondes, PNJ, trésors, familiers, quêtes PNJ —
  // voir gameState.ts::getAllMapMarkers), positionnés IDENTIQUEMENT à WorldMapWidget.tsx (même
  // fonction, même repli déterministe) afin que les deux vues soient toujours cohérentes.
  const [markers, setMarkers] = useState<MapMarker[]>([]);
  const poiPoints = useMemo(
    () => markers.filter(m => m.kind === 'poi').map(m => ({ x: m.x, y: m.y, poiType: m.poiType, radius: m.radius })),
    [markers],
  );

  // Position réelle de Synk sur la mapmonde (0-100%, source de vérité partagée avec
  // WorldMapWidget.tsx) et coin de la caméra isométrique (en cellules, 0-100 chacun).
  const [worldPos, setWorldPos] = useState<Pos>({ x: 50, y: 88 });
  const [origin, setOrigin] = useState({ col: 45, row: 84 });
  const worldPosRef = useRef(worldPos);
  useEffect(() => { worldPosRef.current = worldPos; }, [worldPos]);

  // ─── Détection "Synk en mouvement" pour la mécanique Fatigue ──────────────────────────────────
  // Chaque changement de position (pas au clavier/pavé directionnel, clic sur une tuile de la
  // Plateforme 2D isométrique OU sur la Mapmonde — même donnée partagée players/{addr}/mapPos)
  // relance un minuteur de grâce `fatigueStopGraceSec` : tant qu'un nouveau déplacement survient
  // avant son échéance, Synk reste considéré "en mouvement continu" ; sans nouveau déplacement
  // pendant ce délai, il est considéré arrêté/ralenti. Le tout premier positionnement (montage du
  // widget, avant toute action du joueur) est ignoré pour ne jamais déclencher un état "en
  // mouvement" fictif au chargement de la page.
  const skipFirstMoveRef = useRef(true);
  useEffect(() => {
    if (skipFirstMoveRef.current) { skipFirstMoveRef.current = false; return; }
    setIsMoving(true);
    if (moveStopTimerRef.current) clearTimeout(moveStopTimerRef.current);
    const graceMs = Math.max(200, Math.round((rules?.fatigueStopGraceSec ?? 1.5) * 1000));
    moveStopTimerRef.current = setTimeout(() => setIsMoving(false), graceMs);
    return () => { if (moveStopTimerRef.current) clearTimeout(moveStopTimerRef.current); };
  }, [worldPos, rules?.fatigueStopGraceSec]);

  const [npc, setNpc] = useState<Actor>({ id: 'npc', col: 4, row: 3, icon: '🧙', label: t('canvas2d.npcLabel') });
  const [dragon, setDragon] = useState<Actor>({ id: 'dragon', col: 7, row: 5, icon: '🐉', label: t('canvas2d.dragonLabel') });

  // Identité catalogue (PNJ/familier-dragon réel) attribuée une fois au PNJ/Dragon errant, pour que
  // leur clic ouvre le VRAI pop-up d'interaction (discussion/quête ou apprivoisement) au lieu de ne
  // rien faire — voir onActorClick() plus bas. Choisie aléatoirement dès que le catalogue est chargé
  // puis figée (ne change plus tant que le widget reste monté).
  const [roamingNpcId, setRoamingNpcId] = useState<string | null>(null);
  const [roamingDragonId, setRoamingDragonId] = useState<string | null>(null);

  useEffect(() => {
    const savedSize = localStorage.getItem(SIZE_KEY);
    if (savedSize) { try { setSize(JSON.parse(savedSize)); } catch { /* ignore */ } }
  }, []);

  // Tous les marqueurs de la mapmonde (une fois) — décor pour le biais de terrain local (voir
  // worldTileAt) ET affichage direct dans la fenêtre de la caméra (voir rendu plus bas).
  useEffect(() => { getAllMapMarkers(DEFAULT_MAP_ID).then(setMarkers).catch(() => {}); }, []);

  // Marqueur unique de la Quête du Royaume en cours (👑, voir getKingdomQuestMarker) — fusionné
  // dans visibleMarkers ci-dessous (kind: 'quest', réutilise le même clic → PoiInteractionModal
  // que les quêtes PNJ classiques), sans toucher à getAllMapMarkers()/`markers` (zéro régression).
  const [kingdomMarker, setKingdomMarker] = useState<MapMarker | null>(null);
  useEffect(() => {
    if (!address) { setKingdomMarker(null); return; }
    const refreshKingdomMarker = () => getKingdomQuestMarker(address).then(setKingdomMarker).catch(() => {});
    refreshKingdomMarker();
    return subscribeSolvedQuestIds(address, refreshKingdomMarker);
  }, [address]);

  // Traque de Zorghon (voir déclaration d'état plus haut) : (ré)essaie de créer paresseusement
  // l'état dès qu'une quête est résolue (le seuil zorghonAppearKingdomSolvedCount peut alors venir
  // d'être atteint — même principe que kingdomMarker ci-dessus) ET reste abonné en temps réel au
  // nœud Firebase pour refléter instantanément une relocalisation/délivrance déclenchée depuis un
  // autre widget (WorldMapWidget.tsx) ou un autre onglet.
  useEffect(() => {
    if (!address) { setZorghonEncounter(null); return; }
    const refreshZorghon = () => getZorghonEncounter(address).then(s => { if (s) setZorghonEncounter(s); }).catch(() => {});
    refreshZorghon();
    const unsubProgress = subscribeSolvedQuestIds(address, refreshZorghon);
    const unsubLive = subscribeZorghonEncounter(address, s => { if (s) setZorghonEncounter(s); });
    return () => { unsubProgress(); unsubLive(); };
  }, [address]);

  // Attribue au PNJ errant et au Dragon errant une véritable entrée du catalogue (dès que les
  // marqueurs sont chargés), pour que cliquer sur eux ouvre le vrai pop-up (discussion/quête pour le
  // PNJ, apprivoisement pour le dragon) — voir onActorClick(). Le dragon préfère un familier de type
  // "dragon.*" (voir DragonSkin.tsx::dragonKindFromId) s'il en existe un dans le catalogue.
  useEffect(() => {
    if (!roamingNpcId) {
      const pool = markers.filter(m => m.kind === 'npc');
      if (pool.length) setRoamingNpcId(pool[Math.floor(Math.random() * pool.length)].id);
    }
    if (!roamingDragonId) {
      const familiars = markers.filter(m => m.kind === 'familiar');
      const dragons = familiars.filter(m => /^dragon\./i.test(m.id));
      const pool = dragons.length ? dragons : familiars;
      if (pool.length) setRoamingDragonId(pool[Math.floor(Math.random() * pool.length)].id);
    }
  }, [markers, roamingNpcId, roamingDragonId]);

  const roamingNpcMarker = useMemo(
    () => markers.find(m => m.kind === 'npc' && m.id === roamingNpcId) ?? null,
    [markers, roamingNpcId],
  );
  const roamingDragonMarker = useMemo(
    () => markers.find(m => m.kind === 'familiar' && m.id === roamingDragonId) ?? null,
    [markers, roamingDragonId],
  );
  const worldMarkers = useMemo(() => markers.filter(m => m.kind === 'world'), [markers]);

  // Écoute temps réel de la position de Synk — synchronise instantanément avec WorldMapWidget.tsx,
  // quel que soit le widget à l'origine du déplacement (clic carte, flèches, pavé virtuel).
  useEffect(() => {
    if (!address) return;
    return subscribePlayerMapPos(address, p => {
      if (p && p.mapId === DEFAULT_MAP_ID) setWorldPos({ x: p.x, y: p.y });
    });
  }, [address]);

  // Raccord avec la mapmonde : détermine le POI-décor le plus proche de la position réelle de Synk
  // (juste pour l'indication textuelle affichée sous le titre — le terrain lui-même est désormais
  // biaisé LOCALEMENT par POI, voir worldTileAt()).
  useEffect(() => {
    if (!poiPoints.length) return;
    let nearest: { name: string } | null = null;
    let bestD = Infinity;
    for (const poi of markers) {
      if (poi.kind !== 'poi') continue;
      const d = Math.hypot(poi.x - worldPos.x, poi.y - worldPos.y);
      if (d < bestD) { bestD = d; nearest = poi; }
    }
    if (nearest) setBiasLabel(nearest.name);
  }, [markers, poiPoints.length, worldPos]);

  // Caméra qui suit Synk : recadre (pan) le décor dès qu'il approche du bord de la fenêtre
  // affichée, pour continuer à progresser dans l'espace total de la mapmonde (0-100%).
  useEffect(() => {
    const wc = Math.round(clamp100(worldPos.x));
    const wr = Math.round(clamp100(worldPos.y));
    setOrigin(prev => {
      let { col, row } = prev;
      if (wc - col < MARGIN) col = wc - MARGIN;
      else if (wc - col > COLS - 1 - MARGIN) col = wc - (COLS - 1 - MARGIN);
      if (wr - row < MARGIN) row = wr - MARGIN;
      else if (wr - row > ROWS - 1 - MARGIN) row = wr - (ROWS - 1 - MARGIN);
      col = Math.max(0, Math.min(WORLD_SIZE - COLS, col));
      row = Math.max(0, Math.min(WORLD_SIZE - ROWS, row));
      return (col === prev.col && row === prev.row) ? prev : { col, row };
    });
  }, [worldPos]);

  const grid = useMemo(() => buildViewportGrid(origin.col, origin.row, poiPoints), [origin, poiPoints]);

  // Marqueurs de la traque de Zorghon (voir zorghonEncounter ci-dessus) — purement synthétiques
  // (jamais écrits dans getAllMapMarkers()/`markers`), fusionnés à visibleMarkers exactement comme
  // kingdomMarker ci-dessous ; absents dès que la mécanique est indisponible ou déjà résolue.
  const zorghonMarkers = useMemo<MapMarker[]>(() => {
    if (!zorghonEncounter || zorghonEncounter.rescued) return [];
    return [
      { id: 'zorghon.boss', kind: 'zorghon', name: t('zorghon.marker.zorghon'), icon: '👹', x: zorghonEncounter.zorghonX, y: zorghonEncounter.zorghonY },
      { id: 'zorghon.captives', kind: 'captive', name: t('zorghon.marker.captives'), icon: '🧝‍♀️', x: zorghonEncounter.captiveX, y: zorghonEncounter.captiveY },
    ];
  }, [zorghonEncounter, t]);

  // Marqueurs visibles dans la fenêtre de caméra actuelle (COLSxROWS), convertis en cellule locale —
  // c'est ce qui « repositionne tous les POI de la mapmonde sur la plateforme 2D isométrique ».
  // Inclut le marqueur 👑 Quête du Royaume (kingdomMarker) et les marqueurs Zorghon/prisonniers en
  // plus des marqueurs du catalogue.
  const visibleMarkers = useMemo(() => {
    const out: (MapMarker & { col: number; row: number })[] = [];
    const all = kingdomMarker ? [...markers, kingdomMarker, ...zorghonMarkers] : [...markers, ...zorghonMarkers];
    for (const m of all) {
      const wc = Math.round(m.x), wr = Math.round(m.y);
      const col = wc - origin.col, row = wr - origin.row;
      if (col >= 0 && col < COLS && row >= 0 && row < ROWS) out.push({ ...m, col, row });
    }
    return out;
  }, [markers, kingdomMarker, zorghonMarkers, origin]);

  // Filtres d'affichage par catégorie (boutons de WorldMapWidget.tsx, voir lib/mapFilters.ts) —
  // se synchronise EN TEMPS RÉEL avec la Mapmonde (même état partagé, portée module). Appliqué
  // UNIQUEMENT à la liste rendue ci-dessous : `markers`/`worldMarkers`/pools PNJ-dragon errants et
  // le biais de terrain (poiPoints) restent INTACTS et non filtrés (zéro régression fonctionnelle,
  // seul l'affichage change — voir commentaire de markerMatchesFilters()).
  const [mapFilters] = useMapFilters();
  const renderedMarkers = useMemo(
    () => visibleMarkers.filter(m => markerMatchesFilters(m, mapFilters)),
    [visibleMarkers, mapFilters],
  );

  const worldCol = Math.round(clamp100(worldPos.x));
  const worldRow = Math.round(clamp100(worldPos.y));
  const playerCell = {
    col: Math.max(0, Math.min(COLS - 1, worldCol - origin.col)),
    row: Math.max(0, Math.min(ROWS - 1, worldRow - origin.row)),
  };
  // Cellule adjacente à Synk où matérialiser le PNJ "en approche" (voir encounterNpc) — juste au
  // nord de Synk, ou au sud si Synk est déjà collé au bord haut de la fenêtre de caméra.
  const encounterCell = {
    col: playerCell.col,
    row: playerCell.row > 0 ? playerCell.row - 1 : Math.min(ROWS - 1, playerCell.row + 1),
  };

  // Tuile actuellement sous Synk (voir worldTileAt) — sert à détecter les dalles d'eau/montagne
  // pour la mécanique Oxygène (+ leur altitude/profondeur pour la raréfaction de l'air, voir
  // computeRarefactionFactor) ci-dessous ; ne change de valeur que lorsque Synk change réellement de
  // TYPE de dalle (entrée/sortie d'eau), pas à chaque pas sur un même type de terrain.
  const currentTile = useMemo(
    () => worldTileAt(worldCol, worldRow, poiPoints),
    [worldCol, worldRow, poiPoints],
  );
  const currentTerrain = currentTile.terrain;
  // Miroir de `currentTile` en ref (même principe que `playerRef` ci-dessus) — lu LIVE depuis
  // l'intérieur des `setInterval` Oxygène/Fatigue ci-dessous pour connaître l'altitude/profondeur
  // courante SANS dépendre de `currentTile` dans leur tableau de dépendances : `currentTile` est un
  // NOUVEL objet à chaque pas (même en restant sur le même TYPE de terrain), donc l'y inclure
  // relançait (et donc réinitialisait) tout le décompte à chaque déplacement — bug empêchant la
  // Fatigue/l'Oxygène de jamais atteindre leur palier tant que Synk se déplace en continu (signalé
  // par l'utilisateur : "maintenir appuyé les touches... ne font pas diminuer le pourcentage de
  // fatigue"). Seul `currentTerrain`/`isMoving` (changement de TYPE de dalle ou arrêt du mouvement)
  // doit interrompre le décompte — voir les deux effets ci-dessous.
  const currentTileRef = useRef(currentTile);
  useEffect(() => { currentTileRef.current = currentTile; }, [currentTile]);

  // ─── Besace (voir RepRules::islandVehicleRequired) — nécessaire pour savoir si Synk possède un
  // Engin avant de le laisser fouler une île (voir moveTo ci-dessous). Abonnement temps réel (et
  // non un simple fetch ponctuel) pour refléter immédiatement un achat/drag-and-drop d'Engin.
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  useEffect(() => {
    if (!address) { setInventory([]); return; }
    return subscribeInventory(address, setInventory);
  }, [address]);
  const hasVehicle = useMemo(() => inventory.some(i => i.category === 'vehicle' && i.qty > 0), [inventory]);
  // Petit message non bloquant (auto-masqué) affiché quand un déplacement vers une île est refusé
  // faute d'Engin dans la besace — voir moveTo ci-dessous.
  const [islandBlockedMsg, setIslandBlockedMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!islandBlockedMsg) return;
    const id = setTimeout(() => setIslandBlockedMsg(null), 3500);
    return () => clearTimeout(id);
  }, [islandBlockedMsg]);

  // ─── Déplacement de Synk (flèches clavier, pavé directionnel virtuel, clic sur une tuile) ───
  // Écrit directement dans `players/{addr}/mapPos` (même donnée que WorldMapWidget.tsx) : la
  // caméra isométrique ET la carte se mettent à jour en temps réel via subscribePlayerMapPos.
  // Bloque l'accès aux dalles d'île (voir worldTerrain.ts::Tile.isIsland) tant que Synk ne possède
  // aucun Engin (besace) et que `rules.islandVehicleRequired` est actif — cf. demande utilisateur
  // "pour se rendre sur ces iles, il faudra disposer d'engins".
  const moveTo = useCallback((nx: number, ny: number) => {
    if (!address) return;
    const x = clamp100(nx), y = clamp100(ny);
    if ((rules?.islandVehicleRequired ?? true) && !hasVehicle) {
      const dest = worldTileAt(Math.round(x), Math.round(y), poiPoints);
      if (dest.isIsland) { setIslandBlockedMsg(t('canvas2d.islandVehicleRequired')); return; }
    }
    setWorldPos({ x, y });
    worldPosRef.current = { x, y };
    setPlayerMapPos(address, DEFAULT_MAP_ID, x, y).catch(() => {});
  }, [address, rules?.islandVehicleRequired, hasVehicle, poiPoints, t]);

  // ─── Direction/animation de marche de Synk (voir SynkSkin.tsx::direction/walking et
  // RepRules.synkLimbAnimationEnabled) — purement visuel : `facing` mémorise la dernière direction
  // de déplacement (8 valeurs, cardinales + diagonales), `isWalking` reste vrai tant que des pas
  // continuent d'arriver et retombe à faux après `WALK_STOP_DELAY_MS` d'inactivité (maintien
  // clavier/D-pad/souris = "marche continue", relâchement = arrêt de l'animation). `isRunning`
  // bascule à `true` après `movementRunHoldThresholdMs` de maintien ininterrompu d'une direction
  // (voir useHoldMovement.ts) — anime Synk plus vite (SynkSkin.tsx::running) SANS changer le pas
  // (`STEP_PCT` reste 1 case/pas, seule la CADENCE des pas s'accélère).
  const [facing, setFacing] = useState<SynkDirection>('down');
  const [isWalking, setIsWalking] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const walkStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const move = useCallback((dx: number, dy: number) => {
    if (faintingRef.current || fatigueFaintingRef.current) return; // Synk évanoui (noyade OU épuisement) : déplacement bloqué
    const dir = directionFromDelta(dx, dy);
    if (dir) {
      setFacing(dir);
      setIsWalking(true);
      if (walkStopTimerRef.current) clearTimeout(walkStopTimerRef.current);
      walkStopTimerRef.current = setTimeout(() => { setIsWalking(false); setIsRunning(false); }, WALK_STOP_DELAY_MS);
    }
    const cur = worldPosRef.current;
    const nx = cur.x + dx * STEP_PCT, ny = cur.y + dy * STEP_PCT;
    // ─── Collision POI "obstacle" (voir worldTerrain.ts::isObstacleAt et RepRules
    // .poiObstacleCollisionEnabled) : ne bloque QUE ce déplacement incrémental — jamais moveTo
    // (clic d'approche/téléportation), qui reste intégralement inchangé (aucune régression sur le
    // clic pour s'approcher d'un village/PNJ/marqueur, même s'il se tient sur une case obstacle).
    if (rules?.poiObstacleCollisionEnabled ?? true) {
      const destTile = worldTileAt(Math.round(clamp100(nx)), Math.round(clamp100(ny)), poiPoints);
      if (isObstacleAt(Math.round(clamp100(nx)), Math.round(clamp100(ny)), poiPoints, destTile)) return;
    }
    moveTo(nx, ny);
  }, [moveTo, rules?.poiObstacleCollisionEnabled, poiPoints]);

  const hold = useHoldMovement(move, {
    walkStepMs: rules?.movementWalkStepMs ?? 220,
    runStepMs: rules?.movementRunStepMs ?? 110,
    runHoldThresholdMs: rules?.movementRunHoldThresholdMs ?? 1500,
    onRunChange: setIsRunning,
  });

  useEffect(() => () => { if (walkStopTimerRef.current) clearTimeout(walkStopTimerRef.current); }, []);

  // ─── Décroissance d'oxygène sur l'eau et la montagne/roche ────────────────────────────────────
  // Tant que Synk reste sur une dalle d'eau OU de montagne/roche (raréfaction de l'air en
  // altitude/profondeur — voir computeRarefactionFactor), un décompte de `oxygenDrainIntervalSec`
  // (défaut 50 s, paramétrable, réduit par la raréfaction) tourne en continu (traverser plusieurs
  // dalles à la suite ne le réinitialise PAS, seul un retour sur la terre ferme l'arrête) ; à chaque
  // palier atteint tant que Synk est toujours sur l'une de ces dalles, on applique la pénalité
  // (oxygène/XP/Force) et on relance un décompte complet. La raréfaction est recalculée à chaque
  // tick depuis `currentTileRef` (LIVE) plutôt que figée à l'ouverture de l'effet, afin que
  // `currentTile` puisse rester HORS du tableau de dépendances (voir currentTileRef ci-dessus) —
  // sinon chaque pas sur de l'eau/montagne (nouvel objet `currentTile`) relançait l'effet et
  // réinitialisait le décompte à zéro avant même d'atteindre le premier palier.
  useEffect(() => {
    if (oxygenIntervalRef.current) { clearInterval(oxygenIntervalRef.current); oxygenIntervalRef.current = null; }
    if ((currentTerrain !== 'water' && currentTerrain !== 'rock') || !address || !rules || fainting || fatigueFainting) {
      setOxygenTimer(null);
      return;
    }
    const initialIntervalSec = Math.max(1, Math.round(
      (rules.oxygenDrainIntervalSec ?? 50) * computeRarefactionFactor(rules, currentTileRef.current),
    ));
    setOxygenTimer(initialIntervalSec);
    oxygenIntervalRef.current = setInterval(() => {
      setOxygenTimer((prev) => {
        if (prev === null) return prev;
        if (prev <= 1) {
          applyEffect(address, {
            oxygen: -(rules.oxygenDrainPct ?? 30),
            xpBonus: -(rules.oxygenPenaltyXp ?? 10),
            force: -(rules.oxygenPenaltyForce ?? 10),
          }).catch(() => {});
          return Math.max(1, Math.round(
            (rules.oxygenDrainIntervalSec ?? 50) * computeRarefactionFactor(rules, currentTileRef.current),
          ));
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (oxygenIntervalRef.current) { clearInterval(oxygenIntervalRef.current); oxygenIntervalRef.current = null; } };
  }, [currentTerrain, address, rules, fainting, fatigueFainting]);

  // ─── Récupération d'oxygène sur la terre ferme ────────────────────────────────────────────────
  // Dès que Synk se retrouve sur une dalle de terre (verte), restaure l'oxygène par palier de
  // `oxygenRecoveryPct` (défaut 10 %) toutes les `oxygenRecoveryIntervalSec` (défaut 1 s) jusqu'à
  // 100 %. Lit l'oxygène courant via `playerRef` (et non `player` en dépendance) pour ne PAS
  // relancer l'intervalle à chaque palier — seul un changement de terrain/adresse/règles doit le
  // faire. S'arrête automatiquement dès que le maximum est atteint ou si Synk quitte la terre ferme.
  useEffect(() => {
    if (oxygenRecoverIntervalRef.current) { clearInterval(oxygenRecoverIntervalRef.current); oxygenRecoverIntervalRef.current = null; }
    if (currentTerrain !== 'grass' || !address || !rules || fainting || fatigueFainting) {
      setOxygenRecovering(false);
      return;
    }
    const already = playerRef.current;
    if (already && (already.oxygen ?? 100) >= (already.oxygenMax ?? 100)) {
      setOxygenRecovering(false);
      return;
    }
    const intervalSec = Math.max(1, Math.round(rules.oxygenRecoveryIntervalSec ?? 1));
    const pct = Math.max(0, rules.oxygenRecoveryPct ?? 10);
    setOxygenRecovering(true);
    oxygenRecoverIntervalRef.current = setInterval(() => {
      const cur = playerRef.current;
      const oxy = cur?.oxygen ?? 100;
      const oxyMax = cur?.oxygenMax ?? 100;
      if (oxy >= oxyMax) {
        setOxygenRecovering(false);
        if (oxygenRecoverIntervalRef.current) { clearInterval(oxygenRecoverIntervalRef.current); oxygenRecoverIntervalRef.current = null; }
        return;
      }
      applyEffect(address, { oxygen: Math.min(pct, oxyMax - oxy) }).catch(() => {});
    }, intervalSec * 1000);
    return () => { if (oxygenRecoverIntervalRef.current) { clearInterval(oxygenRecoverIntervalRef.current); oxygenRecoverIntervalRef.current = null; } };
  }, [currentTerrain, address, rules, fainting, fatigueFainting]);

  // ─── Décroissance de fatigue en mouvement continu ─────────────────────────────────────────────
  // Tant que Synk enchaîne les déplacements sans pause d'au moins `fatigueStopGraceSec` (voir
  // `isMoving` ci-dessus), un décompte de `fatigueDrainIntervalSec` (défaut 3 s, réduit par la
  // raréfaction de l'air en altitude — voir computeRarefactionFactor : "plus la fatigue se fera
  // ressentir" en montagne) tourne en continu ; à chaque palier atteint tant que `isMoving` reste
  // vrai, on applique la perte de Fatigue (voir `computeFatigueDrainPct` ci-dessus : la perte de
  // base `fatigueDrainPct` est pondérée à la hausse quand Vie/Faim/Force/Oxygène sont bas — moins
  // d'énergie, fatigue plus rapide) et on relance un décompte complet. Désactivable entièrement via
  // `rules.fatigueEnabled` (Administration). La raréfaction est recalculée à chaque tick depuis
  // `currentTileRef` (LIVE, voir plus haut) plutôt que figée à l'ouverture de l'effet — sinon
  // `currentTile` (nouvel objet à CHAQUE pas, donc en continu tant qu'une touche de déplacement
  // reste enfoncée) devait rester dans le tableau de dépendances, ce qui relançait l'effet et donc
  // réinitialisait le décompte à zéro avant même d'atteindre le premier palier de perte de Fatigue :
  // c'est ce bug précis qui empêchait la Fatigue de jamais diminuer en maintenant les touches de
  // déplacement enfoncées (signalé par l'utilisateur).
  useEffect(() => {
    if (fatigueIntervalRef.current) { clearInterval(fatigueIntervalRef.current); fatigueIntervalRef.current = null; }
    if (!isMoving || !address || !rules || fainting || fatigueFainting || rules.fatigueEnabled === false) {
      setFatigueTimer(null);
      return;
    }
    const initialIntervalSec = Math.max(1, Math.round(
      (rules.fatigueDrainIntervalSec ?? 3) * computeRarefactionFactor(rules, currentTileRef.current),
    ));
    setFatigueTimer(initialIntervalSec);
    fatigueIntervalRef.current = setInterval(() => {
      setFatigueTimer((prev) => {
        if (prev === null) return prev;
        if (prev <= 1) {
          applyEffect(address, { fatigue: -computeFatigueDrainPct(rules, playerRef.current) }).catch(() => {});
          return Math.max(1, Math.round(
            (rules.fatigueDrainIntervalSec ?? 3) * computeRarefactionFactor(rules, currentTileRef.current),
          ));
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (fatigueIntervalRef.current) { clearInterval(fatigueIntervalRef.current); fatigueIntervalRef.current = null; } };
  }, [isMoving, address, rules, fainting, fatigueFainting]);

  // ─── Récupération de fatigue à l'arrêt/ralenti ─────────────────────────────────────────────────
  // Dès que Synk ralentit ou s'arrête (`isMoving` devient faux), restaure la Fatigue par palier de
  // `fatigueRecoveryPct` (défaut 20 %) toutes les `fatigueRecoveryIntervalSec` (défaut 1 s) jusqu'à
  // 100 %. Lit la fatigue courante via `playerRef` (comme la récupération d'oxygène) pour ne PAS
  // relancer l'intervalle à chaque palier.
  useEffect(() => {
    if (fatigueRecoverIntervalRef.current) { clearInterval(fatigueRecoverIntervalRef.current); fatigueRecoverIntervalRef.current = null; }
    if (isMoving || !address || !rules || fainting || fatigueFainting || rules.fatigueEnabled === false) {
      setFatigueRecovering(false);
      return;
    }
    const already = playerRef.current;
    if (already && (already.fatigue ?? 100) >= (already.fatigueMax ?? 100)) {
      setFatigueRecovering(false);
      return;
    }
    const intervalSec = Math.max(1, Math.round(rules.fatigueRecoveryIntervalSec ?? 1));
    const pct = Math.max(0, rules.fatigueRecoveryPct ?? 20);
    setFatigueRecovering(true);
    fatigueRecoverIntervalRef.current = setInterval(() => {
      const cur = playerRef.current;
      const fat = cur?.fatigue ?? 100;
      const fatMax = cur?.fatigueMax ?? 100;
      if (fat >= fatMax) {
        setFatigueRecovering(false);
        if (fatigueRecoverIntervalRef.current) { clearInterval(fatigueRecoverIntervalRef.current); fatigueRecoverIntervalRef.current = null; }
        return;
      }
      applyEffect(address, { fatigue: Math.min(pct, fatMax - fat) }).catch(() => {});
    }, intervalSec * 1000);
    return () => { if (fatigueRecoverIntervalRef.current) { clearInterval(fatigueRecoverIntervalRef.current); fatigueRecoverIntervalRef.current = null; } };
  }, [isMoving, address, rules, fainting, fatigueFainting]);


  // ─── Évanouissement par manque d'oxygène ──────────────────────────────────────────────────────
  // Déclenché dès que l'oxygène (mis à jour en temps réel via subscribePlayer) passe sous le seuil
  // `oxygenFaintThresholdPct` (défaut 20 %). Applique immédiatement les pertes XP/Vie/objet, bloque
  // l'interface `oxygenFaintDurationSec` secondes (comme SleepModal), puis restaure l'oxygène à
  // 100 % et repositionne Synk sur la terre ferme la plus proche (voir finishFainting ci-dessous).
  useEffect(() => {
    if (!address || !rules || !player) return;
    const threshold = rules.oxygenFaintThresholdPct ?? 20;
    if ((player.oxygen ?? 100) > threshold) return;
    if (faintingRef.current || fatigueFaintingRef.current) return; // pas deux évanouissements en même temps
    faintingRef.current = true;
    if (oxygenIntervalRef.current) { clearInterval(oxygenIntervalRef.current); oxygenIntervalRef.current = null; }
    setOxygenTimer(null);
    const durationSec = Math.max(1, Math.round(rules.oxygenFaintDurationSec ?? 30));
    setFainting({ remaining: durationSec });
    const xpLoss = Math.max(0, Math.round(rules.oxygenFaintXpLoss ?? 50));
    const hpLoss = Math.max(0, Math.round(rules.oxygenFaintHpLoss ?? 10));
    const faintSpot = worldPosRef.current;
    trackFaintEvent(address, DEFAULT_MAP_ID, faintSpot.x, faintSpot.y, 'oxygen').catch(() => {});
    (async () => {
      await applyEffect(address, { xpBonus: -xpLoss, hp: -hpLoss }).catch(() => {});
      const lost = await removeRandomInventoryItem(address).catch(() => null);
      setFaintResult({ xp: xpLoss, hp: hpLoss, itemName: lost ? itemLabel(t, lost.itemId, lost.name) : null });
    })();
  }, [address, rules, player, t]);

  // Restaure l'oxygène à 100 % et téléporte Synk sur la dalle verte la plus proche — appelé une
  // seule fois, à la fin du compte à rebours d'évanouissement (voir effet suivant). Passe par
  // `finishFaintingRef` (et non directement dans le setInterval) pour toujours utiliser la version
  // la plus à jour de la fonction sans avoir à relancer l'intervalle à chaque rendu.
  const finishFainting = useCallback(async () => {
    try {
      if (!address) return;
      const fresh = await getOrCreatePlayer(address);
      const missing = Math.max(0, (fresh.oxygenMax ?? 100) - (fresh.oxygen ?? 0));
      if (missing > 0) await applyEffect(address, { oxygen: missing }).catch(() => {});
      const cur = worldPosRef.current;
      const landSpot = findNearestGrassTile(Math.round(cur.x), Math.round(cur.y), poiPoints);
      if (landSpot) {
        setWorldPos(landSpot);
        worldPosRef.current = landSpot;
        setPlayerMapPos(address, DEFAULT_MAP_ID, landSpot.x, landSpot.y).catch(() => {});
      }
    } finally {
      faintingRef.current = false;
    }
  }, [address, poiPoints]);
  const finishFaintingRef = useRef(finishFainting);
  useEffect(() => { finishFaintingRef.current = finishFainting; }, [finishFainting]);

  // Compte à rebours de l'évanouissement en cours, puis appelle finishFainting() à échéance.
  useEffect(() => {
    if (!fainting) return;
    faintIntervalRef.current = setInterval(() => {
      setFainting((prev) => {
        if (!prev) return prev;
        if (prev.remaining <= 1) { finishFaintingRef.current(); return null; }
        return { remaining: prev.remaining - 1 };
      });
    }, 1000);
    return () => { if (faintIntervalRef.current) { clearInterval(faintIntervalRef.current); faintIntervalRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!fainting]);

  // ─── Évanouissement par épuisement (manque de Fatigue) ────────────────────────────────────────
  // Déclenché dès que la Fatigue (mise à jour en temps réel via subscribePlayer) passe sous le
  // seuil `fatigueFaintThresholdPct` (défaut 10 %). Contrairement à l'évanouissement par noyade, ne
  // retire QUE de la Vie (pas de XP ni d'objet, pas de téléportation — l'épuisement est lié au
  // mouvement, pas au terrain) : bloque l'interface `fatigueFaintDurationSec` secondes (défaut 50,
  // comme SleepModal), puis restaure la Fatigue à 100 % (voir finishFatigueFainting ci-dessous).
  useEffect(() => {
    if (!address || !rules || !player || rules.fatigueEnabled === false) return;
    const threshold = rules.fatigueFaintThresholdPct ?? 10;
    if ((player.fatigue ?? 100) > threshold) return;
    if (fatigueFaintingRef.current || faintingRef.current) return; // pas deux évanouissements en même temps
    fatigueFaintingRef.current = true;
    if (fatigueIntervalRef.current) { clearInterval(fatigueIntervalRef.current); fatigueIntervalRef.current = null; }
    if (fatigueRecoverIntervalRef.current) { clearInterval(fatigueRecoverIntervalRef.current); fatigueRecoverIntervalRef.current = null; }
    setFatigueTimer(null);
    setFatigueRecovering(false);
    const durationSec = Math.max(1, Math.round(rules.fatigueFaintDurationSec ?? 50));
    setFatigueFainting({ remaining: durationSec });
    const hpLoss = Math.max(0, Math.round(rules.fatigueFaintHpLoss ?? 30));
    const faintSpot = worldPosRef.current;
    trackFaintEvent(address, DEFAULT_MAP_ID, faintSpot.x, faintSpot.y, 'fatigue').catch(() => {});
    (async () => {
      await applyEffect(address, { hp: -hpLoss }).catch(() => {});
      if (rules.fatigueFaintResultPopupEnabled !== false) setFatigueFaintResult({ hp: hpLoss });
    })();
  }, [address, rules, player]);

  // Restaure la Fatigue à 100 % — appelé une seule fois, à la fin du compte à rebours d'évanouissement
  // par épuisement (voir effet suivant). Passe par `finishFatigueFaintingRef` pour toujours utiliser
  // la version la plus à jour de la fonction sans avoir à relancer l'intervalle à chaque rendu.
  const finishFatigueFainting = useCallback(async () => {
    try {
      if (!address) return;
      const fresh = await getOrCreatePlayer(address);
      const missing = Math.max(0, (fresh.fatigueMax ?? 100) - (fresh.fatigue ?? 0));
      if (missing > 0) await applyEffect(address, { fatigue: missing }).catch(() => {});
    } finally {
      fatigueFaintingRef.current = false;
    }
  }, [address]);
  const finishFatigueFaintingRef = useRef(finishFatigueFainting);
  useEffect(() => { finishFatigueFaintingRef.current = finishFatigueFainting; }, [finishFatigueFainting]);

  // Compte à rebours de l'évanouissement par épuisement en cours, puis appelle finishFatigueFainting() à échéance.
  useEffect(() => {
    if (!fatigueFainting) return;
    fatigueFaintIntervalRef.current = setInterval(() => {
      setFatigueFainting((prev) => {
        if (!prev) return prev;
        if (prev.remaining <= 1) { finishFatigueFaintingRef.current(); return null; }
        return { remaining: prev.remaining - 1 };
      });
    }, 1000);
    return () => { if (fatigueFaintIntervalRef.current) { clearInterval(fatigueFaintIntervalRef.current); fatigueFaintIntervalRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!fatigueFainting]);

  // ─── Vérification périodique de proximité avec Zorghon (voir RepRules::zorghonCheckIntervalSec)
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Tant que Zorghon est présent sur la carte (zorghonEncounter non nul) et pas encore délivré,
  // recalcule à intervalle régulier la distance entre Synk et Zorghon (coordonnées mapmonde en %,
  // lues depuis worldPosRef pour ne jamais relancer l'intervalle à chaque déplacement — même
  // principe que les intervalles Oxygène/Fatigue ci-dessus). En-deçà de `zorghonProximityPct`, tire
  // une chance de relocalisation (`zorghonRelocationChancePct`) : si elle réussit, un petit bandeau
  // non bloquant prévient le joueur (voir zorghonUi plus bas).
  useEffect(() => {
    if (!address || !rules?.zorghonEnabled) return;
    const intervalMs = Math.max(1000, Math.round((rules.zorghonCheckIntervalSec ?? 20) * 1000));
    const iv = setInterval(() => {
      const enc = zorghonEncounterRef.current;
      if (!enc || enc.rescued) return;
      const cur = worldPosRef.current;
      const dist = Math.hypot(enc.zorghonX - cur.x, enc.zorghonY - cur.y);
      if (dist > (rules.zorghonProximityPct ?? 12)) return;
      if (Math.random() * 100 > (rules.zorghonRelocationChancePct ?? 35)) return;
      relocateZorghonCaptives(address).then(({ state, relocated }) => {
        if (state) setZorghonEncounter(state);
        if (relocated) {
          if (zorghonNoticeTimerRef.current) clearTimeout(zorghonNoticeTimerRef.current);
          setZorghonNotice(t('zorghon.notice.relocated'));
          zorghonNoticeTimerRef.current = setTimeout(() => setZorghonNotice(null), 6000);
        }
      }).catch(() => {});
    }, intervalMs);
    return () => clearInterval(iv);
  }, [address, rules?.zorghonEnabled, rules?.zorghonCheckIntervalSec, rules?.zorghonProximityPct, rules?.zorghonRelocationChancePct, t]);

  // ─── Délivrance de PocaPoka & El Pipo à l'arrivée sur leur case (voir rescuePocaPoka) ──────────
  // Même seuil d'adjacence (≤ 1 cellule) que les autres interactions de proximité de ce widget.
  useEffect(() => {
    if (!address) return;
    const enc = zorghonEncounter;
    if (!enc || enc.rescued || zorghonRescuingRef.current) return;
    const dist = Math.max(Math.abs(Math.round(enc.captiveX) - worldCol), Math.abs(Math.round(enc.captiveY) - worldRow));
    if (dist > 1) return;
    zorghonRescuingRef.current = true;
    rescuePocaPoka(address).then((result) => {
      if (result === 'rescued') {
        setZorghonEncounter(prev => prev ? { ...prev, rescued: true } : prev);
        setZorghonRescueResult({ xp: rules?.zorghonRescueXpReward ?? 2000 });
      }
    }).catch(() => {}).finally(() => { zorghonRescuingRef.current = false; });
  }, [address, zorghonEncounter, worldCol, worldRow, rules?.zorghonRescueXpReward]);

  useEffect(() => () => { if (zorghonNoticeTimerRef.current) clearTimeout(zorghonNoticeTimerRef.current); }, []);


  // ─── Clic sur un marqueur (PNJ, familier/dragon, trésor, quête, monde, hutte) ───
  // Si Synk est déjà sur sa case ou une case adjacente (distance ≤ 1 cellule) : ouvre le pop-up
  // d'interaction adéquat (voir PoiInteractionModal.tsx). Sinon, déplace Synk vers ce marqueur
  // (comme un clic sur la tuile sous-jacente) — un second clic une fois arrivé ouvrira le pop-up.
  // Les POI purement décoratifs (montagne, lac, sentier...) ne déclenchent aucun pop-up : leur
  // découverte fortuite (petit bonus d'XP) est déjà gérée par WorldMapWidget.tsx::runDiscoveryScan.
  const onMarkerClick = useCallback((m: MapMarker) => {
    const interactable = m.kind === 'npc' || m.kind === 'familiar' || m.kind === 'treasure'
      || m.kind === 'quest' || m.kind === 'world' || (m.kind === 'poi' && m.poiType === 'hut');
    if (!interactable) return;
    const cur = worldPosRef.current;
    const dist = Math.max(Math.abs(Math.round(m.x) - Math.round(cur.x)), Math.abs(Math.round(m.y) - Math.round(cur.y)));
    if (dist <= 1) setInteractionMarker(m);
    else moveTo(m.x, m.y);
  }, [moveTo]);

  // ─── Clic sur le PNJ errant ou le Dragon errant (icônes qui se déplacent seules dans la grille) ───
  // Contrairement aux marqueurs catalogue ci-dessus, ces acteurs n'existent qu'en coordonnées LOCALES
  // (col/row dans la fenêtre de caméra) : l'adjacence se calcule donc contre `playerCell` (lui aussi
  // local), et « se rapprocher » convertit leur position locale en coordonnées mapmonde absolues
  // (origin + col/row) pour réutiliser moveTo(). `marker` est la véritable entrée catalogue (PNJ ou
  // familier-dragon) attribuée plus haut : sans elle (catalogue vide), le clic ne fait rien.
  const onActorClick = useCallback((actor: Actor, marker: MapMarker | null) => {
    if (!marker) return;
    const dist = Math.max(Math.abs(actor.col - playerCell.col), Math.abs(actor.row - playerCell.row));
    if (dist <= 1) setInteractionMarker(marker);
    else moveTo(origin.col + actor.col, origin.row + actor.row);
  }, [moveTo, origin, playerCell]);

  // ─── Clic sur une tuile portant un portail décoratif (🌀 généré aléatoirement par worldTileAt) ───
  // Chaque portail décoratif est associé de façon déterministe (même case ⇒ toujours le même monde)
  // à l'un des vrais mondes du catalogue, afin d'ouvrir le même pop-up « Monde » que les portes de
  // monde officielles (visibleMarkers ci-dessus) plutôt que de rester muet. S'il n'y a Adjacence
  // (≤ 1 case), on rapproche Synk comme pour une tuile normale.
  const onPortalTileClick = useCallback((wc: number, wr: number) => {
    const cur = worldPosRef.current;
    const dist = Math.max(Math.abs(wc - Math.round(cur.x)), Math.abs(wr - Math.round(cur.y)));
    if (dist <= 1 && worldMarkers.length) {
      const idx = Math.floor(hashRand(wc, wr, 5) * worldMarkers.length);
      setInteractionMarker(worldMarkers[Math.min(worldMarkers.length - 1, idx)]);
    } else {
      moveTo(wc, wr);
    }
  }, [moveTo, worldMarkers]);

  // ─── Clic sur une tuile portant une hutte décorative (🛖 générée aléatoirement par worldTileAt,
  // biais village/taverne/étable/hutte) ─── Aucune MapPoiDef "hutte" n'est semée par défaut dans le
  // catalogue (elles ne sont créées que si l'admin en ajoute via la rubrique Carte) : la hutte que
  // le joueur voit et clique le plus souvent sur la Plateforme 2D isométrique est donc CETTE tuile
  // décorative, qui — comme le portail ci-dessus — ne déclenchait jusqu'ici aucun pop-up. On
  // synthétise un marqueur "poi/hut" pour ouvrir le même pop-up de repos que HutBody (voir
  // PoiInteractionModal.tsx), avec son message de cooldown déjà géré (getHutRestRemainingMs).
  const onHutTileClick = useCallback((wc: number, wr: number) => {
    const cur = worldPosRef.current;
    const dist = Math.max(Math.abs(wc - Math.round(cur.x)), Math.abs(wr - Math.round(cur.y)));
    if (dist <= 1) {
      setInteractionMarker({
        id: `hut-${wc}-${wr}`, kind: 'poi', poiType: 'hut',
        name: t(PROP_I18N_KEY.hut), icon: PROP_ICON.hut, x: wc, y: wr,
      });
    } else {
      moveTo(wc, wr);
    }
  }, [moveTo, t]);

  // Déplacement au clavier (flèches directionnelles, y compris en diagonale via appui combiné
  // Haut/Bas + Gauche/Droite — voir demande utilisateur "haut diagonale gauche", etc.) — actif
  // seulement widget déplié, et ignoré si le focus est dans un champ de saisie (chat, admin, etc.)
  // pour ne pas interférer. `keysDownRef` mémorise les flèches actuellement enfoncées : chaque
  // keydown recalcule un delta composite (ex. ArrowUp+ArrowLeft ⇒ dx=-1,dy=-1) pour permettre les
  // 8 directions tout en gardant EXACTEMENT le même pas (STEP_PCT) qu'un déplacement cardinal.
  // `e.repeat` (répétition automatique OS) est IGNORÉ : c'est `useHoldMovement` (hold.press/update)
  // qui pilote désormais seul la cadence des pas tant qu'une touche reste maintenue (corrige le bug
  // rapporté "Synk avance de 2 cases par appui" dû à la variabilité de la répétition native).
  const keysDownRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (collapsed) return;
    const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    const composite = () => {
      const keys = keysDownRef.current;
      const dy = keys.has('ArrowUp') ? -1 : keys.has('ArrowDown') ? 1 : 0;
      const dx = keys.has('ArrowLeft') ? -1 : keys.has('ArrowRight') ? 1 : 0;
      return { dx, dy };
    };
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!ARROWS.has(e.key)) return;
      e.preventDefault();
      if (e.repeat) return;
      const wasIdle = keysDownRef.current.size === 0;
      keysDownRef.current.add(e.key);
      const { dx, dy } = composite();
      if (dx === 0 && dy === 0) return;
      if (wasIdle) hold.press(dx, dy); else hold.update(dx, dy);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!ARROWS.has(e.key)) return;
      keysDownRef.current.delete(e.key);
      const { dx, dy } = composite();
      if (dx === 0 && dy === 0) hold.release(); else hold.update(dx, dy);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      keysDownRef.current.clear();
      hold.release();
    };
  }, [collapsed, hold]);

  // PNJ et dragon errent doucement dans la grille pour donner l'impression d'un monde vivant.
  useEffect(() => {
    const iv = setInterval(() => {
      setNpc(p => ({ ...p, col: clampCoord(p.col + (Math.random() < 0.5 ? -1 : 1), COLS), row: clampCoord(p.row + (Math.random() < 0.5 ? -1 : 1), ROWS) }));
      setDragon(p => ({ ...p, col: clampCoord(p.col + (Math.random() < 0.5 ? -1 : 1), COLS), row: clampCoord(p.row + (Math.random() < 0.5 ? -1 : 1), ROWS) }));
    }, 4000);
    return () => clearInterval(iv);
  }, []);

  const onResizePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    setResizing(true);
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onResizePointerMove = (e: React.PointerEvent) => {
    if (!resizing) return;
    const dx = e.clientX - resizeStart.current.x, dy = e.clientY - resizeStart.current.y;
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

  // Éléments d'interface de la mécanique Oxygène — rendus dans les DEUX branches (widget replié ou
  // déplié) puisque Synk peut se déplacer (ex. depuis WorldMapWidget) même widget replié, et que le
  // joueur doit toujours voir le compte à rebours/l'évanouissement quel que soit l'état du widget.
  const islandBlockedUi = islandBlockedMsg ? (
    <div className="fixed z-50 bottom-4 right-4 bg-amber-950/95 border border-amber-500 rounded-lg shadow-xl px-3 py-2 max-w-xs">
      <p className="text-xs text-amber-200">🚤 {islandBlockedMsg}</p>
    </div>
  ) : null;
  const faintDurationSec = Math.max(1, Math.round(rules?.oxygenFaintDurationSec ?? 30));
  const oxygenPct = Math.max(0, Math.min(100, ((player?.oxygen ?? 100) / (player?.oxygenMax ?? 100)) * 100));
  const oxygenUi = (
    <>
      {oxygenTimer !== null && !fainting && (
        <div className="fixed bottom-24 right-4 z-[90] bg-slate-900/95 border-2 border-sky-500 rounded-xl px-4 py-3 shadow-xl text-center w-40 pointer-events-none">
          <p className="text-2xl animate-pulse">⏳</p>
          <p className="text-lg font-mono text-sky-300">{oxygenTimer}s</p>
          <p className="text-[10px] text-slate-400 mt-1">{t('oxygen.warning.title')}</p>
          <div className="w-full bg-slate-700 rounded-full h-2 mt-2">
            <div className="bg-sky-400 h-2 rounded-full transition-all" style={{ width: `${oxygenPct}%` }} />
          </div>
          <p className="text-[10px] text-slate-500 mt-1">🫧 {Math.round(player?.oxygen ?? 100)}/{player?.oxygenMax ?? 100}</p>
        </div>
      )}
      {oxygenRecovering && !fainting && (
        <div className="fixed bottom-24 right-4 z-[90] bg-slate-900/95 border-2 border-emerald-500 rounded-xl px-4 py-3 shadow-xl text-center w-40 pointer-events-none">
          <p className="text-2xl animate-pulse">🌿</p>
          <p className="text-[10px] text-slate-400 mt-1">{t('oxygen.recovery.title')}</p>
          <div className="w-full bg-slate-700 rounded-full h-2 mt-2">
            <div className="bg-emerald-400 h-2 rounded-full transition-all" style={{ width: `${oxygenPct}%` }} />
          </div>
          <p className="text-[10px] text-slate-500 mt-1">🫧 {Math.round(player?.oxygen ?? 100)}/{player?.oxygenMax ?? 100}</p>
        </div>
      )}
      {fainting && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[100] p-4">
          <div className="bg-slate-900 border-2 border-sky-500 rounded-xl p-8 max-w-md w-full text-center">
            <div className="text-7xl mb-4 animate-pulse">🫧</div>
            <h3 className="text-2xl font-bold text-sky-300 mb-2">{t('oxygen.faint.title')}</h3>
            <p className="text-sm text-slate-400 mb-6">{t('oxygen.faint.description')}</p>
            <div className="bg-slate-800/60 rounded-lg p-4 mb-4">
              <p className="text-5xl font-mono text-sky-300">{fainting.remaining}s</p>
              <div className="w-full bg-slate-700 rounded-full h-2 mt-3">
                <div className="bg-sky-500 h-2 rounded-full transition-all" style={{ width: `${((faintDurationSec - fainting.remaining) / faintDurationSec) * 100}%` }} />
              </div>
            </div>
            <p className="text-xs text-slate-500">{t('oxygen.faint.hint')}</p>
          </div>
        </div>
      )}
      {faintResult && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] p-4" onClick={() => setFaintResult(null)}>
          <div className="bg-slate-900 border-2 border-sky-500 rounded-xl p-6 max-w-sm w-full text-center" onClick={(e) => e.stopPropagation()}>
            <div className="text-5xl mb-3">😵‍💫</div>
            <h3 className="text-lg font-bold text-sky-300 mb-3">{t('oxygen.faintResult.title')}</h3>
            <p className="text-sm text-rose-300">✨ -{faintResult.xp} XP</p>
            <p className="text-sm text-rose-300">❤️ -{faintResult.hp} {t('game.stats.hp')}</p>
            <p className="text-sm text-rose-300">🎒 {faintResult.itemName ? t('oxygen.faintResult.itemLost', { name: faintResult.itemName }) : t('oxygen.faintResult.noItem')}</p>
            <button className="mt-4 w-full bg-sky-700 hover:bg-sky-600 text-white rounded-lg py-2 text-sm" onClick={() => setFaintResult(null)}>
              {t('oxygen.faintResult.close')}
            </button>
          </div>
        </div>
      )}
    </>
  );

  // Éléments d'interface de la mécanique Fatigue — même principe que oxygenUi ci-dessus (rendus
  // dans les DEUX branches, popups non bloquants en bas à GAUCHE pour ne jamais chevaucher ceux de
  // l'oxygène qui restent en bas à droite). Masqués entièrement si `fatigueEnabled` est désactivé
  // par l'admin.
  const fatiguePct = Math.max(0, Math.min(100, ((player?.fatigue ?? 100) / (player?.fatigueMax ?? 100)) * 100));
  const fatigueFaintDurationSec = Math.max(1, Math.round(rules?.fatigueFaintDurationSec ?? 50));
  const fatigueUi = rules?.fatigueEnabled === false ? null : (
    <>
      {fatigueTimer !== null && !fainting && !fatigueFainting && (
        <div className="fixed bottom-24 left-4 z-[90] bg-slate-900/95 border-2 border-amber-500 rounded-xl px-4 py-3 shadow-xl text-center w-40 pointer-events-none">
          <p className="text-2xl animate-pulse">⏳</p>
          <p className="text-lg font-mono text-amber-300">{fatigueTimer}s</p>
          <p className="text-[10px] text-slate-400 mt-1">{t('fatigue.warning.title')}</p>
          <div className="w-full bg-slate-700 rounded-full h-2 mt-2">
            <div className="bg-amber-400 h-2 rounded-full transition-all" style={{ width: `${fatiguePct}%` }} />
          </div>
          <p className="text-[10px] text-slate-500 mt-1">🥵 {Math.round(player?.fatigue ?? 100)}/{player?.fatigueMax ?? 100}</p>
        </div>
      )}
      {fatigueRecovering && !fainting && !fatigueFainting && (
        <div className="fixed bottom-24 left-4 z-[90] bg-slate-900/95 border-2 border-emerald-500 rounded-xl px-4 py-3 shadow-xl text-center w-40 pointer-events-none">
          <p className="text-2xl animate-pulse">💤</p>
          <p className="text-[10px] text-slate-400 mt-1">{t('fatigue.recovery.title')}</p>
          <div className="w-full bg-slate-700 rounded-full h-2 mt-2">
            <div className="bg-emerald-400 h-2 rounded-full transition-all" style={{ width: `${fatiguePct}%` }} />
          </div>
          <p className="text-[10px] text-slate-500 mt-1">🥵 {Math.round(player?.fatigue ?? 100)}/{player?.fatigueMax ?? 100}</p>
        </div>
      )}
      {fatigueFainting && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[100] p-4">
          <div className="bg-slate-900 border-2 border-amber-500 rounded-xl p-8 max-w-md w-full text-center">
            <div className="text-7xl mb-4 animate-pulse">🥱</div>
            <h3 className="text-2xl font-bold text-amber-300 mb-2">{t('fatigue.faint.title')}</h3>
            <p className="text-sm text-slate-400 mb-6">{t('fatigue.faint.description')}</p>
            <div className="bg-slate-800/60 rounded-lg p-4 mb-4">
              <p className="text-5xl font-mono text-amber-300">{fatigueFainting.remaining}s</p>
              <div className="w-full bg-slate-700 rounded-full h-2 mt-3">
                <div className="bg-amber-500 h-2 rounded-full transition-all" style={{ width: `${((fatigueFaintDurationSec - fatigueFainting.remaining) / fatigueFaintDurationSec) * 100}%` }} />
              </div>
            </div>
            <p className="text-xs text-slate-500">{t('fatigue.faint.hint')}</p>
          </div>
        </div>
      )}
      {fatigueFaintResult && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] p-4" onClick={() => setFatigueFaintResult(null)}>
          <div className="bg-slate-900 border-2 border-amber-500 rounded-xl p-6 max-w-sm w-full text-center" onClick={(e) => e.stopPropagation()}>
            <div className="text-5xl mb-3">😪</div>
            <h3 className="text-lg font-bold text-amber-300 mb-3">{t('fatigue.faintResult.title')}</h3>
            <p className="text-sm text-rose-300">❤️ -{fatigueFaintResult.hp} {t('game.stats.hp')}</p>
            <p className="text-xs text-slate-400 mt-2">{t('fatigue.faintResult.message', { hp: fatigueFaintResult.hp })}</p>
            <button className="mt-4 w-full bg-amber-700 hover:bg-amber-600 text-white rounded-lg py-2 text-sm" onClick={() => setFatigueFaintResult(null)}>
              {t('fatigue.faintResult.close')}
            </button>
          </div>
        </div>
      )}
    </>
  );

  // ─── Éléments d'interface de la traque de Zorghon (voir effets dédiés plus haut) ───────────────
  // Bandeau non bloquant en haut de l'écran (zone encore libre : oxygène=bas-droite,
  // fatigue=bas-gauche) lors d'une relocalisation, + pop-up de célébration modal à la délivrance.
  const zorghonUi = (
    <>
      {zorghonNotice && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[90] bg-rose-950/95 border-2 border-rose-500 rounded-xl px-4 py-2 shadow-xl text-center pointer-events-none">
          <p className="text-sm text-rose-200">👹 {zorghonNotice}</p>
        </div>
      )}
      {zorghonRescueResult && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4" onClick={() => setZorghonRescueResult(null)}>
          <div className="bg-slate-900 border-2 border-amber-400 rounded-xl p-6 max-w-sm w-full text-center" onClick={(e) => e.stopPropagation()}>
            <div className="text-6xl mb-3">🎉</div>
            <h3 className="text-lg font-bold text-amber-300 mb-2">{t('zorghon.rescue.title')}</h3>
            <p className="text-sm text-slate-300 mb-3">{t('zorghon.rescue.message')}</p>
            <p className="text-sm text-emerald-300">✨ +{zorghonRescueResult.xp} XP</p>
            <button className="mt-4 w-full bg-amber-700 hover:bg-amber-600 text-white rounded-lg py-2 text-sm" onClick={() => setZorghonRescueResult(null)}>
              {t('zorghon.rescue.close')}
            </button>
          </div>
        </div>
      )}
    </>
  );

  // ─── Pop-up profondeur/altitude (voir RepRules::depthAltitudePopupEnabled/Position/*Template) ──
  // Petit indicateur non bloquant et clignotant, affiché tant que Synk reste sur une dalle d'eau
  // (profondeur, `currentTile.depthM`) ou de montagne/roche (altitude, `currentTile.altitudeM`) —
  // purement informatif, aucun impact sur les statistiques (contrairement à Oxygène/Fatigue).
  // Gabarit texte personnalisable par l'admin (jeton `{value}`), sinon texte traduit par défaut.
  const depthAltitudeUi = (rules?.depthAltitudePopupEnabled === false || (currentTerrain !== 'water' && currentTerrain !== 'rock')) ? null : (() => {
    const isWater = currentTerrain === 'water';
    const value = Math.round(isWater ? (currentTile.depthM ?? 0) : (currentTile.altitudeM ?? 0));
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

  if (!pos) return null;

  if (collapsed) {
    return (
      <>
        <button
          ref={containerRef}
          className="fixed z-40 w-14 h-14 rounded-full bg-emerald-950 border-2 border-emerald-600 text-2xl shadow-lg flex items-center justify-center"
          style={{ left: pos.x, top: pos.y, zIndex: z }}
          onPointerDownCapture={bringToFront}
          onPointerDown={onHeaderPointerDown} onPointerMove={onHeaderPointerMove} onPointerUp={onHeaderPointerUp}
          onClick={onToggleClick}
          onContextMenu={onContextMenu}
          title={t('canvas2d.title')}
        >🧩</button>
        <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
        {oxygenUi}
        {fatigueUi}
        {islandBlockedUi}
        {zorghonUi}
        {depthAltitudeUi}
      </>
    );
  }

  const originX = size.w / 2, originY = 46;
  const dpadBtn = 'flex items-center justify-center rounded bg-emerald-900/80 hover:bg-emerald-700 active:bg-emerald-600 border border-emerald-600 text-emerald-100 text-sm shadow select-none';

  return (
    <div
      ref={containerRef}
      className="fixed z-40 bg-slate-950 border-2 border-emerald-600 rounded-xl shadow-2xl select-none flex flex-col"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h, zIndex: z }}
      onPointerDownCapture={bringToFront}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-emerald-900/40 rounded-t-xl cursor-move shrink-0"
        onPointerDown={onHeaderPointerDown} onPointerMove={onHeaderPointerMove} onPointerUp={onHeaderPointerUp}
        onContextMenu={onContextMenu}
      >
        <span className="text-sm font-semibold text-emerald-100">🧩 {t('canvas2d.title')}</span>
        <button className="text-xs opacity-70 hover:opacity-100" onClick={toggleCollapsed}>✕</button>
      </div>
      <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      <p className="px-3 pt-1 text-[10px] text-emerald-400/80 shrink-0" title={t('canvas2d.engineNote')}>
        ℹ️ {biasLabel ? t('canvas2d.biasHint', { poi: biasLabel }) : t('canvas2d.hint')} · {t('canvas2d.moveHint')}
      </p>

      <div className="relative flex-1 overflow-hidden bg-gradient-to-b from-sky-950 to-slate-900 rounded-b-xl">
        <div className="absolute inset-0" style={{ transform: `translate(${originX}px, ${originY}px)` }}>
          {grid.flatMap((rowTiles, r) => rowTiles.map((tile, c) => {
            const x = projX(c, r), y = projY(c, r);
            const zIdx = c + r;
            // Sommet enneigé (INDÉPENDANT de la saison — voir RepRules::altitudeSnowThresholdM) :
            // corrige l'incohérence "neige en été" tout en permettant une neige permanente en haute
            // montagne, quelle que soit la saison réelle (voir aussi seasonalWeatherIndex()).
            const snowThreshold = rules?.altitudeSnowThresholdM ?? 2000;
            const isSnowCapped = rules?.altitudeEnabled !== false && tile.terrain === 'rock' && (tile.altitudeM ?? 0) >= snowThreshold;
            const tileTitle = tile.prop
              ? `${PROP_ICON[tile.prop]} ${t(PROP_I18N_KEY[tile.prop])}`
              : `${t(TERRAIN_I18N_KEY[tile.terrain])}${tile.altitudeM ? ` · ${Math.round(tile.altitudeM)} m` : ''}${tile.depthM ? ` · -${tile.depthM} m` : ''}`;
            return (
              <div key={`t-${r}-${c}`} className="absolute" style={{ left: x - TILE_W / 2, top: y - TILE_H / 2, zIndex: zIdx }}>
                <div
                  className="cursor-pointer hover:brightness-125"
                  style={{
                    width: TILE_W, height: TILE_H, background: isSnowCapped ? '#e7eef3' : TERRAIN_COLOR[tile.terrain],
                    clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
                    border: '1px solid rgba(0,0,0,0.15)',
                  }}
                  onClick={() => {
                    if (tile.prop === 'portal') onPortalTileClick(origin.col + c, origin.row + r);
                    else if (tile.prop === 'hut') onHutTileClick(origin.col + c, origin.row + r);
                    else moveTo(origin.col + c, origin.row + r);
                  }}
                  title={tileTitle}
                />
                {tile.prop && (
                  <span className="absolute left-1/2 -translate-x-1/2 -top-4 text-lg pointer-events-none select-none" style={{ zIndex: zIdx + 1 }}>
                    {PROP_ICON[tile.prop]}
                  </span>
                )}
                {!tile.prop && isSnowCapped && (
                  <span className="absolute left-1/2 -translate-x-1/2 -top-3 text-sm pointer-events-none select-none" style={{ zIndex: zIdx + 1 }}>
                    ❄️
                  </span>
                )}
              </div>
            );
          }))}

          {/* POI/mondes/PNJ/trésors/familiers/quêtes de la mapmonde, repositionnés à leur vraie
              position dans la fenêtre de caméra (voir gameState.ts::getAllMapMarkers) — survol =
              info-bulle avec le nom du POI. */}
          {renderedMarkers.map(m => {
            const x = projX(m.col, m.row), y = projY(m.col, m.row);
            const zIdx = m.col + m.row + 1;
            const interactable = m.kind === 'npc' || m.kind === 'familiar' || m.kind === 'treasure'
              || m.kind === 'quest' || m.kind === 'world' || (m.kind === 'poi' && m.poiType === 'hut');
            return (
              <div
                key={`m-${m.kind}-${m.id}`}
                className={`absolute -translate-x-1/2 pointer-events-auto select-none ${interactable ? 'cursor-pointer' : 'cursor-help'} ${m.isKingdom ? 'animate-pulse' : ''}`}
                style={{ left: x, top: y - 18, zIndex: zIdx }}
                title={`${m.icon} ${localizeName(t, m.i18nKey, m.name)}`}
                onClick={() => onMarkerClick(m)}
              >
                <span className="text-base drop-shadow" style={{ filter: 'drop-shadow(0 0 2px #000)' }}>{m.icon}</span>
              </div>
            );
          })}

          {/* PNJ errant — cliquable dès qu'un PNJ du catalogue lui a été attribué (voir roamingNpcId) */}
          <div
            className={`absolute -translate-x-1/2 flex flex-col items-center transition-all duration-[1500ms] pointer-events-auto ${roamingNpcMarker ? 'cursor-pointer' : 'cursor-help'}`}
            style={{ left: projX(npc.col, npc.row), top: projY(npc.col, npc.row) - 22, zIndex: npc.col + npc.row + 2 }}
            title={roamingNpcMarker ? `${npc.icon} ${localizeName(t, roamingNpcMarker.i18nKey, roamingNpcMarker.name)}` : npc.label}
            onClick={() => onActorClick(npc, roamingNpcMarker)}
          >
            <span className="text-lg">{npc.icon}</span>
          </div>
          {/* Dragon errant — cliquable dès qu'un familier-dragon du catalogue lui a été attribué */}
          <div
            className={`absolute -translate-x-1/2 flex flex-col items-center transition-all duration-[1500ms] pointer-events-auto ${roamingDragonMarker ? 'cursor-pointer' : 'cursor-help'}`}
            style={{ left: projX(dragon.col, dragon.row), top: projY(dragon.col, dragon.row) - 22, zIndex: dragon.col + dragon.row + 2 }}
            title={roamingDragonMarker ? `${dragon.icon} ${localizeName(t, roamingDragonMarker.i18nKey, roamingDragonMarker.name)}` : dragon.label}
            onClick={() => onActorClick(dragon, roamingDragonMarker)}
          >
            <span className="text-xl">{dragon.icon}</span>
          </div>
          {/* PNJ "en approche" — matérialise la rencontre (pop-up NpcEncounterPopup ouvert) juste à
              côté de Synk, tant que le pop-up reste affiché (voir encounterNpc/onEncounterChange).
              Purement informatif (pointer-events-none) : l'interaction se fait dans le pop-up lui-même. */}
          {encounterNpc && (
            <div
              className="absolute -translate-x-1/2 flex flex-col items-center pointer-events-none animate-bounce"
              style={{ left: projX(encounterCell.col, encounterCell.row), top: projY(encounterCell.col, encounterCell.row) - 22, zIndex: encounterCell.col + encounterCell.row + 2 }}
              title={`${NPC_SKINS[encounterNpc.skin]} ${localizeName(t, `npc.archetype.${encounterNpc.baseKey}`, encounterNpc.baseKey)} · ${localizeName(t, `npc.offer.${encounterNpc.offer}`, encounterNpc.offer)}`}
            >
              <span className="text-[10px] leading-none">❗</span>
              <span className="text-xl drop-shadow" style={{ filter: 'drop-shadow(0 0 2px #000)' }}>{NPC_SKINS[encounterNpc.skin]}</span>
            </div>
          )}
          {/* Synk (joueur) — direction/marche animées (voir facing/isWalking, SynkSkin.tsx et
              RepRules.synkLimbAnimationEnabled) */}
          <div className="absolute -translate-x-1/2 flex flex-col items-center transition-all duration-500 pointer-events-auto cursor-help"
            style={{ left: projX(playerCell.col, playerCell.row), top: projY(playerCell.col, playerCell.row) - 26, zIndex: playerCell.col + playerCell.row + 3 }}
            title={t('canvas2d.synkLabel')}>
            <SynkSkin stage={stage} size={26} direction={facing} walking={isWalking} running={isRunning} animated={rules?.synkLimbAnimationEnabled !== false} />
          </div>
        </div>

        {/* Pavé directionnel virtuel — mêmes déplacements que les flèches clavier, y compris les 4
            diagonales (coins du pavé, précédemment inoccupés), ET le maintien pour courir (voir
            useHoldMovement.ts/RepRules.movementRunHoldThresholdMs) — appui court = 1 case (comme
            avant), bouton maintenu = marche continue puis course après le seuil configuré. */}
        <div className="absolute bottom-2 left-2 grid grid-cols-3 grid-rows-3 gap-0.5 w-[84px] h-[84px] z-10" title={t('canvas2d.dpadTitle')}>
          <button className={dpadBtn} onPointerDown={() => hold.press(-1, -1)} onPointerUp={hold.release} onPointerLeave={hold.release} onPointerCancel={hold.release} title={t('canvas2d.dpadUpLeft')}>↖</button>
          <button className={dpadBtn} onPointerDown={() => hold.press(0, -1)} onPointerUp={hold.release} onPointerLeave={hold.release} onPointerCancel={hold.release} title={t('canvas2d.dpadUp')}>▲</button>
          <button className={dpadBtn} onPointerDown={() => hold.press(1, -1)} onPointerUp={hold.release} onPointerLeave={hold.release} onPointerCancel={hold.release} title={t('canvas2d.dpadUpRight')}>↗</button>
          <button className={dpadBtn} onPointerDown={() => hold.press(-1, 0)} onPointerUp={hold.release} onPointerLeave={hold.release} onPointerCancel={hold.release} title={t('canvas2d.dpadLeft')}>◀</button>
          <div className="flex items-center justify-center text-emerald-500/50 text-[10px]">🕹️</div>
          <button className={dpadBtn} onPointerDown={() => hold.press(1, 0)} onPointerUp={hold.release} onPointerLeave={hold.release} onPointerCancel={hold.release} title={t('canvas2d.dpadRight')}>▶</button>
          <button className={dpadBtn} onPointerDown={() => hold.press(-1, 1)} onPointerUp={hold.release} onPointerLeave={hold.release} onPointerCancel={hold.release} title={t('canvas2d.dpadDownLeft')}>↙</button>
          <button className={dpadBtn} onPointerDown={() => hold.press(0, 1)} onPointerUp={hold.release} onPointerLeave={hold.release} onPointerCancel={hold.release} title={t('canvas2d.dpadDown')}>▼</button>
          <button className={dpadBtn} onPointerDown={() => hold.press(1, 1)} onPointerUp={hold.release} onPointerLeave={hold.release} onPointerCancel={hold.release} title={t('canvas2d.dpadDownRight')}>↘</button>
        </div>
      </div>

      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize text-emerald-400/70 flex items-center justify-center text-[10px]"
        onPointerDown={onResizePointerDown} onPointerMove={onResizePointerMove} onPointerUp={onResizePointerUp}
      >⤡</div>

      <PoiInteractionModal
        marker={interactionMarker}
        address={address}
        playerXp={playerXp}
        rules={rules}
        onClose={() => setInteractionMarker(null)}
        onRequestHutRest={() => setHutResting(true)}
      />
      {rules && (
        <HutRestModal
          active={hutResting}
          rules={rules}
          onDone={(result) => {
            setHutResting(false);
            setHutFeedback(result === 'ok' ? t('hutRest.done.ok', { hp: rules.hutRestHp }) : t('hutRest.done.cooldown'));
            setTimeout(() => setHutFeedback(null), 4000);
          }}
        />
      )}
      {hutFeedback && (
        <div className="fixed inset-x-0 bottom-6 flex justify-center z-[101] pointer-events-none">
          <span className="bg-slate-900 border border-amber-500 text-amber-200 text-sm rounded-full px-4 py-2 shadow-xl">
            {hutFeedback}
          </span>
        </div>
      )}
      {oxygenUi}
      {fatigueUi}
      {islandBlockedUi}
      {zorghonUi}
      {depthAltitudeUi}
    </div>
  );
}

function clampCoord(v: number, max: number): number {
  return Math.max(0, Math.min(max - 1, v));
}
