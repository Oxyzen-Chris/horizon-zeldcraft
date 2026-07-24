/**
 * Pousse en base (Firebase RTDB, `catalog/npcDefs|treasureDefs|worldDefs/{id}`) les PNJ officiels,
 * trésors et mondes seedés à l'origine par `contracts/scripts/deploy.ts` (et `scripts/addWorlds.ts`
 * pour les 6 mondes étendus), afin que ces 3 catalogues fonctionnent en mode 100% hors-chaîne et
 * deviennent réellement modifiables depuis le menu Administration — voir `web/src/lib/gameState.ts`
 * (NpcDef/TreasureDef/WorldDef, addNpcDef/addTreasureDef/addWorldDef).
 *
 * Le contrat Solidity n'expose, pour ces 3 entités, que des fonctions de CRÉATION
 * (`addNpc`/`addTreasure`/`addWorld`, chacune avec `require(!x[id].active, "exists")`) — aucune
 * fonction de mise à jour d'un champ existant, ce qui rendait "modifiable" impossible sans
 * redéploiement du contrat.
 *
 * Les trésors n'ont, côté on-chain, qu'un XP de récompense (`xpReward`), pas de seuil de
 * découverte : leur ouverture n'était déclenchée que par l'ancien `submitQuestAnswer` on-chain
 * (lien `treasureId` sur une quête), mécanisme abandonné depuis la migration des quêtes vers
 * `submitQuestAnswerOffchain` (qui ne relie plus de trésor). On leur ajoute donc ici un seuil
 * `xpRequired` (comme les mondes) pour une ouverture manuelle une fois le seuil atteint — voir
 * `TreasureList.tsx`.
 *
 * Usage (one-shot, depuis web/) :
 *   node scripts/migrateNpcsTreasuresWorldsToFirebase.mjs
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
import { keccak256, toBytes } from 'viem';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Charge web/.env.local (parsing minimal, sans dépendance dotenv) ──
const envPath = join(__dirname, '..', '.env.local');
const env = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

/** Hash keccak256 d'un slug texte (ex. "quest.riddle_zelda") — même calcul que
 * migrateQuestsToFirebase.mjs, pour retrouver l'id Firebase des 5 quêtes classiques. */
const questId = (slug) => keccak256(toBytes(slug)).toLowerCase();

/** Clé RTDB sûre — identique à RKEY() dans gameState.ts (les segments de chemin Firebase
 * interdisent ".", "#", "$", "[", "]", d'où le remplacement des points des ids hérités on-chain
 * comme "npc.zelda_princess"). Le champ `id` d'origine (avec points) reste stocké tel quel. */
const rkey = (id) => id.toLowerCase().replace(/[.#$[\]]/g, '_');

//   [id,                     name,                          dialog,                                                                  xpReward, questKey]
const NPCS = [
  ['npc.zelda_princess', 'Princesse Zelda',       "Bienvenue, jeune dresseur ! J'ai une énigme pour toi…", 30, 'quest.riddle_zelda'],
  ['npc.steve',          'Steve le Mineur',       "Yo ! T'as vu mes diamants ?",                            20, 'quest.riddle_mc'],
  ['npc.thrall',         'Thrall (Chef de la Horde)', "Lok'tar Ogar, jeune Voxlyn !",                        50, 'quest.riddle_wow'],
  ['npc.merchant',       'Marchand ambulant',     "J'ai des potions rares… mais il te faudra résoudre mon énigme.", 15, 'quest.riddle_first'],
  ['npc.ancient_dragon', 'Dragon Ancestral',      "Prouve-moi que tu es digne de ma sagesse.",              100, 'quest.riddle_dragon'],
];

// xpRequired repris des seuils des 5 quêtes classiques auxquelles chaque trésor était relié
// on-chain (treasureId sur Quest), pour conserver la même progression narrative.
//   [id,                          name,                          xpRequired, xpReward]
const TREASURES = [
  ['treasure.rupees',            'Bourse de rubis',                0,    30],
  ['treasure.master_sword',      'Épée de maître (Zelda)',         50,    100],
  ['treasure.diamond_pickaxe',   'Pioche en diamant (MC)',        100,    80],
  ['treasure.thunderfury',       'Thunderfury (WoW)',             500,    500],
  ['treasure.dragon_egg',        'Œuf de dragon ancien',         1000,    250],
];

//   [id,                          name,                                  xpRequired]
const WORLDS = [
  ['world.zephyria',            'Forêt de Zephyria',                   0],
  ['world.nether_cristal',      'Grottes de Nether-Cristal',            200],
  ['world.azerothyl',           "Sanctuaire d'Azerothyl",               1000],
  ['world.nexus',               'Nexus Temporel',                       5000],
  ['world.ember_wastes',        "Landes Cendrées d'Ember",               10000],
  ['world.frostfall_peaks',     'Pics Gelés de Frostfall',               20000],
  ['world.shadowmere_marsh',    'Marécages de Shadowmere',               35000],
  ['world.skyreach_spire',      'Flèche Céleste de Skyreach',            50000],
  ['world.stargate_aethyria',   "Portail des Étoiles d'Aethyria",        75000],
  ['world.eternum_sanctum',     'Sanctuaire Éternel d\'Eternum',         100000],
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

  console.log('\n🧙 PNJ officiels...');
  for (const [id, name, dialog, xpReward, questKey] of NPCS) {
    const order = NPCS.findIndex((n) => n[0] === id);
    const key = rkey(id);
    const i18nKey = `npc.official.${id.split('.').slice(1).join('.')}`;
    const def = { id, name, dialog, xpReward, active: true, createdAt: now, order, i18nKey, questId: questId(questKey) };
    await set(ref(db, `catalog/npcDefs/${key}`), def);
    console.log(`   + ${name} (+${xpReward} XP) — quête liée : ${questKey}`);
  }

  console.log('\n💎 Trésors...');
  for (const [id, name, xpRequired, xpReward] of TREASURES) {
    const order = TREASURES.findIndex((tr) => tr[0] === id);
    const key = rkey(id);
    const i18nKey = `treasure.${id.split('.').slice(1).join('.')}`;
    const def = { id, name, xpRequired, xpReward, active: true, createdAt: now, order, i18nKey };
    await set(ref(db, `catalog/treasureDefs/${key}`), def);
    console.log(`   + ${name} (requiert ${xpRequired} XP, +${xpReward} XP à l'ouverture)`);
  }

  console.log('\n🗺️  Mondes...');
  for (const [id, name, xpRequired] of WORLDS) {
    const order = WORLDS.findIndex((w) => w[0] === id);
    const key = rkey(id);
    const i18nKey = `world.${id.split('.').slice(1).join('.')}`;
    const def = { id, name, xpRequired, active: true, createdAt: now, order, i18nKey };
    await set(ref(db, `catalog/worldDefs/${key}`), def);
    console.log(`   + ${name} (requiert ${xpRequired} XP)`);
  }

  console.log('\nTerminé — catalogues PNJ/Trésors/Mondes 100% hors-chaîne opérationnels.');
  process.exit(0);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
