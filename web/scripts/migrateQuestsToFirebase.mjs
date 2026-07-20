/**
 * Pousse en base (Firebase RTDB, `catalog/quests/{questId}`) les définitions complètes des 5
 * quêtes à énigmes seedées par `contracts/scripts/deploy.ts`, afin que le jeu puisse fonctionner
 * en mode 100% hors-chaîne (catalogue + hash de réponse + récompenses) sans plus jamais lire ni
 * écrire sur la blockchain pour les quêtes (voir `web/src/lib/gameState.ts` : `QuestDef`,
 * `addQuestDef`, `getQuestDefs`, `submitQuestAnswerOffchain`).
 *
 * Usage (one-shot, depuis web/) :
 *   node scripts/migrateQuestsToFirebase.mjs
 *
 * Lit la config Firebase publique depuis web/.env.local (mêmes variables NEXT_PUBLIC_FIREBASE_*
 * que l'app). Écriture autorisée par la règle `catalog.write: auth != null` (auth anonyme).
 *
 * NB : `treasureId` et `minDifficulty` (présents sur le Quest struct Solidity) sont volontairement
 * omis du modèle hors-chaîne `QuestDef` : ils ne sont lus/appliqués par aucun composant front-end
 * (champ mort), voir décision documentée dans l'historique de session.
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

function normalizeAnswer(s) {
  return s.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

//   [id,                 label,                                                              xpReq, xpRew, score, answer]
const QUESTS = [
  ['quest.riddle_first',
    "🪨 Énigme 1 : Je suis dur comme la pierre mais je flotte sur l'eau. Que suis-je ?",
    0, 50, 100, 'glace'],
  ['quest.riddle_zelda',
    "🗡️ Énigme 2 (Zelda) : Quelle arme légendaire scelle le mal à Hyrule ?",
    50, 100, 200, 'master sword'],
  ['quest.riddle_mc',
    "⛏️ Énigme 3 (Minecraft) : Quel bloc dois-je miner pour crafter une pioche en diamant ?",
    100, 150, 300, 'diamant'],
  ['quest.riddle_wow',
    "⚔️ Énigme 4 (WoW) : Quel est le nom de l'épée légendaire forgée à partir des éclats de Thunderaan ?",
    500, 400, 600, 'thunderfury'],
  ['quest.riddle_dragon',
    "🐉 Énigme 5 (Légende draconique) : Selon la légende, de quelle matière scintillante sont faites les écailles des dragons anciens ?",
    1000, 600, 800, 'cristal'],
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

  for (const [key, label, xpRequired, xpReward, scoreReward, answer] of QUESTS) {
    const id = keccak256(toBytes(key)).toLowerCase();
    const answerHash = keccak256(toBytes(normalizeAnswer(answer))).toLowerCase();
    const order = QUESTS.findIndex(q => q[0] === key); // 0..4, ordre d'affichage explicite
    const def = { id, label, xpRequired, xpReward, scoreReward, answerHash, active: true, createdAt: now, order };
    await set(ref(db, `catalog/quests/${id}`), def);
    console.log(`✅ ${key} → ${id} (order ${order})\n   ${label.slice(0, 70)}…`);
  }
  console.log('\nTerminé — catalogue de quêtes 100% hors-chaîne opérationnel.');
  process.exit(0);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
