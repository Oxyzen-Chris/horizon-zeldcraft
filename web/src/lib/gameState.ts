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
import { keccak256, toBytes } from 'viem';
import { getFirebaseDb, ensureAnonSignIn } from './firebase';
import { normalizeAnswer } from './contract';

// ─────────────────────────────────────────── Types ───────────────────────────────────────────

export interface PlayerState {
  address: string;
  displayName?: string;
  hp: number;              // valeur courante
  hpMax: number;           // plafond (100 par défaut, boostable via super-fioles jusqu'à 300)
  hunger: number;
  hungerMax: number;
  happiness: number;
  happinessMax: number;
  force: number;
  forceMax: number;        // 100 → 200 → 300 selon super-fioles
  spells: number;
  spellsMax: number;
  reputation: number;      // positif = notoriété (rencontres bienveillantes), négatif = mauvaise réputation (combats perdus, vol)
  wallet: number;
  xpBonus?: number;        // XP off-chain accumulé (peut être négatif après un troc coûteux)
  score?: number;          // score off-chain accumulé (quêtes résolues hors-chaîne — voir QuestDef)
  sleeping?: boolean;      // vrai pendant le sommeil forcé (HP ≤ 20)
  lastTick?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface InventoryItem {
  itemId: string;
  name: string;
  category: 'food' | 'weapon' | 'armor' | 'spell' | 'vehicle' | 'potion' | 'treasure' | 'super_potion';
  qty: number;
  effect?: {
    hp?: number; hunger?: number; happiness?: number; force?: number; spells?: number;
    // Boost permanent du plafond (super-fioles) — appliqué en +100 au max concerné
    maxHp?: number; maxForce?: number; maxSpells?: number;
  };
  addedAt: number;
}

export interface TxRecord {
  hash: string;
  type: 'mint' | 'feed' | 'buy' | 'sell' | 'quest' | 'other';
  label: string;
  valueEth: string;    // en ETH lisible (ex "0.0001")
  gasEth?: string;     // frais réseau (gasUsed * gasPrice) en ETH
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
  // Détails enrichis (affichés dans "Rencontres du jour")
  itemName?: string;      // objet donné/échangé lors d'un trade
  walletDelta?: number;   // pièces gagnées/perdues (négatif = vol)
  hpDelta?: number;       // dégâts subis dans un combat
  repDelta?: number;      // variation reconnaissance
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
    address: k,
    // `displayName` omis si absent : Firebase RTDB rejette toute écriture contenant une
    // valeur `undefined` (voir bug historique "value argument contains undefined").
    ...(displayName ? { displayName } : {}),
    hp: 100, hpMax: 100,
    hunger: 80, hungerMax: 100,
    happiness: 60, happinessMax: 100,
    force: 10, forceMax: 100,
    spells: 5, spellsMax: 100,
    reputation: 0, wallet: 100,
    score: 0,
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

/** Applique un effet (potion, combat, quête réussie…) et clamp les stats en tenant compte des plafonds dynamiques. */
export async function applyEffect(address: string, delta: Partial<PlayerState> & {
  maxHp?: number; maxForce?: number; maxSpells?: number;
}): Promise<PlayerState> {
  const db = getFirebaseDb();
  if (!db) throw new Error('Firebase non configuré');
  const k = KEY(address);
  const snap = await get(ref(db, `players/${k}`));
  const cur = (snap.val() as PlayerState) || await getOrCreatePlayer(address);
  // Migration douce : ancien joueur sans les *Max
  const hpMax        = (cur.hpMax        ?? 100) + (delta.maxHp     ?? 0);
  const forceMax     = (cur.forceMax     ?? 100) + (delta.maxForce  ?? 0);
  const spellsMax    = (cur.spellsMax    ?? 100) + (delta.maxSpells ?? 0);
  const hungerMax    = cur.hungerMax    ?? 100;
  const happinessMax = cur.happinessMax ?? 100;
  const clamped: PlayerState = {
    ...cur,
    hp:         clamp((cur.hp        ?? 100) + (delta.hp        ?? 0), 0, hpMax),
    hpMax,
    hunger:     clamp((cur.hunger    ?? 80)  + (delta.hunger    ?? 0), 0, hungerMax),
    hungerMax,
    happiness:  clamp((cur.happiness ?? 60)  + (delta.happiness ?? 0), 0, happinessMax),
    happinessMax,
    force:      clamp((cur.force     ?? 10)  + (delta.force     ?? 0), 0, forceMax),
    forceMax,
    spells:     clamp((cur.spells    ?? 5)   + (delta.spells    ?? 0), 0, spellsMax),
    spellsMax,
    reputation: (cur.reputation ?? 0) + (delta.reputation ?? 0),
    wallet:     Math.max(0, (cur.wallet ?? 100) + (delta.wallet ?? 0)),
    xpBonus:    (cur.xpBonus ?? 0) + (delta.xpBonus ?? 0),
    score:      (cur.score ?? 0) + (delta.score ?? 0),
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
  // Firebase RTDB refuse undefined ; on strip les champs optionnels non fournis.
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) if (v !== undefined) clean[k] = v;
  await push(listRef, clean);
}

export async function getEncounters(address: string, limit = 50): Promise<EncounterRecord[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  const snap = await get(ref(db, `players/${KEY(address)}/encounters`));
  const v = snap.val() as Record<string, EncounterRecord> | null;
  if (!v) return [];
  return Object.values(v).sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

/** Nombre de PNJ uniques rencontrés (encounters non refusées). Source unique de vérité pour game + admin. */
export async function getNpcsMetCount(address: string): Promise<number> {
  const db = getFirebaseDb();
  if (!db) return 0;
  const snap = await get(ref(db, `players/${KEY(address)}/encounters`));
  const v = snap.val() as Record<string, EncounterRecord> | null;
  if (!v) return 0;
  const uniq = new Set<string>();
  for (const e of Object.values(v)) {
    if (e.outcome !== 'refused') uniq.add(e.npcId);
  }
  return uniq.size;
}

// ────────────────────────────────────── Quêtes à énigmes (100% hors-chaîne) ──────────────────────────────────────
// Catalogue ET vérification des réponses entièrement en Firebase : plus aucune transaction on-chain
// n'est nécessaire pour créer une quête (admin) ou la résoudre (joueur) → zéro gas. Seul le HASH
// (keccak256) de la réponse normalisée est stocké, jamais la réponse en clair.

export interface QuestDef {
  id: string;            // clé stable = keccak256(idTexte), ex. keccak256("riddle.ice")
  label: string;
  xpRequired: number;    // XP (on-chain + off-chain cumulés) nécessaire pour tenter la quête
  xpReward: number;
  scoreReward: number;
  answerHash: string;    // keccak256(normalizeAnswer(réponse)) — jamais la réponse en clair
  active: boolean;
  createdAt: number;
  order?: number;        // ordre d'affichage explicite (0, 1, 2…) — voir getQuestDefs()
}

/** Recalcule un id stable `bytes32`-like à partir d'un identifiant texte (ex. "riddle.ice"). */
export function questIdOf(s: string): string {
  return keccak256(toBytes(s));
}

/** Hash d'une réponse normalisée — comparé côté client, jamais transmis en clair vers la chaîne. */
export function hashAnswer(rawAnswer: string): string {
  return keccak256(toBytes(normalizeAnswer(rawAnswer)));
}

/** Crée/modifie une quête (admin). Aucune transaction blockchain : écriture Firebase uniquement. */
export async function addQuestDef(def: QuestDef): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `catalog/quests/${def.id.toLowerCase()}`), def);
}

/**
 * Liste toutes les quêtes actives/inactives du catalogue, triées par `order` explicite (0, 1, 2…)
 * puis par date de création en repli. Sans ce champ `order`, des quêtes créées en lot (ex. script
 * de migration) partageant le même horodatage se retrouveraient triées arbitrairement (ordre des
 * clés Firebase, c.-à-d. l'ordre alphabétique du hash) — d'où l'utilité d'un ordre explicite.
 */
export async function getQuestDefs(): Promise<QuestDef[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  const snap = await get(ref(db, 'catalog/quests'));
  const v = snap.val() as Record<string, QuestDef> | null;
  if (!v) return [];
  return Object.values(v).sort((a, b) => {
    const ao = a.order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return (a.createdAt ?? 0) - (b.createdAt ?? 0);
  });
}

/**
 * Vérifie la réponse d'une quête et applique la récompense hors-chaîne (xpBonus + score),
 * sans aucun gas. Retourne 'correct' | 'wrong' | 'already'.
 */
export async function submitQuestAnswerOffchain(
  address: string, quest: QuestDef, rawAnswer: string, reputationReward: number,
): Promise<'correct' | 'wrong' | 'already'> {
  const already = await getSolvedQuest(address, quest.id);
  if (already) return 'already';
  const normalized = normalizeAnswer(rawAnswer);
  if (hashAnswer(normalized).toLowerCase() !== quest.answerHash.toLowerCase()) return 'wrong';
  await applyEffect(address, {
    xpBonus: quest.xpReward, score: quest.scoreReward, reputation: reputationReward,
  });
  await markQuestSolved(address, quest.id, normalized);
  return 'correct';
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

/**
 * Réponse "officielle" d'une énigme, stockée en base (Firebase) plutôt que dans le bundle JS
 * client afin de ne pas exposer publiquement les réponses des quêtes non résolues.
 * Utilisée par les scripts de migration (`web/scripts/migrateQuestsToFirebase.mjs`,
 * `web/scripts/backfillLegacyQuests.mjs`) pour reconstituer l'historique des quêtes résolues
 * on-chain avant le passage à un système 100% hors-chaîne.
 */
export async function getSeedQuestAnswer(questId: string): Promise<string | null> {
  const db = getFirebaseDb();
  if (!db) return null;
  const snap = await get(ref(db, `catalog/riddleAnswers/${questId.toLowerCase()}`));
  return snap.val() ?? null;
}

/** Enregistre la réponse officielle d'une énigme (admin, à la création d'une quête). */
export async function seedQuestAnswer(questId: string, answer: string): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `catalog/riddleAnswers/${questId.toLowerCase()}`), answer);
}

// ─────────────────────────────────────── Player index ───────────────────────────────────────

/** Liste tous les joueurs enregistrés (pour dropdown admin). */
export async function listPlayers(): Promise<string[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  await ensureAnonSignIn();
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
  try {
    const snap = await get(ref(db, 'catalog/shop'));
    const v = snap.val() as Record<string, ShopItem> | null;
    return v && Object.keys(v).length ? Object.values(v).filter(i => i.active) : DEFAULT_SHOP;
  } catch (e) {
    console.warn('[shop] catalog read failed, using DEFAULT_SHOP:', e);
    return DEFAULT_SHOP;
  }
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
  { itemId: 'super_hp',      name: '🩸 Super-fiole de Vie (+100 max)',    category: 'super_potion', priceGame: 400, effect: { maxHp: 100, hp: 100 },        active: true },
  { itemId: 'super_force',   name: '💪 Super-fiole de Force (+100 max)',   category: 'super_potion', priceGame: 500, effect: { maxForce: 100, force: 50 },  active: true },
  { itemId: 'super_spells',  name: '🔮 Super-fiole de Sortilèges (+100 max)', category: 'super_potion', priceGame: 500, effect: { maxSpells: 100, spells: 50 }, active: true },
  { itemId: 'legend_hp',     name: '❤️‍🔥 Fiole légendaire de Vie (+200 max)',    category: 'super_potion', priceGame: 900, effect: { maxHp: 200, hp: 200 },       active: true },
  { itemId: 'sword_ep',  name: '⚔️ Épée épique',        category: 'weapon',  priceGame: 200, effect: { force: 20 },              active: true },
  { itemId: 'shield_lg', name: '🛡️ Bouclier légendaire', category: 'armor',  priceGame: 250, effect: { force: 15, hp: 20 },      active: true },
  { itemId: 'spell_fire',name: '🔥 Sort de feu',        category: 'spell',   priceGame: 150, effect: { spells: 25 },             active: true },
  // ─── Engins mécaniques (gate d'accès aux mondes)
  { itemId: 'char_voile',name: '🌤️ Char à voile',      category: 'vehicle', priceGame: 500, effect: {},                          active: true },
  { itemId: 'barque',    name: '🛶 Barque sans fond',   category: 'vehicle', priceGame: 500, effect: {},                          active: true },
  { itemId: 'montgolf',  name: '🎈 Montgolfière',       category: 'vehicle', priceGame: 800, effect: {},                          active: true },
  { itemId: 'mototaupe', name: '⛏️ Moto-taupe',         category: 'vehicle', priceGame: 700, effect: {},                          active: true },
];

// ─────────────────────────────────────── Rep rules ───────────────────────────────────────

/**
 * Barème de reconnaissance appliqué à chaque type de rencontre PNJ.
 * Chargé au démarrage du popup, paramétrable via le menu admin.
 * Clé RTDB : catalog/repRules
 */
export interface RepRules {
  fightWinHostile: number;   // Victoire contre voleur/combattant hostile
  fightWinNormal: number;    // Victoire combat normal
  fightLoss: number;         // Défaite combat (négatif)
  tradeFriendly: number;     // Marchand ami (troc)
  tradeNeutral: number;      // Marchand neutre
  tradeHostileTheft: number; // Faux marchand = voleur qui te pique (négatif)
  questAccepted: number;     // Quête PNJ acceptée
  questSolved: number;       // Énigme résolue (bonus front QuestList)
  chatFriendly: number;      // Discussion PNJ amical
  chatNeutral: number;       // Discussion PNJ neutre
  chatHostile: number;       // Discussion PNJ hostile (négatif)
  // Vol lors d'un faux troc
  theftMaxWallet: number;    // Plafond absolu (borne dure) en monnaie du jeu
  theftMaxPct: number;       // Pourcentage max du solde pouvant être volé (défaut 5%)
  theftMaxItems: number;     // Quantité max d'objets pouvant être volés d'un coup (défaut 1)
  // Butin de combat (tirage de dés) — symétrique gagnant/perdant
  fightLootPct: number;      // % de la bourse du perdant pris par le vainqueur (défaut 20%)
  fightLootMaxWallet: number;// Plafond absolu du butin en monnaie du jeu
  fightLootMaxItems: number; // Nb d'objets pouvant être gagnés/volés après un combat (0 = désactivé)
  fightLootChancePct: number;// % de chance de gagner/perdre un objet après un combat (défaut 35%)
  // Pondération du tirage 1d20 façon jeu de rôle (bonus joueur = somme des 4 poids ci-dessous)
  fightForceWeight: number;  // Poids de la Force dans le bonus joueur (défaut 6)
  fightHpWeight: number;     // Poids de la Vie dans le bonus joueur (défaut 4)
  fightHungerWeight: number; // Poids de la Faim dans le bonus joueur (défaut 3)
  fightSpellsWeight: number; // Poids des Sortilèges dans le bonus joueur (défaut 3)
  fightNpcBonusMax: number;  // Bonus max du PNJ, dérivé de sa Force (défaut 12)
  fightNpcForceRef: number;  // Force de référence du PNJ pour atteindre le bonus max (défaut 45)
}

export const DEFAULT_REP_RULES: RepRules = {
  fightWinHostile: 8,
  fightWinNormal: 4,
  fightLoss: -6,
  tradeFriendly: 4,
  tradeNeutral: 2,
  tradeHostileTheft: -5,
  questAccepted: 5,
  questSolved: 2,
  chatFriendly: 3,
  chatNeutral: 1,
  chatHostile: -2,
  theftMaxWallet: 50,
  theftMaxPct: 5,
  theftMaxItems: 1,
  fightLootPct: 20,
  fightLootMaxWallet: 100,
  fightLootMaxItems: 1,
  fightLootChancePct: 35,
  fightForceWeight: 6,
  fightHpWeight: 4,
  fightHungerWeight: 3,
  fightSpellsWeight: 3,
  fightNpcBonusMax: 12,
  fightNpcForceRef: 45,
};

export async function getRepRules(): Promise<RepRules> {
  const db = getFirebaseDb();
  if (!db) return DEFAULT_REP_RULES;
  const snap = await get(ref(db, 'catalog/repRules'));
  const v = snap.val() as Partial<RepRules> | null;
  return { ...DEFAULT_REP_RULES, ...(v || {}) };
}

export async function setRepRules(rules: RepRules): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, 'catalog/repRules'), rules);
}

// ─────────────────────────────────────── Top-up presets ───────────────────────────────────────

/**
 * Presets de recharge portefeuille (fiat → ETH → coins de jeu).
 * Paramétrable via l'admin (catalog/topupPresets).
 */
export interface TopupPreset {
  fiat: number;       // montant en devise (10, 20, 50, 100)
  eth: string;        // équivalent ETH string (parseEther-compatible)
  coins: number;      // crédit monnaie du jeu
}

export const DEFAULT_TOPUP_PRESETS: TopupPreset[] = [
  { fiat: 10,  eth: '0.004', coins: 1000  },
  { fiat: 20,  eth: '0.008', coins: 2000  },
  { fiat: 50,  eth: '0.020', coins: 5000  },
  { fiat: 100, eth: '0.040', coins: 10000 },
];

export async function getTopupPresets(): Promise<TopupPreset[]> {
  const db = getFirebaseDb();
  if (!db) return DEFAULT_TOPUP_PRESETS;
  const snap = await get(ref(db, 'catalog/topupPresets'));
  const v = snap.val() as TopupPreset[] | null;
  return Array.isArray(v) && v.length > 0 ? v : DEFAULT_TOPUP_PRESETS;
}

export async function setTopupPresets(presets: TopupPreset[]): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, 'catalog/topupPresets'), presets);
}
