/**
 * Pousse en base (Firebase RTDB, `catalog/quests/{questId}`) 50 nouvelles quêtes intermédiaires à
 * énigmes centrées sur l'archipel et les îles sauvages de Horizon ZeldCraft (voir
 * `seedIslandGeography.mjs` pour la géographie et les PNJ indigènes associés). Comme les 20 quêtes
 * PNJ historiques (`seedNpcRiddleQuests.mjs`), ce sont des quêtes `npcGiver: true` — elles
 * rejoignent le même bassin commun (voir `pickNpcQuestForPlayer` dans gameState.ts) et débloquent
 * la progression vers les Quêtes du Royaume au même titre que toute quête intermédiaire résolue
 * (voir `getSolvedIntermediateCount`) : ZÉRO changement de la logique de déblocage existante.
 *
 * Chaque quête porte en plus `islandKind: 'archipelago' | 'wildIsland'` (voir QuestDef dans
 * gameState.ts) — purement une étiquette d'affichage/admin (badge 🏝️/🌴 dans QuestList.tsx et le
 * panneau Administration), sans incidence sur le système de déblocage npcGiver déjà en place.
 * 25 quêtes "archipel" (les 3 îles groupées à l'Est/Sud-Est + la grande île de l'Aurore) et 25
 * "île sauvage" (faune/flore/objets/totems plus rustiques des presqu'îles et de l'île du Sud).
 *
 * 10 des PNJ indigènes (seedIslandGeography.mjs) pointent nommément (`questId`) vers les 10
 * premières quêtes de ce fichier (quest.island_01 à _10) pour garantir une rencontre déterministe ;
 * les 40 autres rejoignent le pool commun, proposées aléatoirement par n'importe quel PNJ "offre
 * quête" (comportement historique inchangé).
 *
 * 100% original (aucun nom copyrighté) — Seigneur des Anneaux/Tolkien, World of Warcraft, Zelda et
 * Minecraft ne sont que des sources d'inspiration de gameplay/ton, jamais de contenu recopié.
 *
 * Usage (one-shot, depuis web/) :
 *   node scripts/seedIslandQuests.mjs
 *
 * Lit la config Firebase publique depuis web/.env.local. Écriture autorisée par la règle
 * `catalog.write: auth != null` (auth anonyme). Idempotent : ré-exécuter écrase les mêmes clés.
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

// ─── Catégorie 1/5 : Lieux de l'archipel (10, archipelago) ───
const LOCATIONS = [
  ['quest.island_01', "🏝️ Énigme des îles 1 : La plus modeste des trois sœurs de l'archipel, si petite qu'on en fait le tour en une matinée. Quel est son nom ?",
    'ban-zuu', "Elle donne son nom au premier PNJ que rencontrent la plupart des voyageurs de l'archipel."],
  ['quest.island_02', "🏝️ Énigme des îles 2 : Sœur du milieu de l'archipel, ni la plus petite ni la plus grande, réputée pour ses sculpteurs de totems. Quel est son nom ?",
    'koraya', 'Son chaman porte le même nom.'],
  ['quest.island_03', "🏝️ Énigme des îles 3 : La plus grande des trois sœurs de l'archipel, son lagon cacherait un trésor englouti depuis trois générations. Quel est son nom ?",
    'tao-lani', 'Un pêcheur du même nom veille sur son lagon.'],
  ['quest.island_04', "🏝️ Énigme des îles 4 : Île isolée au sud du territoire, on raconte qu'un œuf de créature inconnue y attend d'éclore. Quel est son nom ?",
    'perle-verte', 'Sa couleur évoque une émeraude posée sur l\'océan.'],
  ['quest.island_05', "🏝️ Énigme des îles 5 : Grande île à l'Est, la première à avoir vu Zorghon fuir vers le large. Quel est son nom ?",
    "l'aurore", 'Le soleil s\'y lève avant le reste du territoire.'],
  ['quest.island_06', "🏝️ Énigme des îles 6 : Étendue d'eau calme au cœur de l'archipel où la prêtresse Marama écoute les chants des marées. Que suis-je ?",
    'lagon', "On y pêche à marée basse sans jamais s'aventurer trop loin du rivage."],
  ['quest.island_07', "🏝️ Énigme des îles 7 : Barrière naturelle immergée où rôdent des créatures que les livres du royaume ne décrivent pas. Que suis-je ?",
    'recif', "On le contourne prudemment en canoë pour ne pas s'y échouer."],
  ['quest.island_08', "🏝️ Énigme des îles 8 : Racines entremêlées à la limite de la terre et de la mer, refuge du gardien Toa contre les tempêtes. Que suis-je ?",
    'mangrove', 'Ni vraiment terre, ni vraiment mer.'],
  ['quest.island_09', "🏝️ Énigme des îles 9 : Étendue de sable fin où la conteuse Fetia raconte la légende de la princesse perdue par-delà les mers. Que suis-je ?",
    'sablorage', 'Son nom évoque à la fois le sable et la tempête.'],
  ['quest.island_10', "🏝️ Énigme des îles 10 : Petite baie battue par les embruns, rattachée au continent par une fine langue de terre. Que suis-je ?",
    'crique', 'Plus petite qu\'une baie, plus abritée qu\'une plage ouverte.'],
];

// ─── Catégorie 2/5 : Créatures tropicales (10, archipelago) ───
const CREATURES = [
  ['quest.island_11', "🐙 Énigme des îles 11 : Géant des profondeurs aux tentacules infinis, terreur des pêcheurs qui s'aventurent trop loin du lagon. Qui suis-je ?",
    'kraken', "On ne me voit jamais entier, seulement mes bras qui émergent des flots."],
  ['quest.island_12', "🐍 Énigme des îles 12 : Je me faufile entre les branches de corail, aussi coloré que venimeux. Qui suis-je ?",
    'serpent de corail', 'Mes couleurs vives avertissent les prédateurs de rester à distance.'],
  ['quest.island_13', "🐒 Énigme des îles 13 : Je bondis entre les tiges de bambou, invisible sauf à qui sait vraiment regarder. Qui suis-je ?",
    'singe-esprit', "Les indigènes disent que je porte la chance à qui m'aperçoit."],
  ['quest.island_14', "🦜 Énigme des îles 14 : Je répète les mots des voyageurs, mais seuls les initiés comprennent mes prophéties. Qui suis-je ?",
    'perroquet oraculaire', 'On me consulte avant tout grand voyage en mer.'],
  ['quest.island_15', "🦀 Énigme des îles 15 : Ma carapace est plus dure que l'acier, et je défends mon territoire de sable avec mes pinces géantes. Qui suis-je ?",
    'crabe geant', 'Je marche de travers mais je recule rarement devant un intrus.'],
  ['quest.island_16', "🎐 Énigme des îles 16 : Translucide et lumineuse la nuit, mon contact peut paralyser un homme adulte. Qui suis-je ?",
    'meduse luminescente', 'Je flotte sans effort, portée par le courant.'],
  ['quest.island_17', "🦈 Énigme des îles 17 : Rayé comme un fauve des terres, je patrouille les récifs à la recherche de ma prochaine proie. Qui suis-je ?",
    'requin-tigre', 'Mes rayures rappellent celles d\'un grand félin.'],
  ['quest.island_18', "🐢 Énigme des îles 18 : J'ai vu naître l'archipel et je reviens chaque année pondre sur la même plage. Qui suis-je ?",
    'tortue millenaire', 'Ma carapace porte les cicatrices de mille tempêtes.'],
  ['quest.island_19', "🦇 Énigme des îles 19 : Je vole la nuit entre les palmiers, nourrie de fruits plutôt que de sang. Qui suis-je ?",
    'chauve-souris frugivore', "Malgré mon nom, je ne fais aucun mal aux villageois."],
  ['quest.island_20', "⚡ Énigme des îles 20 : Je me love dans les hauts-fonds et je décharge une secousse foudroyante à qui me dérange. Qui suis-je ?",
    'anguille foudroyante', 'Mieux vaut ne pas me toucher pieds nus.'],
];

// ─── Catégorie 3/5 : PNJ indigènes (5, archipelago + 5, wildIsland) ───
const ALLIES = [
  ['quest.island_21', "🧑‍🤝‍🧑 Énigme des îles 21 : Guide spirituel de l'île moyenne, il parle aux esprits de la mer avant chaque grande décision. Qui est-il ?",
    'chaman koraya', 'Il partage le nom de son île.'],
  ['quest.island_22', "🧑‍🤝‍🧑 Énigme des îles 22 : Doyenne respectée de la plus petite île de l'archipel, gardienne de ses secrets malgré sa taille modeste. Qui est-elle ?",
    'doyenne ehiku', "Son île se visite en une matinée, pas son savoir."],
  ['quest.island_23', "🧑‍🤝‍🧑 Énigme des îles 23 : Pêcheur de la grande île de l'archipel, convaincu qu'un trésor dort au fond de son lagon. Qui est-il ?",
    'pecheur vaimoana', 'Il ne quitte jamais son canoë sans son filet porte-bonheur.'],
  ['quest.island_24', "🧑‍🤝‍🧑 Énigme des îles 24 : Éclaireur de la grande île de l'Est, le premier à avoir vu Zorghon fuir vers le large. Qui est-il ?",
    'eclaireur rangi', 'Son île porte le nom du lever du soleil.'],
  ['quest.island_25', "🧑‍🤝‍🧑 Énigme des îles 25 : Sculpteur de totems de l'île du milieu, chaque totem qu'il grave protège un secret de la forêt de bambous. Qui est-il ?",
    'sculpteur moehau', 'Ses œuvres gardent la forêt plus sûrement que des sentinelles.'],
  ['quest.island_26', "🧑‍🤝‍🧑 Énigme des îles 26 : Gardienne de l'île du Sud, elle veille sur un œuf de créature que nul n'a jamais vu éclore. Qui est-elle ?",
    'gardienne nalei', "On dit qu'elle chante une berceuse à l'œuf chaque soir."],
  ['quest.island_27', "🧑‍🤝‍🧑 Énigme des îles 27 : Tisserande de voiles de l'archipel, ses créations ont porté bien des aventuriers vers le large. Qui est-elle ?",
    'tisserande kalani', 'Aucune tempête ne déchire ses voiles.'],
  ['quest.island_28', "🧑‍🤝‍🧑 Énigme des îles 28 : Sage vivant à l'ombre d'un arbre géant sur l'île du Sud, plus vieux que tout le royaume réuni. Qui est-il ?",
    'sage milu', "Son arbre porte le même nom que lui."],
  ['quest.island_29', "🧑‍🤝‍🧑 Énigme des îles 29 : Forgeron de l'archipel, il façonne des lames dans le corail durci par le feu volcanique. Qui est-il ?",
    'forgeron hoku', 'Son atelier sent toujours le sel et la braise.'],
  ['quest.island_30', "🧑‍🤝‍🧑 Énigme des îles 30 : Navigatrice de l'archipel, elle lit le ciel pour guider les radeaux entre les îles sans jamais se perdre. Qui est-elle ?",
    'navigatrice anui', 'Elle ne consulte jamais de carte, seulement les étoiles.'],
];

// ─── Catégorie 4/5 : Trésors et reliques (10, wildIsland) ───
const ITEMS = [
  ['quest.island_31', "💎 Énigme des îles 31 : Rangée de perles sombres comme la nuit, portée jadis par une reine oubliée des îles. Que suis-je ?",
    'collier de perles noires', 'On dit qu\'il porte chance à qui le trouve honnêtement.'],
  ['quest.island_32', "🧭 Énigme des îles 32 : Faite de corail poli, je pointe toujours vers la terre la plus proche, jamais vers le nord. Que suis-je ?",
    'boussole de corail', 'Les marins perdus me consultent en premier.'],
  ['quest.island_33', "🛶 Énigme des îles 33 : Sculpté dans un tronc unique, je permets de traverser les eaux calmes de l'archipel sans jamais chavirer. Que suis-je ?",
    'canoe-balancier', 'Mon flotteur latéral m\'empêche de basculer.'],
  ['quest.island_34', "🎭 Énigme des îles 34 : Sculpté dans le bois rejeté par la mer, je représente le visage d'un ancêtre protecteur. Que suis-je ?",
    'masque de bois flotte', "On me porte lors des cérémonies importantes."],
  ['quest.island_35', "🔱 Énigme des îles 35 : Forgée pour la première éclaireuse de l'île de l'Aurore, je brille comme le soleil levant. Que suis-je ?",
    "lance de l'aurore", 'Son éclat annonce le matin avant même le soleil.'],
  ['quest.island_36', "🐚 Énigme des îles 36 : Porté à l'oreille, je fais entendre le chant de l'océan même loin du rivage. Que suis-je ?",
    'coquillage chantant', "On m'offre en cadeau d'adieu avant un long voyage."],
  ['quest.island_37', "🦈 Énigme des îles 37 : Taillée dans une dent de requin-tigre, je protège son porteur des créatures des profondeurs. Que suis-je ?",
    'amulette de requin', 'On me porte autour du cou avant de plonger.'],
  ['quest.island_38', "🕸️ Énigme des îles 38 : Tissé de fils précieux, je capture les poissons les plus rusés sans jamais me déchirer. Que suis-je ?",
    "filet d'argent", 'Aucun poisson ne mord assez fort pour me briser.'],
  ['quest.island_39', "🥁 Énigme des îles 39 : Frappé lors des grandes cérémonies, mon rythme raconte l'histoire des premiers habitants des îles. Que suis-je ?",
    'tambour des ancetres', "On m'entend résonner jusque dans la forêt de bambous."],
  ['quest.island_40', "🪞 Énigme des îles 40 : Poli par l'écume des vagues, je reflète non pas le visage mais le véritable désir de qui me regarde. Que suis-je ?",
    "miroir d'ecume", "Aucun artisan ne se souvient m'avoir fabriqué."],
];

// ─── Catégorie 5/5 : Sortilèges et totems (10, wildIsland) ───
const SPELLS = [
  ['quest.island_41', "🌬️ Énigme des îles 41 : Ce sortilège apaise la mer déchaînée le temps d'une traversée en canoë. Quel est son nom ?",
    'souffle du lagon', "Les navigateurs le murmurent avant de lever l'ancre."],
  ['quest.island_42', "🗿 Énigme des îles 42 : Ce totem, sculpté face au récif, repousse les créatures les plus agressives des profondeurs. Quel est son nom ?",
    'totem du recif', "On le plante à l'entrée de chaque village côtier."],
  ['quest.island_43', "🎶 Énigme des îles 43 : Ce chant rituel prédit l'heure exacte de la marée montante. Quel est son nom ?",
    'chant des marees', "Seule la prêtresse du lagon le connaît en entier."],
  ['quest.island_44', "🌴 Énigme des îles 44 : Cette bénédiction fait porter aux palmiers deux fois plus de noix de coco en une saison. Quel est son nom ?",
    'benediction des palmiers', "On la récite au lever du soleil, jamais au crépuscule."],
  ['quest.island_45', "🌀 Énigme des îles 45 : Ce sortilège redouté déchaîne des vents capables de renverser une flotte entière. Quel est son nom ?",
    "fureur de l'ouragan", "Seuls les chamans les plus expérimentés osent le prononcer."],
  ['quest.island_46', "✨ Énigme des îles 46 : Cet éclat magique fait briller n'importe quel objet comme s'il était neuf. Quel est son nom ?",
    'eclat de nacre', "On l'utilise pour restaurer les trésors abîmés par le sel."],
  ['quest.island_47', "🌿 Énigme des îles 47 : Ce murmure ancien permet de comprendre le langage silencieux des racines de mangrove. Quel est son nom ?",
    'murmure des mangroves', 'Seul le gardien des mangroves le maîtrise pleinement.'],
  ['quest.island_48', "🔥 Énigme des îles 48 : Cette danse rituelle appelle la protection du volcan endormi au cœur de l'île sauvage. Quel est son nom ?",
    'danse du feu volcanique', "On ne la danse qu'une fois par génération."],
  ['quest.island_49', "🌫️ Énigme des îles 49 : Ce voile enchanté dissimule un radeau entier dans une brume tropicale impénétrable. Quel est son nom ?",
    'voile de brume tropicale', "Il ne dure que le temps d'échapper à un danger immédiat."],
  ['quest.island_50', "🦈 Énigme des îles 50 : Cet appel rituel attire le plus grand des requins-tigres pour qu'il protège l'archipel plutôt que de l'attaquer. Quel est son nom ?",
    'appel du grand requin', "On ne le prononce qu'en dernier recours, en période de grand péril."],
];

const ALL = [
  ...LOCATIONS.map(q => [...q, 'archipelago']),
  ...CREATURES.map(q => [...q, 'archipelago']),
  ...ALLIES.slice(0, 5).map(q => [...q, 'archipelago']),
  ...ALLIES.slice(5).map(q => [...q, 'wildIsland']),
  ...ITEMS.map(q => [...q, 'wildIsland']),
  ...SPELLS.map(q => [...q, 'wildIsland']),
];

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
  let nextOrder = existing.reduce((max, q) => Math.max(max, q.order ?? -1), -1) + 1;

  let i = 0;
  for (const [key, label, answer, hint, islandKind] of ALL) {
    i += 1;
    const xpReward = 90 + i * 2;
    const scoreReward = Math.round(xpReward * 1.5);
    const id = keccak256(toBytes(key)).toLowerCase();
    const normalized = normalizeAnswer(answer);
    const answerHash = keccak256(toBytes(normalized)).toLowerCase();
    const def = {
      id, label, xpRequired: 0, xpReward, scoreReward, answerHash,
      active: true, createdAt: now, order: nextOrder, i18nKey: key,
      npcGiver: true, hint, hintKey: `${key}.hint`, islandKind,
    };
    await set(ref(db, `catalog/quests/${id}`), def);
    await set(ref(db, `catalog/riddleAnswers/${id}`), normalized);
    console.log(`✅ ${key} [${islandKind}] → ${id} (order ${nextOrder}, +${xpReward} XP)`);
    nextOrder += 1;
  }
  console.log(`\nTerminé — ${ALL.length} quêtes îles opérationnelles (${LOCATIONS.length + CREATURES.length + 5} archipel, ${5 + ITEMS.length + SPELLS.length} île sauvage).`);
  process.exit(0);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
