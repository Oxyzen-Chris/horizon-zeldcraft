/**
 * Couche de persistance off-chain pour éviter le gas Ethereum sur les données
 * non-monétaires (inventaire, faim/vie temps réel, rencontres PNJ, transactions,
 * rep, portefeuille de jeu, historique).
 *
 * Fournisseur : Firebase Realtime Database (plan gratuit Spark : 1 Go, 10 Go BW/mois).
 * Clé de persistance : adresse wallet (0x…, lowercase). Survit à tout redéploiement
 * de smart contract → l'historique du joueur n'est jamais perdu.
 *
 * Chemins RTDB :
 *   players/{addr}                     → PlayerState (stats agrégées)
 *   players/{addr}/inventory/{itemId}  → { qty, addedAt }
 *   players/{addr}/txs/{txHash}        → TxRecord (log de facturation)
 *   players/{addr}/encounters/{ts}     → EncounterRecord (rencontres popup)
 *   players/{addr}/quests/{questId}    → { answer, solvedAt } (réponse révélée)
 *   playerIndex/{addr}                 → true (pour lister tous les joueurs)
 *   catalog/shop/{itemId}              → ShopItem (paramétrable par admin)
 */
import {
  ref, get, set, update, onValue, off, push, serverTimestamp, DataSnapshot,
} from 'firebase/database';
import { getFirebaseDb, ensureAnonSignIn } from './firebase';

// ─────────────────────────────────────────── Types ───────────────────────────────────────────

export interface PlayerState {
  address: string;
  displayName?: string;
  hp: number;              // 0–100, décroit avec le temps + combats
  hunger: number;          // 0–100, décroit chaque jour
  happiness: number;
  force: number;           // 0–100, augmente en combattant
  spells: number;          // 0–100, sortilèges/incantations connus
  reputation: number;      // points de notoriété (positif si généreux, négatif si voleur)
  wallet: number;          // solde de jeu (en unités de reconnaissance × 1000)
  lastTick?: number;       // dernier update pour calcul dégradation
  createdAt?: number;
  updatedAt?: number;
}

export interface InventoryItem {
  itemId: string;
  name: string;
  category: 'food' | 'weapon' | 'armor' | 'spell' | 'vehicle' | 'potion' | 'treasure';
  qty: number;
  effect?: { hp?: number; hunger?: number; force?: number; spells?: number };
  addedAt: number;
}

export interface TxRecord {
  hash: string;
  type: 'mint' | 'feed' | 'buy' | 'sell' | 'quest' | 'other';
  label: string;
  valueEth: string;    // en ETH lisible (ex "0.0001")
  timestamp: number;
  chainId: number;
  status?: 'pending' | 'confirmed' | 'failed';
}

export interface EncounterRecord {
  npcId: string;
  npcName: string;
  npcSkin: number;
  alignment: 'friendly' | 'neutral' | 'hostile' | 'unknown';
  offer: 'trade' | 'quest' | 'fight' | 'chat';
  timestamp: number;
  outcome?: 'accepted' | 'refused' | 'won' | 'lost';
  xpGained?: number;
}

export interface ShopItem {
  itemId: string;
  name: string;
  category: InventoryItem['category'];
  priceEth?: string;    // si vente on-chain (via buyCatalogItem)
  priceGame?: number;   // si achat/vente off-chain via wallet du jeu
  effect?: InventoryItem['effect'];
  active: boolean;
}

// ────────────────────────────────────── Init player ──────────────────────────────────────

const KEY = (addr: string) => addr.toLowerCase();

/** Récupère ou crée le PlayerState. */
export async function getOrCreatePlayer(address: string, displayName?: string): Promise<PlayerState> {
  const db = getFirebaseDb();
  if (!db) throw new Error('Firebase non configuré');
  await ensureAnonSignIn();
  const k = KEY(address);
  const snap = await get(ref(db, `players/${k}`));
  if (snap.exists()) {
    return applyDecay(snap.val() as PlayerState, k);
  }
  const now = Date.now();
  const initial: PlayerState = {
    address: k, displayName,
    hp: 100, hunger: 80, happiness: 60,
    force: 10, spells: 5, reputation: 0, wallet: 100,
    lastTick: now, createdAt: now, updatedAt: now,
  };
  await set(ref(db, `players/${k}`), initial);
  await set(ref(db, `playerIndex/${k}`), true);
  return initial;
}

/** Dégradation temporelle : faim -1/heure, hp -1/jour si faim < 20. */
async function applyDecay(p: PlayerState, k: string): Promise<PlayerState> {
  const now = Date.now();
  const last = p.lastTick ?? now;
  const hoursElapsed = Math.max(0, Math.floor((now - last) / 3_600_000));
  if (hoursElapsed === 0) return p;
  const newHunger = Math.max(0, p.hunger - hoursElapsed);
  const hpLoss = newHunger < 20 ? Math.floor(hoursElapsed / 24) : 0;
  const newHp = Math.max(1, p.hp - hpLoss);
  const updated = { ...p, hunger: newHunger, hp: newHp, lastTick: now, updatedAt: now };
  const db = getFirebaseDb()!;
  await update(ref(db, `players/${k}`), { hunger: newHunger, hp: newHp, lastTick: now, updatedAt: now });
  return updated;
}

/** Écoute temps réel de l'état joueur. Retourne la fonction unsubscribe. */
export function subscribePlayer(address: string, cb: (p: PlayerState | null) => void): () => void {
  const db = getFirebaseDb();
  if (!db) { cb(null); return () => {}; }
  const r = ref(db, `players/${KEY(address)}`);
  const handler = (snap: DataSnapshot) => cb(snap.exists() ? snap.val() as PlayerState : null);
  onValue(r, handler);
  return () => off(r, 'value', handler);
}

export async function updatePlayer(address: string, patch: Partial<PlayerState>): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await update(ref(db, `players/${KEY(address)}`), { ...patch, updatedAt: Date.now() });
}

/** Applique un effet (potion, combat, quête réussie…) et clamp les stats. */
export async function applyEffect(address: string, delta: Partial<PlayerState>): Promise<PlayerState> {
  const db = getFirebaseDb();
  if (!db) throw new Error('Firebase non configuré');
  const k = KEY(address);
  const snap = await get(ref(db, `players/${k}`));
  const cur = (snap.val() as PlayerState) || await getOrCreatePlayer(address);
  const clamped: PlayerState = {
    ...cur,
    hp:         clamp(cur.hp        + (delta.hp        ?? 0), 0, 100),
    hunger:     clamp(cur.hunger    + (delta.hunger    ?? 0), 0, 100),
    happiness:  clamp(cur.happiness + (delta.happiness ?? 0), 0, 100),
    force:      clamp(cur.force     + (delta.force     ?? 0), 0, 999),
    spells:     clamp(cur.spells    + (delta.spells    ?? 0), 0, 999),
    reputation: cur.reputation + (delta.reputation ?? 0),
    wallet:     Math.max(0, cur.wallet + (delta.wallet ?? 0)),
    lastTick:   Date.now(),
    updatedAt:  Date.now(),
  };
  await update(ref(db, `players/${k}`), clamped);
  return clamped;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ────────────────────────────────────── Inventaire ──────────────────────────────────────

export async function addToInventory(address: string, item: Omit<InventoryItem, 'addedAt'>): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  const path = `players/${KEY(address)}/inventory/${item.itemId}`;
  const snap = await get(ref(db, path));
  const existing = snap.val() as InventoryItem | null;
  if (existing) {
    await update(ref(db, path), { qty: existing.qty + item.qty });
  } else {
    await set(ref(db, path), { ...item, addedAt: Date.now() });
  }
}

export async function removeFromInventory(address: string, itemId: string, qty = 1): Promise<boolean> {
  const db = getFirebaseDb();
  if (!db) return false;
  const path = `players/${KEY(address)}/inventory/${itemId}`;
  const snap = await get(ref(db, path));
  const it = snap.val() as InventoryItem | null;
  if (!it || it.qty < qty) return false;
  if (it.qty === qty) await set(ref(db, path), null);
  else await update(ref(db, path), { qty: it.qty - qty });
  return true;
}

export function subscribeInventory(address: string, cb: (items: InventoryItem[]) => void): () => void {
  const db = getFirebaseDb();
  if (!db) { cb([]); return () => {}; }
  const r = ref(db, `players/${KEY(address)}/inventory`);
  const handler = (snap: DataSnapshot) => {
    const v = snap.val() as Record<string, InventoryItem> | null;
    cb(v ? Object.values(v) : []);
  };
  onValue(r, handler);
  return () => off(r, 'value', handler);
}

// ────────────────────────────────────── Transactions ──────────────────────────────────────

export async function logTx(address: string, tx: TxRecord): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `players/${KEY(address)}/txs/${tx.hash}`), tx);
}

export async function getTxs(address: string): Promise<TxRecord[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  const snap = await get(ref(db, `players/${KEY(address)}/txs`));
  const v = snap.val() as Record<string, TxRecord> | null;
  return v ? Object.values(v).sort((a, b) => b.timestamp - a.timestamp) : [];
}

// ────────────────────────────────────── Rencontres ──────────────────────────────────────

export async function logEncounter(address: string, e: EncounterRecord): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  const listRef = ref(db, `players/${KEY(address)}/encounters`);
  await push(listRef, e);
}

export async function getEncounters(address: string, limit = 50): Promise<EncounterRecord[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  const snap = await get(ref(db, `players/${KEY(address)}/encounters`));
  const v = snap.val() as Record<string, EncounterRecord> | null;
  if (!v) return [];
  return Object.values(v).sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

// ────────────────────────────────────── Quests solved ──────────────────────────────────────

/** Enregistre la réponse d'une quête résolue (pour l'afficher au joueur). */
export async function markQuestSolved(address: string, questId: string, answer: string): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `players/${KEY(address)}/quests/${questId.toLowerCase()}`), {
    answer, solvedAt: Date.now(),
  });
}

export async function getSolvedQuest(address: string, questId: string): Promise<{ answer: string; solvedAt: number } | null> {
  const db = getFirebaseDb();
  if (!db) return null;
  const snap = await get(ref(db, `players/${KEY(address)}/quests/${questId.toLowerCase()}`));
  return snap.val();
}

// ─────────────────────────────────────── Player index ───────────────────────────────────────

/** Liste tous les joueurs enregistrés (pour dropdown admin). */
export async function listPlayers(): Promise<string[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  const snap = await get(ref(db, 'playerIndex'));
  const v = snap.val() as Record<string, boolean> | null;
  return v ? Object.keys(v) : [];
}

export async function getPlayer(address: string): Promise<PlayerState | null> {
  const db = getFirebaseDb();
  if (!db) return null;
  const snap = await get(ref(db, `players/${KEY(address)}`));
  return snap.val();
}

// ─────────────────────────────────────── Shop catalog ───────────────────────────────────────

/** Boutique paramétrable — items achetables/vendables. */
export async function getShopCatalog(): Promise<ShopItem[]> {
  const db = getFirebaseDb();
  if (!db) return DEFAULT_SHOP;
  const snap = await get(ref(db, 'catalog/shop'));
  const v = snap.val() as Record<string, ShopItem> | null;
  return v && Object.keys(v).length ? Object.values(v).filter(i => i.active) : DEFAULT_SHOP;
}

export async function setShopItem(item: ShopItem): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `catalog/shop/${item.itemId}`), item);
}

export async function removeShopItem(itemId: string): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await set(ref(db, `catalog/shop/${itemId}`), null);
}

/** Catalogue par défaut (seed si vide) — inclut engins mécaniques pour mondes gated. */
export const DEFAULT_SHOP: ShopItem[] = [
  { itemId: 'apple',     name: '🍎 Pomme',              category: 'food',    priceGame: 5,  effect: { hunger: 10 },              active: true },
  { itemId: 'meat',      name: '🍖 Viande grillée',     category: 'food',    priceGame: 15, effect: { hunger: 30 },              active: true },
  { itemId: 'fish',      name: '🐟 Poisson',            category: 'food',    priceGame: 12, effect: { hunger: 25 },              active: true },
  { itemId: 'potion_hp', name: '🧪 Potion de vie',      category: 'potion',  priceGame: 30, effect: { hp: 40 },                  active: true },
  { itemId: 'potion_sp', name: '💫 Potion de mana',     category: 'potion',  priceGame: 40, effect: { spells: 15 },              active: true },
  { itemId: 'sword_ep',  name: '⚔️ Épée épique',        category: 'weapon',  priceGame: 200, effect: { force: 20 },              active: true },
  { itemId: 'shield_lg', name: '🛡️ Bouclier légendaire', category: 'armor',  priceGame: 250, effect: { force: 15, hp: 20 },      active: true },
  { itemId: 'spell_fire',name: '🔥 Sort de feu',        category: 'spell',   priceGame: 150, effect: { spells: 25 },             active: true },
  // ─── Engins mécaniques (gate d'accès aux mondes)
  { itemId: 'char_voile',name: '🌤️ Char à voile',      category: 'vehicle', priceGame: 500, effect: {},                          active: true },
  { itemId: 'barque',    name: '🛶 Barque sans fond',   category: 'vehicle', priceGame: 500, effect: {},                          active: true },
  { itemId: 'montgolf',  name: '🎈 Montgolfière',       category: 'vehicle', priceGame: 800, effect: {},                          active: true },
  { itemId: 'mototaupe', name: '⛏️ Moto-taupe',         category: 'vehicle', priceGame: 700, effect: {},                          active: true },
];
