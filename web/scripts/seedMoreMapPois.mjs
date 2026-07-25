/**
 * Ajoute 19 nouveaux points d'intérêt (Firebase RTDB, `catalog/mapPois/{id}`) sur la carte du
 * territoire de Synk, en complément des 30 déjà seedés par `seedMapToFirebase.mjs` — plus de
 * variété/densité sur la carte, et 4 d'entre eux tagués `season` (un par saison : printemps, été,
 * automne, hiver) pour illustrer concrètement le nouveau système de saisons tournantes (voir
 * gameState.ts::Season/getCurrentSeason, WorldMapWidget.tsx). Un décor saisonnier n'apparaît sur
 * la carte que pendant sa saison, sauf s'il a déjà été découvert par le joueur (voir
 * `visiblePois` dans WorldMapWidget.tsx) — une fois trouvé, il reste visible toute l'année.
 *
 * Usage (one-shot, depuis web/) :
 *   node scripts/seedMoreMapPois.mjs
 *
 * Lit la config Firebase publique depuis web/.env.local (mêmes variables NEXT_PUBLIC_FIREBASE_*
 * que l'app). Écriture autorisée par la règle `catalog.write: auth != null` (auth anonyme).
 * Idempotent : ré-exécuter ce script écrase simplement les mêmes clés avec les mêmes valeurs.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';

const __dirname = dirname(fileURLToPath(import.meta.url));

const envPath = join(__dirname, '..', '.env.local');
const env = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const rkey = (id) => id.toLowerCase().replace(/[.#$[\]]/g, '_');
const MAP_ID = 'map.synk_territory';

// 15 nouveaux décors "toute saison" — plus de variété/densité sur la carte.
//   [id,                            type,            name,                            icon, x,  y]
const POIS = [
  ['poi.plaine_emeraude',        'plain',        "Plaine d'Émeraude",             '🌾', 15, 20],
  ['poi.ruisseau_cristal',       'stream',       'Ruisseau de Cristal',           '🏞️', 48, 20],
  ['poi.lac_tempete',            'lake',         'Lac de la Tempête',             '💧', 75, 70],
  ['poi.mont_dragon',            'mountain',     'Mont du Dragon Endormi',        '🌋', 95, 45],
  ['poi.foret_enchantee',        'forest',       'Forêt Enchantée',               '🌳', 5,  30],
  ['poi.grotte_glace',           'cave',         'Grotte de Glace Éternelle',     '🧊', 90, 10],
  ['poi.plage_lune',             'beach',        'Plage sous la Lune',            '🏖️', 95, 95],
  ['poi.chute_dragon',           'waterfall',    'Chute du Dragon',               '💦', 10, 10],
  ['poi.village_saules',         'village_ally', 'Village des Saules',            '🏘️', 55, 85],
  ['poi.repaire_necromancien',   'village_enemy', 'Repaire du Nécromancien',      '💀', 5,  50],
  ['poi.chemin_etoiles',         'path',         'Chemin des Étoiles',            '🛤️', 68, 12],
  ['poi.pont_geants',            'bridge',       'Pont des Géants',               '🌉', 33, 85],
  ['poi.taverne_licorne',        'tavern',       'Taverne de la Licorne',         '🍺', 10, 65],
  ['poi.etable_pegase',          'stable',       'Étable du Pégase',              '🦄', 78, 30],
  ['poi.hutte_druide',           'hut',          'Hutte du Druide',               '🛖', 60, 90],
];

// 4 décors saisonniers (un par saison) — visibles uniquement pendant leur saison tant que non
// découverts (voir `season` sur MapPoiDef).
//   [id,                       type,      name,                     icon, x,  y,  season]
const SEASONAL_POIS = [
  ['poi.bosquet_fleuri',    'forest', 'Bosquet en Fleurs',        '🌸', 32, 22, 'spring'],
  ['poi.oasis_estivale',    'beach',  'Oasis Estivale',           '🏝️', 68, 88, 'summer'],
  ['poi.verger_automnal',   'plain',  "Verger d'Automne",         '🍁', 52, 78, 'autumn'],
  ['poi.lac_gele',          'lake',   'Lac Gelé Éternel',         '❄️', 80, 8,  'winter'],
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

  const existingSnap = await get(ref(db, 'catalog/mapPois'));
  const existing = existingSnap.val() ? Object.values(existingSnap.val()) : [];
  let nextOrder = existing.reduce((mx, p) => Math.max(mx, p.order ?? -1), -1) + 1;

  console.log('\n📍 Nouveaux points d\'intérêt (toute saison)...');
  for (const [id, type, name, icon, x, y] of POIS) {
    const def = { id, mapId: MAP_ID, type, name, icon, x, y, active: true, createdAt: now, order: nextOrder };
    await set(ref(db, `catalog/mapPois/${rkey(id)}`), def);
    console.log(`   + ${icon} ${name} (${type}) @ (${x},${y})`);
    nextOrder += 1;
  }

  console.log('\n🍂 Nouveaux points d\'intérêt saisonniers...');
  for (const [id, type, name, icon, x, y, season] of SEASONAL_POIS) {
    const def = { id, mapId: MAP_ID, type, name, icon, x, y, active: true, createdAt: now, order: nextOrder, season };
    await set(ref(db, `catalog/mapPois/${rkey(id)}`), def);
    console.log(`   + ${icon} ${name} (${type}, saison: ${season}) @ (${x},${y})`);
    nextOrder += 1;
  }

  console.log(`\nTerminé — ${POIS.length + SEASONAL_POIS.length} nouveaux POI ajoutés (dont ${SEASONAL_POIS.length} saisonniers).`);
  process.exit(0);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
