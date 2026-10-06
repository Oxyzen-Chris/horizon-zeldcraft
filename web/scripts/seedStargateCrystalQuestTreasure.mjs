/**
 * Pousse en base (Firebase RTDB) une quête à énigme ET un trésor récompensant tous deux le
 * « Cristal de la Porte des Étoiles » (`stargate_crystal`, voir DEFAULT_SHOP dans gameState.ts) —
 * objet déjà requis par `RepRules.stargateRequiredItemId` pour actionner la console d'une Porte des
 * étoiles, mais jusqu'ici introuvable autrement qu'en l'achetant en boutique : demande utilisateur
 * « Créer le trésor "Cristal de la Porte des Étoiles" et associe-le à une nouvelle quête pour le
 * gagner, tu mettras également à jour le menu Administration avec cette nouvelle quête et ce
 * nouvel objet ».
 *
 * - `catalog/quests/{id}` : quête CLASSIQUE (pas npcGiver, comme "Gardiens à trois têtes de
 *   chameaux" dans seedInvisibilityQuest.mjs) — visible dans "Quêtes à énigmes" dès que
 *   xpRequired est atteint, sans dépendre d'un tirage PNJ aléatoire.
 * - `catalog/treasureDefs/{id}` : coffre ouvrable une fois le même seuil d'XP atteint (voie
 *   alternative indépendante de la quête — les deux remettent le même `itemReward`).
 *
 * Les DEUX apparaissent immédiatement dans le menu Administration (rubriques "Quêtes existantes"
 * et "Trésors existants", qui listent respectivement catalog/quests et catalog/treasureDefs sans
 * filtrage — voir app/admin/page.tsx::QuestRow/TreasureRow).
 *
 * Usage (one-shot, depuis web/) :
 *   node scripts/seedStargateCrystalQuestTreasure.mjs
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
function rkey(id) {
  return id.toLowerCase().replace(/[.#$[\]]/g, '_');
}

const ITEM_REWARD = {
  itemId: 'stargate_crystal', name: '🔺 Cristal de la Porte des Étoiles', qty: 1, category: 'treasure',
};

const QUEST_KEY = 'quest.stargate_crystal';
const QUEST_LABEL = "🌀 L'Énigme du Voyageur Immobile : Je relie deux mondes sans jamais me déplacer, je m'ouvre à qui porte la pierre qui scintille comme les étoiles, et je tourne sur moi-même avant d'avaler le voyageur. Quel objet dois-tu porter sur toi pour que je m'active ?";
const QUEST_HINT = 'Cherche une pierre taillée, plus précieuse que l\'or, qui porte le nom même du portail qu\'elle active.';
const QUEST_ANSWER = 'cristal';
const QUEST_XP_REQUIRED = 2200;
const QUEST_XP_REWARD = 120;
const QUEST_SCORE_REWARD = 180;

const TREASURE_ID = 'treasure.stargate_crystal';
const TREASURE_NAME = '🔺 Cristal de la Porte des Étoiles';
const TREASURE_XP_REQUIRED = 2600;
const TREASURE_XP_REWARD = 150;

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

  // ─── Quête ───
  const questsSnap = await get(ref(db, 'catalog/quests'));
  const existingQuests = questsSnap.val() ? Object.values(questsSnap.val()) : [];
  const nextQuestOrder = existingQuests.reduce((max, q) => Math.max(max, q.order ?? -1), -1) + 1;

  const questId = keccak256(toBytes(QUEST_KEY)).toLowerCase();
  const normalizedAnswer = normalizeAnswer(QUEST_ANSWER);
  const answerHash = keccak256(toBytes(normalizedAnswer)).toLowerCase();
  const questDef = {
    id: questId, label: QUEST_LABEL, xpRequired: QUEST_XP_REQUIRED, xpReward: QUEST_XP_REWARD,
    scoreReward: QUEST_SCORE_REWARD, answerHash, active: true, createdAt: now, order: nextQuestOrder,
    i18nKey: QUEST_KEY, hint: QUEST_HINT, hintKey: `${QUEST_KEY}.hint`,
    itemReward: ITEM_REWARD,
  };
  await set(ref(db, `catalog/quests/${questId}`), questDef);
  await set(ref(db, `catalog/riddleAnswers/${questId}`), normalizedAnswer);
  console.log(`✅ Quête ${QUEST_KEY} → ${questId} (order ${nextQuestOrder})`);

  // ─── Trésor ───
  const treasuresSnap = await get(ref(db, 'catalog/treasureDefs'));
  const existingTreasures = treasuresSnap.val() ? Object.values(treasuresSnap.val()) : [];
  const nextTreasureOrder = existingTreasures.reduce((max, tr) => Math.max(max, tr.order ?? -1), -1) + 1;

  const treasureDef = {
    id: TREASURE_ID, name: TREASURE_NAME, i18nKey: TREASURE_ID,
    xpRequired: TREASURE_XP_REQUIRED, xpReward: TREASURE_XP_REWARD,
    active: true, createdAt: now, order: nextTreasureOrder,
    itemReward: ITEM_REWARD,
  };
  await set(ref(db, `catalog/treasureDefs/${rkey(TREASURE_ID)}`), treasureDef);
  console.log(`✅ Trésor ${TREASURE_ID} (order ${nextTreasureOrder})`);

  console.log('\nTerminé — les deux entrées récompensent "stargate_crystal" et sont visibles dans');
  console.log('le menu Administration (rubriques "Quêtes existantes" et "Trésors existants").');
  process.exit(0);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
