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
  // Amulettes d'entrée de gamme (prix symbolique, accessibles dès le début de partie).
  ['amulette_voyageur', '📿 Amulette du Voyageur', 'armor', 20, { slot: 'amulet', rarity: 'common', defense: 2, durabilityMax: 10 }],
  ['amulette_bois', '🪵 Amulette de Bois runique', 'armor', 25, { slot: 'amulet', rarity: 'common', defense: 3, durabilityMax: 12 }],
  ['amulette_argile', "🏺 Amulette d'Argile bénie", 'armor', 30, { slot: 'amulet', rarity: 'common', defense: 4, durabilityMax: 14 }],
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
  // ─── 60 nouvelles armes (demande utilisateur) — inspirées du Seigneur des Anneaux/Tolkien,
  // World of Warcraft, Zelda et Minecraft. Noms « réplique »/paraphrasés pour rester dans l'esprit
  // de ces univers sans réutiliser de noms déposés tels quels. Réparties par rareté sur le même
  // barème que le catalogue existant (common → rare → legendary → epic).
  // — Common (24) —
  ['epee_paysanne', '🗡️ Épée paysanne', 'weapon', 220000, { slot: 'weapon', rarity: 'common', damage: 10, durabilityMax: 28 }],
  ['hachette_bucheron', '🪓 Hachette de bûcheron', 'weapon', 200000, { slot: 'weapon', rarity: 'common', damage: 11, durabilityMax: 26 }],
  ['faux_moisson', '🌾 Faux du moissonneur', 'weapon', 200000, { slot: 'weapon', rarity: 'common', damage: 13, durabilityMax: 24 }],
  ['fourche_ferme', '🍴 Fourche de ferme', 'weapon', 190000, { slot: 'weapon', rarity: 'common', damage: 9, durabilityMax: 26 }],
  ['baton_pelerin', '🥢 Bâton du pèlerin', 'weapon', 180000, { slot: 'weapon', rarity: 'common', damage: 8, durabilityMax: 28 }],
  ['epee_garde_village', '🗡️ Épée de la garde du village', 'weapon', 210000, { slot: 'weapon', rarity: 'common', damage: 14, durabilityMax: 24 }],
  ['hache_bucheron_naine', '🪓 Hache de bûcheron naine', 'weapon', 220000, { slot: 'weapon', rarity: 'common', damage: 16, durabilityMax: 22 }],
  ['dague_voleur', '🔪 Dague de voleur', 'weapon', 200000, { slot: 'weapon', rarity: 'common', damage: 12, durabilityMax: 26 }],
  ['marteau_forgeron', '🔨 Marteau de forgeron', 'weapon', 210000, { slot: 'weapon', rarity: 'common', damage: 15, durabilityMax: 24 }],
  ['lance_milicien', '🛡️ Lance de milicien', 'weapon', 215000, { slot: 'weapon', rarity: 'common', damage: 17, durabilityMax: 22 }],
  ['arc_court_hobbit', '🏹 Arc court de Hobbit', 'weapon', 200000, { slot: 'weapon', rarity: 'common', damage: 5, durabilityMax: 28, requiresArrow: true }],
  ['fronde_gobelin', '🪨 Fronde de gobelin', 'weapon', 180000, { slot: 'weapon', rarity: 'common', damage: 6, durabilityMax: 30 }],
  ['epee_courte_naine', '⚔️ Épée courte naine', 'weapon', 225000, { slot: 'weapon', rarity: 'common', damage: 18, durabilityMax: 22 }],
  ['hallebarde_garde', '🗡️ Hallebarde de la garde royale', 'weapon', 230000, { slot: 'weapon', rarity: 'common', damage: 19, durabilityMax: 20 }],
  ['epee_diamant_minecraft', '💎 Épée en diamant', 'weapon', 230000, { slot: 'weapon', rarity: 'common', damage: 20, durabilityMax: 24 }],
  ['hache_diamant_minecraft', '💎 Hache en diamant', 'weapon', 235000, { slot: 'weapon', rarity: 'common', damage: 22, durabilityMax: 22 }],
  ['epee_fer_minecraft', '⛏️ Épée en fer', 'weapon', 210000, { slot: 'weapon', rarity: 'common', damage: 16, durabilityMax: 24 }],
  ['arc_enchante_minecraft', '🏹 Arc enchanté', 'weapon', 220000, { slot: 'weapon', rarity: 'common', damage: 8, durabilityMax: 26, requiresArrow: true }],
  ['arbalete_chasseur', '🏹 Arbalète du chasseur', 'weapon', 210000, { slot: 'weapon', rarity: 'common', damage: 9, durabilityMax: 24, requiresArrow: true }],
  ['gourdin_troll', '🪵 Gourdin de troll des cavernes', 'weapon', 220000, { slot: 'weapon', rarity: 'common', damage: 20, durabilityMax: 26 }],
  ['dague_ombre', '🗡️ Dague de l\u2019ombre', 'weapon', 205000, { slot: 'weapon', rarity: 'common', damage: 14, durabilityMax: 24 }],
  ['epee_ecuyer', '🗡️ Épée d\u2019écuyer', 'weapon', 195000, { slot: 'weapon', rarity: 'common', damage: 12, durabilityMax: 26 }],
  ['lance_cavalier_leger', '🐎 Lance de cavalier léger', 'weapon', 215000, { slot: 'weapon', rarity: 'common', damage: 17, durabilityMax: 22 }],
  ['masse_pierre', '🪨 Masse de pierre runique', 'weapon', 205000, { slot: 'weapon', rarity: 'common', damage: 15, durabilityMax: 24 }],
  // — Rare (18) —
  ['glamdring_replique', '⚔️ Réplique de Frappe-Gnome', 'weapon', 400000, { slot: 'weapon', rarity: 'rare', damage: 38, durabilityMax: 18 }],
  ['orcrist_replique', '⚔️ Réplique de Morsure-Gobelin', 'weapon', 410000, { slot: 'weapon', rarity: 'rare', damage: 40, durabilityMax: 18 }],
  ['herugrim_replique', "⚔️ Réplique de l'épée du Roi-Cavalier", 'weapon', 390000, { slot: 'weapon', rarity: 'rare', damage: 36, durabilityMax: 18 }],
  ['guthwine_replique', '⚔️ Réplique de la Lame du Neveu', 'weapon', 380000, { slot: 'weapon', rarity: 'rare', damage: 34, durabilityMax: 19 }],
  ['hache_durin', '🪓 Hache de Durin', 'weapon', 420000, { slot: 'weapon', rarity: 'rare', damage: 42, durabilityMax: 17 }],
  ['lance_intendant_gondor', "🗡️ Lance de l'Intendant de Gondor", 'weapon', 390000, { slot: 'weapon', rarity: 'rare', damage: 35, durabilityMax: 18 }],
  ['marteau_destin_orque', '⚒️ Marteau du Destin orque', 'weapon', 430000, { slot: 'weapon', rarity: 'rare', damage: 44, durabilityMax: 16 }],
  ['lame_givre_maudite', '❄️ Lame gelée maudite', 'weapon', 410000, { slot: 'weapon', rarity: 'rare', damage: 40, durabilityMax: 17 }],
  ['hache_bataille_horde', '🪓 Hache de bataille de la Horde', 'weapon', 400000, { slot: 'weapon', rarity: 'rare', damage: 39, durabilityMax: 18 }],
  ['epee_geant_montagnes', '⚔️ Épée du Géant des Montagnes', 'weapon', 440000, { slot: 'weapon', rarity: 'rare', damage: 45, durabilityMax: 16 }],
  ['marteau_megatonique', '🔨 Marteau mégatonique', 'weapon', 420000, { slot: 'weapon', rarity: 'rare', damage: 43, durabilityMax: 16 }],
  ['baton_feu_ancien', '🔥 Bâton de feu ancien', 'weapon', 370000, { slot: 'weapon', rarity: 'rare', damage: 30, durabilityMax: 20 }],
  ['baton_glace_ancien', '❄️ Bâton de glace ancien', 'weapon', 370000, { slot: 'weapon', rarity: 'rare', damage: 30, durabilityMax: 20 }],
  ['trident_profondeurs', '🔱 Trident des profondeurs', 'weapon', 400000, { slot: 'weapon', rarity: 'rare', damage: 37, durabilityMax: 18 }],
  ['arbalete_lourde_naine', '🏹 Arbalète lourde naine', 'weapon', 380000, { slot: 'weapon', rarity: 'rare', damage: 14, durabilityMax: 20, requiresArrow: true }],
  ['arc_sylvain_elfe', '🏹 Arc sylvain elfique', 'weapon', 390000, { slot: 'weapon', rarity: 'rare', damage: 13, durabilityMax: 22, requiresArrow: true }],
  ['hache_netherite', '🟫 Hache en Netherite', 'weapon', 420000, { slot: 'weapon', rarity: 'rare', damage: 41, durabilityMax: 17 }],
  ['epee_netherite', '🟫 Épée en Netherite', 'weapon', 415000, { slot: 'weapon', rarity: 'rare', damage: 40, durabilityMax: 17 }],
  // — Legendary (12) —
  ['porte_cendres', '✨ Porte-Cendres, la lame sacrée', 'weapon', 780000, { slot: 'weapon', rarity: 'legendary', damage: 58, durabilityMax: 14 }],
  ['fureur_tonnerre', '⚡ Fureur du Tonnerre', 'weapon', 800000, { slot: 'weapon', rarity: 'legendary', damage: 60, durabilityMax: 13 }],
  ['epee_ceremonial_gondor', '👑 Épée cérémoniale de Gondor', 'weapon', 700000, { slot: 'weapon', rarity: 'legendary', damage: 52, durabilityMax: 15 }],
  ['hache_bataille_naine_royale', '🪓 Hache de bataille naine royale', 'weapon', 720000, { slot: 'weapon', rarity: 'legendary', damage: 55, durabilityMax: 15 }],
  ['arc_dame_bois_dore', '🏹 Arc de la Dame du Bois Doré', 'weapon', 750000, { slot: 'weapon', rarity: 'legendary', damage: 22, durabilityMax: 18, requiresArrow: true }],
  ['lame_celeste', '🗡️ Lame céleste scellée', 'weapon', 800000, { slot: 'weapon', rarity: 'legendary', damage: 62, durabilityMax: 13 }],
  ['marteau_forge_montagne', '⚒️ Marteau de la Forge de la Montagne', 'weapon', 760000, { slot: 'weapon', rarity: 'legendary', damage: 57, durabilityMax: 14 }],
  ['trident_roi_mer', '🔱 Trident du Roi des Mers', 'weapon', 750000, { slot: 'weapon', rarity: 'legendary', damage: 56, durabilityMax: 14 }],
  ['baton_archimage', "🔮 Bâton de l'archimage", 'weapon', 700000, { slot: 'weapon', rarity: 'legendary', damage: 48, durabilityMax: 16 }],
  ['faux_faucheur_ames', "💀 Faux du faucheur d'âmes", 'weapon', 790000, { slot: 'weapon', rarity: 'legendary', damage: 60, durabilityMax: 13 }],
  ['dague_reine_ombres', '🗡️ Dague de la Reine des Ombres', 'weapon', 700000, { slot: 'weapon', rarity: 'legendary', damage: 50, durabilityMax: 15 }],
  ['arc_vent_eternel', '🏹 Arc du Vent Éternel', 'weapon', 780000, { slot: 'weapon', rarity: 'legendary', damage: 24, durabilityMax: 17, requiresArrow: true }],
  // — Epic (6) —
  ['deuil_ombres', '🖤 Deuil des Ombres, lame maudite', 'weapon', 1700000, { slot: 'weapon', rarity: 'epic', damage: 95, durabilityMax: 10 }],
  ['sulfuron_marteau_flammes', '🔥 Marteau de Sulfuron', 'weapon', 1650000, { slot: 'weapon', rarity: 'epic', damage: 92, durabilityMax: 10 }],
  ['epee_maitre_temps', '⏳ Épée du Maître du Temps', 'weapon', 1600000, { slot: 'weapon', rarity: 'epic', damage: 88, durabilityMax: 11 }],
  ['hache_titan_dechu', '🪓 Hache du Titan déchu', 'weapon', 1650000, { slot: 'weapon', rarity: 'epic', damage: 90, durabilityMax: 10 }],
  ['lame_hylienne_eternelle', '✨ Lame Hylienne Éternelle', 'weapon', 1550000, { slot: 'weapon', rarity: 'epic', damage: 85, durabilityMax: 12 }],
  ['trident_empereur_abysses', "🔱 Trident de l'Empereur des Abysses", 'weapon', 1700000, { slot: 'weapon', rarity: 'epic', damage: 93, durabilityMax: 10 }],
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
