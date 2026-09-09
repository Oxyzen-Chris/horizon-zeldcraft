'use client';

import { useEffect, useState } from 'react';
import { subscribeWorldDrops, type WorldDroppedItem, type MapMarker } from './gameState';
import { ITEM_TAB_CATEGORIES, ITEM_TAB_ICON, type ItemTab } from './itemTabs';

/**
 * Icône du type d'objet déposé (voir demande utilisateur « matérialiseras l'objet déposé [...]
 * dans le widget de la plateforme 2D isométrique et le widget de la mapmonde avec l'icône du type
 * d'objet ») — réutilise EXACTEMENT le même registre que la besace/la boutique (voir
 * lib/itemTabs.ts::ITEM_TAB_ICON) plutôt que d'inventer une nouvelle table d'icônes, pour rester
 * visuellement cohérent partout (⚔️ pour une arme, 🍖 pour de la nourriture, etc.). Repli 📦
 * (colis générique) pour toute catégorie qui n'appartiendrait à aucun onglet connu.
 */
export function worldDropIcon(category: WorldDroppedItem['category']): string {
  for (const tab of Object.keys(ITEM_TAB_CATEGORIES) as Exclude<ItemTab, 'familiars'>[]) {
    if (ITEM_TAB_CATEGORIES[tab].includes(category)) return ITEM_TAB_ICON[tab];
  }
  return '📦';
}

/** Retire un éventuel préfixe emoji (+ espace) d'un nom d'objet catalogue — TOUS les objets du
 * catalogue préfixent déjà leur nom par une icône (ex. `'⚔️ Épée épique'`, voir gameState.ts::ITEMS).
 * Sans ce nettoyage, le titre affiché sur la carte (`${marker.icon} ${marker.name}`, voir
 * GameCanvas2D.tsx/Platform3DWidget.tsx/WorldMapWidget.tsx) doublerait l'icône (ex.
 * "⚔️ ⚔️ Épée épique") puisque `marker.icon` est déjà calculé séparément par catégorie
 * (`worldDropIcon`) pour le glyphe affiché sur la case. `d.name` lui-même n'est PAS modifié
 * (conservé tel quel pour les toasts/pop-up qui l'affichent seul, ex. « Épée épique déposé au
 * sol »), seul le nom porté par le marqueur carte l'est. */
function stripLeadingEmoji(name: string): string {
  return name.replace(/^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]+\s*/u, '');
}

/** Convertit un dépôt (voir WorldDroppedItem) en MapMarker générique `kind:'drop'`, directement
 * compatible avec le pipeline de rendu/filtrage déjà en place dans les 3 widgets (GameCanvas2D.tsx/
 * Platform3DWidget.tsx/WorldMapWidget.tsx, voir markerMatchesFilters). PAS de `i18nKey` ici
 * (volontairement `undefined`, à la différence des PNJ/quêtes/mondes) : la traduction `item.<id>`
 * (voir i18n/messages/*.json, résolue ailleurs via `itemLabel()`) inclut TOUJOURS déjà sa propre
 * icône dans le texte traduit (ex. `"item.sword_ep": "⚔️ Épée épique"`) — la combiner avec le
 * template de titre générique partagé (`${marker.icon} ${localizeName(...)}`, qui préfixe
 * lui-même `marker.icon`) doublerait l'icône (ex. "⚔️ ⚔️ Épée épique"). Sans `i18nKey`,
 * `localizeName` retombe toujours sur `marker.name` (nettoyé de son icône par
 * `stripLeadingEmoji`), qui reste en français quel que soit le paramètre de langue courant — un
 * compromis mineur et volontaire pour cette info-bulle carte uniquement (la besace/la boutique,
 * elles, restent parfaitement traduites via `itemLabel()`). */
export function worldDropToMarker(d: WorldDroppedItem): MapMarker {
  return {
    id: d.id, kind: 'drop', name: stripLeadingEmoji(d.name),
    icon: worldDropIcon(d.category), x: d.x, y: d.y,
  };
}

/** Abonnement React temps réel à tous les objets actuellement déposés dans le monde — voir
 * gameState.ts::subscribeWorldDrops. Utilisé par les 3 widgets pour fusionner ces marqueurs
 * dynamiques à leur liste de marqueurs catalogue, exactement comme lib/roamingActors.ts::extras. */
export function useWorldDrops(): WorldDroppedItem[] {
  const [drops, setDrops] = useState<WorldDroppedItem[]>([]);
  useEffect(() => subscribeWorldDrops(setDrops), []);
  return drops;
}
