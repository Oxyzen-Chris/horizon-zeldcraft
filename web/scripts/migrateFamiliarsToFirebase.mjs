/**
 * Pousse en base (Firebase RTDB, `catalog/familiars/{id}`) le premier Familier du jeu : un Dragon
 * d'Or, rencontré sous forme de quête à accomplir dès 5000 XP cumulés, à condition de posséder
 * dans sa besace l'objet rare "Écaille de Sémaphore Écarlate" (en vente dans la boutique).
 *
 * Lore (inspiré de la mythologie draconique classique façon D&D) : les dragons chromatiques
 * (Rouge = feu, Noir = acide/marais, Vert = gaz toxique/ruse, Bleu = foudre/désert) sont malfaisants,
 * tandis que les dragons métalliques (Or = feu/noble/métamorphe, Argent = froid/sage, Bronze = foudre/
 * côtier, Cuivre = acide, Airain = feu/désert) sont bienveillants. Le Dragon d'Or, le plus noble et
 * protecteur des dragons métalliques, est choisi comme premier familier par défaut de Synk.
 *
 * Usage (one-shot, depuis web/) :
 *   node scripts/migrateFamiliarsToFirebase.mjs
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

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Charge web/.env.local (parsing minimal, sans dépendance dotenv) ──
const envPath = join(__dirname, '..', '.env.local');
const env = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

//   [id,            label,                     xpRequired, requiredItemId, i18nKey]
const FAMILIARS = [
  ['dragon.gold', '🐲 Dragon d\'Or', 5000, 'ecaille_semaphore', 'familiar.dragon_gold'],
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

  for (const [id, label, xpRequired, requiredItemId, i18nKey] of FAMILIARS) {
    const order = FAMILIARS.findIndex((f) => f[0] === id); // 0..n, ordre d'affichage explicite
    const key = id.toLowerCase().replace(/[.#$[\]]/g, '_'); // clé RTDB valide (Firebase interdit ".#$[]")
    const def = { id, label, xpRequired, requiredItemId, active: true, createdAt: now, order, i18nKey };
    await set(ref(db, `catalog/familiars/${key}`), def);
    console.log(`✅ ${id} → ${key} (order ${order}) — ${label} · ${xpRequired} XP + objet "${requiredItemId}"`);
  }
  console.log('\nTerminé — catalogue de familiers 100% hors-chaîne opérationnel.');
  process.exit(0);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
