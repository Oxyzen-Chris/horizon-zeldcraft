/**
 * Pousse en base (Firebase RTDB, `catalog/quests/{questId}`) les 400 "Quêtes du Royaume"
 * (`kingdomQuest: true`) — fil narratif principal de Horizon ZeldCraft, inspiré de Donjons &
 * Dragons, Tolkien/Le Seigneur des Anneaux, la trilogie Zelda et Warcraft : délivrer la Princesse
 * PocaPoka et son fidèle lutin des sables El Pipo de l'emprise de Zorghon le Maléfique.
 *
 * 40 chapitres (`kingdomChapter` 1-40, voir KINGDOM_CHAPTERS dans src/lib/gameState.ts) de 10
 * quêtes chacun (`kingdomOrder` 1-400, déblocage STRICTEMENT séquentiel — voir
 * computeKingdomProgress()). Exactly 40 d'entre elles (une par chapitre, archétype "Pleine lune")
 * sont `fullMoonOnly: true`.
 *
 * Contenu 100% original (noms de lieux/personnages inventés : Emberrune, Sylvaltide, PocaPoka, El
 * Pipo, Zorghon…), au même niveau d'inspiration générique que les quêtes PNJ existantes
 * (seedNpcRiddleQuests.mjs) — aucun texte ni nom copyrighté n'est reproduit.
 *
 * Contrairement aux quêtes PNJ, les Quêtes du Royaume ne sont PAS gate par `xpRequired` (mis à 0,
 * même convention que npcGiver) : le déblocage est intégralement piloté par la chaîne
 * `kingdomOrder`/`kingdomMinIntermediateSolved` (voir computeKingdomProgress) et par la pleine lune
 * (`fullMoonOnly`) — zéro risque de double-verrouillage contradictoire dans PoiInteractionModal.
 *
 * Usage (one-shot, depuis web/) :
 *   node scripts/seedKingdomQuests.mjs
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

const envPath = join(__dirname, '..', '.env.local');
const env = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

function normalizeAnswer(s) {
  return s.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function slugify(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
function firstWord(s) { return s.replace(/[^\p{L}\p{N}\s'-]/gu, '').trim().split(/\s+/)[0]; }
function lastWord(s) { const w = s.replace(/[^\p{L}\p{N}\s'-]/gu, '').trim().split(/\s+/); return w[w.length - 1]; }

// ─── 40 chapitres — DOIT rester synchrone avec KINGDOM_CHAPTERS (web/src/lib/gameState.ts) ───
const CHAPTER_TITLES = [
  "Vallée d'Emberrune", 'Forêt de Sylvaltide', 'Marais de Fangrouille', 'Collines de Pierreflamme',
  'Grottes de Kragmoor', 'Pont Brisé de Ravenoire', 'Plaines de Corenlie', "Ruines d'Anvieil",
  'Lac Glacial de Mirevent', 'Village des Sables', 'Désert de Sarrakoth', 'Oasis Perdue de Zayira',
  'Canyon des Échos', 'Temple Enseveli de Nourah', 'Forêt Pétrifiée', 'Cité Engloutie de Valmoria',
  'Steppe de Khardûn', 'Camp des Nomades du Vent', 'Passage des Brumes', 'Sommet de Grisemont',
  'Terres Calcinées', 'Champ des Cendres', 'Fort Abandonné de Nathrek', 'Rivière de Magma',
  'Antre du Wyrm Noir', 'Nécropole de Kaldrith', 'Labyrinthe de Voss', 'Tour des Murmures',
  'Pont des Âmes', 'Sanctuaire Oublié', 'Bastion de Zorghon', 'Prison des Cendres',
  'Cour des Ombres', 'Salle des Lieutenants', 'Forge Infernale', 'Jardins Calcinés',
  'Grand Escalier Noir', 'Salle du Trône Déchu', 'Cœur de la Citadelle', 'La Chute de Zorghon',
];

const CREATURES = [
  'Gobelin des Broussailles', 'Araignée Sylvane', 'Vase Putride', 'Homme-Pierre des Collines',
  'Chauve-souris Cavernique Géante', 'Corbeau-Ombre de Ravenoire', 'Loup des Plaines', "Gardien de Pierre d'Anvieil",
  'Élémentaire de Glace', 'Scorpion des Sables Ardents', 'Ver des Dunes', "Djinn de l'Oasis",
  'Écho Hurlant du Canyon', 'Sphinx Enseveli', 'Golem de Racines Pétrifiées', 'Sirène des Abysses',
  'Centaure des Steppes', 'Harpie du Vent Nomade', 'Spectre des Brumes', 'Griffon de Grisemont',
  'Salamandre des Cendres', 'Zombie Calciné', 'Chevalier Déchu de Nathrek', 'Élémentaire de Magma',
  'Wyrm Noir', 'Liche de Kaldrith', 'Minotaure de Voss', 'Banshee de la Tour des Murmures',
  'Âme Errante du Pont', 'Gardien Oublié du Sanctuaire', 'Orc de la Garde Noire', 'Geôlier des Cendres',
  'Ombre Sans Nom', 'Assassin des Lieutenants', 'Forgeron Damné', 'Épine Vivante des Jardins',
  "Cavalier Noir de l'Escalier", 'Trône Vivant', 'Cœur des Ténèbres', 'Garde Rapprochée de Zorghon',
];

const ALLIES = [
  "Aldwin l'Éclaireur", 'Sylia des Bois', 'Bram le Tourbier', 'Thoric Pierreflamme',
  'Nym la Taupe', 'Corven le Messager', 'Elowen des Plaines', "Le Sage d'Anvieil",
  'Frost la Gardienne du Lac', 'Zahra du Village des Sables', 'Kadir le Guide du Désert', "Yasmine de l'Oasis",
  'L\'Écho du Canyon', 'Prêtresse Nourah', "Sylvurne l'Esprit Pétrifié", 'Marin Valmor',
  'Khadar des Steppes', 'Capitaine Rasha du Vent', 'Le Passeur des Brumes', 'Seigneur de Grisemont',
  'Cendrine des Terres Calcinées', 'Le Veilleur du Champ des Cendres', 'Sire Nathrek Repenti', 'Forgemaître Ignis',
  'Kaela la Dresseuse de Wyrms', 'Vaeloth le Nécromancien Repenti', "Voss l'Ancien Architecte", 'La Voix de la Tour',
  'Le Passeur des Âmes', 'Mira Gardienne du Sanctuaire', 'Renn le Déserteur', "L'Évadée des Cendres",
  "L'Ombre Repentie", 'Kael le Rival des Lieutenants', 'Le Forgeron Affranchi', 'La Jardinière des Cendres',
  "Le Dernier Garde de l'Escalier", "L'Héritier du Trône Déchu", "L'Étincelle du Cœur", 'PocaPoka et El Pipo',
];

const ITEMS = [
  'Dague de Rosée', 'Arc de Sylvaltide', 'Amulette de Fangrouille', 'Marteau de Pierreflamme',
  'Lanterne de Kragmoor', 'Corde de Ravenoire', 'Bouclier de Corenlie', "Sceau d'Anvieil",
  'Perle de Mirevent', 'Voile du Village des Sables', 'Sablier de Sarrakoth', 'Fiole de Zayira',
  'Flûte du Canyon des Échos', 'Masque de Nourah', 'Graine Pétrifiée', 'Perle de Valmoria',
  'Fer à Cheval de Khardûn', 'Plume du Vent Nomade', 'Voile des Brumes', 'Couronne de Grisemont',
  'Cendre Ardente', 'Amulette du Champ des Cendres', 'Bouclier de Nathrek', 'Gantelet de Magma',
  'Écaille du Wyrm Noir', 'Grimoire de Kaldrith', "Fil d'Ariane de Voss", 'Cloche des Murmures',
  "Pierre d'Âme", 'Relique du Sanctuaire Oublié', 'Clé du Bastion', 'Chaîne Brisée des Cendres',
  'Voile des Ombres', 'Lame des Lieutenants', 'Marteau de la Forge Infernale', 'Rose Calcinée',
  "Rampe de l'Escalier Noir", 'Fragment du Trône Déchu', 'Éclat du Cœur de la Citadelle', 'Couronne de Zorghon',
];

const SPELLS = [
  'Éclat de Lumière', 'Ronces Enchevêtrées', 'Souffle Putride', 'Poigne de Pierre',
  'Écho des Cavernes', 'Cri du Corbeau', 'Galop du Vent', "Mémoire d'Anvieil",
  'Givre Éternel', 'Mirage Ardent', 'Sable Mouvant', 'Oasis Illusoire',
  'Écho Amplifié', 'Sceau de Nourah', 'Racine Pétrifiante', 'Marée Engloutie',
  'Ruée de la Steppe', 'Bourrasque Nomade', 'Voile de Brume', 'Cri de Grisemont',
  'Flamme Cendrée', 'Fléau des Cendres', 'Serment Brisé', 'Coulée de Magma',
  'Souffle du Wyrm', 'Malédiction de Kaldrith', 'Fil Directeur', 'Murmure Halluciné',
  'Appel des Âmes', 'Bénédiction Oubliée', 'Rugissement Noir', 'Chaîne Spectrale',
  "Voile d'Ombre", 'Frappe du Lieutenant', 'Fournaise Infernale', 'Épine Toxique',
  "Pas de l'Ombre", 'Écho du Trône', 'Éveil du Cœur', 'Sceau Final de Zorghon',
];

const GUARDIANS = [
  'Garde Aldric', 'Ent Veilleur', 'Vieux Crapaud-Sage', 'Forgeron Pierreflamme',
  'Ombre de Kragmoor', 'Spectre du Pont', 'Cavalier de Corenlie', "Statue Vivante d'Anvieil",
  'Esprit du Lac Gelé', 'Chef du Village des Sables', 'Mirage du Désert', "Gardien de l'Oasis",
  'Écho Gardien du Canyon', 'Sphinx de Nourah', 'Druide Pétrifié', 'Roi Englouti de Valmoria',
  'Chef de la Steppe', 'Chamane du Vent', 'Ombre des Brumes', 'Seigneur de Grisemont',
  'Sentinelle de Cendres', 'Spectre du Champ des Cendres', 'Sire Nathrek le Déchu', 'Gardien de Magma',
  'Wyrm Noir Ancestral', 'Liche Gardienne de Kaldrith', 'Minotaure de Voss', 'Banshee de la Tour',
  'Passeur des Âmes', 'Gardien du Sanctuaire Oublié', '1er Lieutenant de Zorghon, Capitaine de la Garde Noire',
  '2e Lieutenant de Zorghon, Geôlier en Chef', '3e Lieutenant de Zorghon, Maître des Ombres',
  '4e Lieutenant de Zorghon, Chef des Assassins', '5e Lieutenant de Zorghon, Forgeron Damné',
  '6e Lieutenant de Zorghon, Jardinière Calcinée', '7e Lieutenant de Zorghon, Cavalier Noir Suprême',
  '8e Lieutenant de Zorghon, Régent du Trône Déchu', 'Cœur des Ténèbres, Garde Rapprochée de Zorghon',
  'Zorghon le Maléfique',
];

const VIRTUES = ['courage', 'sagesse', 'loyaute', 'espoir', 'humilite', 'patience', 'justice', 'sacrifice', 'honneur', 'unite'];

// 40 énigmes classiques originales (une par chapitre) — réponses toutes distinctes.
const LOGIC_RIDDLES = [
  { text: "Je grandis quand on me nourrit de bois, mais je meurs si l'on me noie. Que suis-je ?", answer: 'feu', hint: "Le vent m'attise, l'eau m'éteint." },
  { text: 'Plus on me prend, plus je laisse de traces derrière moi. Que suis-je ?', answer: 'pas', hint: 'On me laisse dans le sable ou la neige.' },
  { text: "Je n'ai ni bouche ni gorge, pourtant je peux vous faire pleurer à table. Que suis-je ?", answer: 'oignon', hint: "On m'épluche avant de me couper." },
  { text: "J'ai des villes sans maisons, des forêts sans arbres et des rivières sans eau. Que suis-je ?", answer: 'carte', hint: 'On me déplie pour trouver son chemin.' },
  { text: 'Je suis toujours devant toi mais jamais tu ne peux m\'atteindre. Que suis-je ?', answer: 'horizon', hint: "Je recule à mesure que tu avances." },
  { text: "On me casse avant même de m'utiliser. Que suis-je ?", answer: 'oeuf', hint: 'Je peux devenir une omelette.' },
  { text: "J'ai une seule couleur mais mille formes, et je disparais dès que la lumière s'éteint. Que suis-je ?", answer: 'ombre', hint: 'Je te suis toujours au soleil.' },
  { text: 'Je danse sans jambes et je chante sans bouche. Que suis-je ?', answer: 'vent', hint: 'On me sent mais on ne me voit jamais.' },
  { text: 'Plus je suis grand, moins je pèse lourd. Que suis-je ?', answer: 'trou', hint: 'On me creuse, on ne me remplit jamais vraiment.' },
  { text: 'Je nais dans la montagne et je meurs dans la mer. Que suis-je ?', answer: 'riviere', hint: 'Je coule toujours vers le bas.' },
  { text: "Je suis fait de gouttes mais je peux vous noyer si vous m'ignorez trop longtemps. Que suis-je ?", answer: 'pluie', hint: 'Je tombe du ciel en été comme en hiver.' },
  { text: "Je n'ai pas de bouche mais je raconte le temps qui passe sur mon visage de pierre. Que suis-je ?", answer: 'cadran solaire', hint: 'Sans soleil, je ne dis plus rien.' },
  { text: 'Je suis léger comme une plume mais même le plus fort ne peut me retenir plus de quelques minutes. Que suis-je ?', answer: 'souffle', hint: 'Tu me retiens puis tu me relâches.' },
  { text: "Je n'existe que lorsque deux éléments contraires se rencontrent : le soleil et la pluie. Que suis-je ?", answer: 'arc-en-ciel', hint: 'Je porte sept couleurs sans jamais les mélanger.' },
  { text: "Je n'ai pas de dents mais je peux mordre le temps, on me trouve chez les plus vieux gardiens du Royaume. Que suis-je ?", answer: 'sagesse', hint: "Elle vient rarement seule avec la jeunesse." },
  { text: "Je suis un roi tant que je reste debout, mais je fonds dès qu'on m'approche du feu. Que suis-je ?", answer: 'bonhomme de neige', hint: 'Je ne survis pas à l\'été.' },
  { text: "Je n'ai qu'une aiguille mais je ne couds jamais. Que suis-je ?", answer: 'boussole', hint: 'Je pointe toujours vers le même horizon.' },
  { text: "Je n'ai pas de bouche mais je répète chaque mot que tu cries dans les montagnes. Que suis-je ?", answer: 'echo', hint: 'Plus la vallée est profonde, plus je persiste.' },
  { text: 'Je grandis en hiver et je meurs en été, contrairement à toutes les plantes. Que suis-je ?', answer: 'glacon', hint: 'Je pends du toit des huttes gelées.' },
  { text: 'Je suis un livre que personne n\'a jamais écrit mais que tout le monde peut lire dans le ciel. Que suis-je ?', answer: 'etoiles', hint: 'Les marins m\'ont toujours utilisé pour se guider.' },
  { text: 'Plus je suis vieux, plus je vaux cher, sauf pour le pain et le lait. Que suis-je ?', answer: 'vin', hint: 'On me garde dans une cave sombre pendant des années.' },
  { text: 'Sans yeux je pleure, sans bouche je chante quand le vent me traverse. Que suis-je ?', answer: 'harpe eolienne', hint: 'On me suspend pour que le vent joue de moi.' },
  { text: 'Je suis toujours en train de courir mais je ne quitte jamais ma place. Que suis-je ?', answer: 'horloge', hint: "Mes aiguilles tournent sans jamais s'arrêter." },
  { text: 'Je suis pleine de trous mais je retiens l\'eau. Que suis-je ?', answer: 'eponge', hint: "On m'utilise pour nettoyer après le combat." },
  { text: 'Je meurs à chaque fois que l\'on me prononce. Que suis-je ?', answer: 'silence', hint: 'On me brise en un seul mot.' },
  { text: 'Je suis ronde, je flotte dans le ciel et je change de forme chaque nuit sans jamais disparaître. Que suis-je ?', answer: 'lune', hint: 'Je suis pleine une fois par mois.' },
  { text: 'Je ronge lentement le métal sans jamais lever la moindre arme. Que suis-je ?', answer: 'rouille', hint: "Je déteste l'huile et l'entretien." },
  { text: 'Je suis faite de sable mais je compte les heures. Que suis-je ?', answer: 'sablier', hint: 'On me retourne quand le temps est écoulé.' },
  { text: "Je n'ai pas d'ailes mais je vole d'une bouche à l'autre à travers tout le Royaume. Que suis-je ?", answer: 'rumeur', hint: 'Plus on me raconte, plus je grandis... et je déforme la vérité.' },
  { text: 'Je suis un pont que l\'on ne construit qu\'avec des mots. Que suis-je ?', answer: 'promesse', hint: 'Je peux être brisée aussi facilement qu\'une brindille.' },
  { text: 'Je grandis dans le noir et je flétris à la lumière. Que suis-je ?', answer: 'champignon', hint: 'On me trouve dans les grottes humides.' },
  { text: 'Je suis une armée à moi seule quand je me multiplie en silence dans l\'ombre des cœurs. Que suis-je ?', answer: 'peur', hint: "Je grandis avec le silence et l'inconnu." },
  { text: "Je n'ai pas de flamme mais je peux brûler un cœur pendant des années. Que suis-je ?", answer: 'rancune', hint: 'On me nourrit avec de vieux souvenirs.' },
  { text: 'Je suis un voleur qui ne prend jamais rien mais que tout le monde redoute de perdre. Que suis-je ?', answer: 'temps', hint: 'On ne peut jamais m\'arrêter, seulement me mesurer.' },
  { text: "Forgée dans le feu, je ne crains que la rouille et l'oubli, parfois endormie des siècles avant qu'un héros ne me réveille. Que suis-je ?", answer: 'epee', hint: 'On me tire parfois d\'un rocher ou d\'un tombeau.' },
  { text: "Je meurs si l'on m'oublie mais je renais si l'on prend soin de moi, encore et encore. Que suis-je ?", answer: 'renouveau', hint: 'Le printemps est mon symbole éternel.' },
  { text: 'Je suis une clé que l\'on ne peut forger, seulement mériter. Que suis-je ?', answer: 'confiance', hint: 'On me donne rarement, on me gagne toujours.' },
  { text: 'Je tombe chaque soir sans jamais me briser et je précède toujours l\'aube. Que suis-je ?', answer: 'nuit', hint: 'Je suis plus sombre juste avant que tout change.' },
  { text: "Je suis la première chose que Zorghon a volée au Royaume, avant même la Princesse. Que suis-je ?", answer: 'liberte', hint: 'On ne m\'apprécie vraiment qu\'une fois perdue.' },
  { text: 'Je suis ce qui reste quand tout semble perdu, la dernière arme de PocaPoka contre les ténèbres de Zorghon. Que suis-je ?', answer: 'espoir', hint: 'On ne peut me voler tant que le cœur bat encore.' },
];

const GLYPH_TPL = [
  (loc) => `Gravé par les Anciens à l'entrée de ${loc}, ce glyphe ne s'active qu'en prononçant le nom du lieu qu'il protège depuis des siècles. Quel est ce nom ?`,
  (loc) => `Ce symbole runique veille sur ${loc} et ne répond qu'à celui qui connaît le nom exact de la terre qu'il scelle. Quel est ce nom ?`,
  (loc) => `Sur une arche de pierre à ${loc}, un glyphe ancien n'exige qu'une seule chose avant de s'illuminer : le nom du lieu lui-même. Lequel ?`,
  (loc) => `Les PNJ locaux racontent qu'un glyphe ancien garde ${loc} et ne s'éteint que si l'on prononce son nom véritable. Quel est ce nom ?`,
];
const LOCATION_TPL = [
  (creature, guardian) => `Un territoire hanté par ${creature} et surveillé par ${guardian}, à mesure que l'on approche de Zorghon. Quel est le nom de ce lieu ?`,
  (creature, guardian) => `Les cartes du Royaume désignent ce lieu comme celui où rôde ${creature}, sous le regard de ${guardian}. Quel est son nom ?`,
  (creature, guardian) => `Entre légende et danger, ce territoire abrite ${creature} et ${guardian} en son cœur. Comment le nomme-t-on ?`,
  (creature, guardian) => `Ni village ni ruine tout à fait, ce lieu redouté abrite ${creature} et se trouve sous la garde de ${guardian}. Quel est son nom ?`,
];
const CREATURE_TPL = [
  (loc) => `Je rôde dans ${loc}, craint des voyageurs qui s'y aventurent seuls. Mi-bête, mi-légende du Royaume. Qui suis-je ?`,
  (loc) => `On me raconte autour des feux de camp : une créature de ${loc} qu'il vaut mieux ne jamais croiser la nuit. Qui suis-je ?`,
  (loc) => `Gardienne involontaire de ${loc}, je ne cherche qu'à protéger mon territoire — à mes dépens si l'on m'affronte sans respect. Qui suis-je ?`,
  (loc) => `Les PNJ de ${loc} évitent de prononcer mon nom après le crépuscule. Qui suis-je ?`,
];
const ALLY_TPL = [
  (loc) => `Un allié précieux attend d'être convaincu de rejoindre ta quête à ${loc}, sa connaissance du terrain te sera indispensable. Qui est-il ou elle ?`,
  (loc) => `Les PNJ de ${loc} parlent d'une figure prête à combattre à tes côtés contre Zorghon, si tu gagnes sa confiance. Qui est-ce ?`,
  (loc) => `Un compagnon de route t'attend à ${loc}, prêt à grossir les rangs de la résistance face au Maléfique. Qui est-il ou elle ?`,
  (loc) => `À ${loc}, une âme courageuse cherche un aventurier digne de confiance pour rejoindre la lutte contre Zorghon. Qui est-ce ?`,
];
const ITEM_TPL = [
  (loc) => `Caché à ${loc}, un objet ancien attend celui qui saura le retrouver — il pourrait bien faire la différence face aux Lieutenants de Zorghon. Quel est cet objet ?`,
  (loc) => `Les PNJ de ${loc} évoquent une relique oubliée, enterrée ou scellée quelque part dans la région. Quelle relique ?`,
  (loc) => `Un trésor du Royaume dort à ${loc}, en attente d'un héros digne de le porter. Quel est cet objet ?`,
  (loc) => `Une relique légendaire de ${loc} n'attend que d'être réclamée par qui saura la nommer. Quel est son nom ?`,
];
const SPELL_TPL = [
  (loc) => `Un sortilège oublié sommeille à ${loc}, transmis autrefois par les mages du Royaume. Quel est ce sortilège ?`,
  (loc) => `Les grimoires de ${loc} mentionnent un sort puissant, indispensable pour affronter ce qui rôde plus loin. Quel est ce sort ?`,
  (loc) => `Un sortilège ancien protège encore ${loc}, transmis de mage en mage depuis des générations. Comment le nomme-t-on ?`,
  (loc) => `On raconte qu'un sort unique fut inventé à ${loc} pour repousser les ténèbres. Quel est ce sortilège ?`,
];
const GUARDIAN_TPL = [
  () => `Un gardien redoutable protège ce chapitre du Royaume, mettant à l'épreuve tout aventurier qui ose avancer. Qui est-il ?`,
  () => `Nul ne passe sans affronter ce gardien, dont le nom seul suffit à faire trembler les PNJ du coin. Qui est-il ?`,
  () => `Ce protecteur (ou geôlier) veille jalousement sur ce territoire du Royaume. Qui est-il ?`,
  () => `Son ombre plane sur tout le chapitre : impossible d'avancer sans le nommer. Qui est-il ?`,
];
const TRIAL_TPL = [
  (v) => `Pour franchir cette épreuve du Royaume, tu dois démontrer une vertu précise face au danger. Laquelle ? (indice : ${v.length} lettres)`,
  (v) => `Les Anciens du Royaume exigent une seule qualité pour continuer plus loin dans cette quête. Laquelle ? (indice : ${v.length} lettres)`,
  (v) => `Un test invisible juge chaque aventurier sur une vertu essentielle avant de le laisser passer. Laquelle ? (indice : ${v.length} lettres)`,
  (v) => `Ce chapitre du Royaume ne s'ouvre qu'à qui prouve une vertu précise dans ses actes. Laquelle ? (indice : ${v.length} lettres)`,
];
const MOON_TPL = [
  (loc) => `Ce soir de pleine lune, un phénomène rare se révèle à ${loc} : un halo que seuls les PNJ les plus anciens savent nommer. Comment l'appellent-ils ?`,
  (loc) => `Sous la pleine lune, ${loc} laisse entrevoir un secret invisible le reste du mois. Quel nom lui donne-t-on ?`,
  (loc) => `La légende raconte qu'une seule nuit par mois, ${loc} révèle un mystère lunaire à qui sait regarder. Comment le nomme-t-on ?`,
  (loc) => `Seule la pleine lune permet de percevoir ce phénomène caché à ${loc}. Quel est son nom ?`,
];

function xpRewardFor(order) { return 30 + order * 4; }
function scoreRewardFor(order) { return Math.round(xpRewardFor(order) * 1.5); }

const QUESTS = []; // { key, label, xpReward, scoreReward, answer, hint, kingdomChapter, kingdomOrder, fullMoonOnly, itemReward? }

for (let idx = 0; idx < 40; idx++) {
  const chapterNum = idx + 1;
  const pad = String(chapterNum).padStart(2, '0');
  const location = CHAPTER_TITLES[idx];
  const creature = CREATURES[idx];
  const ally = ALLIES[idx];
  const item = ITEMS[idx];
  const spell = SPELLS[idx];
  const guardian = GUARDIANS[idx];
  const virtue = VIRTUES[idx % VIRTUES.length];
  const logic = LOGIC_RIDDLES[idx];
  const v = idx % 4;
  const isFinal = chapterNum === 40;
  const base = (chapterNum - 1) * 10;
  const prefix = (n) => `Quête du Royaume — Chapitre ${chapterNum} (${location}) : `;

  QUESTS.push({ key: `quest.kingdom.ch${pad}.glyph`, label: `📜 ${prefix()}${GLYPH_TPL[v](location)}`,
    order: base + 1, answer: location, hint: `Indice : le nom commence par « ${firstWord(location)} ».`, chapter: chapterNum });

  QUESTS.push({ key: `quest.kingdom.ch${pad}.location`, label: `🗺️ ${prefix()}${LOCATION_TPL[v](creature, guardian)}`,
    order: base + 2, answer: location, hint: `Indice : le nom commence par « ${firstWord(location)} ».`, chapter: chapterNum });

  QUESTS.push({ key: `quest.kingdom.ch${pad}.creature`, label: `🐾 ${prefix()}${CREATURE_TPL[v](location)}`,
    order: base + 3, answer: creature, hint: `Indice : son nom se termine par « ${lastWord(creature)} ».`, chapter: chapterNum });

  if (isFinal) {
    QUESTS.push({ key: `quest.kingdom.ch${pad}.ally`,
      label: `🤝 ${prefix()}Le Royaume tout entier retient son souffle, prêt à accueillir de nouveau sa princesse et son fidèle compagnon lutin des sables. Qui sont-ils, elle et lui ?`,
      order: base + 4, answer: 'pocapoka et el pipo', hint: 'Elle porte une couronne de sable doré ; lui ne la quitte jamais d\'une semelle.', chapter: chapterNum });
  } else {
    QUESTS.push({ key: `quest.kingdom.ch${pad}.ally`, label: `🤝 ${prefix()}${ALLY_TPL[v](location)}`,
      order: base + 4, answer: ally, hint: `Indice : son nom se termine par « ${lastWord(ally)} ».`, chapter: chapterNum });
  }

  QUESTS.push({ key: `quest.kingdom.ch${pad}.item`, label: `💎 ${prefix()}${ITEM_TPL[v](location)}`,
    order: base + 5, answer: item, hint: `Indice : son nom se termine par « ${lastWord(item)} ».`, chapter: chapterNum,
    itemReward: { itemId: `relic_ch${pad}_${slugify(item)}`, name: `💎 ${item}`, qty: 1, category: 'treasure', effect: {} } });

  QUESTS.push({ key: `quest.kingdom.ch${pad}.spell`, label: `✨ ${prefix()}${SPELL_TPL[v](location)}`,
    order: base + 6, answer: spell, hint: `Indice : son nom se termine par « ${lastWord(spell)} ».`, chapter: chapterNum });

  QUESTS.push({ key: `quest.kingdom.ch${pad}.riddle`, label: `❓ ${prefix()}${logic.text}`,
    order: base + 7, answer: logic.answer, hint: logic.hint, chapter: chapterNum });

  if (isFinal) {
    QUESTS.push({ key: `quest.kingdom.ch${pad}.guardian`,
      label: `🛡️ ${prefix()}Il a enlevé la Princesse PocaPoka et son fidèle El Pipo pour régner sur les cendres du Royaume depuis les tréfonds de sa citadelle. Qui est ce Maléfique ?`,
      order: base + 8, answer: 'zorghon', hint: 'Son nom seul suffit à glacer le sang des PNJ du Royaume.', chapter: chapterNum });
  } else {
    QUESTS.push({ key: `quest.kingdom.ch${pad}.guardian`, label: `🛡️ ${prefix()}${GUARDIAN_TPL[v]()}`,
      order: base + 8, answer: guardian, hint: `Indice : son nom se termine par « ${lastWord(guardian)} ».`, chapter: chapterNum });
  }

  QUESTS.push({ key: `quest.kingdom.ch${pad}.trial`, label: `⚖️ ${prefix()}${TRIAL_TPL[v](virtue)}`,
    order: base + 9, answer: virtue, hint: `Cette vertu compte ${virtue.length} lettres.`, chapter: chapterNum });

  if (isFinal) {
    QUESTS.push({ key: `quest.kingdom.ch${pad}.moon`,
      label: `🌕 ${prefix()}Ce soir de pleine lune, les sceaux de Zorghon faiblissent enfin. C'est l'heure de porter le coup final pour libérer la Princesse PocaPoka et son fidèle El Pipo. Quelle lumière succède toujours à la nuit la plus sombre et scelle la défaite du Maléfique ?`,
      order: base + 10, answer: 'aurore', hint: 'Elle se lève chaque matin, même après la pire des nuits.', chapter: chapterNum, fullMoonOnly: true,
      itemReward: { itemId: 'titre_liberateur_royaume', name: '🏆 Titre de Libérateur du Royaume', qty: 1, category: 'treasure', effect: {} },
      bonusReward: true });
  } else {
    QUESTS.push({ key: `quest.kingdom.ch${pad}.moon`, label: `🌕 ${prefix()}${MOON_TPL[v](location)}`,
      order: base + 10, answer: `pleine lune de ${location}`, hint: `Le nom est simplement « Pleine Lune de ${location} ».`, chapter: chapterNum, fullMoonOnly: true });
  }
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
  const now = Date.now();

  const existingSnap = await get(ref(db, 'catalog/quests'));
  const existing = existingSnap.val() ? Object.values(existingSnap.val()) : [];
  let nextOrder = existing.reduce((max, q) => Math.max(max, q.order ?? -1), -1) + 1;

  console.log(`Préparation de ${QUESTS.length} Quêtes du Royaume (attendu : 400)…`);
  for (const q of QUESTS) {
    const id = keccak256(toBytes(q.key)).toLowerCase();
    const normalized = normalizeAnswer(q.answer);
    const answerHash = keccak256(toBytes(normalized)).toLowerCase();
    const xpReward = q.bonusReward ? Math.round(xpRewardFor(q.order) * 4) : xpRewardFor(q.order);
    const scoreReward = q.bonusReward ? Math.round(scoreRewardFor(q.order) * 4) : scoreRewardFor(q.order);
    const def = {
      id, label: q.label, xpRequired: 0, xpReward, scoreReward, answerHash,
      active: true, createdAt: now, order: nextOrder, i18nKey: q.key,
      hint: q.hint, hintKey: `${q.key}.hint`,
      kingdomQuest: true, kingdomChapter: q.chapter, kingdomOrder: q.order,
      ...(q.fullMoonOnly ? { fullMoonOnly: true } : {}),
      ...(q.itemReward ? { itemReward: q.itemReward } : {}),
    };
    await set(ref(db, `catalog/quests/${id}`), def);
    await set(ref(db, `catalog/riddleAnswers/${id}`), normalized);
    nextOrder += 1;
  }
  console.log(`\n✅ ${QUESTS.length} Quêtes du Royaume opérationnelles (kingdomQuest: true, kingdomOrder 1-400).`);
  const moonCount = QUESTS.filter((q) => q.fullMoonOnly).length;
  console.log(`   dont ${moonCount} quêtes "Pleine lune" (fullMoonOnly: true).`);
  process.exit(0);
}

if (process.env.DRY_RUN === '1') {
  console.log(`QUESTS.length = ${QUESTS.length}`);
  console.log(`fullMoonOnly count = ${QUESTS.filter((q) => q.fullMoonOnly).length}`);
  console.log(`unique keys = ${new Set(QUESTS.map((q) => q.key)).size}`);
  console.log(`order range = ${Math.min(...QUESTS.map((q) => q.order))}..${Math.max(...QUESTS.map((q) => q.order))}`);
  console.log(`unique orders = ${new Set(QUESTS.map((q) => q.order)).size}`);
  process.exit(0);
} else {
  main().catch((e) => { console.error('❌', e); process.exit(1); });
}
