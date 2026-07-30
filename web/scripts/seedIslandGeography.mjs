/**
 * Pousse en base (Firebase RTDB, `catalog/mapPois/{id}` + `catalog/npcDefs/{id}`) la géographie des
 * « grandes étendues » demandées par l'utilisateur : une chaîne de montagnes contiguë culminant en
 * altitude (voir `worldTerrain.ts::poiCap`/`ALTITUDE_MAX_M`), deux mers (bordure Est et Sud-Est),
 * deux océans (bordure Ouest et Nord-Ouest), des lacs/étangs/ruisseaux dispersés, 1-2 presqu'îles
 * rattachées au continent, et un archipel de 5 îles (petite/moyenne/grande regroupées + une île
 * moyenne au sud + une grande île à l'est) peuplées de bambous/baobabs/palmiers (voir
 * `worldTerrain.ts::islandBias`) et de PNJ indigènes originaux.
 *
 * Utilise le nouveau champ optionnel `MapPoiDef.radius` (voir gameState.ts) pour faire varier la
 * taille de chaque île/mer/lac indépendamment du rayon par défaut de son type — sans quoi toutes
 * les îles auraient exactement le même gabarit (POI_RADIUS_BY_TYPE.island = 20).
 *
 * 100% original (aucun nom copyrighté) — même niveau d'inspiration générique que le reste du
 * catalogue (seedKingdomQuests.mjs, seedNpcRiddleQuests.mjs...) : Seigneur des Anneaux/Tolkien,
 * World of Warcraft, Zelda et Minecraft ne sont que des SOURCES D'INSPIRATION de gameplay/ton, pas
 * de contenu recopié.
 *
 * Usage (one-shot, depuis web/) :
 *   node scripts/seedIslandGeography.mjs
 *
 * Lit la config Firebase publique depuis web/.env.local. Écriture autorisée par la règle
 * `catalog.write: auth != null` (auth anonyme). Idempotent : ré-exécuter écrase les mêmes clés.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { keccak256, toBytes } from 'viem';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
const env = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const rkey = (id) => id.toLowerCase().replace(/[.#$[\]]/g, '_');
const questIdOf = (slug) => keccak256(toBytes(slug)).toLowerCase();
const MAP_ID = 'map.synk_territory';

// ─────────────────────── Chaîne de montagnes (Nord, contiguë) ───────────────────────
// 6 POI 'mountain' juxtaposés (rayon élargi 12-20) simulant une VRAIE chaîne continue — voir
// poiCap() dans worldTerrain.ts pour l'irrégularité naturelle des sommets (1800-6000m).
//   [id,                         name,                              icon, x,  y,  radius]
const MOUNTAINS = [
  ['poi.chaine_grisemont_1', 'Contrefort de Grisemont', '⛰️', 22, 12, 12],
  ['poi.chaine_grisemont_2', 'Pic du Vent Glacé', '🏔️', 31, 9, 16],
  ['poi.chaine_grisemont_3', 'Aiguille de Frimasse', '🏔️', 40, 11, 18],
  ['poi.chaine_grisemont_4', 'Couronne des Neiges Éternelles', '🏔️', 50, 8, 20],
  ['poi.chaine_grisemont_5', 'Crête du Corbeau Blanc', '🏔️', 60, 12, 16],
  ['poi.chaine_grisemont_6', 'Épaule de Sylvaltide', '⛰️', 68, 9, 12],
];

// ─────────────────────── Mers (Est / Sud-Est) et Océans (Ouest / Nord-Ouest) ───────────────────────
const SEAS_OCEANS = [
  ['poi.mer_orientale', 'sea', 'Mer Orientale', '🌊', 95, 35, 42],
  ['poi.mer_australe', 'sea', 'Mer Australe', '🌊', 88, 85, 42],
  ['poi.ocean_occidental', 'ocean', 'Océan Occidental', '🌐', 4, 35, 48],
  ['poi.ocean_boreal', 'ocean', 'Océan Boréal', '🌐', 8, 8, 46],
];

// ─────────────────────── Lacs (8x8/10x10), étangs (6x6) ───────────────────────
const LAKES_PONDS = [
  ['poi.lac_mirevent_2', 'lake', 'Second Lac de Mirevent', '💧', 45, 55, 10],
  ['poi.lac_khardun', 'lake', 'Lac de Khardûn', '💧', 62, 42, 13],
  ['poi.etang_fangrouille', 'pond', 'Étang de Fangrouille', '🪷', 35, 70, 6],
  ['poi.etang_corenlie', 'pond', 'Étang de Corenlie', '🪷', 55, 25, 6],
  ['poi.etang_valmoria', 'pond', 'Étang de Valmoria', '🪷', 70, 60, 7],
];

// ─────────────────────── Ruisseaux/rivière (chaîne de POI 'stream' en ligne) ───────────────────────
// Simule un cours d'eau qui descend de la chaîne de montagnes jusqu'au lac puis rejoint la mer
// australe — plusieurs dalles 'stream' contiguës (voir demande utilisateur : rectangles dispersés).
const STREAMS = [
  ['poi.riviere_grisemont_1', 'Ruisseau de Grisemont (source)', 40, 25],
  ['poi.riviere_grisemont_2', 'Ruisseau de Grisemont (milieu)', 42, 35],
  ['poi.riviere_grisemont_3', 'Ruisseau de Grisemont (aval)', 44, 45],
  ['poi.riviere_grisemont_4', 'Ruisseau de Grisemont (embouchure)', 45, 52],
  ['poi.riviere_australe_1', "Rivière vers l'Australe (amont)", 55, 65],
  ['poi.riviere_australe_2', "Rivière vers l'Australe (milieu)", 65, 75],
  ['poi.riviere_australe_3', "Rivière vers l'Australe (delta)", 75, 82],
];

// ─────────────────────── Presqu'îles (rattachées au continent) ───────────────────────
const PENINSULAS = [
  ['poi.presquile_ouest', 'Presqu\'île des Embruns', '🏖️', 15, 30, 11],
  ['poi.presquile_sud', 'Presqu\'île de Sablorage', '🏖️', 25, 90, 10],
];

// ─────────────────────── Archipel (3 îles : petite/moyenne/grande) + île moyenne (Sud) + grande île (Est) ───────────────────────
const ISLANDS = [
  ['poi.archipel_petite', 'Petite Île de Ban-Zuu', '🏝️', 90, 58, 9],
  ['poi.archipel_moyenne', 'Île Moyenne de Koraya', '🏝️', 94, 64, 14],
  ['poi.archipel_grande', 'Grande Île de Tao-Lani', '🏝️', 98, 71, 20],
  ['poi.ile_sud', 'Île du Sud de Perle-Verte', '🏝️', 50, 96, 14],
  ['poi.ile_est', "Grande Île de l'Aurore", '🏝️', 97, 20, 20],
];

// ─────────────────────── PNJ indigènes des îles (15) ───────────────────────
// Certains sont liés (questId) à une des 50 quêtes archipel/île sauvage (voir seedIslandQuests.mjs,
// mêmes clés "quest.island_XX") pour garantir une rencontre narrative déterministe ; les autres
// restent de simples PNJ d'ambiance rencontrables au hasard (voir pickNpcQuestForPlayer, pool
// commun à toutes les quêtes npcGiver actives — inchangé, zéro régression).
//   [id,                       name,                          dialog,                                                                 xp,  mapX, mapY, questKey (ou null)]
const ISLAND_NPCS = [
  ['npc.chaman_koraya', 'Chaman Koraya', "Les esprits de la mer m'ont parlé de ton arrivée, étranger des terres vertes...", 80, 94, 64, 'quest.island_01'],
  ['npc.doyenne_banzuu', 'Doyenne Ehiku de Ban-Zuu', "Notre petite île garde plus de secrets que sa taille ne le laisse croire.", 70, 90, 58, 'quest.island_02'],
  ['npc.pecheur_taolani', 'Pêcheur Vaimoana', "Le lagon de Tao-Lani cache un trésor englouti depuis trois générations.", 90, 98, 71, 'quest.island_03'],
  ['npc.gardienne_perleverte', 'Gardienne Nalei de Perle-Verte', "Au sud, notre île veille sur un œuf de créature que nul n'a jamais vu éclore.", 85, 50, 96, 'quest.island_04'],
  ['npc.eclaireur_aurore', "Éclaireur Rangi de l'Aurore", "La Grande Île de l'Aurore fut la première à voir Zorghon fuir vers l'Est.", 95, 97, 20, 'quest.island_05'],
  ['npc.sculpteur_totems', 'Sculpteur de Totems Moehau', "Chaque totem que je grave protège un secret de la forêt de bambous.", 75, 92, 61, 'quest.island_06'],
  ['npc.tisserande_voiles', 'Tisserande Kalani', "Mes voiles ont porté bien des aventuriers vers l'archipel et le large.", 65, 96, 68, 'quest.island_07'],
  ['npc.sage_baobab', 'Sage du Baobab Milu', "Cet arbre a vu plus de saisons que tout le royaume réuni.", 100, 49, 94, 'quest.island_08'],
  ['npc.chasseur_recifs', 'Chasseur de Récifs Tehani', "Les récifs autour de nos îles cachent des créatures qu'aucun livre ne décrit.", 78, 99, 22, 'quest.island_09'],
  ['npc.prtresse_lagon', 'Prêtresse du Lagon Marama', "Le lagon murmure des chants que seule une oreille patiente peut comprendre.", 82, 93, 63, 'quest.island_10'],
  ['npc.forgeron_corail', 'Forgeron de Corail Hoku', "Je forge des lames dans le corail durci par le feu volcanique.", 88, 91, 59, null],
  ['npc.navigatrice_etoiles', 'Navigatrice des Étoiles Anui', "Je lis le ciel pour guider les radeaux entre les îles sans jamais me perdre.", 72, 95, 69, null],
  ['npc.gardien_mangroves', 'Gardien des Mangroves Toa', "Les racines des mangroves protègent notre presqu'île des tempêtes.", 60, 15, 30, null],
  ['npc.conteuse_sablorage', 'Conteuse de Sablorage Fetia', "Je raconte aux enfants la légende de la princesse perdue par-delà les mers.", 68, 25, 90, null],
  ['npc.ancien_grisemont_pic', 'Ancien du Pic Kavika', "Là-haut, l'air se raréfie et seuls les plus braves osent grimper jusqu'au sommet.", 92, 50, 8, null],
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
  const now = Date.now();

  const existingPoisSnap = await get(ref(db, 'catalog/mapPois'));
  const existingPois = existingPoisSnap.val() ? Object.values(existingPoisSnap.val()) : [];
  let nextPoiOrder = existingPois.reduce((mx, p) => Math.max(mx, p.order ?? -1), -1) + 1;

  const writePoi = async (id, type, name, icon, x, y, radius) => {
    const def = {
      id, mapId: MAP_ID, type, name, icon, x, y, active: true, createdAt: now, order: nextPoiOrder,
      ...(radius != null ? { radius } : {}),
    };
    await set(ref(db, `catalog/mapPois/${rkey(id)}`), def);
    console.log(`   + ${icon} ${name} (${type}, r:${radius ?? 'défaut'}) @ (${x},${y})`);
    nextPoiOrder += 1;
  };

  console.log('\n⛰️  Chaîne de montagnes de Grisemont (6 sommets contigus, jusqu\'à 6000 m)...');
  for (const [id, name, icon, x, y, radius] of MOUNTAINS) await writePoi(id, 'mountain', name, icon, x, y, radius);

  console.log('\n🌊 Mers (Est/Sud-Est) et Océans (Ouest/Nord-Ouest)...');
  for (const [id, type, name, icon, x, y, radius] of SEAS_OCEANS) await writePoi(id, type, name, icon, x, y, radius);

  console.log('\n💧 Lacs et étangs...');
  for (const [id, type, name, icon, x, y, radius] of LAKES_PONDS) await writePoi(id, type, name, icon, x, y, radius);

  console.log('\n🏞️  Ruisseaux/rivière (chaîne de dalles contiguës)...');
  for (const [id, name, x, y] of STREAMS) await writePoi(id, 'stream', name, '🏞️', x, y, undefined);

  console.log('\n🏖️  Presqu\'îles...');
  for (const [id, name, icon, x, y, radius] of PENINSULAS) await writePoi(id, 'island', name, icon, x, y, radius);

  console.log('\n🏝️  Archipel + île du Sud + grande île de l\'Est...');
  for (const [id, name, icon, x, y, radius] of ISLANDS) await writePoi(id, 'island', name, icon, x, y, radius);

  console.log('\n🧑‍🤝‍🧑 PNJ indigènes des îles (15)...');
  const existingNpcsSnap = await get(ref(db, 'catalog/npcDefs'));
  const existingNpcs = existingNpcsSnap.val() ? Object.values(existingNpcsSnap.val()) : [];
  let nextNpcOrder = existingNpcs.reduce((mx, n) => Math.max(mx, n.order ?? -1), -1) + 1;
  for (const [id, name, dialog, xp, mapX, mapY, questKey] of ISLAND_NPCS) {
    const def = {
      id, name, dialog, xpReward: xp, active: true, createdAt: now, order: nextNpcOrder, mapX, mapY,
      ...(questKey ? { questId: questIdOf(questKey) } : {}),
    };
    await set(ref(db, `catalog/npcDefs/${rkey(id)}`), def);
    console.log(`   + 🧑 ${name} @ (${mapX},${mapY})${questKey ? ` → ${questKey}` : ''}`);
    nextNpcOrder += 1;
  }

  console.log(`\nTerminé — ${MOUNTAINS.length + SEAS_OCEANS.length + LAKES_PONDS.length + STREAMS.length + PENINSULAS.length + ISLANDS.length} POI géographiques + ${ISLAND_NPCS.length} PNJ indigènes opérationnels.`);
  process.exit(0);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
