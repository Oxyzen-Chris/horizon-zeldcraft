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
}

export const DEFAULT_MAP_FILTERS: MapFilterState = {
  showPois: true, showWorlds: true, showNpcs: true, showTreasures: true, showFamiliars: true,
  showQuestsClassic: true, showQuestsNpc: true, showQuestsKingdom: true,
  kingdomChapters: null, kingdomFullMoonMode: 'all',
};

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
  kingdomFullMoonMode: 'all' | 'onlyFullMoon' | 'onlyNormal';
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
];

/** Prédicat de filtrage d'un marqueur — utilisé IDENTIQUEMENT par WorldMapWidget.tsx (rendu de la
 * carte) et GameCanvas2D.tsx (rendu de la caméra isométrique), appliqué uniquement à la liste
 * RENDUE (jamais aux pools fonctionnels : biais de terrain, PNJ/dragon errant, tuiles-portail…). */
export function markerMatchesFilters(m: MapMarker, f: MapFilterState): boolean {
  switch (m.kind) {
    case 'poi': return f.showPois;
    case 'world': return f.showWorlds;
    case 'npc': return f.showNpcs;
    case 'treasure': return f.showTreasures;
    case 'familiar': return f.showFamiliars;
    case 'quest': {
      if (m.questCategory === 'kingdom') {
        if (!f.showQuestsKingdom) return false;
        if (f.kingdomChapters && m.kingdomChapter != null && !f.kingdomChapters.includes(m.kingdomChapter)) return false;
        if (f.kingdomFullMoonMode === 'onlyFullMoon' && !m.fullMoonOnly) return false;
        if (f.kingdomFullMoonMode === 'onlyNormal' && m.fullMoonOnly) return false;
        return true;
      }
      if (m.questCategory === 'npc') return f.showQuestsNpc;
      return f.showQuestsClassic; // 'classic' (ou non renseigné, par prudence)
    }
    default: return true;
  }
}
