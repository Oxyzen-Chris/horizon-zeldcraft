/**
 * Pousse en base (Firebase RTDB, `catalog/riddleAnswers/{questId}`) les réponses des 5 énigmes
 * seedées par `contracts/scripts/deploy.ts`, afin que `QuestList` puisse révéler la réponse
 * d'une quête déjà résolue on-chain AVANT l'existence du mécanisme `markQuestSolved`
 * (ou si l'écriture Firebase du joueur a échoué), SANS jamais exposer ces réponses en clair
 * dans le bundle JS client (seul le hash keccak256 vit sur la blockchain).
 *
 * Usage (one-shot, depuis web/) :
 *   node scripts/seedRiddleAnswers.mjs
 *
 * Lit la config Firebase publique depuis web/.env.local (mêmes variables NEXT_PUBLIC_FIREBASE_*
 * que l'app). Écriture autorisée par la règle `catalog.write: auth != null` (auth anonyme).
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

// id → réponse (normalisée : minuscules, sans accents — voir normalizeAnswer() côté app)
const RIDDLE_ANSWERS = {
  'quest.riddle_first':  'glace',
  'quest.riddle_zelda':  'master sword',
  'quest.riddle_mc':     'diamant',
  'quest.riddle_wow':    'thunderfury',
  'quest.riddle_dragon': 'cristal',
};

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

  for (const [questKey, answer] of Object.entries(RIDDLE_ANSWERS)) {
    const questId = keccak256(toBytes(questKey)).toLowerCase();
    await set(ref(db, `catalog/riddleAnswers/${questId}`), answer);
    console.log(`✅ ${questKey} → ${questId} = "${answer}"`);
  }
  console.log('\nTerminé.');
  process.exit(0);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
