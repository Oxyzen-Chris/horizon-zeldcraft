/**
 * Termine l'audit de traduction (demande utilisateur) en ajoutant les clés manquantes des 3
 * dernières catégories de contenu généré identifiées comme non traduites :
 *  - `quest.guardians_camel` (+ `.hint`) : la quête rare "Cape d'invisibilité", voir
 *    seedInvisibilityQuest.mjs — 0 traduction dans aucune langue.
 *  - `treasure.*` (40 "trésors supplémentaires") : voir migrateNpcsTreasuresWorldsToFirebase.mjs
 *    (TREASURES_EXTRA) — i18nKey déjà assigné en base mais aucune entrée de traduction.
 *  - `npc.island.*` (15 PNJ indigènes des îles) : voir seedIslandGeography.mjs (ISLAND_NPCS) — ces
 *    PNJ n'avaient même pas de champ i18nKey (ajouté dans ce même correctif) ; on ajoute donc les
 *    traductions du NOM dans les 4 langues (y compris fr, par symétrie avec npc.official.*) — le
 *    champ `dialog` (texte d'ambiance libre) reste non traduit, comme pour les 5 PNJ officiels
 *    existants (npc.official.*) et les scripts de dialogue admin (limitation assumée, non un bug).
 *
 * N'écrit pas dans Firebase — alimente uniquement les fichiers de traduction lus par
 * `t()`/`localizeName()`. Les valeurs `answer`/noms propres/identifiants d'objet ne changent pas
 * d'une langue à l'autre (même convention que quest.riddle_*, quest.kingdom.*, quest.island_*).
 *
 * Usage (idempotent, depuis web/) :
 *   node scripts/genMiscI18n.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MSG_DIR = join(__dirname, '..', 'src', 'i18n', 'messages');

// ─────────────────────── Quête "Gardiens à trois têtes de chameaux" (invisibilité) ───────────────────────
const INVISIBILITY_QUEST = {
  en: {
    'quest.guardians_camel': "🐫 Three-Headed Camel Guardians: Three heads I bear, three gazes I cast upon whoever dares approach my treasure. Only one who becomes invisible to my six eyes may pass without a fight. What must you become to deceive me?",
    'quest.guardians_camel.hint': "Neither shield nor sword will help you here — you must vanish from their sight.",
  },
  es: {
    'quest.guardians_camel': "🐫 Guardianes Camello de Tres Cabezas: Tres cabezas llevo, tres miradas poso sobre quien ose acercarse a mi tesoro. Solo quien se vuelva invisible a mis seis ojos puede cruzarme sin combatir. ¿En qué debes convertirte para engañarme?",
    'quest.guardians_camel.hint': "Ni escudo ni espada te ayudarán aquí — debes desaparecer de su vista.",
  },
  pt: {
    'quest.guardians_camel': "🐫 Guardiões Camelo de Três Cabeças: Três cabeças eu carrego, três olhares eu lanço sobre quem ousa se aproximar do meu tesouro. Só quem se tornar invisível aos meus seis olhos pode me atravessar sem lutar. Em que deves te transformar para me enganar?",
    'quest.guardians_camel.hint': "Nem escudo nem espada te ajudarão aqui — precisas desaparecer da vista deles.",
  },
};

// ─────────────────────── 40 trésors supplémentaires (noms uniquement, pas de hint) ───────────────────────
const TREASURES_EXTRA = [
  ['treasure.pomme_doree', '🍏 Enchanted Golden Apple', '🍏 Manzana Dorada Encantada', '🍏 Maçã Dourada Encantada'],
  ['treasure.fiole_essence_verte', '🧪 Vial of Green Essence', '🧪 Frasco de Esencia Verde', '🧪 Frasco de Essência Verde'],
  ['treasure.grimoire_etincelles', '📖 Grimoire of Sparks', '📖 Grimorio de Chispas', '📖 Grimório de Faíscas'],
  ['treasure.carquois_bois_ancien', '🏹 Quiver of Ancient Wood', '🏹 Carcaj de Madera Antigua', '🏹 Aljava de Madeira Antiga'],
  ['treasure.bourse_cuivre_royale', '💰 Royal Copper Purse', '💰 Bolsa de Cobre Real', '💰 Bolsa de Cobre Real'],
  ['treasure.champignon_lueur', '🍄 Luminescent Mushroom', '🍄 Champiñón Luminiscente', '🍄 Cogumelo Luminescente'],
  ['treasure.parchemin_glace', '❄️ Runic Ice Scroll', '❄️ Pergamino Rúnico de Hielo', '❄️ Pergaminho Rúnico de Gelo'],
  ['treasure.gantelet_apprenti', "🧤 Apprentice's Gauntlet", '🧤 Guantelete del Aprendiz', '🧤 Manopla do Aprendiz'],
  ['treasure.dague_rouille', '🗡️ Rusty Dagger of the Secret Passage', '🗡️ Daga Oxidada del Pasadizo Secreto', '🗡️ Adaga Enferrujada da Passagem Secreta'],
  ['treasure.bouclier_ronce', '🌿 Shield of Thorns', '🌿 Escudo de Zarzas', '🌿 Escudo de Espinhos'],
  ['treasure.arc_bois_noueux', '🏹 Gnarled Wood Bow', '🏹 Arco de Madera Nudosa', '🏹 Arco de Madeira Nodosa'],
  ['treasure.armure_ecailles_lezard', "🦎 Lizard Scale Armor", '🦎 Armadura de Escamas de Lagarto', '🦎 Armadura de Escamas de Lagarto'],
  ['treasure.heaume_gargouille', '🗿 Gargoyle Helm', '🗿 Yelmo de Gárgola', '🗿 Elmo de Gárgula'],
  ['treasure.bottes_sable_mouvant', '👢 Quicksand Boots', '👢 Botas de Arenas Movedizas', '👢 Botas de Areia Movediça'],
  ['treasure.fiole_force_ancienne', '💪 Vial of Ancient Strength', '💪 Frasco de Fuerza Ancestral', '💪 Frasco de Força Ancestral'],
  ['treasure.epee_glace_eternelle', '❄️ Sword of Eternal Ice', '❄️ Espada de Hielo Eterno', '❄️ Espada de Gelo Eterno'],
  ['treasure.hache_bucheron_geant', '🪓 Axe of the Giant Woodcutter', '🪓 Hacha del Leñador Gigante', '🪓 Machado do Lenhador Gigante'],
  ['treasure.armure_ecorce_vivante', "🌳 Living Bark Armor", '🌳 Armadura de Corteza Viva', '🌳 Armadura de Casca Viva'],
  ['treasure.bouclier_miroir_astral', '🪞 Astral Mirror Shield', '🪞 Escudo Espejo Astral', '🪞 Escudo Espelho Astral'],
  ['treasure.amulette_brume_spectrale', '👻 Amulet of Spectral Mist', '👻 Amuleto de Bruma Espectral', '👻 Amuleto de Bruma Espectral'],
  ['treasure.arc_vent_hurlant', '🌪️ Bow of the Howling Wind', '🌪️ Arco del Viento Aullante', '🌪️ Arco do Vento Uivante'],
  ['treasure.carquois_flammes_eternelles', '🔥 Quiver of Eternal Flames', '🔥 Carcaj de Llamas Eternas', '🔥 Aljava de Chamas Eternas'],
  ['treasure.grimoire_tempete', '⛈️ Grimoire of the Storm', '⛈️ Grimorio de la Tormenta', '⛈️ Grimório da Tempestade'],
  ['treasure.fiole_regeneration_draconique', '🐉 Vial of Draconic Regeneration', '🐉 Frasco de Regeneración Dracónica', '🐉 Frasco de Regeneração Dracônica'],
  ['treasure.eclat_etoile_filante', "☄️ Shard of a Shooting Star", '☄️ Fragmento de Estrella Fugaz', '☄️ Fragmento de Estrela Cadente'],
  ['treasure.epee_lumiere_eternelle', '✨ Sword of Eternal Light', '✨ Espada de Luz Eterna', '✨ Espada da Luz Eterna'],
  ['treasure.armure_titan_oublie', '🗿 Armor of the Forgotten Titan', '🗿 Armadura del Titán Olvidado', '🗿 Armadura do Titã Esquecido'],
  ['treasure.casque_seigneur_dragons', '🐲 Helm of the Dragon Lord', '🐲 Yelmo del Señor de los Dragones', '🐲 Elmo do Senhor dos Dragões'],
  ['treasure.bouclier_aube_celeste', "🌅 Shield of the Celestial Dawn", '🌅 Escudo del Alba Celestial', '🌅 Escudo da Aurora Celestial'],
  ['treasure.bottes_vent_stellaire', '🌠 Boots of the Stellar Wind', '🌠 Botas del Viento Estelar', '🌠 Botas do Vento Estelar'],
  ['treasure.hache_seisme_titanesque', '🌋 Axe of the Titanic Earthquake', '🌋 Hacha del Sismo Titánico', '🌋 Machado do Sismo Titânico'],
  ['treasure.grimoire_arcanes_interdits', '📕 Grimoire of Forbidden Arcana', '📕 Grimorio de los Arcanos Prohibidos', '📕 Grimório dos Arcanos Proibidos'],
  ['treasure.fiole_ame_phenix', "🔥🦅 Vial of the Phoenix's Soul", '🔥🦅 Frasco del Alma del Fénix', '🔥🦅 Frasco da Alma da Fênix'],
  ['treasure.epee_neant_stellaire', '🌌 Sword of the Stellar Void', '🌌 Espada del Vacío Estelar', '🌌 Espada do Vazio Estelar'],
  ['treasure.armure_forgeronde_dieux', '⚡ Armor Forged by the Gods', '⚡ Armadura Forjada por los Dioses', '⚡ Armadura Forjada pelos Deuses'],
  ['treasure.bouclier_infini_cristallin', '💠 Infinite Crystalline Shield', '💠 Escudo Infinito Cristalino', '💠 Escudo Infinito Cristalino'],
  ['treasure.amulette_convergence_astrale', '🌀 Amulet of Astral Convergence', '🌀 Amuleto de Convergencia Astral', '🌀 Amuleto de Convergência Astral'],
  ['treasure.fiole_essence_infinie', "♾️ Vial of Infinite Essence", '♾️ Frasco de Esencia Infinita', '♾️ Frasco de Essência Infinita'],
  ['treasure.aeronef_zephyr_eternel', '🎈 Airship of the Eternal Zephyr', '🎈 Aeronave del Céfiro Eterno', '🎈 Aeronave do Zéfiro Eterno'],
  ['treasure.sceptre_vide_etoile', '🔮 Scepter of the Starry Void', '🔮 Cetro del Vacío Estelar', '🔮 Cetro do Vazio Estelar'],
];

// ─────────────────────── 15 PNJ indigènes des îles (nom uniquement, 4 langues) ───────────────────────
const ISLAND_NPCS = [
  ['npc.island.chaman_koraya', 'Chaman Koraya', 'Shaman Koraya', 'Chamán Koraya', 'Xamã Koraya'],
  ['npc.island.doyenne_banzuu', 'Doyenne Ehiku de Ban-Zuu', 'Elder Ehiku of Ban-Zuu', 'Decana Ehiku de Ban-Zuu', 'Decana Ehiku de Ban-Zuu'],
  ['npc.island.pecheur_taolani', 'Pêcheur Vaimoana', 'Fisherman Vaimoana', 'Pescador Vaimoana', 'Pescador Vaimoana'],
  ['npc.island.gardienne_perleverte', 'Gardienne Nalei de Perle-Verte', 'Guardian Nalei of Green Pearl', 'Guardiana Nalei de la Perla Verde', 'Guardiã Nalei da Pérola Verde'],
  ['npc.island.eclaireur_aurore', "Éclaireur Rangi de l'Aurore", 'Scout Rangi of the Island of Dawn', 'Explorador Rangi de la Isla del Amanecer', 'Batedor Rangi da Ilha da Aurora'],
  ['npc.island.sculpteur_totems', 'Sculpteur de Totems Moehau', 'Totem Carver Moehau', 'Tallador de Tótems Moehau', 'Escultor de Totens Moehau'],
  ['npc.island.tisserande_voiles', 'Tisserande Kalani', 'Weaver Kalani', 'Tejedora Kalani', 'Tecelã Kalani'],
  ['npc.island.sage_baobab', 'Sage du Baobab Milu', 'Sage of the Baobab Milu', 'Sabio del Baobab Milu', 'Sábio do Baobá Milu'],
  ['npc.island.chasseur_recifs', 'Chasseur de Récifs Tehani', 'Reef Hunter Tehani', 'Cazador de Arrecifes Tehani', 'Caçador de Recifes Tehani'],
  ['npc.island.prtresse_lagon', 'Prêtresse du Lagon Marama', 'Lagoon Priestess Marama', 'Sacerdotisa de la Laguna Marama', 'Sacerdotisa da Lagoa Marama'],
  ['npc.island.forgeron_corail', 'Forgeron de Corail Hoku', 'Coral Blacksmith Hoku', 'Herrero de Coral Hoku', 'Ferreiro de Coral Hoku'],
  ['npc.island.navigatrice_etoiles', 'Navigatrice des Étoiles Anui', 'Star Navigator Anui', 'Navegante de las Estrellas Anui', 'Navegadora das Estrelas Anui'],
  ['npc.island.gardien_mangroves', 'Gardien des Mangroves Toa', 'Mangrove Guardian Toa', 'Guardián de los Manglares Toa', 'Guardião dos Mangues Toa'],
  ['npc.island.conteuse_sablorage', 'Conteuse de Sablorage Fetia', 'Storyteller of Sablorage Fetia', 'Narradora de Sablorage Fetia', 'Contadora de Histórias de Sablorage Fetia'],
  ['npc.island.ancien_grisemont_pic', 'Ancien du Pic Kavika', 'Elder of the Peak Kavika', 'Anciano del Pico Kavika', 'Ancião do Pico Kavika'],
];

const OUT = { fr: {}, en: {}, es: {}, pt: {} };

for (const [locale, dict] of Object.entries(INVISIBILITY_QUEST)) Object.assign(OUT[locale], dict);
for (const [id, en, es, pt] of TREASURES_EXTRA) { OUT.en[id] = en; OUT.es[id] = es; OUT.pt[id] = pt; }
for (const [i18nKey, fr, en, es, pt] of ISLAND_NPCS) { OUT.fr[i18nKey] = fr; OUT.en[i18nKey] = en; OUT.es[i18nKey] = es; OUT.pt[i18nKey] = pt; }

for (const locale of ['fr', 'en', 'es', 'pt']) {
  const filePath = join(MSG_DIR, `${locale}.json`);
  const current = JSON.parse(readFileSync(filePath, 'utf8'));
  const merged = { ...current, ...OUT[locale] };
  writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  console.log(`✅ ${locale}.json : ${Object.keys(OUT[locale]).length} clés ajoutées/mises à jour (quest.guardians_camel, treasure.*, npc.island.*).`);
}
console.log('\nTerminé.');
