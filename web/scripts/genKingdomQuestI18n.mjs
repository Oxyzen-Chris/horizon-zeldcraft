/**
 * Génère les traductions EN/ES/PT des 400 "Quêtes du Royaume" (`quest.kingdom.chXX.*`) et fusionne
 * le résultat dans `web/src/i18n/messages/{en,es,pt}.json`, en réutilisant EXACTEMENT la même
 * logique d'assemblage (mêmes gabarits/variantes par chapitre, `v = idx % 4`) que
 * `seedKingdomQuests.mjs` — seuls les gabarits narratifs sont traduits ; les noms propres inventés
 * (lieux, créatures, alliés, objets, sorts, gardiens) et les réponses (`answer`) restent inchangés
 * dans toutes les langues, exactement comme les 5 énigmes historiques (`quest.riddle_*`, voir
 * `seedRiddleAnswers.mjs` : réponse `"glace"` même quand la question est affichée en anglais).
 *
 * Pourquoi un script séparé plutôt que d'éditer les 4 JSON à la main : 400 quêtes × (label + hint)
 * × 3 langues = 2400 chaînes ; les factoriser via les mêmes 9 tableaux de gabarits (4 variantes
 * chacun) + les 40 énigmes logiques + les gabarits d'indices + les 3 phrases spéciales du chapitre
 * final rend la traduction709 gérable ET reproductible si de nouveaux chapitres sont ajoutés un
 * jour à `seedKingdomQuests.mjs` (garder les deux fichiers synchronisés).
 *
 * N'écrit PAS dans Firebase : `catalog/quests/*` garde son `label` français (fallback) et son
 * `i18nKey` déjà posé par `seedKingdomQuests.mjs`. Ce script alimente uniquement les fichiers de
 * traduction JSON lus par `t()` (voir `src/lib/i18n.tsx`) — `localizeName()` les préfère
 * désormais au fallback français dès que la clé existe dans la locale active.
 *
 * Usage (idempotent, depuis web/) :
 *   node scripts/genKingdomQuestI18n.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MSG_DIR = join(__dirname, '..', 'src', 'i18n', 'messages');

function firstWord(s) { return s.replace(/[^\p{L}\p{N}\s'-]/gu, '').trim().split(/\s+/)[0]; }
function lastWord(s) { const w = s.replace(/[^\p{L}\p{N}\s'-]/gu, '').trim().split(/\s+/); return w[w.length - 1]; }

// ─── Mêmes 40 chapitres / noms propres que seedKingdomQuests.mjs (inchangés dans toutes les langues) ───
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

// ─── 40 énigmes logiques traduites (texte + indice) — réponse identique dans toutes les langues ───
const LOGIC_RIDDLES = {
  en: [
    { text: 'I grow when fed with wood, but I die if drowned. What am I?', hint: 'The wind fans me, water puts me out.' },
    { text: 'The more you take of me, the more traces I leave behind. What am I?', hint: "I'm left behind in sand or snow." },
    { text: 'I have neither mouth nor throat, yet I can make you cry at the table. What am I?', hint: "I'm peeled before being cut." },
    { text: 'I have cities without houses, forests without trees, and rivers without water. What am I?', hint: "I'm unfolded to find your way." },
    { text: 'I am always ahead of you but you can never reach me. What am I?', hint: 'I recede as you advance.' },
    { text: "I'm broken before I'm even used. What am I?", hint: 'I can become an omelette.' },
    { text: 'I have one colour but a thousand shapes, and I vanish the moment the light goes out. What am I?', hint: 'I always follow you in the sun.' },
    { text: 'I dance without legs and sing without a mouth. What am I?', hint: 'You feel me but never see me.' },
    { text: 'The bigger I am, the less I weigh. What am I?', hint: "I'm dug, but never truly filled." },
    { text: 'I am born in the mountains and I die in the sea. What am I?', hint: 'I always flow downward.' },
    { text: "I'm made of drops but I can drown you if ignored for too long. What am I?", hint: 'I fall from the sky in summer as in winter.' },
    { text: 'I have no mouth but I tell the passing of time on my stone face. What am I?', hint: 'Without sun, I say nothing at all.' },
    { text: 'I am light as a feather but even the strongest cannot hold me for more than a few minutes. What am I?', hint: 'You hold me in, then let me go.' },
    { text: 'I only exist when two opposite elements meet: the sun and the rain. What am I?', hint: 'I carry seven colours without ever mixing them.' },
    { text: "I have no teeth but I can bite through time; I'm found among the oldest guardians of the Kingdom. What am I?", hint: 'It rarely comes alone with youth.' },
    { text: 'I am a king as long as I stand, but I melt the moment fire comes near. What am I?', hint: "I don't survive the summer." },
    { text: 'I have only one needle but I never sew. What am I?', hint: 'I always point to the same horizon.' },
    { text: 'I have no mouth but I repeat every word you shout in the mountains. What am I?', hint: 'The deeper the valley, the longer I linger.' },
    { text: 'I grow in winter and die in summer, unlike every plant. What am I?', hint: 'I hang from the roofs of frozen huts.' },
    { text: 'I am a book no one has ever written but everyone can read in the sky. What am I?', hint: 'Sailors have always used me to find their way.' },
    { text: "The older I am, the more I'm worth, except for bread and milk. What am I?", hint: "I'm kept in a dark cellar for years." },
    { text: 'Without eyes I weep, without a mouth I sing when the wind passes through me. What am I?', hint: "I'm hung up so the wind can play me." },
    { text: 'I am always running yet I never leave my place. What am I?', hint: 'My hands turn without ever stopping.' },
    { text: 'I am full of holes but I hold water. What am I?', hint: "I'm used to clean up after battle." },
    { text: "I die every time I'm spoken. What am I?", hint: "I'm broken with a single word." },
    { text: 'I am round, I float in the sky, and I change shape every night without ever disappearing. What am I?', hint: 'I am full once a month.' },
    { text: 'I slowly eat away at metal without ever raising a single weapon. What am I?', hint: 'I hate oil and upkeep.' },
    { text: 'I am made of sand but I count the hours. What am I?', hint: "I'm turned over when time runs out." },
    { text: 'I have no wings but I fly from mouth to mouth across the whole Kingdom. What am I?', hint: "The more I'm told, the more I grow... and distort the truth." },
    { text: 'I am a bridge built only with words. What am I?', hint: 'I can be broken as easily as a twig.' },
    { text: 'I grow in the dark and wither in the light. What am I?', hint: "I'm found in damp caves." },
    { text: 'I am an army all by myself when I multiply silently in the shadow of hearts. What am I?', hint: 'I grow with silence and the unknown.' },
    { text: 'I have no flame but I can burn a heart for years. What am I?', hint: "I'm fed with old memories." },
    { text: 'I am a thief who never takes anything, yet everyone dreads losing me. What am I?', hint: 'You can never stop me, only measure me.' },
    { text: 'Forged in fire, I fear only rust and forgetting, sometimes asleep for centuries before a hero awakens me. What am I?', hint: "I'm sometimes drawn from a rock or a tomb." },
    { text: 'I die if forgotten but I am reborn if cared for, again and again. What am I?', hint: 'Spring is my eternal symbol.' },
    { text: 'I am a key that cannot be forged, only earned. What am I?', hint: "I'm rarely given, always earned." },
    { text: 'I fall every evening without ever breaking and I always come before dawn. What am I?', hint: 'I am darkest just before everything changes.' },
    { text: 'I am the first thing Zorghon stole from the Kingdom, even before the Princess. What am I?', hint: "I'm truly appreciated only once lost." },
    { text: "I am what remains when all seems lost, PocaPoka's last weapon against Zorghon's darkness. What am I?", hint: 'I cannot be stolen as long as the heart still beats.' },
  ],
  es: [
    { text: 'Crezco cuando me alimentan con madera, pero muero si me ahogan. ¿Qué soy?', hint: 'El viento me aviva, el agua me apaga.' },
    { text: 'Cuanto más me toman, más huellas dejo detrás. ¿Qué soy?', hint: 'Me dejan en la arena o en la nieve.' },
    { text: 'No tengo boca ni garganta, pero puedo hacerte llorar en la mesa. ¿Qué soy?', hint: 'Me pelan antes de cortarme.' },
    { text: 'Tengo ciudades sin casas, bosques sin árboles y ríos sin agua. ¿Qué soy?', hint: 'Me despliegan para encontrar el camino.' },
    { text: 'Siempre estoy delante de ti, pero nunca puedes alcanzarme. ¿Qué soy?', hint: 'Retrocedo a medida que avanzas.' },
    { text: 'Me rompen incluso antes de usarme. ¿Qué soy?', hint: 'Puedo convertirme en una tortilla.' },
    { text: 'Tengo un solo color pero mil formas, y desaparezco en cuanto se apaga la luz. ¿Qué soy?', hint: 'Siempre te sigo bajo el sol.' },
    { text: 'Bailo sin piernas y canto sin boca. ¿Qué soy?', hint: 'Se me siente pero nunca se me ve.' },
    { text: 'Cuanto más grande soy, menos peso. ¿Qué soy?', hint: 'Me cavan, pero nunca me llenan de verdad.' },
    { text: 'Nazco en la montaña y muero en el mar. ¿Qué soy?', hint: 'Siempre fluyo hacia abajo.' },
    { text: 'Estoy hecha de gotas, pero puedo ahogarte si me ignoras demasiado tiempo. ¿Qué soy?', hint: 'Caigo del cielo en verano como en invierno.' },
    { text: 'No tengo boca pero cuento el paso del tiempo en mi rostro de piedra. ¿Qué soy?', hint: 'Sin sol, no digo nada.' },
    { text: 'Soy ligero como una pluma, pero ni el más fuerte puede retenerme más de unos minutos. ¿Qué soy?', hint: 'Me retienes y luego me dejas ir.' },
    { text: 'Solo existo cuando se encuentran dos elementos opuestos: el sol y la lluvia. ¿Qué soy?', hint: 'Llevo siete colores sin mezclarlos jamás.' },
    { text: 'No tengo dientes pero puedo morder el tiempo, se me encuentra entre los guardianes más viejos del Reino. ¿Qué soy?', hint: 'Rara vez llega sola junto a la juventud.' },
    { text: 'Soy un rey mientras permanezco de pie, pero me derrito en cuanto el fuego se acerca. ¿Qué soy?', hint: 'No sobrevivo al verano.' },
    { text: 'Tengo una sola aguja pero nunca coso. ¿Qué soy?', hint: 'Siempre señalo el mismo horizonte.' },
    { text: 'No tengo boca pero repito cada palabra que gritas en las montañas. ¿Qué soy?', hint: 'Cuanto más profundo el valle, más persisto.' },
    { text: 'Crezco en invierno y muero en verano, al contrario que todas las plantas. ¿Qué soy?', hint: 'Cuelgo del techo de las cabañas heladas.' },
    { text: 'Soy un libro que nadie ha escrito jamás pero que todos pueden leer en el cielo. ¿Qué soy?', hint: 'Los marineros siempre me usaron para guiarse.' },
    { text: 'Cuanto más viejo soy, más valgo, excepto para el pan y la leche. ¿Qué soy?', hint: 'Me guardan en una bodega oscura durante años.' },
    { text: 'Sin ojos lloro, sin boca canto cuando el viento me atraviesa. ¿Qué soy?', hint: 'Me cuelgan para que el viento toque en mí.' },
    { text: 'Siempre estoy corriendo pero nunca abandono mi lugar. ¿Qué soy?', hint: 'Mis manecillas giran sin detenerse jamás.' },
    { text: 'Estoy llena de agujeros pero retengo el agua. ¿Qué soy?', hint: 'Me usan para limpiar después del combate.' },
    { text: 'Muero cada vez que me pronuncian. ¿Qué soy?', hint: 'Me rompen con una sola palabra.' },
    { text: 'Soy redonda, floto en el cielo y cambio de forma cada noche sin desaparecer jamás. ¿Qué soy?', hint: 'Estoy llena una vez al mes.' },
    { text: 'Corroo lentamente el metal sin levantar jamás un arma. ¿Qué soy?', hint: 'Odio el aceite y el mantenimiento.' },
    { text: 'Estoy hecho de arena pero cuento las horas. ¿Qué soy?', hint: 'Me voltean cuando el tiempo se agota.' },
    { text: 'No tengo alas pero vuelo de boca en boca por todo el Reino. ¿Qué soy?', hint: 'Cuanto más me cuentan, más crezco... y deformo la verdad.' },
    { text: 'Soy un puente que solo se construye con palabras. ¿Qué soy?', hint: 'Puedo romperme tan fácilmente como una ramita.' },
    { text: 'Crezco en la oscuridad y me marchito con la luz. ¿Qué soy?', hint: 'Se me encuentra en cuevas húmedas.' },
    { text: 'Soy un ejército yo sola cuando me multiplico en silencio en la sombra de los corazones. ¿Qué soy?', hint: 'Crezco con el silencio y lo desconocido.' },
    { text: 'No tengo llama pero puedo quemar un corazón durante años. ¿Qué soy?', hint: 'Me alimentan con viejos recuerdos.' },
    { text: 'Soy un ladrón que nunca toma nada, pero todos temen perderme. ¿Qué soy?', hint: 'Nunca se me puede detener, solo medir.' },
    { text: 'Forjada en el fuego, solo temo el óxido y el olvido, a veces dormida durante siglos antes de que un héroe me despierte. ¿Qué soy?', hint: 'A veces me sacan de una roca o de una tumba.' },
    { text: 'Muero si me olvidan pero renazco si me cuidan, una y otra vez. ¿Qué soy?', hint: 'La primavera es mi símbolo eterno.' },
    { text: 'Soy una llave que no se puede forjar, solo ganar. ¿Qué soy?', hint: 'Rara vez se me da, siempre se me gana.' },
    { text: 'Caigo cada noche sin romperme jamás y siempre precedo al amanecer. ¿Qué soy?', hint: 'Soy más oscura justo antes de que todo cambie.' },
    { text: 'Soy lo primero que Zorghon robó al Reino, incluso antes que a la Princesa. ¿Qué soy?', hint: 'Solo se me aprecia de verdad una vez perdida.' },
    { text: 'Soy lo que queda cuando todo parece perdido, la última arma de PocaPoka contra las tinieblas de Zorghon. ¿Qué soy?', hint: 'No pueden robarme mientras el corazón siga latiendo.' },
  ],
  pt: [
    { text: 'Cresço quando me alimentam com madeira, mas morro se me afogam. O que sou?', hint: 'O vento me aviva, a água me apaga.' },
    { text: 'Quanto mais me tiram, mais rastros deixo para trás. O que sou?', hint: 'Me deixam na areia ou na neve.' },
    { text: 'Não tenho boca nem garganta, mas posso te fazer chorar à mesa. O que sou?', hint: 'Sou descascado antes de ser cortado.' },
    { text: 'Tenho cidades sem casas, florestas sem árvores e rios sem água. O que sou?', hint: 'Sou desdobrado para encontrar o caminho.' },
    { text: 'Estou sempre à sua frente, mas você nunca pode me alcançar. O que sou?', hint: 'Recuo à medida que você avança.' },
    { text: 'Sou quebrado antes mesmo de ser usado. O que sou?', hint: 'Posso virar uma omelete.' },
    { text: 'Tenho uma só cor mas mil formas, e desapareço assim que a luz se apaga. O que sou?', hint: 'Sempre te sigo ao sol.' },
    { text: 'Danço sem pernas e canto sem boca. O que sou?', hint: 'Sou sentido mas nunca visto.' },
    { text: 'Quanto maior sou, menos peso. O que sou?', hint: 'Sou cavado, mas nunca realmente preenchido.' },
    { text: 'Nasço na montanha e morro no mar. O que sou?', hint: 'Sempre corro para baixo.' },
    { text: 'Sou feita de gotas, mas posso te afogar se me ignorarem por muito tempo. O que sou?', hint: 'Caio do céu no verão como no inverno.' },
    { text: 'Não tenho boca mas conto o tempo que passa no meu rosto de pedra. O que sou?', hint: 'Sem sol, não digo nada.' },
    { text: 'Sou leve como uma pluma, mas nem o mais forte consegue me segurar por mais de alguns minutos. O que sou?', hint: 'Você me retém e depois me solta.' },
    { text: 'Só existo quando dois elementos opostos se encontram: o sol e a chuva. O que sou?', hint: 'Carrego sete cores sem nunca misturá-las.' },
    { text: 'Não tenho dentes mas posso morder o tempo, sou encontrada entre os guardiões mais antigos do Reino. O que sou?', hint: 'Raramente vem sozinha com a juventude.' },
    { text: 'Sou um rei enquanto fico de pé, mas derreto assim que o fogo se aproxima. O que sou?', hint: 'Não sobrevivo ao verão.' },
    { text: 'Tenho apenas uma agulha mas nunca costuro. O que sou?', hint: 'Sempre aponto para o mesmo horizonte.' },
    { text: 'Não tenho boca mas repito cada palavra que você grita nas montanhas. O que sou?', hint: 'Quanto mais profundo o vale, mais persisto.' },
    { text: 'Cresço no inverno e morro no verão, ao contrário de todas as plantas. O que sou?', hint: 'Fico pendurado no telhado das cabanas geladas.' },
    { text: 'Sou um livro que ninguém jamais escreveu mas que todos podem ler no céu. O que sou?', hint: 'Os marinheiros sempre me usaram para se guiar.' },
    { text: 'Quanto mais velho sou, mais valho, exceto para o pão e o leite. O que sou?', hint: 'Sou guardado numa adega escura por anos.' },
    { text: 'Sem olhos choro, sem boca canto quando o vento me atravessa. O que sou?', hint: 'Sou pendurada para que o vento toque em mim.' },
    { text: 'Estou sempre correndo mas nunca saio do meu lugar. O que sou?', hint: 'Meus ponteiros giram sem nunca parar.' },
    { text: 'Estou cheia de buracos mas retenho a água. O que sou?', hint: 'Sou usada para limpar depois da batalha.' },
    { text: 'Morro toda vez que sou pronunciado. O que sou?', hint: 'Sou quebrado com uma única palavra.' },
    { text: 'Sou redonda, flutuo no céu e mudo de forma toda noite sem nunca desaparecer. O que sou?', hint: 'Fico cheia uma vez por mês.' },
    { text: 'Corroo lentamente o metal sem nunca erguer uma única arma. O que sou?', hint: 'Odeio óleo e manutenção.' },
    { text: 'Sou feita de areia mas conto as horas. O que sou?', hint: 'Sou virada quando o tempo se esgota.' },
    { text: 'Não tenho asas mas voo de boca em boca por todo o Reino. O que sou?', hint: 'Quanto mais me contam, mais cresço... e deformo a verdade.' },
    { text: 'Sou uma ponte que só se constrói com palavras. O que sou?', hint: 'Posso ser quebrada tão facilmente quanto um graveto.' },
    { text: 'Cresço no escuro e murcho na luz. O que sou?', hint: 'Sou encontrado em cavernas úmidas.' },
    { text: 'Sou um exército sozinha quando me multiplico em silêncio na sombra dos corações. O que sou?', hint: 'Cresço com o silêncio e o desconhecido.' },
    { text: 'Não tenho chama mas posso queimar um coração por anos. O que sou?', hint: 'Sou alimentado com velhas lembranças.' },
    { text: 'Sou um ladrão que nunca leva nada, mas todos temem me perder. O que sou?', hint: 'Nunca podem me parar, apenas me medir.' },
    { text: 'Forjada no fogo, só temo a ferrugem e o esquecimento, às vezes adormecida por séculos até que um herói me desperte. O que sou?', hint: 'Às vezes sou tirada de uma rocha ou de um túmulo.' },
    { text: 'Morro se me esquecerem mas renasço se cuidarem de mim, vezes sem conta. O que sou?', hint: 'A primavera é meu símbolo eterno.' },
    { text: 'Sou uma chave que não se pode forjar, apenas merecer. O que sou?', hint: 'Raramente sou dada, sempre sou conquistada.' },
    { text: 'Caio toda noite sem nunca me quebrar e sempre precedo o amanhecer. O que sou?', hint: 'Sou mais escura pouco antes de tudo mudar.' },
    { text: 'Sou a primeira coisa que Zorghon roubou do Reino, antes mesmo da Princesa. O que sou?', hint: 'Só sou verdadeiramente apreciada uma vez perdida.' },
    { text: 'Sou o que resta quando tudo parece perdido, a última arma de PocaPoka contra as trevas de Zorghon. O que sou?', hint: 'Não podem me roubar enquanto o coração ainda bater.' },
  ],
};

const TPL = {
  en: {
    prefix: (n, loc) => `Kingdom Quest — Chapter ${n} (${loc}): `,
    glyph: [
      (loc) => `Carved by the Ancients at the entrance of ${loc}, this glyph only activates when you speak the name of the place it has protected for centuries. What is that name?`,
      (loc) => `This runic symbol watches over ${loc} and answers only to those who know the exact name of the land it seals. What is that name?`,
      (loc) => `On a stone arch at ${loc}, an ancient glyph demands only one thing before it lights up: the name of the place itself. Which one?`,
      (loc) => `Local NPCs say an ancient glyph guards ${loc} and only fades once its true name is spoken. What is that name?`,
    ],
    location: [
      (creature, guardian) => `A territory haunted by ${creature} and watched over by ${guardian}, as one draws closer to Zorghon. What is the name of this place?`,
      (creature, guardian) => `The Kingdom's maps mark this place as the one where ${creature} roams, under the watch of ${guardian}. What is its name?`,
      (creature, guardian) => `Between legend and danger, this territory shelters ${creature} and ${guardian} at its heart. What is it called?`,
      (creature, guardian) => `Neither quite a village nor a ruin, this feared place shelters ${creature} and lies under the guard of ${guardian}. What is its name?`,
    ],
    creature: [
      (loc) => `I roam ${loc}, feared by travelers who venture there alone. Half beast, half legend of the Kingdom. Who am I?`,
      (loc) => `They tell tales of me around campfires: a creature of ${loc} best never crossed at night. Who am I?`,
      (loc) => `Unwilling guardian of ${loc}, I only seek to protect my territory — to my own cost if faced without respect. Who am I?`,
      (loc) => `The NPCs of ${loc} avoid saying my name after dusk. Who am I?`,
    ],
    ally: [
      (loc) => `A valuable ally waits to be convinced to join your quest at ${loc}; their knowledge of the terrain will be essential to you. Who is he or she?`,
      (loc) => `The NPCs of ${loc} speak of a figure ready to fight beside you against Zorghon, if you earn their trust. Who is it?`,
      (loc) => `A traveling companion awaits you at ${loc}, ready to swell the ranks of the resistance against the Evil One. Who is he or she?`,
      (loc) => `At ${loc}, a brave soul is looking for a trustworthy adventurer to join the fight against Zorghon. Who is it?`,
    ],
    item: [
      (loc) => `Hidden at ${loc}, an ancient object awaits whoever can find it — it could well make the difference against Zorghon's Lieutenants. What is this object?`,
      (loc) => `The NPCs of ${loc} speak of a forgotten relic, buried or sealed somewhere in the region. Which relic?`,
      (loc) => `A treasure of the Kingdom sleeps at ${loc}, waiting for a hero worthy of carrying it. What is this object?`,
      (loc) => `A legendary relic of ${loc} awaits only to be claimed by whoever can name it. What is its name?`,
    ],
    spell: [
      (loc) => `A forgotten spell slumbers at ${loc}, once passed down by the Kingdom's mages. What is this spell?`,
      (loc) => `The grimoires of ${loc} mention a powerful spell, essential for facing what lurks further on. What is this spell?`,
      (loc) => `An ancient spell still protects ${loc}, passed down from mage to mage for generations. What is it called?`,
      (loc) => `It's said a unique spell was invented at ${loc} to push back the darkness. What is this spell?`,
    ],
    guardian: [
      () => `A fearsome guardian protects this chapter of the Kingdom, testing any adventurer who dares to advance. Who is he?`,
      () => `None pass without facing this guardian, whose name alone is enough to make the local NPCs tremble. Who is he?`,
      () => `This protector (or jailer) jealously watches over this territory of the Kingdom. Who is he?`,
      () => `His shadow looms over the whole chapter: impossible to advance without naming him. Who is he?`,
    ],
    trial: [
      (v) => `To pass this trial of the Kingdom, you must show a specific virtue in the face of danger. Which one? (hint: ${v.length} letters)`,
      (v) => `The Elders of the Kingdom demand a single quality to continue further in this quest. Which one? (hint: ${v.length} letters)`,
      (v) => `An invisible test judges every adventurer on an essential virtue before letting them pass. Which one? (hint: ${v.length} letters)`,
      (v) => `This chapter of the Kingdom opens only to those who prove a specific virtue through their deeds. Which one? (hint: ${v.length} letters)`,
    ],
    moon: [
      (loc) => `On this full-moon night, a rare phenomenon reveals itself at ${loc}: a halo that only the oldest NPCs know how to name. What do they call it?`,
      (loc) => `Under the full moon, ${loc} reveals a secret invisible the rest of the month. What name is given to it?`,
      (loc) => `Legend says that once a month, ${loc} reveals a lunar mystery to those who know how to look. What is it called?`,
      (loc) => `Only the full moon allows this hidden phenomenon at ${loc} to be perceived. What is its name?`,
    ],
    hintStartsWith: (w) => `Hint: the name starts with "${w}".`,
    hintEndsWith: (w) => `Hint: its name ends with "${w}".`,
    hintVirtueLength: (n) => `This virtue has ${n} letters.`,
    hintMoon: (loc) => `The name is simply "Full Moon of ${loc}".`,
    finalAllyLabel: `The entire Kingdom holds its breath, ready to welcome back its princess and her faithful sand-sprite companion. Who are they, she and him?`,
    finalAllyHint: `She wears a crown of golden sand; he never leaves her side.`,
    finalGuardianLabel: `He kidnapped Princess PocaPoka and her faithful El Pipo to rule over the Kingdom's ashes from the depths of his citadel. Who is this Evil One?`,
    finalGuardianHint: `His name alone is enough to chill the blood of the Kingdom's NPCs.`,
    finalMoonLabel: `On this full-moon night, Zorghon's seals finally weaken. It's time to deliver the final blow to free Princess PocaPoka and her faithful El Pipo. What light always follows the darkest night and seals the Evil One's defeat?`,
    finalMoonHint: `It rises every morning, even after the worst of nights.`,
  },
  es: {
    prefix: (n, loc) => `Misión del Reino — Capítulo ${n} (${loc}): `,
    glyph: [
      (loc) => `Grabado por los Antiguos en la entrada de ${loc}, este glifo solo se activa al pronunciar el nombre del lugar que protege desde hace siglos. ¿Cuál es ese nombre?`,
      (loc) => `Este símbolo rúnico vela por ${loc} y solo responde a quien conoce el nombre exacto de la tierra que sella. ¿Cuál es ese nombre?`,
      (loc) => `En un arco de piedra en ${loc}, un antiguo glifo exige una sola cosa antes de iluminarse: el nombre del lugar mismo. ¿Cuál es?`,
      (loc) => `Los PNJ locales cuentan que un antiguo glifo custodia ${loc} y solo se apaga si se pronuncia su verdadero nombre. ¿Cuál es ese nombre?`,
    ],
    location: [
      (creature, guardian) => `Un territorio acechado por ${creature} y vigilado por ${guardian}, a medida que uno se acerca a Zorghon. ¿Cuál es el nombre de este lugar?`,
      (creature, guardian) => `Los mapas del Reino señalan este lugar como aquel donde ronda ${creature}, bajo la mirada de ${guardian}. ¿Cuál es su nombre?`,
      (creature, guardian) => `Entre leyenda y peligro, este territorio alberga a ${creature} y a ${guardian} en su corazón. ¿Cómo se le llama?`,
      (creature, guardian) => `Ni del todo aldea ni ruina, este lugar temido alberga a ${creature} y se encuentra bajo la guardia de ${guardian}. ¿Cuál es su nombre?`,
    ],
    creature: [
      (loc) => `Ronda por ${loc}, temida por los viajeros que se aventuran allí solos. Mitad bestia, mitad leyenda del Reino. ¿Quién soy?`,
      (loc) => `Se cuenta junto a las hogueras: una criatura de ${loc} a la que más vale no cruzarse de noche. ¿Quién soy?`,
      (loc) => `Guardiana involuntaria de ${loc}, solo busco proteger mi territorio, a mi pesar si me enfrentan sin respeto. ¿Quién soy?`,
      (loc) => `Los PNJ de ${loc} evitan pronunciar mi nombre después del anochecer. ¿Quién soy?`,
    ],
    ally: [
      (loc) => `Un valioso aliado espera ser convencido de unirse a tu misión en ${loc}; su conocimiento del terreno te será indispensable. ¿Quién es él o ella?`,
      (loc) => `Los PNJ de ${loc} hablan de una figura dispuesta a luchar a tu lado contra Zorghon, si te ganas su confianza. ¿Quién es?`,
      (loc) => `Un compañero de viaje te espera en ${loc}, listo para engrosar las filas de la resistencia frente al Maléfico. ¿Quién es él o ella?`,
      (loc) => `En ${loc}, un alma valiente busca a un aventurero de confianza para unirse a la lucha contra Zorghon. ¿Quién es?`,
    ],
    item: [
      (loc) => `Escondido en ${loc}, un objeto antiguo espera a quien sepa encontrarlo; podría marcar la diferencia frente a los Tenientes de Zorghon. ¿Cuál es ese objeto?`,
      (loc) => `Los PNJ de ${loc} hablan de una reliquia olvidada, enterrada o sellada en algún lugar de la región. ¿Qué reliquia?`,
      (loc) => `Un tesoro del Reino duerme en ${loc}, esperando a un héroe digno de portarlo. ¿Cuál es ese objeto?`,
      (loc) => `Una reliquia legendaria de ${loc} solo espera ser reclamada por quien sepa nombrarla. ¿Cuál es su nombre?`,
    ],
    spell: [
      (loc) => `Un hechizo olvidado dormita en ${loc}, transmitido antaño por los magos del Reino. ¿Cuál es ese hechizo?`,
      (loc) => `Los grimorios de ${loc} mencionan un hechizo poderoso, indispensable para enfrentar lo que acecha más allá. ¿Cuál es ese hechizo?`,
      (loc) => `Un hechizo antiguo aún protege ${loc}, transmitido de mago en mago durante generaciones. ¿Cómo se le llama?`,
      (loc) => `Se cuenta que un hechizo único fue inventado en ${loc} para repeler las tinieblas. ¿Cuál es ese hechizo?`,
    ],
    guardian: [
      () => `Un guardián temible protege este capítulo del Reino, poniendo a prueba a todo aventurero que ose avanzar. ¿Quién es?`,
      () => `Nadie pasa sin enfrentarse a este guardián, cuyo solo nombre basta para hacer temblar a los PNJ del lugar. ¿Quién es?`,
      () => `Este protector (o carcelero) vela celosamente por este territorio del Reino. ¿Quién es?`,
      () => `Su sombra se cierne sobre todo el capítulo: imposible avanzar sin nombrarlo. ¿Quién es?`,
    ],
    trial: [
      (v) => `Para superar esta prueba del Reino, debes demostrar una virtud precisa frente al peligro. ¿Cuál? (pista: ${v.length} letras)`,
      (v) => `Los Ancianos del Reino exigen una sola cualidad para seguir avanzando en esta misión. ¿Cuál? (pista: ${v.length} letras)`,
      (v) => `Una prueba invisible juzga a cada aventurero por una virtud esencial antes de dejarlo pasar. ¿Cuál? (pista: ${v.length} letras)`,
      (v) => `Este capítulo del Reino solo se abre a quien demuestre una virtud precisa con sus actos. ¿Cuál? (pista: ${v.length} letras)`,
    ],
    moon: [
      (loc) => `Esta noche de luna llena, un fenómeno raro se revela en ${loc}: un halo que solo los PNJ más ancianos saben nombrar. ¿Cómo lo llaman?`,
      (loc) => `Bajo la luna llena, ${loc} deja entrever un secreto invisible el resto del mes. ¿Qué nombre se le da?`,
      (loc) => `La leyenda cuenta que una sola noche al mes, ${loc} revela un misterio lunar a quien sabe mirar. ¿Cómo se le llama?`,
      (loc) => `Solo la luna llena permite percibir este fenómeno oculto en ${loc}. ¿Cuál es su nombre?`,
    ],
    hintStartsWith: (w) => `Pista: el nombre empieza por «${w}».`,
    hintEndsWith: (w) => `Pista: su nombre termina en «${w}».`,
    hintVirtueLength: (n) => `Esta virtud tiene ${n} letras.`,
    hintMoon: (loc) => `El nombre es simplemente «Luna Llena de ${loc}».`,
    finalAllyLabel: `Todo el Reino contiene la respiración, listo para recibir de nuevo a su princesa y a su fiel compañero duende de arena. ¿Quiénes son, ella y él?`,
    finalAllyHint: `Ella lleva una corona de arena dorada; él nunca se separa de ella.`,
    finalGuardianLabel: `Secuestró a la Princesa PocaPoka y a su fiel El Pipo para reinar sobre las cenizas del Reino desde las profundidades de su ciudadela. ¿Quién es este Maléfico?`,
    finalGuardianHint: `Su sola mención basta para helar la sangre de los PNJ del Reino.`,
    finalMoonLabel: `Esta noche de luna llena, los sellos de Zorghon por fin se debilitan. Es hora de dar el golpe final para liberar a la Princesa PocaPoka y a su fiel El Pipo. ¿Qué luz sucede siempre a la noche más oscura y sella la derrota del Maléfico?`,
    finalMoonHint: `Sale cada mañana, incluso tras la peor de las noches.`,
  },
  pt: {
    prefix: (n, loc) => `Missão do Reino — Capítulo ${n} (${loc}): `,
    glyph: [
      (loc) => `Gravado pelos Antigos na entrada de ${loc}, este glifo só se ativa ao pronunciar o nome do lugar que protege há séculos. Qual é esse nome?`,
      (loc) => `Este símbolo rúnico vela por ${loc} e só responde a quem conhece o nome exato da terra que sela. Qual é esse nome?`,
      (loc) => `Num arco de pedra em ${loc}, um glifo antigo exige apenas uma coisa antes de se iluminar: o nome do próprio lugar. Qual é?`,
      (loc) => `Os NPCs locais contam que um glifo antigo guarda ${loc} e só se apaga se pronunciarem seu verdadeiro nome. Qual é esse nome?`,
    ],
    location: [
      (creature, guardian) => `Um território assombrado por ${creature} e vigiado por ${guardian}, à medida que se aproxima de Zorghon. Qual é o nome deste lugar?`,
      (creature, guardian) => `Os mapas do Reino apontam este lugar como aquele onde ronda ${creature}, sob o olhar de ${guardian}. Qual é o seu nome?`,
      (creature, guardian) => `Entre lenda e perigo, este território abriga ${creature} e ${guardian} em seu coração. Como se chama?`,
      (creature, guardian) => `Nem bem uma aldeia nem uma ruína, este lugar temido abriga ${creature} e está sob a guarda de ${guardian}. Qual é o seu nome?`,
    ],
    creature: [
      (loc) => `Ronda por ${loc}, temida pelos viajantes que se aventuram sozinhos por lá. Metade fera, metade lenda do Reino. Quem sou eu?`,
      (loc) => `Contam sobre mim ao redor das fogueiras: uma criatura de ${loc} que é melhor nunca encontrar à noite. Quem sou eu?`,
      (loc) => `Guardiã involuntária de ${loc}, só busco proteger meu território — para meu próprio azar se me enfrentarem sem respeito. Quem sou eu?`,
      (loc) => `Os NPCs de ${loc} evitam dizer meu nome depois do anoitecer. Quem sou eu?`,
    ],
    ally: [
      (loc) => `Um aliado valioso espera ser convencido a se juntar à sua missão em ${loc}; seu conhecimento do terreno será indispensável para você. Quem é ele ou ela?`,
      (loc) => `Os NPCs de ${loc} falam de uma figura pronta para lutar ao seu lado contra Zorghon, se você conquistar sua confiança. Quem é?`,
      (loc) => `Um companheiro de jornada espera por você em ${loc}, pronto para engrossar as fileiras da resistência contra o Maléfico. Quem é ele ou ela?`,
      (loc) => `Em ${loc}, uma alma corajosa procura um aventureiro de confiança para se juntar à luta contra Zorghon. Quem é?`,
    ],
    item: [
      (loc) => `Escondido em ${loc}, um objeto antigo espera por quem souber encontrá-lo — ele pode fazer toda a diferença contra os Tenentes de Zorghon. Qual é esse objeto?`,
      (loc) => `Os NPCs de ${loc} falam de uma relíquia esquecida, enterrada ou selada em algum lugar da região. Qual relíquia?`,
      (loc) => `Um tesouro do Reino dorme em ${loc}, esperando por um herói digno de carregá-lo. Qual é esse objeto?`,
      (loc) => `Uma relíquia lendária de ${loc} só espera ser reclamada por quem souber nomeá-la. Qual é o seu nome?`,
    ],
    spell: [
      (loc) => `Um feitiço esquecido dorme em ${loc}, transmitido outrora pelos magos do Reino. Qual é esse feitiço?`,
      (loc) => `Os grimórios de ${loc} mencionam um feitiço poderoso, indispensável para enfrentar o que espreita mais adiante. Qual é esse feitiço?`,
      (loc) => `Um feitiço antigo ainda protege ${loc}, transmitido de mago em mago por gerações. Como se chama?`,
      (loc) => `Conta-se que um feitiço único foi inventado em ${loc} para repelir as trevas. Qual é esse feitiço?`,
    ],
    guardian: [
      () => `Um guardião temível protege este capítulo do Reino, testando qualquer aventureiro que ouse avançar. Quem é ele?`,
      () => `Ninguém passa sem enfrentar este guardião, cujo nome sozinho já basta para fazer os NPCs locais tremerem. Quem é ele?`,
      () => `Este protetor (ou carcereiro) vela ciosamente por este território do Reino. Quem é ele?`,
      () => `Sua sombra paira sobre todo o capítulo: impossível avançar sem nomeá-lo. Quem é ele?`,
    ],
    trial: [
      (v) => `Para superar esta provação do Reino, você deve demonstrar uma virtude precisa diante do perigo. Qual? (dica: ${v.length} letras)`,
      (v) => `Os Anciãos do Reino exigem uma única qualidade para continuar mais adiante nesta missão. Qual? (dica: ${v.length} letras)`,
      (v) => `Um teste invisível julga cada aventureiro por uma virtude essencial antes de deixá-lo passar. Qual? (dica: ${v.length} letras)`,
      (v) => `Este capítulo do Reino só se abre para quem provar uma virtude precisa em seus atos. Qual? (dica: ${v.length} letras)`,
    ],
    moon: [
      (loc) => `Nesta noite de lua cheia, um fenômeno raro se revela em ${loc}: um halo que só os NPCs mais antigos sabem nomear. Como o chamam?`,
      (loc) => `Sob a lua cheia, ${loc} deixa entrever um segredo invisível pelo resto do mês. Que nome lhe dão?`,
      (loc) => `A lenda conta que uma única noite por mês, ${loc} revela um mistério lunar a quem sabe olhar. Como se chama?`,
      (loc) => `Só a lua cheia permite perceber esse fenômeno oculto em ${loc}. Qual é o seu nome?`,
    ],
    hintStartsWith: (w) => `Dica: o nome começa por «${w}».`,
    hintEndsWith: (w) => `Dica: o nome termina em «${w}».`,
    hintVirtueLength: (n) => `Esta virtude tem ${n} letras.`,
    hintMoon: (loc) => `O nome é simplesmente «Lua Cheia de ${loc}».`,
    finalAllyLabel: `O Reino inteiro prende a respiração, pronto para acolher de novo sua princesa e seu fiel companheiro duende da areia. Quem são eles, ela e ele?`,
    finalAllyHint: `Ela usa uma coroa de areia dourada; ele nunca a deixa por um segundo.`,
    finalGuardianLabel: `Ele raptou a Princesa PocaPoka e seu fiel El Pipo para reinar sobre as cinzas do Reino desde as profundezas de sua cidadela. Quem é esse Maléfico?`,
    finalGuardianHint: `Só o nome já basta para gelar o sangue dos NPCs do Reino.`,
    finalMoonLabel: `Nesta noite de lua cheia, os selos de Zorghon finalmente enfraquecem. É hora de desferir o golpe final para libertar a Princesa PocaPoka e seu fiel El Pipo. Que luz sempre sucede a noite mais escura e sela a derrota do Maléfico?`,
    finalMoonHint: `Ela nasce toda manhã, mesmo depois da pior das noites.`,
  },
};

function buildLocale(locale) {
  const t = TPL[locale];
  const riddles = LOGIC_RIDDLES[locale];
  const out = {};

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
    const riddle = riddles[idx];
    const v = idx % 4;
    const isFinal = chapterNum === 40;
    const prefix = () => t.prefix(chapterNum, location);
    const K = (suffix) => `quest.kingdom.ch${pad}.${suffix}`;

    out[K('glyph')] = `📜 ${prefix()}${t.glyph[v](location)}`;
    out[K('glyph.hint')] = t.hintStartsWith(firstWord(location));

    out[K('location')] = `🗺️ ${prefix()}${t.location[v](creature, guardian)}`;
    out[K('location.hint')] = t.hintStartsWith(firstWord(location));

    out[K('creature')] = `🐾 ${prefix()}${t.creature[v](location)}`;
    out[K('creature.hint')] = t.hintEndsWith(lastWord(creature));

    if (isFinal) {
      out[K('ally')] = `🤝 ${prefix()}${t.finalAllyLabel}`;
      out[K('ally.hint')] = t.finalAllyHint;
    } else {
      out[K('ally')] = `🤝 ${prefix()}${t.ally[v](location)}`;
      out[K('ally.hint')] = t.hintEndsWith(lastWord(ally));
    }

    out[K('item')] = `💎 ${prefix()}${t.item[v](location)}`;
    out[K('item.hint')] = t.hintEndsWith(lastWord(item));

    out[K('spell')] = `✨ ${prefix()}${t.spell[v](location)}`;
    out[K('spell.hint')] = t.hintEndsWith(lastWord(spell));

    out[K('riddle')] = `❓ ${prefix()}${riddle.text}`;
    out[K('riddle.hint')] = riddle.hint;

    if (isFinal) {
      out[K('guardian')] = `🛡️ ${prefix()}${t.finalGuardianLabel}`;
      out[K('guardian.hint')] = t.finalGuardianHint;
    } else {
      out[K('guardian')] = `🛡️ ${prefix()}${t.guardian[v]()}`;
      out[K('guardian.hint')] = t.hintEndsWith(lastWord(guardian));
    }

    out[K('trial')] = `⚖️ ${prefix()}${t.trial[v](virtue)}`;
    out[K('trial.hint')] = t.hintVirtueLength(virtue.length);

    if (isFinal) {
      out[K('moon')] = `🌕 ${prefix()}${t.finalMoonLabel}`;
      out[K('moon.hint')] = t.finalMoonHint;
    } else {
      out[K('moon')] = `🌕 ${prefix()}${t.moon[v](location)}`;
      out[K('moon.hint')] = t.hintMoon(location);
    }
  }
  return out;
}

for (const locale of ['en', 'es', 'pt']) {
  const filePath = join(MSG_DIR, `${locale}.json`);
  const current = JSON.parse(readFileSync(filePath, 'utf8'));
  const generated = buildLocale(locale);
  // Préserve l'ordre existant des clés (regroupées par fonctionnalité, non trié alphabétiquement) ;
  // les nouvelles clés `quest.kingdom.*` sont simplement ajoutées à la fin, pour un diff minimal.
  const merged = { ...current, ...generated };
  writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  console.log(`✅ ${locale}.json : ${Object.keys(generated).length} clés quest.kingdom.* ajoutées/mises à jour.`);
}
console.log('\nTerminé.');
