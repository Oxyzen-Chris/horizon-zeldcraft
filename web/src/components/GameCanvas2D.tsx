'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import {
  getAllMapMarkers, setPlayerMapPos, subscribePlayerMapPos, DEFAULT_MAP_ID, getRepRules,
  getOrCreatePlayer, subscribePlayer, applyEffect, removeRandomInventoryItem,
  getKingdomQuestMarker, subscribeSolvedQuestIds,
  type MapMarker, type MapPoiType, type RepRules, type PlayerState,
} from '@/lib/gameState';
import {
  TERRAIN_COLOR, PROP_ICON, TERRAIN_I18N_KEY, PROP_I18N_KEY, worldTileAt, clamp100, WORLD_SIZE, hashRand,
  type Tile,
} from '@/lib/worldTerrain';
import { useI18n, localizeName, itemLabel } from '@/lib/i18n';
import { useWindowZIndex } from '@/lib/windowZOrder';
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

interface Actor { id: string; col: number; row: number; icon: string; label: string }

/** Construit la grille COLSxROWS visible à partir du coin (originCol, originRow) de la caméra. */
function buildViewportGrid(originCol: number, originRow: number, poiPoints: { x: number; y: number; poiType?: MapPoiType }[]): Tile[][] {
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
function findNearestGrassTile(wc: number, wr: number, poiPoints: { x: number; y: number; poiType?: MapPoiType }[]): Pos | null {
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

  const [collapsed, setCollapsed] = useState(true);
  const [pos, setPos] = useState<Pos | null>(null);
  const [size, setSize] = useState<Size>({ w: 480, h: 380 });
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const dragOffset = useRef<Pos>({ x: 0, y: 0 });
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

  const [biasLabel, setBiasLabel] = useState<string>('');
  // Tous les marqueurs de la mapmonde (décor/terrain, mondes, PNJ, trésors, familiers, quêtes PNJ —
  // voir gameState.ts::getAllMapMarkers), positionnés IDENTIQUEMENT à WorldMapWidget.tsx (même
  // fonction, même repli déterministe) afin que les deux vues soient toujours cohérentes.
  const [markers, setMarkers] = useState<MapMarker[]>([]);
  const poiPoints = useMemo(
    () => markers.filter(m => m.kind === 'poi').map(m => ({ x: m.x, y: m.y, poiType: m.poiType })),
    [markers],
  );

  // Position réelle de Synk sur la mapmonde (0-100%, source de vérité partagée avec
  // WorldMapWidget.tsx) et coin de la caméra isométrique (en cellules, 0-100 chacun).
  const [worldPos, setWorldPos] = useState<Pos>({ x: 50, y: 88 });
  const [origin, setOrigin] = useState({ col: 45, row: 84 });
  const worldPosRef = useRef(worldPos);
  useEffect(() => { worldPosRef.current = worldPos; }, [worldPos]);

  const [npc, setNpc] = useState<Actor>({ id: 'npc', col: 4, row: 3, icon: '🧙', label: t('canvas2d.npcLabel') });
  const [dragon, setDragon] = useState<Actor>({ id: 'dragon', col: 7, row: 5, icon: '🐉', label: t('canvas2d.dragonLabel') });

  // Identité catalogue (PNJ/familier-dragon réel) attribuée une fois au PNJ/Dragon errant, pour que
  // leur clic ouvre le VRAI pop-up d'interaction (discussion/quête ou apprivoisement) au lieu de ne
  // rien faire — voir onActorClick() plus bas. Choisie aléatoirement dès que le catalogue est chargé
  // puis figée (ne change plus tant que le widget reste monté).
  const [roamingNpcId, setRoamingNpcId] = useState<string | null>(null);
  const [roamingDragonId, setRoamingDragonId] = useState<string | null>(null);

  useEffect(() => {
    setCollapsed((localStorage.getItem(COLLAPSED_KEY) ?? '1') === '1');
    const savedPos = localStorage.getItem(POS_KEY);
    if (savedPos) { try { setPos(JSON.parse(savedPos)); } catch { /* ignore */ } }
    else if (typeof window !== 'undefined') setPos({ x: window.innerWidth - 520, y: 90 });
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

  // Marqueurs visibles dans la fenêtre de caméra actuelle (COLSxROWS), convertis en cellule locale —
  // c'est ce qui « repositionne tous les POI de la mapmonde sur la plateforme 2D isométrique ».
  // Inclut le marqueur 👑 Quête du Royaume (kingdomMarker) en plus des marqueurs du catalogue.
  const visibleMarkers = useMemo(() => {
    const out: (MapMarker & { col: number; row: number })[] = [];
    const all = kingdomMarker ? [...markers, kingdomMarker] : markers;
    for (const m of all) {
      const wc = Math.round(m.x), wr = Math.round(m.y);
      const col = wc - origin.col, row = wr - origin.row;
      if (col >= 0 && col < COLS && row >= 0 && row < ROWS) out.push({ ...m, col, row });
    }
    return out;
  }, [markers, kingdomMarker, origin]);

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

  // Terrain actuellement sous Synk (voir worldTileAt) — sert uniquement à détecter les dalles d'eau
  // pour la mécanique Oxygène ci-dessous ; ne change de valeur que lorsque Synk change réellement de
  // TYPE de dalle (entrée/sortie d'eau), pas à chaque pas sur un même type de terrain.
  const currentTerrain = useMemo(
    () => worldTileAt(worldCol, worldRow, poiPoints).terrain,
    [worldCol, worldRow, poiPoints],
  );

  // ─── Déplacement de Synk (flèches clavier, pavé directionnel virtuel, clic sur une tuile) ───
  // Écrit directement dans `players/{addr}/mapPos` (même donnée que WorldMapWidget.tsx) : la
  // caméra isométrique ET la carte se mettent à jour en temps réel via subscribePlayerMapPos.
  const moveTo = useCallback((nx: number, ny: number) => {
    if (!address) return;
    const x = clamp100(nx), y = clamp100(ny);
    setWorldPos({ x, y });
    worldPosRef.current = { x, y };
    setPlayerMapPos(address, DEFAULT_MAP_ID, x, y).catch(() => {});
  }, [address]);

  const move = useCallback((dx: number, dy: number) => {
    if (faintingRef.current) return; // Synk évanoui : déplacement bloqué (voir mécanique Oxygène)
    const cur = worldPosRef.current;
    moveTo(cur.x + dx * STEP_PCT, cur.y + dy * STEP_PCT);
  }, [moveTo]);

  // ─── Décroissance d'oxygène sur l'eau et la montagne/roche ────────────────────────────────────
  // Tant que Synk reste sur une dalle d'eau OU de montagne/roche (raréfaction de l'air en
  // altitude), un décompte de `oxygenDrainIntervalSec` (défaut 50 s, paramétrable) tourne en continu
  // (traverser plusieurs dalles à la suite ne le réinitialise PAS, seul un retour sur la terre
  // ferme l'arrête) ; à chaque palier atteint tant que Synk est toujours sur l'une de ces dalles,
  // on applique la pénalité (oxygène/XP/Force) et on relance un décompte complet.
  useEffect(() => {
    if (oxygenIntervalRef.current) { clearInterval(oxygenIntervalRef.current); oxygenIntervalRef.current = null; }
    if ((currentTerrain !== 'water' && currentTerrain !== 'rock') || !address || !rules || fainting) {
      setOxygenTimer(null);
      return;
    }
    const intervalSec = Math.max(1, Math.round(rules.oxygenDrainIntervalSec ?? 50));
    setOxygenTimer(intervalSec);
    oxygenIntervalRef.current = setInterval(() => {
      setOxygenTimer((prev) => {
        if (prev === null) return prev;
        if (prev <= 1) {
          applyEffect(address, {
            oxygen: -(rules.oxygenDrainPct ?? 30),
            xpBonus: -(rules.oxygenPenaltyXp ?? 10),
            force: -(rules.oxygenPenaltyForce ?? 10),
          }).catch(() => {});
          return intervalSec;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (oxygenIntervalRef.current) { clearInterval(oxygenIntervalRef.current); oxygenIntervalRef.current = null; } };
  }, [currentTerrain, address, rules, fainting]);

  // ─── Récupération d'oxygène sur la terre ferme ────────────────────────────────────────────────
  // Dès que Synk se retrouve sur une dalle de terre (verte), restaure l'oxygène par palier de
  // `oxygenRecoveryPct` (défaut 10 %) toutes les `oxygenRecoveryIntervalSec` (défaut 1 s) jusqu'à
  // 100 %. Lit l'oxygène courant via `playerRef` (et non `player` en dépendance) pour ne PAS
  // relancer l'intervalle à chaque palier — seul un changement de terrain/adresse/règles doit le
  // faire. S'arrête automatiquement dès que le maximum est atteint ou si Synk quitte la terre ferme.
  useEffect(() => {
    if (oxygenRecoverIntervalRef.current) { clearInterval(oxygenRecoverIntervalRef.current); oxygenRecoverIntervalRef.current = null; }
    if (currentTerrain !== 'grass' || !address || !rules || fainting) {
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
  }, [currentTerrain, address, rules, fainting]);


  // ─── Évanouissement par manque d'oxygène ──────────────────────────────────────────────────────
  // Déclenché dès que l'oxygène (mis à jour en temps réel via subscribePlayer) passe sous le seuil
  // `oxygenFaintThresholdPct` (défaut 20 %). Applique immédiatement les pertes XP/Vie/objet, bloque
  // l'interface `oxygenFaintDurationSec` secondes (comme SleepModal), puis restaure l'oxygène à
  // 100 % et repositionne Synk sur la terre ferme la plus proche (voir finishFainting ci-dessous).
  useEffect(() => {
    if (!address || !rules || !player) return;
    const threshold = rules.oxygenFaintThresholdPct ?? 20;
    if ((player.oxygen ?? 100) > threshold) return;
    if (faintingRef.current) return;
    faintingRef.current = true;
    if (oxygenIntervalRef.current) { clearInterval(oxygenIntervalRef.current); oxygenIntervalRef.current = null; }
    setOxygenTimer(null);
    const durationSec = Math.max(1, Math.round(rules.oxygenFaintDurationSec ?? 30));
    setFainting({ remaining: durationSec });
    const xpLoss = Math.max(0, Math.round(rules.oxygenFaintXpLoss ?? 50));
    const hpLoss = Math.max(0, Math.round(rules.oxygenFaintHpLoss ?? 10));
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

  // Déplacement au clavier (flèches directionnelles) — actif seulement widget déplié, et ignoré
  // si le focus est dans un champ de saisie (chat, admin, etc.) pour ne pas interférer.
  useEffect(() => {
    if (collapsed) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      switch (e.key) {
        case 'ArrowUp': e.preventDefault(); move(0, -1); break;
        case 'ArrowDown': e.preventDefault(); move(0, 1); break;
        case 'ArrowLeft': e.preventDefault(); move(-1, 0); break;
        case 'ArrowRight': e.preventDefault(); move(1, 0); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [collapsed, move]);

  // PNJ et dragon errent doucement dans la grille pour donner l'impression d'un monde vivant.
  useEffect(() => {
    const iv = setInterval(() => {
      setNpc(p => ({ ...p, col: clampCoord(p.col + (Math.random() < 0.5 ? -1 : 1), COLS), row: clampCoord(p.row + (Math.random() < 0.5 ? -1 : 1), ROWS) }));
      setDragon(p => ({ ...p, col: clampCoord(p.col + (Math.random() < 0.5 ? -1 : 1), COLS), row: clampCoord(p.row + (Math.random() < 0.5 ? -1 : 1), ROWS) }));
    }, 4000);
    return () => clearInterval(iv);
  }, []);

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if (!pos) return;
    setDragging(true);
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onHeaderPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
  };
  const onHeaderPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    if (pos) localStorage.setItem(POS_KEY, JSON.stringify(pos));
  };
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
  const toggleCollapsed = () => {
    setCollapsed(prev => { localStorage.setItem(COLLAPSED_KEY, prev ? '0' : '1'); return !prev; });
  };

  // Éléments d'interface de la mécanique Oxygène — rendus dans les DEUX branches (widget replié ou
  // déplié) puisque Synk peut se déplacer (ex. depuis WorldMapWidget) même widget replié, et que le
  // joueur doit toujours voir le compte à rebours/l'évanouissement quel que soit l'état du widget.
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

  if (!pos) return null;

  if (collapsed) {
    return (
      <>
        <button
          className="fixed z-40 w-14 h-14 rounded-full bg-emerald-950 border-2 border-emerald-600 text-2xl shadow-lg flex items-center justify-center"
          style={{ left: pos.x, top: pos.y, zIndex: z }}
          onPointerDownCapture={bringToFront}
          onPointerDown={onHeaderPointerDown} onPointerMove={onHeaderPointerMove} onPointerUp={onHeaderPointerUp}
          onClick={() => !dragging && toggleCollapsed()}
          title={t('canvas2d.title')}
        >🧩</button>
        {oxygenUi}
      </>
    );
  }

  const originX = size.w / 2, originY = 46;
  const dpadBtn = 'flex items-center justify-center rounded bg-emerald-900/80 hover:bg-emerald-700 active:bg-emerald-600 border border-emerald-600 text-emerald-100 text-sm shadow select-none';

  return (
    <div
      className="fixed z-40 bg-slate-950 border-2 border-emerald-600 rounded-xl shadow-2xl select-none flex flex-col"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h, zIndex: z }}
      onPointerDownCapture={bringToFront}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-emerald-900/40 rounded-t-xl cursor-move shrink-0"
        onPointerDown={onHeaderPointerDown} onPointerMove={onHeaderPointerMove} onPointerUp={onHeaderPointerUp}
      >
        <span className="text-sm font-semibold text-emerald-100">🧩 {t('canvas2d.title')}</span>
        <button className="text-xs opacity-70 hover:opacity-100" onClick={toggleCollapsed}>✕</button>
      </div>
      <p className="px-3 pt-1 text-[10px] text-emerald-400/80 shrink-0" title={t('canvas2d.engineNote')}>
        ℹ️ {biasLabel ? t('canvas2d.biasHint', { poi: biasLabel }) : t('canvas2d.hint')} · {t('canvas2d.moveHint')}
      </p>

      <div className="relative flex-1 overflow-hidden bg-gradient-to-b from-sky-950 to-slate-900 rounded-b-xl">
        <div className="absolute inset-0" style={{ transform: `translate(${originX}px, ${originY}px)` }}>
          {grid.flatMap((rowTiles, r) => rowTiles.map((tile, c) => {
            const x = projX(c, r), y = projY(c, r);
            const zIdx = c + r;
            return (
              <div key={`t-${r}-${c}`} className="absolute" style={{ left: x - TILE_W / 2, top: y - TILE_H / 2, zIndex: zIdx }}>
                <div
                  className="cursor-pointer hover:brightness-125"
                  style={{
                    width: TILE_W, height: TILE_H, background: TERRAIN_COLOR[tile.terrain],
                    clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
                    border: '1px solid rgba(0,0,0,0.15)',
                  }}
                  onClick={() => {
                    if (tile.prop === 'portal') onPortalTileClick(origin.col + c, origin.row + r);
                    else if (tile.prop === 'hut') onHutTileClick(origin.col + c, origin.row + r);
                    else moveTo(origin.col + c, origin.row + r);
                  }}
                  title={tile.prop ? `${PROP_ICON[tile.prop]} ${t(PROP_I18N_KEY[tile.prop])}` : t(TERRAIN_I18N_KEY[tile.terrain])}
                />
                {tile.prop && (
                  <span className="absolute left-1/2 -translate-x-1/2 -top-4 text-lg pointer-events-none select-none" style={{ zIndex: zIdx + 1 }}>
                    {PROP_ICON[tile.prop]}
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
          {/* Synk (joueur) */}
          <div className="absolute -translate-x-1/2 flex flex-col items-center transition-all duration-500 pointer-events-auto cursor-help"
            style={{ left: projX(playerCell.col, playerCell.row), top: projY(playerCell.col, playerCell.row) - 26, zIndex: playerCell.col + playerCell.row + 3 }}
            title={t('canvas2d.synkLabel')}>
            <SynkSkin stage={stage} size={26} />
          </div>
        </div>

        {/* Pavé directionnel virtuel — mêmes déplacements que les flèches clavier */}
        <div className="absolute bottom-2 left-2 grid grid-cols-3 grid-rows-3 gap-0.5 w-[84px] h-[84px] z-10" title={t('canvas2d.dpadTitle')}>
          <div />
          <button className={dpadBtn} onClick={() => move(0, -1)} title={t('canvas2d.dpadUp')}>▲</button>
          <div />
          <button className={dpadBtn} onClick={() => move(-1, 0)} title={t('canvas2d.dpadLeft')}>◀</button>
          <div className="flex items-center justify-center text-emerald-500/50 text-[10px]">🕹️</div>
          <button className={dpadBtn} onClick={() => move(1, 0)} title={t('canvas2d.dpadRight')}>▶</button>
          <div />
          <button className={dpadBtn} onClick={() => move(0, 1)} title={t('canvas2d.dpadDown')}>▼</button>
          <div />
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
    </div>
  );
}

function clampCoord(v: number, max: number): number {
  return Math.max(0, Math.min(max - 1, v));
}
