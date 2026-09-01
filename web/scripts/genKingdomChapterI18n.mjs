/**
 * Corrige un bug de traduction distinct de celui traité par genKingdomQuestI18n.mjs : les 40 NOMS
 * DE CHAPITRE du Royaume (`kingdom.chapter.1`–`.40`, voir KINGDOM_CHAPTERS dans gameState.ts)
 * n'avaient JAMAIS de traduction, contrairement aux 400 quêtes elles-mêmes (label+hint) qui avaient
 * déjà été traitées. Ces noms de chapitre sont affichés dans 3 endroits qui appellent tous
 * `localizeName(t, ch.i18nKey, ch.title)` : le widget "Kingdom Quests" (en-tête de chaque région),
 * le widget "ZeldCraft Quests" / panneau admin "Statistiques par joueur" (sous-groupes du thème
 * "Kingdom quests" dans le ledger de progression, via computeKingdomProgress →
 * ProgressLedgerView.tsx), et le widget "World Map" (filtre par région). Comme aucune clé
 * `kingdom.chapter.N` n'existait dans aucune langue, `localizeName()` retombait systématiquement
 * sur le titre français — d'où le bug signalé (« Grottes de Kragmoor », « Terres Calcinées », etc.
 * restent en français même en EN/ES/PT).
 *
 * N'écrit pas dans Firebase (ces titres ne sont pas stockés en base, uniquement dans
 * KINGDOM_CHAPTERS côté code) — alimente uniquement les fichiers de traduction. Le FR n'a pas
 * besoin d'entrée : le titre déjà présent dans KINGDOM_CHAPTERS EST le fallback français.
 *
 * Usage (idempotent, depuis web/) :
 *   node scripts/genKingdomChapterI18n.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MSG_DIR = join(__dirname, '..', 'src', 'i18n', 'messages');

// [chapitre, en, es, pt] — même ordre narratif que KINGDOM_CHAPTERS dans gameState.ts.
const CHAPTERS = [
  [1, 'Valley of Emberrune', 'Valle de Emberrune', 'Vale de Emberrune'],
  [2, 'Sylvaltide Forest', 'Bosque de Sylvaltide', 'Floresta de Sylvaltide'],
  [3, 'Fangrouille Marsh', 'Pantano de Fangrouille', 'Pântano de Fangrouille'],
  [4, 'Pierreflamme Hills', 'Colinas de Pierreflamme', 'Colinas de Pierreflamme'],
  [5, 'Kragmoor Caves', 'Cuevas de Kragmoor', 'Cavernas de Kragmoor'],
  [6, 'Broken Bridge of Ravenoire', 'Puente Roto de Ravenoire', 'Ponte Quebrada de Ravenoire'],
  [7, 'Corenlie Plains', 'Llanuras de Corenlie', 'Planícies de Corenlie'],
  [8, 'Ruins of Anvieil', 'Ruinas de Anvieil', 'Ruínas de Anvieil'],
  [9, 'Icy Lake of Mirevent', 'Lago Helado de Mirevent', 'Lago Glacial de Mirevent'],
  [10, 'Village of Sands', 'Aldea de las Arenas', 'Vila das Areias'],
  [11, 'Desert of Sarrakoth', 'Desierto de Sarrakoth', 'Deserto de Sarrakoth'],
  [12, 'Lost Oasis of Zayira', 'Oasis Perdido de Zayira', 'Oásis Perdido de Zayira'],
  [13, 'Canyon of Echoes', 'Cañón de los Ecos', 'Cânion dos Ecos'],
  [14, 'Buried Temple of Nourah', 'Templo Enterrado de Nourah', 'Templo Soterrado de Nourah'],
  [15, 'Petrified Forest', 'Bosque Petrificado', 'Floresta Petrificada'],
  [16, 'Sunken City of Valmoria', 'Ciudad Sumergida de Valmoria', 'Cidade Submersa de Valmoria'],
  [17, 'Steppe of Khardûn', 'Estepa de Khardûn', 'Estepe de Khardûn'],
  [18, 'Camp of the Wind Nomads', 'Campamento de los Nómadas del Viento', 'Acampamento dos Nômades do Vento'],
  [19, 'Passage of Mists', 'Paso de las Brumas', 'Passagem das Brumas'],
  [20, 'Peak of Grisemont', 'Cumbre de Grisemont', 'Cume de Grisemont'],
  [21, 'Scorched Lands', 'Tierras Calcinadas', 'Terras Calcinadas'],
  [22, 'Field of Ashes', 'Campo de Cenizas', 'Campo de Cinzas'],
  [23, 'Abandoned Fort of Nathrek', 'Fuerte Abandonado de Nathrek', 'Forte Abandonado de Nathrek'],
  [24, 'River of Magma', 'Río de Magma', 'Rio de Magma'],
  [25, 'Lair of the Black Wyrm', 'Guarida de la Wyrm Negra', 'Covil da Wyrm Negra'],
  [26, 'Necropolis of Kaldrith', 'Necrópolis de Kaldrith', 'Necrópole de Kaldrith'],
  [27, 'Labyrinth of Voss', 'Laberinto de Voss', 'Labirinto de Voss'],
  [28, 'Tower of Whispers', 'Torre de los Susurros', 'Torre dos Sussurros'],
  [29, 'Bridge of Souls', 'Puente de las Almas', 'Ponte das Almas'],
  [30, 'Forgotten Sanctuary', 'Santuario Olvidado', 'Santuário Esquecido'],
  [31, 'Bastion of Zorghon', 'Bastión de Zorghon', 'Bastião de Zorghon'],
  [32, 'Prison of Ashes', 'Prisión de las Cenizas', 'Prisão das Cinzas'],
  [33, 'Court of Shadows', 'Corte de las Sombras', 'Corte das Sombras'],
  [34, 'Hall of the Lieutenants', 'Sala de los Tenientes', 'Salão dos Tenentes'],
  [35, 'Infernal Forge', 'Forja Infernal', 'Forja Infernal'],
  [36, 'Scorched Gardens', 'Jardines Calcinados', 'Jardins Calcinados'],
  [37, 'Great Black Staircase', 'Gran Escalera Negra', 'Grande Escadaria Negra'],
  [38, 'Hall of the Fallen Throne', 'Sala del Trono Caído', 'Salão do Trono Caído'],
  [39, 'Heart of the Citadel', 'Corazón de la Ciudadela', 'Coração da Cidadela'],
  [40, 'The Fall of Zorghon', 'La Caída de Zorghon', 'A Queda de Zorghon'],
];

const OUT = { en: {}, es: {}, pt: {} };
for (const [chapter, en, es, pt] of CHAPTERS) {
  const key = `kingdom.chapter.${chapter}`;
  OUT.en[key] = en;
  OUT.es[key] = es;
  OUT.pt[key] = pt;
}

for (const locale of ['en', 'es', 'pt']) {
  const filePath = join(MSG_DIR, `${locale}.json`);
  const current = JSON.parse(readFileSync(filePath, 'utf8'));
  const merged = { ...current, ...OUT[locale] };
  writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  console.log(`✅ ${locale}.json : ${Object.keys(OUT[locale]).length} clés kingdom.chapter.* ajoutées.`);
}
console.log('\nTerminé.');
