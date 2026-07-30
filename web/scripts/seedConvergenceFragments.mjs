/**
 * "Quête de Convergence" — verrouille la toute dernière Quête du Royaume (chapitre 40 "La Chute
 * de Zorghon", `quest.kingdom.ch40.moon`, kingdomOrder 400) derrière la possession de 5 reliques
 * déjà distribuées par les Quêtes du Royaume des chapitres 35 à 39 (Forge Infernale, Jardins
 * Calcinés, Grand Escalier Noir, Salle du Trône Déchu, Cœur de la Citadelle).
 *
 * Ce script NE CRÉE AUCUN NOUVEL OBJET : il relit les 5 `itemReward.itemId`/`name` réellement
 * poussés en base par seedKingdomQuests.mjs (aucune supposition sur le slug exact) et les
 * réutilise tels quels comme "Fragments du Sceau Runique" (voir QuestDef.requiresItems dans
 * src/lib/gameState.ts). Le joueur doit donc avoir progressé et résolu ces 5 chapitres avant de
 * pouvoir valider la quête finale — un niveau de complexité additionnel purement narratif, sans
 * toucher au mécanisme de lancer de dés (réservé à une future demande explicite de l'utilisateur).
 *
 * Écriture par `update()` (jamais `set()`) sur le seul document `catalog/quests/{id}` de la quête
 * finale : tous les autres champs (label, hint, itemReward "Titre de Libérateur du Royaume",
 * fullMoonOnly, kingdomOrder…) restent strictement inchangés — zéro régression sur les 400 Quêtes
 * du Royaume déjà seedées.
 *
 * Usage (one-shot, idempotent, depuis web/) :
 *   node scripts/seedConvergenceFragments.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, update } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { keccak256, toBytes } from 'viem';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
const env = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

// Chapitres fournisseurs de fragments (5 derniers chapitres avant la chute finale de Zorghon).
const FRAGMENT_CHAPTERS = [35, 36, 37, 38, 39];
const FINAL_QUEST_KEY = 'quest.kingdom.ch40.moon';

function questId(key) {
  return keccak256(toBytes(key)).toLowerCase();
}

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

  const requiresItems = [];
  for (const chapterNum of FRAGMENT_CHAPTERS) {
    const pad = String(chapterNum).padStart(2, '0');
    const key = `quest.kingdom.ch${pad}.item`;
    const id = questId(key);
    // eslint-disable-next-line no-await-in-loop
    const snap = await get(ref(db, `catalog/quests/${id}`));
    const def = snap.val();
    if (!def || !def.itemReward || !def.itemReward.itemId) {
      throw new Error(`Quête introuvable ou sans itemReward : ${key} (id=${id}). Lance d'abord seedKingdomQuests.mjs.`);
    }
    requiresItems.push({ itemId: def.itemReward.itemId, qty: 1, name: `🧩 Fragment du Sceau Runique — ${def.itemReward.name.replace(/^💎\s*/, '')}` });
    console.log(`  ✓ Fragment chapitre ${chapterNum} : ${def.itemReward.itemId} (${def.itemReward.name})`);
  }

  const finalId = questId(FINAL_QUEST_KEY);
  const finalSnap = await get(ref(db, `catalog/quests/${finalId}`));
  const finalDef = finalSnap.val();
  if (!finalDef) {
    throw new Error(`Quête finale introuvable : ${FINAL_QUEST_KEY} (id=${finalId}). Lance d'abord seedKingdomQuests.mjs.`);
  }

  await update(ref(db, `catalog/quests/${finalId}`), { requiresItems });
  console.log(`\n✅ Quête finale "${finalDef.label}" (kingdomOrder ${finalDef.kingdomOrder}) verrouillée derrière ${requiresItems.length} Fragments du Sceau Runique.`);
  console.log('   Les 5 chapitres 35-39 doivent être résolus (fragments récupérés) avant de pouvoir libérer PocaPoka et El Pipo.');
  process.exit(0);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
