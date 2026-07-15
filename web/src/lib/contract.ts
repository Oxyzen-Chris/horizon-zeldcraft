/**
 * ABI minimal du contrat HorizonZeldCraft — regénérable depuis
 * contracts/artifacts/contracts/HorizonZeldCraft.sol/HorizonZeldCraft.json
 */
export const HORIZON_ABI = [
  { type: 'function', name: 'mintVoxlyn', stateMutability: 'nonpayable',
    inputs: [{ name: 'name_', type: 'string' }],
    outputs: [{ name: 'tokenId', type: 'uint256' }] },
  { type: 'function', name: 'feed', stateMutability: 'payable',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'feedType', type: 'uint8' },
    ], outputs: [] },
  { type: 'function', name: 'buyCatalogItem', stateMutability: 'payable',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'itemId', type: 'bytes32' },
    ], outputs: [] },
  { type: 'function', name: 'startQuest', stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'questId', type: 'bytes32' },
    ], outputs: [] },
  { type: 'function', name: 'voxlynOf', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'voxlyns', stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'name', type: 'string' },
      { name: 'bornAt', type: 'uint64' },
      { name: 'lastFedAt', type: 'uint64' },
      { name: 'xp', type: 'uint32' },
      { name: 'hp', type: 'uint16' },
      { name: 'happiness', type: 'uint16' },
      { name: 'hunger', type: 'uint16' },
      { name: 'level', type: 'uint32' },
      { name: 'stage', type: 'uint8' },
    ] },
  { type: 'function', name: 'feedPrice', stateMutability: 'view',
    inputs: [{ name: '', type: 'uint8' }],
    outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'owner', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'addCatalogItem', stateMutability: 'nonpayable',
    inputs: [
      { name: 'itemId', type: 'bytes32' },
      { name: 'label', type: 'string' },
      { name: 'priceWei', type: 'uint256' },
    ], outputs: [] },
  { type: 'function', name: 'addQuest', stateMutability: 'nonpayable',
    inputs: [
      { name: 'questId', type: 'bytes32' },
      { name: 'label', type: 'string' },
      { name: 'xpRequired', type: 'uint32' },
      { name: 'xpReward', type: 'uint32' },
    ], outputs: [] },
  { type: 'function', name: 'setFeedPrice', stateMutability: 'nonpayable',
    inputs: [
      { name: 'feedType', type: 'uint8' },
      { name: 'priceWei', type: 'uint256' },
    ], outputs: [] },
  { type: 'function', name: 'setFeedCooldown', stateMutability: 'nonpayable',
    inputs: [
      { name: 'feedType', type: 'uint8' },
      { name: 'cooldownSec', type: 'uint64' },
    ], outputs: [] },
  { type: 'function', name: 'setFeedXpReward', stateMutability: 'nonpayable',
    inputs: [
      { name: 'feedType', type: 'uint8' },
      { name: 'xpReward', type: 'uint32' },
    ], outputs: [] },
  { type: 'function', name: 'feedCooldown', stateMutability: 'view',
    inputs: [{ name: '', type: 'uint8' }],
    outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'withdraw', stateMutability: 'nonpayable',
    inputs: [], outputs: [] },
  { type: 'function', name: 'pause', stateMutability: 'nonpayable',
    inputs: [], outputs: [] },
  { type: 'function', name: 'unpause', stateMutability: 'nonpayable',
    inputs: [], outputs: [] },
] as const;

export const FEED_TYPES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type FeedTypeName = (typeof FEED_TYPES)[number];

export const STAGE_NAMES = ['egg', 'hatched', 'juvenile', 'adult', 'ancient'] as const;
