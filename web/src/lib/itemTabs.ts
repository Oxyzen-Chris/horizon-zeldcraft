import type { InventoryItem } from './gameState';

/**
 * Découpage en onglets par catégorie d'objet — partagé entre la besace (InventoryPanel.tsx)
 * et la boutique (ShopPanel.tsx) pour garantir une organisation identique aux deux endroits
 * (voir demande utilisateur : "comme pour la gestion du sac/besace, créer des onglets par
 * catégorie dans la boutique"). Une arme ne peut être rangée QUE dans "Armes", etc.
 */
export type ItemTab = 'weapon' | 'armor' | 'food' | 'potion' | 'vehicle' | 'treasure' | 'saddle' | 'familiars';

export const ITEM_TAB_CATEGORIES: Record<Exclude<ItemTab, 'familiars'>, InventoryItem['category'][]> = {
  weapon: ['weapon', 'arrow'],
  armor: ['armor', 'shield'],
  food: ['food'],
  potion: ['potion', 'super_potion', 'spell'],
  vehicle: ['vehicle'],
  // "parchment" (voir demande utilisateur : parchemins trouvés dans les salles de souterrains de
  // crypte, lib/gameState.ts::DEFAULT_CRYPT_POIS/CryptTunnelScene.tsx) rangé dans l'onglet Trésors
  // — même esprit d'objet de collection/lore que le reste de cet onglet, pas assez nombreux pour
  // justifier un onglet dédié.
  treasure: ['treasure', 'parchment'],
  saddle: ['saddle'],
};

export const ITEM_TAB_ORDER: ItemTab[] = ['weapon', 'armor', 'food', 'potion', 'vehicle', 'treasure', 'saddle', 'familiars'];

// "vehicle" → 🎈 (montgolfière) : renommé "Engins" (voir i18n game.inventory.tab.vehicle),
// plus cohérent avec les autres engins mécaniques du jeu (char à voile, barque, moto-taupe...).
export const ITEM_TAB_ICON: Record<ItemTab, string> = {
  weapon: '⚔️', armor: '🛡️', food: '🍖', potion: '🧪', vehicle: '🎈', treasure: '💎', saddle: '🐎', familiars: '🐲',
};
