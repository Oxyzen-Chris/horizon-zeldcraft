/**
 * Pousse en base (Firebase RTDB, `catalog/familiars/{id}`) les Familiers Dragon du jeu, rencontrés
 * sous forme de quête à accomplir à mesure que Synk cumule de l'XP (jusqu'à 100 000 XP).
 *
 * Lore (inspiré de la mythologie draconique classique façon D&D, recherché pour être crédible) :
 * les dragons chromatiques (Blanc = froid/arctique, le moins rusé mais redoutable au corps à corps ;
 * Noir = acide/marais, sournois et corrosif ; Vert = gaz toxique, manipulateur et rusé ;
 * Bleu = foudre/désert, fier et très territorial ; Rouge = feu/volcan, le plus puissant et le plus
 * arrogant/avide de tous) sont malfaisants, tandis que les dragons métalliques (Or = feu/noble/
 * métamorphe, le plus protecteur ; Argent = froid/sage, ami des humains, prend forme humaine ;
 * Bronze = foudre/côtier, curieux et joueur) sont bienveillants. Le Dragon d'Or, le plus noble,
 * reste le premier familier par défaut de Synk (5000 XP). Les autres apparaissent progressivement,
 * du plus commun (Blanc, 8000 XP) au plus rare et puissant (Bronze, 90000 XP), pour garder le jeu
 * jouable et évolutif sur le long terme. Chacun requiert, en plus de l'XP, un objet rare thématique
 * à posséder dans la besace (en vente dans la boutique — voir `DEFAULT_SHOP` dans gameState.ts).
 *
 * Usage (one-shot, depuis web/) :
 *   node scripts/migrateFamiliarsToFirebase.mjs
 *
 * Lit la config Firebase publique depuis web/.env.local (mêmes variables NEXT_PUBLIC_FIREBASE_*
 * que l'app). Écriture autorisée par la règle `catalog.write: auth != null` (auth anonyme).
 * Idempotent : ré-exécuter ce script écrase simplement les mêmes clés avec les mêmes valeurs.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Charge web/.env.local (parsing minimal, sans dépendance dotenv) ──
const envPath = join(__dirname, '..', '.env.local');
const env = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

//   [id,              label,                       xpRequired, requiredItemId,           i18nKey,                combatDamage, combatDefense]
const FAMILIARS = [
  ['dragon.gold',   '🐲 Dragon d\'Or',      5000,  'ecaille_semaphore',       'familiar.dragon_gold',   15, 25],
  ['dragon.white',  '🐉 Dragon Blanc',      8000,  'griffe_gel_eternel',      'familiar.dragon_white',   8, 12],
  ['dragon.black',  '🐉 Dragon Noir',       15000, 'larme_marais_noir',       'familiar.dragon_black',  14, 10],
  ['dragon.green',  '🐉 Dragon Vert',       22000, 'ecaille_ronce_venin',     'familiar.dragon_green',  16, 12],
  ['dragon.blue',   '🐉 Dragon Bleu',       32000, 'eclat_orage_saphir',      'familiar.dragon_blue',   20, 16],
  ['dragon.red',    '🐉 Dragon Rouge',      45000, 'braise_coeur_volcan',     'familiar.dragon_red',    28, 18],
  ['dragon.silver', '🐉 Dragon d\'Argent',  65000, 'plume_givre_lunaire',     'familiar.dragon_silver', 24, 32],
  ['dragon.bronze', '🐉 Dragon de Bronze',  90000, 'perle_abysse_electrique', 'familiar.dragon_bronze', 26, 38],
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

  for (const [id, label, xpRequired, requiredItemId, i18nKey, combatDamage, combatDefense] of FAMILIARS) {
    const order = FAMILIARS.findIndex((f) => f[0] === id); // 0..n, ordre d'affichage explicite
    const key = id.toLowerCase().replace(/[.#$[\]]/g, '_'); // clé RTDB valide (Firebase interdit ".#$[]")
    // RTDB refuse toute valeur `undefined` explicite (déjà rencontré comme bug de push) : on omet
    // la clé requiredItemId plutôt que de la laisser à `undefined` quand le dragon n'a pas d'objet requis.
    const def = { id, label, xpRequired, active: true, createdAt: now, order, i18nKey, combatDamage, combatDefense };
    if (requiredItemId) def.requiredItemId = requiredItemId;
    await set(ref(db, `catalog/familiars/${key}`), def);
    console.log(`✅ ${id} → ${key} (order ${order}) — ${label} · ${xpRequired} XP · ⚔️${combatDamage}/🛡️${combatDefense}${requiredItemId ? ` + objet "${requiredItemId}"` : ''}`);
  }
  console.log('\nTerminé — catalogue de familiers 100% hors-chaîne opérationnel.');
  process.exit(0);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
