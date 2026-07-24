/**
 * Pousse en base (Firebase RTDB, `catalog/shop/{itemId}`) le catalogue d'équipement du personnage
 * (armes, arcs, flèches, protections, boucliers, amulettes, engins, selles de dragon) — voir
 * `DEFAULT_SHOP` dans `web/src/lib/gameState.ts` pour la même liste (utilisée en repli local si
 * `catalog/shop` est vide en base). Ce script permet de propager les NOUVEAUX items dans une base
 * déjà peuplée (le repli `DEFAULT_SHOP` n'est utilisé QUE si `catalog/shop` est totalement vide
 * côté Firebase — d'où l'importance de relancer ce script après toute modification d'un item déjà
 * seedé, ex. cape_invisibilite, sous peine que la version Firebase périmée l'emporte).
 *
 * Lore (inspiré de Tolkien et des bestiaires/arsenaux classiques Donjons & Dragons, recherché pour
 * rester crédible) : Andúril (l'Épée Reforgée d'Aragorn), Dard (l'épée de Bilbo/Frodo, luit près
 * des Orcs), le mithril (armure légère et increvable de Bilbo/Frodo), l'arc de Galadriel. Rareté
 * croissante (common → rare → legendary → epic), seuils XP paramétrables (menu Administration →
 * RepRules equipRarityXp*). Prix boutique ≥ 200 000 pièces pour toute arme/protection/bouclier
 * (RepRules.equipShopMinPrice) ; les flèches (consommables) restent bon marché.
 *
 * Usage (one-shot, depuis web/) :
 *   node scripts/seedEquipmentCatalog.mjs
 *
 * Lit la config Firebase publique depuis web/.env.local. Écriture autorisée par la règle
 * `catalog.write: auth != null` (auth anonyme). Idempotent.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';

const __dirname = dirname(fileURLToPath(import.meta.url));

const envPath = join(__dirname, '..', '.env.local');
const env = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

// [itemId, name, category, priceGame, extra] — extra = { slot, rarity, damage, defense, durabilityMax, requiresArrow, effect }
const ITEMS = [
  ['epee_courte', '🗡️ Épée courte', 'weapon', 200000, { slot: 'weapon', rarity: 'common', damage: 15, durabilityMax: 20 }],
  ['epee_longue', '⚔️ Épée longue', 'weapon', 220000, { slot: 'weapon', rarity: 'common', damage: 20, durabilityMax: 22 }],
  ['lance_chevalier', '🛡️ Lance de chevalier', 'weapon', 210000, { slot: 'weapon', rarity: 'common', damage: 18, durabilityMax: 20 }],
  ['gourdin_cloute', '🪵 Gourdin clouté', 'weapon', 200000, { slot: 'weapon', rarity: 'common', damage: 12, durabilityMax: 25 }],
  ['masse_templiere', '🔨 Masse templière', 'weapon', 205000, { slot: 'weapon', rarity: 'common', damage: 16, durabilityMax: 24 }],
  ['epee_bataille', '⚔️ Épée de bataille', 'weapon', 380000, { slot: 'weapon', rarity: 'rare', damage: 35, durabilityMax: 18 }],
  ['hache_guerre_naine', '🪓 Hache de guerre naine', 'weapon', 400000, { slot: 'weapon', rarity: 'rare', damage: 38, durabilityMax: 18 }],
  ['marteau_guerre_sacre', '⚒️ Marteau de guerre sacré', 'weapon', 420000, { slot: 'weapon', rarity: 'rare', damage: 40, durabilityMax: 17 }],
  ['dague_sept_eclats', "🗡️ Dague aux Sept Éclats", 'weapon', 750000, { slot: 'weapon', rarity: 'legendary', damage: 55, durabilityMax: 14 }],
  ['epee_elfique_argent', "✨ Épée elfique à lame d'argent", 'weapon', 800000, { slot: 'weapon', rarity: 'legendary', damage: 60, durabilityMax: 15 }],
  ['dard_luisant', "🔷 Dard, la lame qui luit près des Orcs", 'weapon', 700000, { slot: 'weapon', rarity: 'legendary', damage: 50, durabilityMax: 16 }],
  ['anduril_replique', "👑 Réplique d'Andúril, l'Épée Reforgée", 'weapon', 1500000, { slot: 'weapon', rarity: 'epic', damage: 90, durabilityMax: 10 }],
  ['arc_chasseur', '🏹 Arc du chasseur', 'weapon', 200000, { slot: 'weapon', rarity: 'common', damage: 6, durabilityMax: 28, requiresArrow: true }],
  ['arc_elfique', '🏹 Arc elfique', 'weapon', 380000, { slot: 'weapon', rarity: 'rare', damage: 10, durabilityMax: 30, requiresArrow: true }],
  ['arc_galadriel', '🏹 Arc légendaire de Galadriel', 'weapon', 780000, { slot: 'weapon', rarity: 'legendary', damage: 20, durabilityMax: 20, requiresArrow: true }],
  ['fleche_simple', '➶ Flèche simple', 'arrow', 20, { slot: 'arrows', damage: 5 }],
  ['fleche_glace', '❄️ Flèche de glace', 'arrow', 60, { slot: 'arrows', damage: 12 }],
  ['fleche_feu', '🔥 Flèche de feu', 'arrow', 70, { slot: 'arrows', damage: 15 }],
  ['fleche_explosive', '💥 Flèche explosive', 'arrow', 120, { slot: 'arrows', damage: 25 }],
  ['casque_fer', '⛑️ Casque de fer', 'armor', 200000, { slot: 'head', rarity: 'common', defense: 8, durabilityMax: 20 }],
  ['casque_dragon', '🐲 Casque en écailles de dragon', 'armor', 780000, { slot: 'head', rarity: 'legendary', defense: 25, durabilityMax: 14 }],
  ['cotte_mailles', '🥋 Cotte de mailles', 'armor', 210000, { slot: 'body', rarity: 'common', defense: 15, durabilityMax: 22 }],
  ['armure_plates', '🛡️ Armure de plates', 'armor', 400000, { slot: 'body', rarity: 'rare', defense: 30, durabilityMax: 18 }],
  ['armure_mithril', '💎 Armure de mithril', 'armor', 1600000, { slot: 'body', rarity: 'epic', defense: 70, durabilityMax: 12 }],
  ['jambieres_acier', "🦵 Jambières d'acier", 'armor', 200000, { slot: 'legs', rarity: 'common', defense: 10, durabilityMax: 20 }],
  ['jambieres_naines', '🦵 Jambières naines renforcées', 'armor', 380000, { slot: 'legs', rarity: 'rare', defense: 20, durabilityMax: 18 }],
  ['bottes_voyageur', '👢 Bottes du voyageur', 'armor', 200000, { slot: 'feet', rarity: 'common', defense: 6, durabilityMax: 25 }],
  ['bottes_sept_lieues', '👢 Bottes de sept lieues', 'armor', 750000, { slot: 'feet', rarity: 'legendary', defense: 18, durabilityMax: 15 }],
  ['ceinture_force', '🎗️ Ceinture de force', 'armor', 200000, { slot: 'belt', rarity: 'common', defense: 5, durabilityMax: 22 }],
  ['ceinture_geant', '🎗️ Ceinture du géant', 'armor', 380000, { slot: 'belt', rarity: 'rare', defense: 15, durabilityMax: 18 }],
  ['bouclier_bois', '🛡️ Bouclier de bois clouté', 'shield', 200000, { slot: 'offhand', rarity: 'common', defense: 10, durabilityMax: 20 }],
  ['bouclier_fer', '🛡️ Bouclier de fer', 'shield', 220000, { slot: 'offhand', rarity: 'common', defense: 16, durabilityMax: 22 }],
  ['egide_templiere', '🛡️ Égide templière', 'shield', 400000, { slot: 'offhand', rarity: 'rare', defense: 30, durabilityMax: 18 }],
  ['bouclier_dragon_or', "🛡️ Bouclier en écailles de Dragon d'Or", 'shield', 1500000, { slot: 'offhand', rarity: 'epic', defense: 65, durabilityMax: 12 }],
  // Cape d'invisibilité : désormais un objet double-usage — s'équipe comme protection (slot
  // 'amulet', défense + durabilité) OU se consomme directement (garde son effect.invisibleMinutes,
  // voir consumeInventoryItem()) via le bouton "Utiliser" de la besace.
  ['cape_invisibilite', "🫥 Cape d'invisibilité", 'armor', 90000, { slot: 'amulet', rarity: 'epic', defense: 20, durabilityMax: 6, effect: { invisibleMinutes: 12 } }],
  ['amulette_vitalite', '📿 Amulette de Vitalité', 'armor', 200000, { slot: 'amulet', rarity: 'common', defense: 12, durabilityMax: 24 }],
  ['amulette_anciens', '📿 Amulette des Anciens', 'armor', 400000, { slot: 'amulet', rarity: 'rare', defense: 28, durabilityMax: 18 }],
  ['char_voile', '🌤️ Char à voile', 'vehicle', 500, { slot: 'vehicle' }],
  ['barque', '🛶 Barque', 'vehicle', 400, { slot: 'vehicle' }],
  ['montgolf', '🎈 Montgolfière', 'vehicle', 800, { slot: 'vehicle' }],
  ['mototaupe', '🚀 Moto-taupe', 'vehicle', 900, { slot: 'vehicle' }],
  // Selles de dragon (une par dragon, appairage strict via requiresFamiliarId — voir equipItem()).
  ['selle_blanc',  '❄️ Selle Immaculée du Dragon Blanc',      'saddle', 40000,  { slot: 'saddle', rarity: 'common',    requiresFamiliarId: 'dragon.white' }],
  ['selle_noir',   "🌑 Selle d'Ombre du Dragon Noir",          'saddle', 50000,  { slot: 'saddle', rarity: 'rare',      requiresFamiliarId: 'dragon.black' }],
  ['selle_vert',   '🟢 Selle Sylvestre du Dragon Vert',        'saddle', 55000,  { slot: 'saddle', rarity: 'rare',      requiresFamiliarId: 'dragon.green' }],
  ['selle_bleu',   '🔵 Selle des Tempêtes du Dragon Bleu',     'saddle', 65000,  { slot: 'saddle', rarity: 'legendary', requiresFamiliarId: 'dragon.blue' }],
  ['selle_rouge',  '🔴 Selle Ardente du Dragon Rouge',         'saddle', 80000,  { slot: 'saddle', rarity: 'legendary', requiresFamiliarId: 'dragon.red' }],
  ['selle_or',     "🥇 Selle Solaire du Dragon d'Or",          'saddle', 90000,  { slot: 'saddle', rarity: 'legendary', requiresFamiliarId: 'dragon.gold' }],
  ['selle_argent', "🥈 Selle Lunaire du Dragon d'Argent",      'saddle', 110000, { slot: 'saddle', rarity: 'epic',      requiresFamiliarId: 'dragon.silver' }],
  ['selle_bronze', '🥉 Selle des Forges du Dragon de Bronze',  'saddle', 130000, { slot: 'saddle', rarity: 'epic',      requiresFamiliarId: 'dragon.bronze' }],
  // Objets historiques (antérieurs au système d'équipement, jamais inclus dans ce script avant
  // ce correctif) — reçoivent enfin un slot pour devenir glissables/équipables tout en gardant
  // leur effet à usage unique existant (voir gameState.ts DEFAULT_SHOP).
  ['sword_ep',  '⚔️ Épée épique',        'weapon', 200, { slot: 'weapon',  rarity: 'rare', damage: 20,  durabilityMax: 20, effect: { force: 20 } }],
  ['shield_lg', '🛡️ Bouclier légendaire', 'shield', 250, { slot: 'offhand', rarity: 'rare', defense: 20, durabilityMax: 20, effect: { force: 15, hp: 20 } }],
];

async function main() {
  const app = initializeApp({
    apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    databaseURL: env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: env.NEXT_PUBLIC_FIREBASE_APP_ID,
  });
  await signInAnonymously(getAuth(app));
  const db = getDatabase(app);

  for (const [itemId, name, category, priceGame, extra] of ITEMS) {
    const def = { itemId, name, category, priceGame, effect: {}, active: true, ...extra };
    await set(ref(db, `catalog/shop/${itemId}`), def);
    console.log(`✅ ${itemId} → ${name} (${category}${extra.rarity ? `, ${extra.rarity}` : ''}) — ${priceGame} 💰`);
  }
  console.log(`\nTerminé — ${ITEMS.length} objets d'équipement propagés dans catalog/shop.`);
  process.exit(0);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
