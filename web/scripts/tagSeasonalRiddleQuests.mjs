/**
 * Migration ciblée (one-shot) : ajoute le champ `season` aux 4 quêtes à énigmes PNJ déjà
 * saisonnières par leur contenu (`quest.npc_riddle_13`..`16` — printemps/été/automne/hiver, voir
 * seedNpcRiddleQuests.mjs). Utilise `update()` (et non `set()`) pour ne modifier QUE le champ
 * `season` de chaque quête, sans jamais toucher/écraser ses autres champs (label, answerHash,
 * xpReward, hint, order, etc.) — voir la remarque dans gameState.ts sur le risque d'écrasement
 * complet des enregistrements Firebase.
 *
 * Usage (one-shot, depuis web/) :
 *   node scripts/tagSeasonalRiddleQuests.mjs
 *
 * Lit la config Firebase publique depuis web/.env.local (mêmes variables NEXT_PUBLIC_FIREBASE_*
 * que l'app). Écriture autorisée par la règle `catalog.write: auth != null` (auth anonyme).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, update, get } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { keccak256, toBytes } from 'viem';

const __dirname = dirname(fileURLToPath(import.meta.url));

const envPath = join(__dirname, '..', '.env.local');
const env = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

// [clé i18n de la quête, saison]
const SEASONAL_RIDDLES = [
  ['quest.npc_riddle_13', 'spring'],
  ['quest.npc_riddle_14', 'summer'],
  ['quest.npc_riddle_15', 'autumn'],
  ['quest.npc_riddle_16', 'winter'],
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

  for (const [key, season] of SEASONAL_RIDDLES) {
    const id = keccak256(toBytes(key)).toLowerCase();
    const snap = await get(ref(db, `catalog/quests/${id}`));
    if (!snap.exists()) {
      console.warn(`⚠️  ${key} → ${id} introuvable en base, ignoré (as-tu lancé seedNpcRiddleQuests.mjs ?).`);
      continue;
    }
    await update(ref(db, `catalog/quests/${id}`), { season });
    console.log(`✅ ${key} → ${id} taggé saison "${season}"`);
  }
  console.log('\nTerminé — 4 quêtes à énigmes saisonnières taguées (season).');
  process.exit(0);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
