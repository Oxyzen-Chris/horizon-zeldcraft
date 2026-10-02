'use client';

import { useEffect, useState } from 'react';
import type { MapMarker } from './gameState';

const STORAGE_KEY = 'zc.mapFilters';

/**
 * Filtres d'affichage partagés entre la Mapmonde (WorldMapWidget.tsx) et la Plateforme 2D
 * isométrique (GameCanvas2D.tsx) — boutons "afficher/masquer" par catégorie pour éviter de
 * saturer visuellement la carte (voir demande utilisateur). Purement client (localStorage) :
 * n'affecte QUE le rendu visuel des marqueurs, jamais la logique de jeu (déblocage de quête,
 * bassin de PNJ/dragon errants, biais de terrain…), qui continue de lire `getAllMapMarkers()`
 * sans filtrage — voir les commentaires dans GameCanvas2D.tsx/WorldMapWidget.tsx à l'endroit où
 * `markerMatchesFilters` est appliqué (uniquement sur la liste RENDUE, jamais sur les pools
 * fonctionnels).
 *
 * État partagé en portée module (même technique que lib/windowZOrder.ts) : les deux widgets,
 * montés simultanément dans le même arbre `/game`, se synchronisent donc INSTANTANÉMENT dès
 * qu'un joueur bascule un bouton dans l'un des deux (pas besoin de Context React ni de Firebase,
 * cette préférence étant purement locale à ce navigateur).
 */
export interface MapFilterState {
  showPois: boolean;
  showWorlds: boolean;
  showNpcs: boolean;
  showTreasures: boolean;
  showFamiliars: boolean;
  showQuestsClassic: boolean;
  showQuestsNpc: boolean;
  showQuestsKingdom: boolean;
  /** null = tous les chapitres (1-40) — sous-filtre fin, uniquement pertinent pour les Quêtes du
   * Royaume (voir demande utilisateur : "filtrer par chapitre"). */
  kingdomChapters: number[] | null;
  /** Sous-filtre "quêtes de pleine lune" parmi les Quêtes du Royaume (voir demande utilisateur). */
  kingdomFullMoonMode: 'all' | 'onlyFullMoon' | 'onlyNormal';
  /** "Filtre intelligent" (voir demande utilisateur : « pour ne pas avoir trop d'éléments qui
   * surchargent l'affichage ») — masque, UNIQUEMENT sur la Mapmonde (voir markerMatchesFilters,
   * paramètre `playerPos`), les marqueurs catalogue (POI/PNJ/trésors/familiers/quêtes classiques
   * ou PNJ) situés à plus de DECLUTTER_RADIUS_PCT de la position courante de Synk. Les marqueurs
   * "en direct" (PNJ/Dragon errants + PNJ en approche, voir lib/roamingActors.ts/lib/npcApproach.ts)
   * ainsi que la Quête du Royaume et la traque de Zorghon restent TOUJOURS visibles, quelle que
   * soit leur distance — ce sont précisément les éléments dynamiques/rares que le joueur doit
   * pouvoir suivre en permanence. Désactivé par défaut (comportement historique inchangé tant que
   * le joueur ou l'admin ne l'active pas explicitement).
   */
  declutter: boolean;
  /** Filtre "Objets déposés" (voir MapMarkerKind==='drop'/lib/worldDrops.ts) — objets retirés de la
   * besace d'un joueur et déposés à des coordonnées exactes de la mapmonde (voir demande
   * utilisateur « positionneras un filtre spécifique [...] pour retrouver les objets déposés par
   * Synk »). Actif par défaut, comme tous les autres filtres historiques. */
  showDrops: boolean;
  /** Filtre "Faune" (hiboux/loups-garous errants, voir MapMarkerKind==='wildlife' et
   * lib/roamingActors.ts::WildlifeActorState) — distinct de « Familiers » (dragons/familiers
   * apprivoisés du catalogue) car ce sont des créatures sauvages non liées au catalogue,
   * conformément à la demande utilisateur : « positionnes un filtre intelligent [...] pour ne pas
   * avoir trop d'éléments qui surchargent l'affichage ». Actif par défaut. */
  showWildlife: boolean;
  /** Sous-filtres par espèce de faune (voir WildlifeKind) — n'ont d'effet QUE si `showWildlife`
   * est actif (voir markerMatchesFilters) : répond à la demande utilisateur « ajoutes également un
   * niveau de filtre par entité [...] un filtre spécifique pour chacun : loup-garou, hibou [...] ».
   * `showWildlifeBoar` ajouté par symétrie (3ᵉ espèce de faune existante, voir
   * lib/roamingActors.ts::WildlifeKind). Actifs par défaut (comportement historique inchangé). */
  showWildlifeOwl: boolean;
  showWildlifeWerewolf: boolean;
  showWildlifeBoar: boolean;
  /** Sous-filtres morts-vivants (zombie/goule/squelette, voir WildlifeKind) — même principe que
   * showWildlifeOwl/Werewolf/Boar ci-dessus, répond à la demande utilisateur « Il faudra les
   * considérer comme de nouveaux PNJ à part entière et leur donner des interactions [...] et
   * paramètres [...] similaire à ceux des PNJ » (incluant leur filtre dédié). Actifs par défaut. */
  showWildlifeZombie: boolean;
  showWildlifeGhoul: boolean;
  showWildlifeSkeleton: boolean;
  /** Filtres dédiés cimetières/cryptes/tombes (voir MapPoiType==='cemetery'|'crypt'|'tomb') —
   * répond à la demande utilisateur « que tu identifieras dans le widget de la Mapmonde avec des
   * icônes et un filtre particuliers pour chacun (cimetières, cryptes, tombes) ». N'ont d'effet
   * QUE sur ces 3 types précis (voir markerMatchesFilters, cas 'poi') ; tous les autres types de
   * POI restent gouvernés par `showPois` comme avant (zéro régression). Actifs par défaut. */
  showCemetery: boolean;
  showCrypt: boolean;
  showTomb: boolean;
  /** Identifiants catalogue (`MapMarker.catalogId ?? MapMarker.id`) d'entités individuelles
   * (PNJ/familiers nommés — ex. dragon rouge, pêcheur Vaimoana) explicitement masquées par le
   * joueur, indépendamment du filtre global « PNJ »/« Familiers » — répond à « un filtre spécifique
   * pour chacun [...] dragon rouge, pêcheur Vaimoana ». Vide par défaut (rien de masqué). */
  hiddenEntityIds: string[];
  /** Clés d'archétype de rencontre (voir NpcEncounterPopup.tsx::ARCHETYPES, ex. "chevalier")
   * explicitement masquées parmi les PNJ de rencontre persistés (voir lib/roamingActors.ts::
   * ExtraRoamingActor) — répond à « un filtre spécifique pour chacun [...] chevalier ». Vide par
   * défaut. */
  hiddenNpcArchetypes: string[];
}

export const DEFAULT_MAP_FILTERS: MapFilterState = {
  showPois: true, showWorlds: true, showNpcs: true, showTreasures: true, showFamiliars: true,
  showQuestsClassic: true, showQuestsNpc: true, showQuestsKingdom: true,
  kingdomChapters: null, kingdomFullMoonMode: 'all', declutter: false, showDrops: true, showWildlife: true,
  showWildlifeOwl: true, showWildlifeWerewolf: true, showWildlifeBoar: true,
  showWildlifeZombie: true, showWildlifeGhoul: true, showWildlifeSkeleton: true,
  showCemetery: true, showCrypt: true, showTomb: true,
  hiddenEntityIds: [], hiddenNpcArchetypes: [],
};

// Rayon (en % de l'échelle mapmonde 0-100, même échelle que MapMarker.x/y) au-delà duquel un
// marqueur catalogue est masqué quand le "filtre intelligent" (declutter) est actif — voir
// MapFilterState.declutter ci-dessus. ~1/4 de la largeur totale de la mapmonde : assez large pour
// rester utile en exploration locale, assez restreint pour vraiment désencombrer une carte pleine.
const DECLUTTER_RADIUS_PCT = 24;

function loadInitial(): MapFilterState {
  if (typeof window === 'undefined') return DEFAULT_MAP_FILTERS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_MAP_FILTERS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_MAP_FILTERS;
}

let current: MapFilterState = loadInitial();
let hasUserChoice = typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY) != null;
const listeners = new Set<(s: MapFilterState) => void>();

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* ignore */ }
}

export function getMapFilters(): MapFilterState { return current; }

export function setMapFilters(patch: Partial<MapFilterState>) {
  current = { ...current, ...patch };
  hasUserChoice = true;
  persist();
  listeners.forEach((l) => l(current));
}

export function resetMapFilters() { setMapFilters(DEFAULT_MAP_FILTERS); }

/** true si le joueur a déjà personnalisé ses filtres dans CE navigateur (sinon les valeurs
 * par défaut de l'admin — voir getMapFilterDefaults() — peuvent encore être appliquées). */
export function hasUserMapFilterChoice(): boolean { return hasUserChoice; }

/** Applique les valeurs par défaut définies par l'admin — UNIQUEMENT si le joueur n'a encore
 * jamais personnalisé ses filtres dans ce navigateur (ne doit jamais écraser un choix existant). */
export function applyAdminMapFilterDefaults(defaults: {
  showPois: boolean; showWorlds: boolean; showNpcs: boolean; showTreasures: boolean; showFamiliars: boolean;
  showQuestsClassic: boolean; showQuestsNpc: boolean; showQuestsKingdom: boolean;
  kingdomFullMoonMode: 'all' | 'onlyFullMoon' | 'onlyNormal'; declutter?: boolean; showDrops?: boolean; showWildlife?: boolean;
}) {
  if (hasUserChoice) return;
  current = { ...current, ...defaults };
  listeners.forEach((l) => l(current));
  // Ne persiste PAS en localStorage ici : tant que le joueur n'a rien choisi lui-même, on veut que
  // les futurs changements de défaut admin continuent de s'appliquer à sa prochaine visite.
}

export function subscribeMapFilters(cb: (s: MapFilterState) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function useMapFilters(): [MapFilterState, (patch: Partial<MapFilterState>) => void] {
  const [state, setState] = useState(current);
  useEffect(() => subscribeMapFilters(setState), []);
  return [state, setMapFilters];
}

/** Catégories affichées sous forme de boutons dans WorldMapWidget.tsx — icône + clé i18n +
 * champ MapFilterState correspondant, pour générer la barre de filtres sans dupliquer la liste. */
export const MAP_FILTER_CATEGORIES: { key: keyof MapFilterState; icon: string; i18nKey: string }[] = [
  { key: 'showPois', icon: '🌲', i18nKey: 'map.filters.poi' },
  { key: 'showWorlds', icon: '🌀', i18nKey: 'map.filters.worlds' },
  { key: 'showNpcs', icon: '🧙', i18nKey: 'map.filters.npcs' },
  { key: 'showTreasures', icon: '🎁', i18nKey: 'map.filters.treasures' },
  { key: 'showFamiliars', icon: '🐾', i18nKey: 'map.filters.familiars' },
  { key: 'showQuestsClassic', icon: '📜', i18nKey: 'map.filters.questsClassic' },
  { key: 'showQuestsNpc', icon: '❓', i18nKey: 'map.filters.questsNpc' },
  { key: 'showQuestsKingdom', icon: '👑', i18nKey: 'map.filters.questsKingdom' },
  { key: 'showDrops', icon: '📦', i18nKey: 'map.filters.drops' },
  { key: 'showWildlife', icon: '🦉', i18nKey: 'map.filters.wildlife' },
  { key: 'showCemetery', icon: '⚰️', i18nKey: 'map.filters.cemetery' },
  { key: 'showCrypt', icon: '🏛️', i18nKey: 'map.filters.crypt' },
  { key: 'showTomb', icon: '🪦', i18nKey: 'map.filters.tomb' },
  { key: 'declutter', icon: '🧹', i18nKey: 'map.filters.declutter' },
];

/** Identifiants des marqueurs "en direct" (PNJ/Dragon errants, PNJ en approche — voir
 * lib/roamingActors.ts/lib/npcApproach.ts) : toujours exemptés du "filtre intelligent" (voir
 * MapFilterState.declutter), qu'ils soient ou non à portée de Synk. */
const LIVE_ACTOR_MARKER_IDS = new Set(['roaming.npc.live', 'roaming.dragon.live', 'encounter.npc.live']);

/** PNJ de rencontre PERSISTÉS après fermeture du pop-up (voir lib/roamingActors.ts::
 * spawnExtraRoamingActor/ExtraRoamingActor) — identifiants dynamiques (un par rencontre, préfixe
 * stable `encounter.extra.`), donc non énumérables dans LIVE_ACTOR_MARKER_IDS ci-dessus. Même
 * exemption que les acteurs "en direct" historiques : ces PNJ restent visibles quelle que soit
 * leur distance à Synk quand le "filtre intelligent" est actif. Idem pour la faune errante
 * (préfixe stable `owl-`/`werewolf-`/`boar-`, voir lib/roamingActors.ts::ensureWildlifeSpawns) :
 * ce sont elles aussi des entités EN DIRECT rares, que le "filtre intelligent" ne doit jamais
 * masquer. */
function isLiveActorMarkerId(id: string): boolean {
  return LIVE_ACTOR_MARKER_IDS.has(id) || id.startsWith('encounter.extra.') || id.startsWith('owl-') || id.startsWith('werewolf-') || id.startsWith('boar-')
    || id.startsWith('zombie-') || id.startsWith('ghoul-') || id.startsWith('skeleton-');
}

const ARCHETYPE_I18N_PREFIX = 'npc.archetype.';
/** Extrait la clé d'archétype stable (ex. "chevalier") d'un `i18nKey` de marqueur PNJ de rencontre
 * (voir NpcEncounterPopup.tsx::ARCHETYPES / app/game/page.tsx::spawnExtraRoamingActor, qui pose
 * systématiquement `i18nKey: npc.archetype.<key>`) — `null` si le marqueur n'est pas un PNJ de
 * rencontre (PNJ/familier catalogue classique, dont l'`i18nKey` suit un format différent). Exporté
 * pour réutilisation dans WorldMapWidget.tsx (construction de la liste de filtre "par entité"). */
export function extractArchetypeKey(i18nKey?: string): string | null {
  return i18nKey && i18nKey.startsWith(ARCHETYPE_I18N_PREFIX) ? i18nKey.slice(ARCHETYPE_I18N_PREFIX.length) : null;
}

/** Prédicat de filtrage d'un marqueur — utilisé IDENTIQUEMENT par WorldMapWidget.tsx (rendu de la
 * carte) et GameCanvas2D.tsx (rendu de la caméra isométrique), appliqué uniquement à la liste
 * RENDUE (jamais aux pools fonctionnels : biais de terrain, PNJ/dragon errant, tuiles-portail…).
 * `playerPos` (optionnel) active le "filtre intelligent" (`f.declutter`) — voir
 * MapFilterState.declutter ci-dessus ; à ne fournir QUE depuis WorldMapWidget.tsx (la Plateforme
 * 2D isométrique restreint déjà nativement l'affichage à une petite fenêtre de caméra locale,
 * bien plus étroite que DECLUTTER_RADIUS_PCT — un appel sans `playerPos` y laisse le comportement
 * historique strictement inchangé). */
export function markerMatchesFilters(m: MapMarker, f: MapFilterState, playerPos?: { x: number; y: number }): boolean {
  let matchesCategory: boolean;
  switch (m.kind) {
    case 'poi':
      matchesCategory = m.poiType === 'cemetery' ? f.showCemetery
        : m.poiType === 'crypt' ? f.showCrypt
        : m.poiType === 'tomb' ? f.showTomb
        : f.showPois;
      break;
    case 'world': matchesCategory = f.showWorlds; break;
    case 'npc': matchesCategory = f.showNpcs; break;
    case 'treasure': matchesCategory = f.showTreasures; break;
    case 'familiar': matchesCategory = f.showFamiliars; break;
    case 'drop': matchesCategory = f.showDrops; break;
    case 'wildlife': {
      if (!f.showWildlife) { matchesCategory = false; break; }
      matchesCategory = m.wildlifeKind === 'owl' ? f.showWildlifeOwl
        : m.wildlifeKind === 'werewolf' ? f.showWildlifeWerewolf
        : m.wildlifeKind === 'boar' ? f.showWildlifeBoar
        : m.wildlifeKind === 'zombie' ? f.showWildlifeZombie
        : m.wildlifeKind === 'ghoul' ? f.showWildlifeGhoul
        : m.wildlifeKind === 'skeleton' ? f.showWildlifeSkeleton
        : true; // espèce inconnue (ne devrait pas arriver) : par prudence, ne pas masquer
      break;
    }
    case 'quest': {
      if (m.questCategory === 'kingdom') {
        if (!f.showQuestsKingdom) { matchesCategory = false; break; }
        if (f.kingdomChapters && m.kingdomChapter != null && !f.kingdomChapters.includes(m.kingdomChapter)) { matchesCategory = false; break; }
        if (f.kingdomFullMoonMode === 'onlyFullMoon' && !m.fullMoonOnly) { matchesCategory = false; break; }
        if (f.kingdomFullMoonMode === 'onlyNormal' && m.fullMoonOnly) { matchesCategory = false; break; }
        matchesCategory = true;
      } else if (m.questCategory === 'npc') matchesCategory = f.showQuestsNpc;
      else matchesCategory = f.showQuestsClassic; // 'classic' (ou non renseigné, par prudence)
      break;
    }
    default: matchesCategory = true;
  }
  if (!matchesCategory) return false;
  // Filtre fin "par entité" (voir MapFilterState.hiddenEntityIds/hiddenNpcArchetypes ci-dessus) —
  // ne s'applique qu'aux PNJ/familiers (seuls kinds concernés par une identité catalogue ou un
  // archétype de rencontre nommé individuellement) ; `catalogId` prend le pas sur `id` quand il est
  // renseigné (cas des marqueurs synthétiques "historiques", voir gameState.ts::MapMarker.catalogId).
  if (m.kind === 'npc' || m.kind === 'familiar') {
    const entityKey = extractArchetypeKey(m.i18nKey);
    if (entityKey && f.hiddenNpcArchetypes.includes(entityKey)) return false;
    const catalogId = m.catalogId ?? m.id;
    if (f.hiddenEntityIds.includes(catalogId)) return false;
  }
  if (f.declutter && playerPos && !m.isKingdom && m.kind !== 'zorghon' && m.kind !== 'captive' && !isLiveActorMarkerId(m.id)) {
    const dist = Math.hypot(m.x - playerPos.x, m.y - playerPos.y);
    if (dist > DECLUTTER_RADIUS_PCT) return false;
  }
  return true;
}
