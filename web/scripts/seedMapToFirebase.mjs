/**
 * Pousse en base (Firebase RTDB, `catalog/maps|mapPois/{id}`) la carte du territoire de Synk
 * (mapmonde style vieux parchemin — voir `WorldMapWidget.tsx`) : la carte elle-même
 * (`map.synk_territory`), une trentaine de points d'intérêt décoratifs/terrain (plaines,
 * ruisseaux, lacs, montagnes, forêts, grottes, plages, chutes d'eau, villages amis/ennemis,
 * chemins, ponts de lianes, tavernes, étables, huttes/hôtels) dispersés sur la grille 0-100, et
 * met à jour (via `update()`, pas `set()` — seuls 3 champs à corriger, le reste du WorldDef
 * existant doit être préservé) les 10 `catalog/worldDefs/{id}` déjà seedés par
 * `migrateNpcsTreasuresWorldsToFirebase.mjs` avec leur position sur la carte (`mapX`/`mapY`) et
 * l'engin requis pour un voyage rapide (`vehicleItemId` — objet déjà existant dans la besace,
 * voir `seedEquipmentCatalog.mjs` ; sans cet objet le joueur peut quand même s'y rendre à pied,
 * plus lentement et avec un risque de rencontre nocturne — voir `WorldMapWidget.tsx`).
 *
 * Usage (one-shot, depuis web/) :
 *   node scripts/seedMapToFirebase.mjs
 *
 * Lit la config Firebase publique depuis web/.env.local (mêmes variables NEXT_PUBLIC_FIREBASE_*
 * que l'app). Écriture autorisée par la règle `catalog.write: auth != null` (auth anonyme).
 * Idempotent : ré-exécuter ce script écrase simplement les mêmes clés avec les mêmes valeurs.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, update } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Charge web/.env.local (parsing minimal, sans dépendance dotenv) ──
const envPath = join(__dirname, '..', '.env.local');
const env = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

/** Clé RTDB sûre — identique à RKEY() dans gameState.ts. */
const rkey = (id) => id.toLowerCase().replace(/[.#$[\]]/g, '_');

const MAP_ID = 'map.synk_territory';

// 30 points d'intérêt dispersés sur la grille 0-100 (x, y), couvrant les 15 types.
//   [id,                          mapId,   type,           name,                        icon, x,  y]
const POIS = [
  ['poi.plaine_synk',            MAP_ID, 'plain',        'Plaine de Synk',              '🌾', 45, 45],
  ['poi.plaine_aurore',          MAP_ID, 'plain',        "Plaine de l'Aurore",           '🌾', 30, 50],
  ['poi.ruisseau_argent',        MAP_ID, 'stream',       "Ruisseau d'Argent",            '🏞️', 35, 65],
  ['poi.ruisseau_murmurant',     MAP_ID, 'stream',       'Ruisseau Murmurant',           '🏞️', 60, 40],
  ['poi.lac_bleu',               MAP_ID, 'lake',         'Lac Bleu Céleste',             '💧', 22, 60],
  ['poi.lac_miroir',             MAP_ID, 'lake',         'Lac Miroir',                   '💧', 65, 25],
  ['poi.mont_corbeau',           MAP_ID, 'mountain',     'Mont du Corbeau',              '⛰️', 82, 22],
  ['poi.pic_gele',               MAP_ID, 'mountain',     'Pic Gelé',                     '🏔️', 88, 18],
  ['poi.foret_zephyria',         MAP_ID, 'forest',       'Forêt de Zephyria',            '🌲', 12, 78],
  ['poi.foret_sombre',           MAP_ID, 'forest',       'Forêt Sombre',                 '🌳', 18, 40],
  ['poi.grotte_cristal',         MAP_ID, 'cave',         'Grotte de Nether-Cristal',     '🕳️', 27, 58],
  ['poi.grotte_echos',           MAP_ID, 'cave',         'Grotte des Échos',             '🕳️', 70, 62],
  ['poi.plage_doree',            MAP_ID, 'beach',        'Plage Dorée',                  '🏖️', 8, 85],
  ['poi.plage_corail',           MAP_ID, 'beach',        'Plage de Corail',              '🏖️', 92, 88],
  ['poi.chute_larmes',           MAP_ID, 'waterfall',    'Chute des Larmes',             '💦', 55, 68],
  ['poi.chute_arc_ciel',         MAP_ID, 'waterfall',    "Chute de l'Arc-en-Ciel",       '💦', 78, 40],
  ['poi.village_hobbiton',       MAP_ID, 'village_ally',  'Village de Hobbiton',          '🏘️', 38, 55],
  ['poi.village_lunargent',      MAP_ID, 'village_ally',  "Village de Lunargent",         '🏘️', 15, 60],
  ['poi.village_gobelins',       MAP_ID, 'village_enemy', 'Camp des Gobelins',            '💀', 72, 78],
  ['poi.village_orcs',           MAP_ID, 'village_enemy', "Campement d'Orcs",             '💀', 85, 55],
  ['poi.chemin_ancien',          MAP_ID, 'path',         'Chemin Ancien',                '🛤️', 42, 50],
  ['poi.route_marchands',        MAP_ID, 'path',         'Route des Marchands',          '🛤️', 50, 30],
  ['poi.pont_lianes_est',        MAP_ID, 'bridge',       'Pont de Lianes Est',           '🌉', 58, 60],
  ['poi.pont_lianes_ouest',      MAP_ID, 'bridge',       'Pont de Lianes Ouest',         '🌉', 20, 48],
  ['poi.taverne_dragon_ivre',    MAP_ID, 'tavern',       'Taverne du Dragon Ivre',       '🍺', 40, 42],
  ['poi.taverne_sirene',         MAP_ID, 'tavern',       'Taverne de la Sirène',         '🍺', 25, 70],
  ['poi.etable_cheval_blanc',    MAP_ID, 'stable',       'Étable du Cheval Blanc',       '🐴', 44, 38],
  ['poi.etable_griffon',         MAP_ID, 'stable',       'Étable du Griffon',            '🦅', 63, 45],
  ['poi.hutte_ermite',           MAP_ID, 'hut',          "Hutte de l'Ermite",            '🛖', 30, 35],
  ['poi.hotel_repos_voyageur',   MAP_ID, 'hut',          'Hôtel du Repos du Voyageur',   '🏨', 48, 60],
];

// Position (x, y en %) et engin requis pour un voyage rapide (déjà présent dans le catalogue
// d'équipement — sans lui, voyage possible à pied mais plus long et risqué de nuit).
//   [id,                          x,  y,  vehicleItemId]
const WORLD_POSITIONS = [
  ['world.zephyria',            10, 80, 'char_voile'],
  ['world.nether_cristal',      25, 60, 'barque'],
  ['world.azerothyl',           40, 30, 'char_voile'],
  ['world.nexus',               60, 15, 'montgolf'],
  ['world.ember_wastes',        75, 55, 'mototaupe'],
  ['world.frostfall_peaks',     85, 20, 'montgolf'],
  ['world.shadowmere_marsh',    20, 25, 'barque'],
  ['world.skyreach_spire',      55, 70, 'montgolf'],
  ['world.stargate_aethyria',   90, 80, 'obj_aeronef_zephyr_eternel'],
  ['world.eternum_sanctum',     50, 50, 'obj_aeronef_zephyr_eternel'],
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

  console.log('\n🗺️  Carte du territoire de Synk...');
  await set(ref(db, `catalog/maps/${rkey(MAP_ID)}`), {
    id: MAP_ID, name: 'Territoire de Synk', i18nKey: 'map.title',
    active: true, createdAt: now, order: 0,
  });
  console.log(`   + ${MAP_ID}`);

  console.log('\n📍 Points d\'intérêt...');
  for (const [id, mapId, type, name, icon, x, y] of POIS) {
    const order = POIS.findIndex((p) => p[0] === id);
    const def = { id, mapId, type, name, icon, x, y, active: true, createdAt: now, order };
    await set(ref(db, `catalog/mapPois/${rkey(id)}`), def);
    console.log(`   + ${icon} ${name} (${type}) @ (${x},${y})`);
  }

  console.log('\n🚀 Positionnement des mondes sur la carte...');
  for (const [id, mapX, mapY, vehicleItemId] of WORLD_POSITIONS) {
    await update(ref(db, `catalog/worldDefs/${rkey(id)}`), { mapId: MAP_ID, mapX, mapY, vehicleItemId });
    console.log(`   ~ ${id} @ (${mapX},${mapY}) — engin : ${vehicleItemId}`);
  }

  console.log('\nTerminé — mapmonde et positions des mondes opérationnels.');
  process.exit(0);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
