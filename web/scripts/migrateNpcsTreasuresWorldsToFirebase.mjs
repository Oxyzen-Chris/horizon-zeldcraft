/**
 * Pousse en base (Firebase RTDB, `catalog/npcDefs|treasureDefs|worldDefs/{id}`) les PNJ officiels,
 * trésors et mondes seedés à l'origine par `contracts/scripts/deploy.ts` (et `scripts/addWorlds.ts`
 * pour les 6 mondes étendus), afin que ces 3 catalogues fonctionnent en mode 100% hors-chaîne et
 * deviennent réellement modifiables depuis le menu Administration — voir `web/src/lib/gameState.ts`
 * (NpcDef/TreasureDef/WorldDef, addNpcDef/addTreasureDef/addWorldDef).
 *
 * Le contrat Solidity n'expose, pour ces 3 entités, que des fonctions de CRÉATION
 * (`addNpc`/`addTreasure`/`addWorld`, chacune avec `require(!x[id].active, "exists")`) — aucune
 * fonction de mise à jour d'un champ existant, ce qui rendait "modifiable" impossible sans
 * redéploiement du contrat.
 *
 * Les trésors n'ont, côté on-chain, qu'un XP de récompense (`xpReward`), pas de seuil de
 * découverte : leur ouverture n'était déclenchée que par l'ancien `submitQuestAnswer` on-chain
 * (lien `treasureId` sur une quête), mécanisme abandonné depuis la migration des quêtes vers
 * `submitQuestAnswerOffchain` (qui ne relie plus de trésor). On leur ajoute donc ici un seuil
 * `xpRequired` (comme les mondes) pour une ouverture manuelle une fois le seuil atteint, ainsi
 * qu'un `itemReward` (objet effectivement remis dans la besace à l'ouverture — sans quoi le
 * rubis/l'épée/la pioche promis par le nom du trésor n'apparaissaient jamais réellement dans la
 * besace du joueur, bug signalé) — voir `TreasureList.tsx` et `openTreasureOffchain()`.
 *
 * `TREASURES_EXTRA` ajoute 40 trésors/coffres supplémentaires (demande utilisateur), avec un
 * contenu gradué selon l'XP requis pour les ouvrir : nourriture/potions/butin mineur en début de
 * progression, jusqu'à l'équipement épique et aux fioles suprêmes en fin de progression — 45
 * trésors au total avec les 5 d'origine.
 *
 * Usage (one-shot, depuis web/) :
 *   node scripts/migrateNpcsTreasuresWorldsToFirebase.mjs
 *
 * Lit la config Firebase publique depuis web/.env.local (mêmes variables NEXT_PUBLIC_FIREBASE_*
 * que l'app). Écriture autorisée par la règle `catalog.write: auth != null` (auth anonyme).
 * Idempotent : ré-exécuter ce script écrase simplement les mêmes clés avec les mêmes valeurs.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { keccak256, toBytes } from 'viem';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Charge web/.env.local (parsing minimal, sans dépendance dotenv) ──
const envPath = join(__dirname, '..', '.env.local');
const env = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

/** Hash keccak256 d'un slug texte (ex. "quest.riddle_zelda") — même calcul que
 * migrateQuestsToFirebase.mjs, pour retrouver l'id Firebase des 5 quêtes classiques. */
const questId = (slug) => keccak256(toBytes(slug)).toLowerCase();

/** Clé RTDB sûre — identique à RKEY() dans gameState.ts (les segments de chemin Firebase
 * interdisent ".", "#", "$", "[", "]", d'où le remplacement des points des ids hérités on-chain
 * comme "npc.zelda_princess"). Le champ `id` d'origine (avec points) reste stocké tel quel. */
const rkey = (id) => id.toLowerCase().replace(/[.#$[\]]/g, '_');

//   [id,                     name,                          dialog,                                                                  xpReward, questKey]
const NPCS = [
  ['npc.zelda_princess', 'Princesse Zelda',       "Bienvenue, jeune dresseur ! J'ai une énigme pour toi…", 30, 'quest.riddle_zelda'],
  ['npc.steve',          'Steve le Mineur',       "Yo ! T'as vu mes diamants ?",                            20, 'quest.riddle_mc'],
  ['npc.thrall',         'Thrall (Chef de la Horde)', "Lok'tar Ogar, jeune Voxlyn !",                        50, 'quest.riddle_wow'],
  ['npc.merchant',       'Marchand ambulant',     "J'ai des potions rares… mais il te faudra résoudre mon énigme.", 15, 'quest.riddle_first'],
  ['npc.ancient_dragon', 'Dragon Ancestral',      "Prouve-moi que tu es digne de ma sagesse.",              100, 'quest.riddle_dragon'],
];

// xpRequired repris des seuils des 5 quêtes classiques auxquelles chaque trésor était relié
// on-chain (treasureId sur Quest), pour conserver la même progression narrative.
// itemReward : objet effectivement remis dans la besace à l'ouverture (voir openTreasureOffchain
// dans gameState.ts) — sans quoi le coffre n'octroyait que de l'XP et l'objet promis par le nom du
// trésor (rubis/épée/pioche...) n'apparaissait jamais dans la besace (bug signalé par l'utilisateur).
//   [id,                     name,                       xpRequired, xpReward, itemReward]
const TREASURES = [
  ['treasure.rupees', 'Bourse de rubis', 0, 30,
    { itemId: 'tresor_bourse_rubis', name: 'Bourse de rubis', category: 'treasure', qty: 50 }],
  ['treasure.master_sword', 'Épée de maître (Zelda)', 50, 100,
    { itemId: 'tresor_epee_maitre', name: 'Épée de maître (Zelda)', category: 'weapon', qty: 1,
      slot: 'weapon', rarity: 'legendary', damage: 65, durabilityMax: 16 }],
  ['treasure.diamond_pickaxe', 'Pioche en diamant (MC)', 100, 80,
    { itemId: 'tresor_pioche_diamant', name: 'Pioche en diamant (MC)', category: 'weapon', qty: 1,
      slot: 'weapon', rarity: 'rare', damage: 35, durabilityMax: 20 }],
  ['treasure.thunderfury', 'Thunderfury (WoW)', 500, 500,
    { itemId: 'tresor_thunderfury', name: 'Thunderfury', category: 'weapon', qty: 1,
      slot: 'weapon', rarity: 'epic', damage: 95, durabilityMax: 10 }],
  ['treasure.dragon_egg', 'Œuf de dragon ancien', 1000, 250,
    { itemId: 'tresor_oeuf_dragon', name: 'Œuf de dragon ancien', category: 'treasure', qty: 1 }],
];

// 40 nouveaux coffres/trésors dont le contenu est gradué selon l'XP du joueur (demande
// utilisateur) : nourriture/potions/butin mineur en début de progression, jusqu'à l'équipement
// épique et aux fioles suprêmes en fin de progression — mêmes conventions de rareté/dégâts/
// défense/durabilité que web/scripts/seedEquipmentCatalog.mjs (paliers RepRules.equipRarityXp*:
// commun 4000, rare 20000, légendaire 80000, épique 100000). Pas d'i18nKey (comme les objets de
// seedEquipmentCatalog.mjs) : noms en français affichés tels quels dans toutes les langues.
//   [id,                                     name,                                    xpRequired, xpReward, itemReward]
const TREASURES_EXTRA = [
  ['treasure.pomme_doree', '🍏 Pomme Dorée Enchantée', 20, 20,
    { itemId: 'obj_pomme_doree', name: '🍏 Pomme Dorée Enchantée', category: 'food', qty: 3, effect: { hunger: 60 } }],
  ['treasure.fiole_essence_verte', "🧪 Fiole d'Essence Verte", 150, 40,
    { itemId: 'obj_fiole_essence_verte', name: "🧪 Fiole d'Essence Verte", category: 'potion', qty: 1, effect: { hp: 50 } }],
  ['treasure.grimoire_etincelles', "📖 Grimoire d'Étincelles", 400, 60,
    { itemId: 'obj_grimoire_etincelles', name: "📖 Grimoire d'Étincelles", category: 'spell', qty: 1, effect: { spells: 30 } }],
  ['treasure.carquois_bois_ancien', '🏹 Carquois de Bois Ancien', 700, 70,
    { itemId: 'obj_fleches_bois_ancien', name: '➶ Flèches de Bois Ancien', category: 'arrow', qty: 10, slot: 'arrows', damage: 8 }],
  ['treasure.bourse_cuivre_royale', '💰 Bourse de Cuivre Royale', 900, 50,
    { itemId: 'obj_bourse_cuivre_royale', name: '💰 Bourse de Cuivre Royale', category: 'treasure', qty: 80 }],
  ['treasure.champignon_lueur', '🍄 Champignon Luminescent', 1200, 80,
    { itemId: 'obj_champignon_lueur', name: '🍄 Champignon Luminescent', category: 'food', qty: 4, effect: { hunger: 45 } }],
  ['treasure.parchemin_glace', '❄️ Parchemin de Glace Runique', 1500, 100,
    { itemId: 'obj_parchemin_glace', name: '❄️ Parchemin de Glace Runique', category: 'spell', qty: 1, effect: { spells: 40 } }],
  ['treasure.gantelet_apprenti', "🧤 Gantelet de l'Apprenti", 1800, 120,
    { itemId: 'obj_gantelet_apprenti', name: "🧤 Gantelet de l'Apprenti", category: 'armor', qty: 1, slot: 'belt', rarity: 'common', defense: 7, durabilityMax: 18 }],
  ['treasure.dague_rouille', '🗡️ Dague Rouillée du Passage Secret', 2100, 140,
    { itemId: 'obj_dague_rouille', name: '🗡️ Dague Rouillée du Passage Secret', category: 'weapon', qty: 1, slot: 'weapon', rarity: 'common', damage: 14, durabilityMax: 16 }],
  ['treasure.bouclier_ronce', '🌿 Bouclier de Ronces', 2500, 160,
    { itemId: 'obj_bouclier_ronce', name: '🌿 Bouclier de Ronces', category: 'shield', qty: 1, slot: 'offhand', rarity: 'common', defense: 9, durabilityMax: 18 }],
  ['treasure.arc_bois_noueux', '🏹 Arc de Bois Noueux', 3000, 200,
    { itemId: 'obj_arc_bois_noueux', name: '🏹 Arc de Bois Noueux', category: 'weapon', qty: 1, slot: 'weapon', rarity: 'common', damage: 7, durabilityMax: 24, requiresArrow: true }],
  ['treasure.armure_ecailles_lezard', "🦎 Armure d'Écailles de Lézard", 4000, 250,
    { itemId: 'obj_armure_ecailles_lezard', name: "🦎 Armure d'Écailles de Lézard", category: 'armor', qty: 1, slot: 'body', rarity: 'common', defense: 13, durabilityMax: 20 }],
  ['treasure.heaume_gargouille', '🗿 Heaume de Gargouille', 5000, 300,
    { itemId: 'obj_heaume_gargouille', name: '🗿 Heaume de Gargouille', category: 'armor', qty: 1, slot: 'head', rarity: 'common', defense: 9, durabilityMax: 18 }],
  ['treasure.bottes_sable_mouvant', '👢 Bottes de Sable Mouvant', 6000, 350,
    { itemId: 'obj_bottes_sable_mouvant', name: '👢 Bottes de Sable Mouvant', category: 'armor', qty: 1, slot: 'feet', rarity: 'common', defense: 7, durabilityMax: 20 }],
  ['treasure.fiole_force_ancienne', '💪 Fiole de Force Ancienne', 7000, 400,
    { itemId: 'obj_fiole_force_ancienne', name: '💪 Fiole de Force Ancienne', category: 'potion', qty: 1, effect: { force: 20 } }],
  ['treasure.epee_glace_eternelle', '❄️ Épée de Glace Éternelle', 9000, 500,
    { itemId: 'obj_epee_glace_eternelle', name: '❄️ Épée de Glace Éternelle', category: 'weapon', qty: 1, slot: 'weapon', rarity: 'rare', damage: 32, durabilityMax: 18 }],
  ['treasure.hache_bucheron_geant', '🪓 Hache du Bûcheron Géant', 11000, 550,
    { itemId: 'obj_hache_bucheron_geant', name: '🪓 Hache du Bûcheron Géant', category: 'weapon', qty: 1, slot: 'weapon', rarity: 'rare', damage: 36, durabilityMax: 17 }],
  ['treasure.armure_ecorce_vivante', "🌳 Armure d'Écorce Vivante", 13000, 600,
    { itemId: 'obj_armure_ecorce_vivante', name: "🌳 Armure d'Écorce Vivante", category: 'armor', qty: 1, slot: 'body', rarity: 'rare', defense: 26, durabilityMax: 18 }],
  ['treasure.bouclier_miroir_astral', '🪞 Bouclier Miroir Astral', 15000, 650,
    { itemId: 'obj_bouclier_miroir_astral', name: '🪞 Bouclier Miroir Astral', category: 'shield', qty: 1, slot: 'offhand', rarity: 'rare', defense: 28, durabilityMax: 18 }],
  ['treasure.amulette_brume_spectrale', '👻 Amulette de Brume Spectrale', 18000, 700,
    { itemId: 'obj_amulette_brume_spectrale', name: '👻 Amulette de Brume Spectrale', category: 'armor', qty: 1, slot: 'amulet', rarity: 'rare', defense: 24, durabilityMax: 18 }],
  ['treasure.arc_vent_hurlant', '🌪️ Arc du Vent Hurlant', 22000, 750,
    { itemId: 'obj_arc_vent_hurlant', name: '🌪️ Arc du Vent Hurlant', category: 'weapon', qty: 1, slot: 'weapon', rarity: 'rare', damage: 12, durabilityMax: 28, requiresArrow: true }],
  ['treasure.carquois_flammes_eternelles', '🔥 Carquois de Flammes Éternelles', 25000, 800,
    { itemId: 'obj_fleches_flammes_eternelles', name: '🔥 Flèches de Flammes Éternelles', category: 'arrow', qty: 15, slot: 'arrows', damage: 18 }],
  ['treasure.grimoire_tempete', '⛈️ Grimoire de la Tempête', 28000, 850,
    { itemId: 'obj_grimoire_tempete', name: '⛈️ Grimoire de la Tempête', category: 'spell', qty: 1, effect: { spells: 80 } }],
  ['treasure.fiole_regeneration_draconique', '🐉 Fiole de Régénération Draconique', 32000, 900,
    { itemId: 'obj_fiole_regen_draconique', name: '🐉 Fiole de Régénération Draconique', category: 'potion', qty: 1, effect: { hp: 120 } }],
  ['treasure.eclat_etoile_filante', "☄️ Éclat d'Étoile Filante", 36000, 950,
    { itemId: 'obj_eclat_etoile_filante', name: "☄️ Éclat d'Étoile Filante", category: 'treasure', qty: 1 }],
  ['treasure.epee_lumiere_eternelle', '✨ Épée de Lumière Éternelle', 42000, 1200,
    { itemId: 'obj_epee_lumiere_eternelle', name: '✨ Épée de Lumière Éternelle', category: 'weapon', qty: 1, slot: 'weapon', rarity: 'legendary', damage: 58, durabilityMax: 15 }],
  ['treasure.armure_titan_oublie', '🗿 Armure du Titan Oublié', 50000, 1500,
    { itemId: 'obj_armure_titan_oublie', name: '🗿 Armure du Titan Oublié', category: 'armor', qty: 1, slot: 'body', rarity: 'legendary', defense: 65, durabilityMax: 14 }],
  ['treasure.casque_seigneur_dragons', '🐲 Casque du Seigneur des Dragons', 58000, 1700,
    { itemId: 'obj_casque_seigneur_dragons', name: '🐲 Casque du Seigneur des Dragons', category: 'armor', qty: 1, slot: 'head', rarity: 'legendary', defense: 28, durabilityMax: 14 }],
  ['treasure.bouclier_aube_celeste', "🌅 Bouclier de l'Aube Céleste", 66000, 1900,
    { itemId: 'obj_bouclier_aube_celeste', name: "🌅 Bouclier de l'Aube Céleste", category: 'shield', qty: 1, slot: 'offhand', rarity: 'legendary', defense: 58, durabilityMax: 14 }],
  ['treasure.bottes_vent_stellaire', '🌠 Bottes du Vent Stellaire', 74000, 2100,
    { itemId: 'obj_bottes_vent_stellaire', name: '🌠 Bottes du Vent Stellaire', category: 'armor', qty: 1, slot: 'feet', rarity: 'legendary', defense: 20, durabilityMax: 15 }],
  ['treasure.hache_seisme_titanesque', '🌋 Hache du Séisme Titanesque', 82000, 2300,
    { itemId: 'obj_hache_seisme_titanesque', name: '🌋 Hache du Séisme Titanesque', category: 'weapon', qty: 1, slot: 'weapon', rarity: 'legendary', damage: 62, durabilityMax: 14 }],
  ['treasure.grimoire_arcanes_interdits', '📕 Grimoire des Arcanes Interdits', 88000, 2500,
    { itemId: 'obj_grimoire_arcanes_interdits', name: '📕 Grimoire des Arcanes Interdits', category: 'spell', qty: 1, effect: { spells: 150 } }],
  ['treasure.fiole_ame_phenix', "🔥🦅 Fiole de l'Âme du Phénix", 95000, 3000,
    { itemId: 'obj_fiole_ame_phenix', name: "🔥🦅 Fiole de l'Âme du Phénix", category: 'super_potion', qty: 1, effect: { maxHp: 150, hp: 150 } }],
  ['treasure.epee_neant_stellaire', '🌌 Épée du Néant Stellaire', 102000, 3500,
    { itemId: 'obj_epee_neant_stellaire', name: '🌌 Épée du Néant Stellaire', category: 'weapon', qty: 1, slot: 'weapon', rarity: 'epic', damage: 95, durabilityMax: 10 }],
  ['treasure.armure_forgeronde_dieux', '⚡ Armure Forgée par les Dieux', 112000, 4000,
    { itemId: 'obj_armure_forgeronde_dieux', name: '⚡ Armure Forgée par les Dieux', category: 'armor', qty: 1, slot: 'body', rarity: 'epic', defense: 75, durabilityMax: 10 }],
  ['treasure.bouclier_infini_cristallin', '💠 Bouclier Infini Cristallin', 124000, 4500,
    { itemId: 'obj_bouclier_infini_cristallin', name: '💠 Bouclier Infini Cristallin', category: 'shield', qty: 1, slot: 'offhand', rarity: 'epic', defense: 70, durabilityMax: 10 }],
  ['treasure.amulette_convergence_astrale', '🌀 Amulette de Convergence Astrale', 136000, 5000,
    { itemId: 'obj_amulette_convergence_astrale', name: '🌀 Amulette de Convergence Astrale', category: 'armor', qty: 1, slot: 'amulet', rarity: 'epic', defense: 35, durabilityMax: 10 }],
  ['treasure.fiole_essence_infinie', "♾️ Fiole d'Essence Infinie", 150000, 6000,
    { itemId: 'obj_fiole_essence_infinie', name: "♾️ Fiole d'Essence Infinie", category: 'super_potion', qty: 1, effect: { maxForce: 150, force: 75 } }],
  ['treasure.aeronef_zephyr_eternel', '🎈 Aéronef du Zéphyr Éternel', 175000, 7000,
    { itemId: 'obj_aeronef_zephyr_eternel', name: '🎈 Aéronef du Zéphyr Éternel', category: 'vehicle', qty: 1, slot: 'vehicle' }],
  ['treasure.sceptre_vide_etoile', '🔮 Sceptre du Vide Étoilé', 200000, 10000,
    { itemId: 'obj_sceptre_vide_etoile', name: '🔮 Sceptre du Vide Étoilé', category: 'weapon', qty: 1, slot: 'weapon', rarity: 'epic', damage: 110, durabilityMax: 8 }],
];

const ALL_TREASURES = [...TREASURES, ...TREASURES_EXTRA];


//   [id,                          name,                                  xpRequired]
const WORLDS = [
  ['world.zephyria',            'Forêt de Zephyria',                   0],
  ['world.nether_cristal',      'Grottes de Nether-Cristal',            200],
  ['world.azerothyl',           "Sanctuaire d'Azerothyl",               1000],
  ['world.nexus',               'Nexus Temporel',                       5000],
  ['world.ember_wastes',        "Landes Cendrées d'Ember",               10000],
  ['world.frostfall_peaks',     'Pics Gelés de Frostfall',               20000],
  ['world.shadowmere_marsh',    'Marécages de Shadowmere',               35000],
  ['world.skyreach_spire',      'Flèche Céleste de Skyreach',            50000],
  ['world.stargate_aethyria',   "Portail des Étoiles d'Aethyria",        75000],
  ['world.eternum_sanctum',     'Sanctuaire Éternel d\'Eternum',         100000],
];

async function main() {
  const app = initializeApp({
    apiKey:      env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain:  env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    databaseURL: env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    projectId:   env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId:       env.NEXT_PUBLIC_FIREBASE_APP_ID,
  });
  await signInAnonymously(getAuth(app));
  const db = getDatabase(app);
  const now = Date.now();

  console.log('\n🧙 PNJ officiels...');
  for (const [id, name, dialog, xpReward, questKey] of NPCS) {
    const order = NPCS.findIndex((n) => n[0] === id);
    const key = rkey(id);
    const i18nKey = `npc.official.${id.split('.').slice(1).join('.')}`;
    const def = { id, name, dialog, xpReward, active: true, createdAt: now, order, i18nKey, questId: questId(questKey) };
    await set(ref(db, `catalog/npcDefs/${key}`), def);
    console.log(`   + ${name} (+${xpReward} XP) — quête liée : ${questKey}`);
  }

  console.log('\n💎 Trésors...');
  for (const [id, name, xpRequired, xpReward, itemReward] of ALL_TREASURES) {
    const order = ALL_TREASURES.findIndex((tr) => tr[0] === id);
    const key = rkey(id);
    const i18nKey = `treasure.${id.split('.').slice(1).join('.')}`;
    const def = { id, name, xpRequired, xpReward, active: true, createdAt: now, order, i18nKey, itemReward };
    await set(ref(db, `catalog/treasureDefs/${key}`), def);
    console.log(`   + ${name} (requiert ${xpRequired} XP, +${xpReward} XP + 🎒 ${itemReward.name} à l'ouverture)`);
  }

  console.log('\n🗺️  Mondes...');
  for (const [id, name, xpRequired] of WORLDS) {
    const order = WORLDS.findIndex((w) => w[0] === id);
    const key = rkey(id);
    const i18nKey = `world.${id.split('.').slice(1).join('.')}`;
    const def = { id, name, xpRequired, active: true, createdAt: now, order, i18nKey };
    await set(ref(db, `catalog/worldDefs/${key}`), def);
    console.log(`   + ${name} (requiert ${xpRequired} XP)`);
  }

  console.log('\nTerminé — catalogues PNJ/Trésors/Mondes 100% hors-chaîne opérationnels.');
  process.exit(0);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
