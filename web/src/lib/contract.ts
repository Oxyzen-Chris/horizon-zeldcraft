/**
 * ABI HorizonZeldCraft v2 — quêtes énigmes, PNJ, trésors, mondes, météo, teams, chat
 */
export const HORIZON_ABI = [
  // ─── Mint / Feed
  { type: 'function', name: 'mintVoxlyn', stateMutability: 'nonpayable',
    inputs: [{ name: 'name_', type: 'string' }], outputs: [{ name: 'tokenId', type: 'uint256' }] },
  { type: 'function', name: 'feed', stateMutability: 'payable',
    inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'feedType', type: 'uint8' }], outputs: [] },
  { type: 'function', name: 'buyCatalogItem', stateMutability: 'payable',
    inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'itemId', type: 'bytes32' }], outputs: [] },
  // ─── Quêtes énigmes
  { type: 'function', name: 'submitQuestAnswer', stateMutability: 'nonpayable',
    inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'questId', type: 'bytes32' }, { name: 'answer', type: 'string' }], outputs: [] },
  { type: 'function', name: 'meetNpc', stateMutability: 'nonpayable',
    inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'npcId', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'discoverWorld', stateMutability: 'nonpayable',
    inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'worldId', type: 'bytes32' }], outputs: [] },
  // ─── Views
  { type: 'function', name: 'voxlynOf', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'voxlyns', stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }], outputs: [
      { name: 'name', type: 'string' }, { name: 'bornAt', type: 'uint64' }, { name: 'lastFedAt', type: 'uint64' },
      { name: 'xp', type: 'uint32' }, { name: 'hp', type: 'uint16' }, { name: 'happiness', type: 'uint16' },
      { name: 'hunger', type: 'uint16' }, { name: 'level', type: 'uint32' }, { name: 'stage', type: 'uint8' },
    ] },
  { type: 'function', name: 'feedPrice', stateMutability: 'view',
    inputs: [{ type: 'uint8' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'feedCooldown', stateMutability: 'view',
    inputs: [{ type: 'uint8' }], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'treasury', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'difficulty', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'currentWeather', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'playerScore', stateMutability: 'view',
    inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'questCompleted', stateMutability: 'view',
    inputs: [{ type: 'uint256' }, { type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'npcMet', stateMutability: 'view',
    inputs: [{ type: 'uint256' }, { type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'treasureFound', stateMutability: 'view',
    inputs: [{ type: 'uint256' }, { type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'worldUnlocked', stateMutability: 'view',
    inputs: [{ type: 'uint256' }, { type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'quests', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [
    { name: 'label', type: 'string' }, { name: 'xpRequired', type: 'uint32' }, { name: 'xpReward', type: 'uint32' },
    { name: 'scoreReward', type: 'uint32' }, { name: 'answerHash', type: 'bytes32' }, { name: 'treasureId', type: 'bytes32' },
    { name: 'minDifficulty', type: 'uint8' }, { name: 'active', type: 'bool' },
  ] },
  { type: 'function', name: 'npcs', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [
    { name: 'name', type: 'string' }, { name: 'dialog', type: 'string' },
    { name: 'xpRewardOnMeet', type: 'uint32' }, { name: 'questId', type: 'bytes32' }, { name: 'active', type: 'bool' },
  ] },
  { type: 'function', name: 'treasures', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [
    { name: 'name', type: 'string' }, { name: 'xpReward', type: 'uint32' }, { name: 'active', type: 'bool' },
  ] },
  { type: 'function', name: 'worlds', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [
    { name: 'name', type: 'string' }, { name: 'xpRequired', type: 'uint32' }, { name: 'active', type: 'bool' },
  ] },
  { type: 'function', name: 'questIds', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'npcIds', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'treasureIds', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'worldIds', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'questsLength', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'npcsLength', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'treasuresLength', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'worldsLength', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  // ─── Teams + Chat
  { type: 'function', name: 'createTeam', stateMutability: 'nonpayable',
    inputs: [{ name: 'name_', type: 'string' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'joinTeam', stateMutability: 'nonpayable',
    inputs: [{ name: 'teamId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'leaveTeam', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'sendTeamMessage', stateMutability: 'nonpayable',
    inputs: [{ name: 'message', type: 'string' }], outputs: [] },
  { type: 'function', name: 'teamOf', stateMutability: 'view',
    inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'teams', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [
    { name: 'name', type: 'string' }, { name: 'leader', type: 'address' }, { name: 'active', type: 'bool' },
  ] },
  { type: 'function', name: 'getTeamMembers', stateMutability: 'view',
    inputs: [{ type: 'uint256' }], outputs: [{ type: 'address[]' }] },
  { type: 'function', name: 'nextTeamId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'event', name: 'TeamMessage', inputs: [
    { name: 'teamId', type: 'uint256', indexed: true }, { name: 'sender', type: 'address', indexed: true },
    { name: 'message', type: 'string', indexed: false }, { name: 'timestamp', type: 'uint64', indexed: false },
  ], anonymous: false },
  // ─── Admin
  { type: 'function', name: 'addCatalogItem', stateMutability: 'nonpayable',
    inputs: [{ type: 'bytes32' }, { type: 'string' }, { type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'addQuest', stateMutability: 'nonpayable',
    inputs: [{ type: 'bytes32' }, { type: 'string' }, { type: 'uint32' }, { type: 'uint32' }, { type: 'uint32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint8' }], outputs: [] },
  { type: 'function', name: 'addNpc', stateMutability: 'nonpayable',
    inputs: [{ type: 'bytes32' }, { type: 'string' }, { type: 'string' }, { type: 'uint32' }, { type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'addTreasure', stateMutability: 'nonpayable',
    inputs: [{ type: 'bytes32' }, { type: 'string' }, { type: 'uint32' }], outputs: [] },
  { type: 'function', name: 'addWorld', stateMutability: 'nonpayable',
    inputs: [{ type: 'bytes32' }, { type: 'string' }, { type: 'uint32' }], outputs: [] },
  { type: 'function', name: 'setDifficulty', stateMutability: 'nonpayable', inputs: [{ type: 'uint8' }], outputs: [] },
  { type: 'function', name: 'setWeather', stateMutability: 'nonpayable', inputs: [{ type: 'uint8' }], outputs: [] },
  { type: 'function', name: 'clearWeatherOverride', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'weatherOverrideActive', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'setNpcMaxPerDay', stateMutability: 'nonpayable', inputs: [{ type: 'uint8' }], outputs: [] },
  { type: 'function', name: 'npcMaxPerDay', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'todaysNpcs', stateMutability: 'view',
    inputs: [{ type: 'uint256' }], outputs: [{ type: 'bytes32[]' }] },
  { type: 'function', name: 'isNpcAvailableToday', stateMutability: 'view',
    inputs: [{ type: 'uint256' }, { type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'npcSkinFor', stateMutability: 'view',
    inputs: [{ type: 'uint256' }, { type: 'bytes32' }], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'setFeedPrice', stateMutability: 'nonpayable',
    inputs: [{ type: 'uint8' }, { type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'setFeedCooldown', stateMutability: 'nonpayable',
    inputs: [{ type: 'uint8' }, { type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'setFeedXpReward', stateMutability: 'nonpayable',
    inputs: [{ type: 'uint8' }, { type: 'uint32' }], outputs: [] },
  { type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'pause', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'unpause', stateMutability: 'nonpayable', inputs: [], outputs: [] },
] as const;

export const FEED_TYPES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type FeedTypeName = (typeof FEED_TYPES)[number];
export const STAGE_NAMES = ['egg', 'hatched', 'juvenile', 'adult', 'ancient'] as const;
export const WEATHER = [
  { emoji: '☀️', label: 'Ensoleillé' },
  { emoji: '🌥️', label: 'Nuageux' },
  { emoji: '🌧️', label: 'Pluvieux' },
  { emoji: '⛈️', label: 'Orageux' },
  { emoji: '🌙', label: 'Nuit' },
  { emoji: '❄️', label: 'Neigeux' },
] as const;

// Clés i18n correspondantes (utiliser t(`weather.${WEATHER_KEYS[idx]}`))
export const WEATHER_KEYS = ['sunny', 'cloudy', 'rainy', 'stormy', 'night', 'snowy'] as const;

// Skins de PNJ (4 variantes = NPC_SKIN_VARIANTS côté contrat)
export const NPC_SKINS = ['🧙', '🧝', '🧛', '🥷'] as const;
// Suffixes ajoutés au nom pour varier l'identité visuelle (texte FR de repli — voir NPC_SUFFIX_KEYS)
export const NPC_NAME_SUFFIXES = ['le Sage', 'l\'Errant', 'de l\'Ombre', 'des Cimes'] as const;
// Clés i18n correspondantes (utiliser t(`npc.suffix.${NPC_SUFFIX_KEYS[idx]}`)) — même principe que WEATHER_KEYS
export const NPC_SUFFIX_KEYS = ['sage', 'errant', 'ombre', 'cimes'] as const;

/**
 * Normalise une réponse d'énigme : minuscules, trim, suppression des accents.
 * Utilisé côté client ET côté script de déploiement pour garantir l'égalité des hash.
 * Exemple : "Glacé" → "glace", "MASTER SWORD " → "master sword"
 */
export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // supprime les accents combinants
    .replace(/\s+/g, ' ');             // espaces multiples → 1
}

/**
 * Extrait un message d'erreur lisible depuis une erreur wagmi/viem.
 * Gère les revert reasons Solidity ("wrong answer") et les custom errors.
 */
export function decodeContractError(err: any): string {
  if (!err) return 'Erreur inconnue';
  const msg = err?.shortMessage || err?.details || err?.message || String(err);
  // Cherche un motif "reverted with the following reason:\n\nXXX" (viem)
  const revertMatch = msg.match(/reverted with the following reason:\s*\n*\s*(.+?)(?:\n|$)/i);
  if (revertMatch) return revertMatch[1].trim();
  // Cherche un motif "Error: XXX"
  const errMatch = msg.match(/reason string ['"](.+?)['"]/);
  if (errMatch) return errMatch[1];
  // Custom error name
  const customMatch = msg.match(/reverted with custom error '([^(]+)/);
  if (customMatch) return customMatch[1];
  return msg.split('\n')[0].slice(0, 140);
}

// ─────────────────────────────────────── i18n des noms on-chain ───────────────────────────────────────
//
// Les mondes/trésors/PNJ "officiels" sont seedés on-chain (voir `contracts/scripts/deploy.ts`) avec
// un id stable `bytes32 = keccak256(utf8("world.zephyria"))` mais un unique libellé français (`name`)
// stocké dans le contrat. Pour les afficher traduits sans redéploiement, on reconstruit ici la même
// table de hash → clé texte : les composants peuvent alors préférer `t('world.'+WORLD_ID_TO_KEY[id])`
// au `name` brut renvoyé par le contrat (repli sur `name` si l'id est inconnu, ex. contenu ajouté
// après coup par l'admin, forcément mono-langue).
import { keccak256, toBytes } from 'viem';

function slugMap(slugs: readonly string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const full of slugs) {
    const key = full.split('.').slice(1).join('.'); // "world.zephyria" -> "zephyria"
    map[keccak256(toBytes(full)).toLowerCase()] = key;
  }
  return map;
}

const WORLD_SLUGS = ['world.zephyria', 'world.nether_cristal', 'world.azerothyl', 'world.nexus'] as const;
const TREASURE_SLUGS = [
  'treasure.master_sword', 'treasure.diamond_pickaxe', 'treasure.thunderfury',
  'treasure.rupees', 'treasure.dragon_egg',
] as const;
const NPC_OFFICIAL_SLUGS = [
  'npc.zelda_princess', 'npc.steve', 'npc.thrall', 'npc.merchant', 'npc.ancient_dragon',
] as const;

/** bytes32 (lowercase) → clé i18n `world.<key>`, voir `contracts/scripts/deploy.ts` § Seed mondes. */
export const WORLD_ID_TO_KEY = slugMap(WORLD_SLUGS);
/** bytes32 (lowercase) → clé i18n `treasure.<key>`, voir `contracts/scripts/deploy.ts` § Seed trésors. */
export const TREASURE_ID_TO_KEY = slugMap(TREASURE_SLUGS);
/** bytes32 (lowercase) → clé i18n `npc.official.<key>`, voir `contracts/scripts/deploy.ts` § Seed PNJ. */
export const NPC_ID_TO_KEY = slugMap(NPC_OFFICIAL_SLUGS);

