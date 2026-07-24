/**
 * Pousse en base (Firebase RTDB, `catalog/quests/{questId}`) la quête rare "Gardiens à trois têtes
 * de chameaux" qui récompense la Cape d'invisibilité (`cape_invisibilite`, voir
 * seedEquipmentCatalog.mjs) — celle-ci permet de franchir discrètement les passages dangereux
 * gardés par ces créatures pendant 10 à 15 minutes (voir activateInvisibility dans gameState.ts).
 *
 * Quête "classique" (pas npcGiver) : visible dans "Quêtes à énigmes" dès que xpRequired est
 * atteint, comme les 5 énigmes historiques. 100% hors-chaîne, zéro gas. `answerHash` seul est
 * stocké dans le catalogue ; la réponse en clair va dans `catalog/riddleAnswers/{questId}`
 * (jamais exposée aux joueurs — voir getAllQuestAnswers, réservé au menu Administration).
 *
 * Usage (one-shot, depuis web/) :
 *   node scripts/seedInvisibilityQuest.mjs
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

function normalizeAnswer(s) {
  return s.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

const KEY = 'quest.guardians_camel';
const LABEL = "🐫 Gardiens à trois têtes de chameaux : Trois têtes je porte, trois regards je pose sur qui ose approcher de mon trésor. Seul celui qui se rend invisible à mes six yeux peut me franchir sans combattre. Que dois-tu devenir pour me tromper ?";
const HINT = "Ni bouclier ni épée ne t'aideront ici — il te faut disparaître de leur vue.";
const ANSWER = 'invisible';
const XP_REQUIRED = 6000;
const XP_REWARD = 300;
const SCORE_REWARD = 450;

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

  const existingSnap = await get(ref(db, 'catalog/quests'));
  const existing = existingSnap.val() ? Object.values(existingSnap.val()) : [];
  const nextOrder = existing.reduce((max, q) => Math.max(max, q.order ?? -1), -1) + 1;

  const id = keccak256(toBytes(KEY)).toLowerCase();
  const normalized = normalizeAnswer(ANSWER);
  const answerHash = keccak256(toBytes(normalized)).toLowerCase();
  const def = {
    id, label: LABEL, xpRequired: XP_REQUIRED, xpReward: XP_REWARD, scoreReward: SCORE_REWARD,
    answerHash, active: true, createdAt: now, order: nextOrder, i18nKey: KEY,
    hint: HINT, hintKey: `${KEY}.hint`,
    // Champs d'équipement alignés sur cape_invisibilite dans seedEquipmentCatalog.mjs/DEFAULT_SHOP —
    // sans quoi la cape obtenue via cette quête restait un simple consommable non glissable/
    // équipable vers la fenêtre Équipement de Synk, contrairement à celle achetée en boutique.
    itemReward: {
      itemId: 'cape_invisibilite', name: "🫥 Cape d'invisibilité", qty: 1, category: 'armor',
      slot: 'amulet', rarity: 'epic', defense: 20, durabilityMax: 6, effect: { invisibleMinutes: 12 },
    },
  };
  await set(ref(db, `catalog/quests/${id}`), def);
  await set(ref(db, `catalog/riddleAnswers/${id}`), normalized);
  console.log(`✅ ${KEY} → ${id} (order ${nextOrder}) — récompense : Cape d'invisibilité`);
  console.log('\nTerminé.');
  process.exit(0);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
