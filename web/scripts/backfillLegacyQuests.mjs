/**
 * Backfill anti-double-récompense : pour chaque joueur connu (`playerIndex`), vérifie si les
 * quêtes seedées (`quest.riddle_*`) ont déjà été résolues ON-CHAIN (avant le passage à un
 * système 100% hors-chaîne / Firebase) via `questCompleted(tokenId, questId)`, et si oui,
 * pré-remplit `players/{addr}/quests/{questId}` en base — SANS jamais réappliquer les
 * récompenses (xpBonus/score/reputation), puisqu'elles ont déjà été accordées on-chain
 * historiquement. Ceci empêche un joueur ayant déjà résolu une énigme on-chain de la
 * re-soumettre via le nouveau flux hors-chaîne pour cumuler une seconde récompense.
 *
 * Usage (one-shot, depuis web/, à lancer UNE FOIS juste après avoir déployé le nouveau flux
 * hors-chaîne) :
 *   node scripts/backfillLegacyQuests.mjs
 *
 * Lit web/.env.local pour la config Firebase ET l'adresse du contrat Sepolia + la clé Alchemy
 * optionnelle (mêmes variables NEXT_PUBLIC_* que l'app).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { createPublicClient, http, keccak256, toBytes } from 'viem';
import { sepolia } from 'viem/chains';

const __dirname = dirname(fileURLToPath(import.meta.url));

const envPath = join(__dirname, '..', '.env.local');
const env = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const CONTRACT = env.NEXT_PUBLIC_CONTRACT_ADDRESS_SEPOLIA;
const ALCHEMY_KEY = env.NEXT_PUBLIC_ALCHEMY_KEY;

const LEGACY_QUEST_KEYS = [
  'quest.riddle_first', 'quest.riddle_zelda', 'quest.riddle_mc', 'quest.riddle_wow', 'quest.riddle_dragon',
];

const ABI = [
  { type: 'function', name: 'voxlynOf', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'questCompleted', stateMutability: 'view',
    inputs: [{ type: 'uint256' }, { type: 'bytes32' }], outputs: [{ type: 'bool' }] },
];

async function main() {
  if (!CONTRACT || CONTRACT === '0x0') {
    console.log('⚠ NEXT_PUBLIC_CONTRACT_ADDRESS_SEPOLIA non configuré — rien à backfiller.');
    process.exit(0);
  }

  const app = initializeApp({
    apiKey:      env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain:  env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    databaseURL: env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    projectId:   env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId:       env.NEXT_PUBLIC_FIREBASE_APP_ID,
  });
  await signInAnonymously(getAuth(app));
  const db = getDatabase(app);

  const client = createPublicClient({
    chain: sepolia,
    transport: http(ALCHEMY_KEY ? `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}` : undefined),
  });

  const idxSnap = await get(ref(db, 'playerIndex'));
  const addresses = Object.keys(idxSnap.val() ?? {});
  console.log(`👥 ${addresses.length} joueur(s) connu(s) dans playerIndex.`);

  let backfilled = 0;
  for (const addr of addresses) {
    let tokenId;
    try {
      tokenId = await client.readContract({ address: CONTRACT, abi: ABI, functionName: 'voxlynOf', args: [addr] });
    } catch { continue; }
    if (!tokenId || tokenId === 0n) continue;

    for (const key of LEGACY_QUEST_KEYS) {
      const questId = keccak256(toBytes(key)).toLowerCase();
      const existing = await get(ref(db, `players/${addr}/quests/${questId}`));
      if (existing.exists()) continue; // déjà migré/résolu en base, rien à faire

      const done = await client.readContract({
        address: CONTRACT, abi: ABI, functionName: 'questCompleted', args: [tokenId, questId],
      }).catch(() => false);
      if (!done) continue;

      const answerSnap = await get(ref(db, `catalog/riddleAnswers/${questId}`));
      const answer = answerSnap.val() ?? '(résolue on-chain avant migration)';
      // Backfill SANS applyEffect : la récompense a déjà été créditée on-chain historiquement.
      await set(ref(db, `players/${addr}/quests/${questId}`), { answer, solvedAt: Date.now(), legacyOnchain: true });
      backfilled++;
      console.log(`✅ backfill ${addr} · ${key}`);
    }
  }
  console.log(`\nTerminé — ${backfilled} enregistrement(s) de complétion historique migré(s).`);
  process.exit(0);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
