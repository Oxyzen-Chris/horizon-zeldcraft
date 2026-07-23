/**
 * Pousse en base (Firebase RTDB, `catalog/quests/{questId}`) 20 quêtes à énigmes proposées par des
 * PNJ (`npcGiver: true`) — thème dungeon crawler / Zelda / Minecraft / WoW / Stargate / dragons /
 * saisons, en écho à l'univers Horizon ZeldCraft. Contrairement aux quêtes "classiques" (gate
 * uniquement par `xpRequired`), ces quêtes apparaissent verrouillées dans "Quêtes à énigmes"
 * (badge "🗣️ Quête PNJ", champ de réponse masqué) tant qu'un PNJ (offre "quête" — ex. Princesse
 * Zelda l'Errante, Marchand ambulant le Sage, Dragon Ancestral le Sage…) ne les a pas proposées et
 * que le joueur ne les a pas acceptées (voir `pickNpcQuestForPlayer`/`unlockQuestForPlayer` dans
 * `web/src/lib/gameState.ts` et `NpcEncounterPopup.tsx`).
 *
 * 100% hors-chaîne, zéro gas. Le catalogue ne stocke QUE le hash keccak256 de la réponse
 * normalisée (`answerHash`) — jamais la réponse en clair — et les libellés (`label`/i18n) ne
 * révèlent jamais la solution. La réponse en clair est écrite séparément dans
 * `catalog/riddleAnswers/{questId}` (via `seedQuestAnswer`), un nœud réservé à l'affichage dans le
 * menu Administration (page `/admin`, protégée par `isOwner`) — jamais exposé aux composants de
 * jeu accessibles aux joueurs.
 *
 * Usage (one-shot, depuis web/) :
 *   node scripts/seedNpcRiddleQuests.mjs
 *
 * Lit la config Firebase publique depuis web/.env.local (mêmes variables NEXT_PUBLIC_FIREBASE_*
 * que l'app). Écriture autorisée par la règle `catalog.write: auth != null` (auth anonyme).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get } from 'firebase/database';
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

//   [id,                       label,                                                                                       xpRew, score, answer,           hint]
const QUESTS = [
  ['quest.npc_riddle_01', "🌀 Énigme PNJ 1 : Je suis un cercle de pierre couvert de symboles, capable de relier deux mondes en un instant. Que suis-je ?",
    60, 90, 'porte des etoiles', "On y compose une adresse à 7 symboles avant de l'activer."],
  ['quest.npc_riddle_02', "🕳️ Énigme PNJ 2 : Je plie l'espace-temps pour relier deux points éloignés de l'univers sans traverser la distance entre eux. Que suis-je ?",
    70, 105, 'trou de ver', "Einstein et Rosen m'ont donné mon second nom : pont d'Einstein-Rosen."],
  ['quest.npc_riddle_03', "🌲 Énigme PNJ 3 : Je vis dans un trou confortable, j'aime les repas six fois par jour et je déteste les aventures... jusqu'à ce qu'on m'en propose une. Qui suis-je ?",
    80, 120, 'hobbit', 'Mes pieds sont poilus et je mesure moins d\'un mètre vingt.'],
  ['quest.npc_riddle_04', "🧌 Énigme PNJ 4 : Je vis sous les ponts, je régénère mes blessures sauf face au feu, et je garde jalousement mon passage. Que suis-je ?",
    90, 135, 'troll', "Seul le feu ou l'acide m'empêche de me régénérer."],
  ['quest.npc_riddle_05', "🧙 Énigme PNJ 5 : Sans baguette ni bâton je ne suis rien, mais avec un grimoire je façonne les éléments. Qui suis-je ?",
    100, 150, 'magicien', 'Je porte souvent un chapeau pointu et une longue barbe.'],
  ['quest.npc_riddle_06', "⚒️ Énigme PNJ 6 : Petit comme un lutin, forgeron dans l'âme, je bricole des mécanismes sous la terre. Qui suis-je ?",
    110, 165, 'gnome', 'Je cousine avec le nain, mais je préfère les rouages à la pioche.'],
  ['quest.npc_riddle_07', "🐲 Énigme PNJ 7 : Je crache des flammes ravageuses et je trône sur un tas d'or ardent dans mon repaire volcanique. Quelle est ma couleur ?",
    130, 195, 'rouge', 'Ma couleur évoque la lave et la colère.'],
  ['quest.npc_riddle_08', "🐉 Énigme PNJ 8 : Je suis le plus noble et le plus sage des dragons métalliques, gardien de la justice. Quel métal précieux porte mon nom ?",
    150, 225, 'or', 'On me façonne aussi en couronnes et en pièces précieuses.'],
  ['quest.npc_riddle_09', "⚔️ Énigme PNJ 9 : Je fus tirée d'un rocher ou remise par une dame du lac ; seul un roi légitime peut me manier. Quel est mon nom ?",
    200, 300, 'excalibur', "Une main surgie d'un lac me tient parfois à la surface."],
  ['quest.npc_riddle_10', "🛡️ Énigme PNJ 10 : Je porte la croix sur mon plastron, je protège les pèlerins et garde des secrets anciens sous mon temple. Qui suis-je ?",
    180, 270, 'templier', 'Mon ordre fut fondé pour protéger la route de Jérusalem.'],
  ['quest.npc_riddle_11', "🏰 Énigme PNJ 11 : Construit par Dédale pour enfermer un monstre mi-homme mi-taureau, je n'ai qu'une entrée mais mille chemins. Que suis-je ?",
    220, 330, 'labyrinthe', "Un fil d'Ariane permet d'en ressortir."],
  ['quest.npc_riddle_12', "🐮 Énigme PNJ 12 : Mi-homme, mi-taureau, je hante le cœur d'un labyrinthe crétois. Qui suis-je ?",
    220, 330, 'minotaure', "Thésée m'a vaincu grâce à un fil."],
  ['quest.npc_riddle_13', "🌸 Énigme PNJ 13 : Je fais fondre la neige, éclore les fleurs et revivre la nature après l'hiver. Quelle saison suis-je ?",
    140, 210, 'printemps', 'Les hirondelles reviennent quand j\'arrive.'],
  ['quest.npc_riddle_14', "☀️ Énigme PNJ 14 : Je porte les jours les plus longs et le soleil le plus haut de l'année. Quelle saison suis-je ?",
    140, 210, 'ete', "Le solstice qui porte mon nom est le jour le plus long de l'année."],
  ['quest.npc_riddle_15', "🍂 Énigme PNJ 15 : Je peins les feuilles en orange et en rouge avant qu'elles ne tombent. Quelle saison suis-je ?",
    140, 210, 'automne', 'Les récoltes se terminent avant que je cède la place à l\'hiver.'],
  ['quest.npc_riddle_16', "❄️ Énigme PNJ 16 : Je recouvre le monde de blanc et fige les rivières sous la glace. Quelle saison suis-je ?",
    140, 210, 'hiver', "Le solstice qui porte mon nom est la nuit la plus longue de l'année."],
  ['quest.npc_riddle_17', "🔮 Énigme PNJ 17 : Sans moi, aucun magicien ne pourrait soigner ses blessures instantanément d'une simple gorgée. Que suis-je ?",
    160, 240, 'potion', 'On me boit d\'un trait, souvent dans une fiole en verre.'],
  ['quest.npc_riddle_18', "📜 Énigme PNJ 18 : Symbole gravé porteur d'un pouvoir magique, je scelle passages secrets et sortilèges anciens. Que suis-je ?",
    170, 255, 'glyphe', 'On me trace parfois sur une porte ou un parchemin pour m\'activer.'],
  ['quest.npc_riddle_19', "🌍 Énigme PNJ 19 : Je relie Azeroth à Draenor, ouvert par les Orcs de la Horde pour envahir un nouveau monde. Que suis-je ?",
    350, 525, 'portail sombre', "Il fut ouvert pour la première fois par Ner'zhul."],
  ['quest.npc_riddle_20', "🔺 Énigme PNJ 20 : Composée de trois triangles dorés, je représente le Pouvoir, la Sagesse et le Courage réunis. Que suis-je ?",
    500, 750, 'triforce', 'Elle appartient à la déesse Hylia et à ses trois porteurs légendaires.'],
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

  // Décale l'ordre d'affichage après les quêtes existantes (0..4 pour les 5 énigmes historiques).
  const existingSnap = await get(ref(db, 'catalog/quests'));
  const existing = existingSnap.val() ? Object.values(existingSnap.val()) : [];
  let nextOrder = existing.reduce((max, q) => Math.max(max, q.order ?? -1), -1) + 1;

  for (const [key, label, xpReward, scoreReward, answer, hint] of QUESTS) {
    const id = keccak256(toBytes(key)).toLowerCase();
    const normalized = normalizeAnswer(answer);
    const answerHash = keccak256(toBytes(normalized)).toLowerCase();
    const def = {
      id, label, xpRequired: 0, xpReward, scoreReward, answerHash,
      active: true, createdAt: now, order: nextOrder, i18nKey: key,
      npcGiver: true, hint, hintKey: `${key}.hint`,
    };
    await set(ref(db, `catalog/quests/${id}`), def);
    // Réponse en clair réservée à l'affichage Administration (jamais exposée aux joueurs).
    await set(ref(db, `catalog/riddleAnswers/${id}`), normalized);
    console.log(`✅ ${key} → ${id} (order ${nextOrder})\n   ${label.slice(0, 70)}…`);
    nextOrder += 1;
  }
  console.log('\nTerminé — 20 quêtes à énigmes PNJ opérationnelles (npcGiver: true).');
  process.exit(0);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
