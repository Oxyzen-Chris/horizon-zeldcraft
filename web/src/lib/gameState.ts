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
 *   players/{addr}/unlockedQuests/{questId} → { unlockedAt, npcKey? } (quête npcGiver débloquée)
 *   playerIndex/{addr}                 → true (pour lister tous les joueurs)
 *   catalog/shop/{itemId}              → ShopItem (paramétrable par admin)
 *   catalog/familiars/{id}             → FamiliarDef (paramétrable par admin — XP requis + objet rare optionnel)
 *   players/{addr}/familiars/{id}      → { obtainedAt } (familier apprivoisé par le joueur)
 *   catalog/chatScripts/{id}           → ChatScript (dialogues PNJ paramétrables par admin)
 *   catalog/customWidgets/{id}         → CustomWidgetDef (widgets flottants paramétrables par admin)
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
  lastFeedCheckAt?: number; // début de la fenêtre glissante de 24h en cours pour la pénalité "non nourri" (voir applyFeedPenalties)
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
  // Quête à énigmes débloquée par ce PNJ (offer 'quest') — voir pickNpcQuestForPlayer/unlockQuestForPlayer
  questId?: string;
  questLabel?: string;    // libellé brut FR de repli
  questI18nKey?: string;  // clé i18n si disponible — voir localizeName()
  // Détails enrichis (affichés dans "Rencontres du jour")
  itemName?: string;      // objet donné/échangé lors d'un trade (texte final déjà formaté, ex. "-Pomme ×2")
  walletDelta?: number;   // pièces gagnées/perdues (négatif = vol)
  hpDelta?: number;       // dégâts subis dans un combat
  repDelta?: number;      // variation reconnaissance
  // Clés stables pour un affichage 100% localisé (repli sur npcName/itemName si absentes —
  // ex. anciennes rencontres enregistrées avant l'ajout de ces champs).
  npcBaseKey?: string;    // clé archétype PNJ, ex. "marchand" — voir t(`npc.archetype.${npcBaseKey}`)
  npcSuffixKey?: string;  // clé suffixe, ex. "sage" — voir t(`npc.suffix.${npcSuffixKey}`)
  itemId?: string;        // id stable de l'objet échangé/volé/reçu — voir t(`item.${itemId}`)
  itemQty?: number;       // quantité (défaut 1)
  itemDirection?: 'gain' | 'loss'; // signe à afficher (+/-)
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

/** Dégradation temporelle : faim -1/heure, hp -1/jour si faim < 20, + pénalité "non nourri" (voir applyFeedPenalties). */
async function applyDecay(p: PlayerState, k: string): Promise<PlayerState> {
  const now = Date.now();
  const last = p.lastTick ?? now;
  const hoursElapsed = Math.max(0, Math.floor((now - last) / 3_600_000));

  let hunger = p.hunger;
  let hp = p.hp;
  if (hoursElapsed > 0) {
    hunger = Math.max(0, p.hunger - hoursElapsed);
    const hpLoss = hunger < 20 ? Math.floor(hoursElapsed / 24) : 0;
    hp = Math.max(1, p.hp - hpLoss);
  }

  const { player: afterFeed, changed: feedChecked } = await applyFeedPenalties({ ...p, hunger, hp }, k, now);
  if (hoursElapsed === 0 && !feedChecked) return p;

  const updated = { ...afterFeed, lastTick: now, updatedAt: now };
  const db = getFirebaseDb()!;
  await update(ref(db, `players/${k}`), updated);
  return updated;
}

/**
 * Pénalité "Synk non nourri régulièrement" : vérifie, par fenêtre glissante de 24h depuis
 * `lastFeedCheckAt` (initialisée à `createdAt` — un joueur tout neuf n'est jamais pénalisé pour sa
 * 1ère journée), si le nombre de transactions `feed` on-chain enregistrées atteint l'objectif
 * paramétrable `moodFeedGoalPerDay` (défaut 4/jour). Si l'objectif d'une fenêtre déjà écoulée n'est
 * pas atteint, applique une fois la pénalité (Bonheur/XP/Faim/Portefeuille, paramétrable dans le
 * menu Admin — voir `RepRules.moodFeed*`). Plafonné à 30 fenêtres de rattrapage par appel pour
 * éviter une rafale de pénalités après une longue absence.
 */
async function applyFeedPenalties(
  p: PlayerState, k: string, now: number,
): Promise<{ player: PlayerState; changed: boolean }> {
  const DAY_MS = 86_400_000;
  const windowStart0 = p.lastFeedCheckAt ?? p.createdAt ?? now;
  const windowsElapsed = Math.floor((now - windowStart0) / DAY_MS);
  if (windowsElapsed <= 0) return { player: p, changed: false };

  const rules = await getRepRules();
  const goal = Math.max(1, rules.moodFeedGoalPerDay ?? 4);
  const happinessPenalty = rules.moodFeedHappinessPenalty ?? 10;
  const xpPenalty = rules.moodFeedXpPenalty ?? 20;
  const hungerPenalty = rules.moodFeedHungerPenalty ?? 10;
  const walletPenalty = rules.moodFeedWalletPenalty ?? 10;

  const txs = await getTxs(k);
  const feedTimestamps = txs
    .filter((tx) => tx.type === 'feed' && tx.status !== 'failed')
    .map((tx) => tx.timestamp);

  const cappedWindows = Math.min(windowsElapsed, 30);
  const happinessMax = p.happinessMax ?? 100;
  let happiness = p.happiness;
  let xpBonus = p.xpBonus ?? 0;
  let hunger = p.hunger;
  let wallet = p.wallet;

  for (let i = 0; i < cappedWindows; i++) {
    const wStart = windowStart0 + i * DAY_MS;
    const wEnd = wStart + DAY_MS;
    const count = feedTimestamps.filter((ts) => ts >= wStart && ts < wEnd).length;
    if (count < goal) {
      happiness = clamp(happiness - happinessPenalty, 0, happinessMax);
      xpBonus -= xpPenalty; // peut devenir négatif — déjà supporté (voir troc coûteux)
      hunger = Math.max(0, hunger - hungerPenalty);
      wallet = Math.max(0, wallet - walletPenalty);
    }
  }

  return {
    player: { ...p, happiness, xpBonus, hunger, wallet, lastFeedCheckAt: windowStart0 + cappedWindows * DAY_MS },
    changed: true,
  };
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

export interface PlayerActivityStats {
  questsSolved: number;
  encounters: number;    // rencontres PNJ non refusées (hors-chaîne, procédurales)
  encountersToday: number; // rencontres non refusées du jour courant (objectif "moodEncounterGoalPerDay")
  fightsWon: number;
  familiarsOwned: number;
  feedsToday: number;     // nombre de fois nourri (tx on-chain "feed") aujourd'hui (objectif "moodFeedGoalPerDay")
}

/**
 * Statistiques agrégées hors-chaîne d'un joueur (quêtes résolues, rencontres, combats gagnés,
 * familiers apprivoisés, nourrissage du jour) — utilisées par le classement mondial (`/scoreboard`)
 * et le panneau admin. Une seule lecture par chemin, sans surcoût N+1.
 */
export async function getPlayerActivityStats(address: string): Promise<PlayerActivityStats> {
  const db = getFirebaseDb();
  if (!db) return { questsSolved: 0, encounters: 0, encountersToday: 0, fightsWon: 0, familiarsOwned: 0, feedsToday: 0 };
  const k = KEY(address);
  const [questsSnap, encSnap, famSnap, txsSnap] = await Promise.all([
    get(ref(db, `players/${k}/quests`)),
    get(ref(db, `players/${k}/encounters`)),
    get(ref(db, `players/${k}/familiars`)),
    get(ref(db, `players/${k}/txs`)),
  ]);
  const questsVal = questsSnap.val() as Record<string, unknown> | null;
  const famVal = famSnap.val() as Record<string, unknown> | null;
  const encVal = encSnap.val() as Record<string, EncounterRecord> | null;
  const txsVal = txsSnap.val() as Record<string, TxRecord> | null;
  let encounters = 0;
  let encountersToday = 0;
  let fightsWon = 0;
  const todayStr = new Date().toDateString();
  if (encVal) {
    for (const e of Object.values(encVal)) {
      if (e.outcome === 'refused') continue;
      encounters++;
      if (e.timestamp && new Date(e.timestamp).toDateString() === todayStr) encountersToday++;
      if (e.offer === 'fight' && e.outcome === 'won') fightsWon++;
    }
  }
  let feedsToday = 0;
  if (txsVal) {
    for (const tx of Object.values(txsVal)) {
      if (tx.type === 'feed' && tx.status !== 'failed' && new Date(tx.timestamp).toDateString() === todayStr) feedsToday++;
    }
  }
  return {
    questsSolved: questsVal ? Object.keys(questsVal).length : 0,
    encounters,
    encountersToday,
    fightsWon,
    familiarsOwned: famVal ? Object.keys(famVal).length : 0,
    feedsToday,
  };
}

// ────────────────────────────── Pondération de l'humeur (statistique "Bonheur") ──────────────────────────────

export interface MoodHappinessResult {
  value: number;                     // valeur finale affichée, clampée [0, happinessMax]
  breakdown: {
    weather: number;
    encounters: number;
    familiar: number;
    wallet: number;
    fights: number;
    feed: number;
  };
}

/**
 * Calcule la statistique "Bonheur" affichée dans "Statistiques", en pondérant la valeur brute
 * stockée (`baseHappiness`, celle que fait évoluer le nourrissage) par des modificateurs
 * contextuels paramétrables par l'admin (`RepRules.mood*`) :
 *  - météo du moment (ensoleillé = très heureux … nuit = humeur vagabonde, tirage aléatoire) ;
 *  - progression des rencontres PNJ du jour vers l'objectif quotidien ;
 *  - possession d'au moins un familier apprivoisé ;
 *  - argent dans le portefeuille de jeu ;
 *  - nombre de combats gagnés (plafonné) ;
 *  - nourrissage régulier de Synk du jour (bonus si l'objectif quotidien est atteint — la pénalité
 *    en cas d'objectif manqué est, elle, appliquée directement sur la valeur stockée par
 *    `applyFeedPenalties`, pas ici : cette fonction reste un pur affichage dérivé).
 * Purement un affichage dérivé : ne modifie jamais la valeur stockée en base.
 */
export function computeMoodHappiness(input: {
  baseHappiness: number;
  happinessMax: number;
  weatherKey: string; // une des WEATHER_KEYS ('sunny'|'cloudy'|'rainy'|'stormy'|'night'|'snowy')
  encountersToday: number;
  hasFamiliar: boolean;
  wallet: number;
  fightsWon: number;
  feedsToday: number;
  rules: RepRules;
}): MoodHappinessResult {
  const { baseHappiness, happinessMax, weatherKey, encountersToday, hasFamiliar, wallet, fightsWon, feedsToday, rules } = input;

  let weather = 0;
  switch (weatherKey) {
    case 'sunny':  weather = rules.moodWeatherSunnyBonus; break;
    case 'cloudy': weather = rules.moodWeatherCloudyBonus; break;
    case 'rainy':  weather = rules.moodWeatherRainyBonus; break;
    case 'stormy': weather = rules.moodWeatherStormyBonus; break;
    case 'snowy':  weather = rules.moodWeatherSnowyBonus; break;
    case 'night':  weather = Math.round((Math.random() * 2 - 1) * rules.moodWeatherNightSwing); break;
    default: weather = 0;
  }

  const goal = Math.max(1, rules.moodEncounterGoalPerDay);
  const encounters = Math.round(Math.min(encountersToday / goal, 1) * rules.moodEncounterBonusMax);

  const familiar = hasFamiliar ? rules.moodFamiliarBonus : 0;

  const walletBonus = rules.moodWalletThreshold > 0
    ? Math.round(Math.min(Math.max(wallet, 0) / rules.moodWalletThreshold, 1) * rules.moodWalletBonusMax)
    : 0;

  const fights = Math.min(Math.max(fightsWon, 0) * rules.moodFightWinBonus, rules.moodFightWinBonusCap);

  const feedGoal = Math.max(1, rules.moodFeedGoalPerDay ?? 4);
  const feed = feedsToday >= feedGoal ? (rules.moodFeedBonusMax ?? 10) : 0;

  const total = weather + encounters + familiar + walletBonus + fights + feed;
  const value = Math.max(0, Math.min(happinessMax, Math.round(baseHappiness + total)));

  return { value, breakdown: { weather, encounters, familiar, wallet: walletBonus, fights, feed } };
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
  i18nKey?: string;      // clé i18n (ex. "quest.riddle_first") pour un libellé traduit — voir localizeName()
  hint?: string;         // indice en clair (repli, admin mono-langue) — révélé via le dialogue PNJ
  hintKey?: string;      // clé i18n (ex. "quest.riddle_first.hint") pour un indice traduit — voir localizeName()
  npcGiver?: boolean;    // true = quête masquée de "Quêtes à énigmes" tant qu'un PNJ (offer 'quest')
                         // ne l'a pas proposée et que le joueur ne l'a pas acceptée — voir
                         // unlockQuestForPlayer()/getUnlockedQuestIds() et pickNpcQuestForPlayer()
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
 * Retrouve la prochaine énigme non résolue du joueur (dans l'ordre d'affichage `order`) disposant
 * d'un indice (`hint`/`hintKey`) et la renvoie. Utilisée par la réaction "Donne plus d'indices" du
 * système de dialogue PNJ (voir `ChatReaction.revealHint`). Renvoie `null` si aucune quête non
 * résolue n'a d'indice défini.
 */
export async function getNextQuestHint(address: string): Promise<QuestDef | null> {
  const quests = await getQuestDefs();
  for (const q of quests) {
    if (!q.active || (!q.hint && !q.hintKey)) continue;
    const solved = await getSolvedQuest(address, q.id);
    if (!solved) return q;
  }
  return null;
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

// ────────────────────────────── Quêtes à énigmes proposées par un PNJ ──────────────────────────────
// Certaines quêtes du catalogue (`QuestDef.npcGiver === true`) restent masquées de la rubrique
// "Quêtes à énigmes" tant qu'aucun PNJ (offer 'quest') ne les a proposées ET que le joueur ne les a
// pas acceptées. Une fois acceptées, elles sont débloquées PAR JOUEUR (indépendamment de xpRequired,
// généralement mis à 0 pour ces quêtes) via `players/{addr}/unlockedQuests/{questId}`.

/** Débloque une quête pour un joueur (à l'acceptation d'une offre "quête" d'un PNJ). */
export async function unlockQuestForPlayer(address: string, questId: string, npcKey?: string): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  const clean: Record<string, unknown> = { unlockedAt: Date.now() };
  if (npcKey) clean.npcKey = npcKey;
  await set(ref(db, `players/${KEY(address)}/unlockedQuests/${questId.toLowerCase()}`), clean);
}

/** Liste les ids de quêtes `npcGiver` débloquées pour ce joueur (Set pour lookup O(1)). */
export async function getUnlockedQuestIds(address: string): Promise<Set<string>> {
  const db = getFirebaseDb();
  if (!db) return new Set();
  const snap = await get(ref(db, `players/${KEY(address)}/unlockedQuests`));
  const v = snap.val() as Record<string, unknown> | null;
  return new Set(v ? Object.keys(v) : []);
}

/**
 * Choisit, parmi le catalogue des quêtes `npcGiver` actives, une énigme non encore débloquée ni
 * résolue par ce joueur (tirage aléatoire) — appelée quand un PNJ "quête" est accepté dans
 * `NpcEncounterPopup`. Renvoie `null` si le joueur a déjà débloqué/résolu les 20 énigmes du pool.
 */
export async function pickNpcQuestForPlayer(address: string): Promise<QuestDef | null> {
  const [quests, unlocked] = await Promise.all([getQuestDefs(), getUnlockedQuestIds(address)]);
  const pool = quests.filter(q => q.active && q.npcGiver && !unlocked.has(q.id.toLowerCase()));
  if (pool.length === 0) return null;
  // Filtre en plus les quêtes déjà résolues (filet de sécurité si `unlockedQuests` a été perdu).
  const notSolved: QuestDef[] = [];
  for (const q of pool) {
    const solved = await getSolvedQuest(address, q.id);
    if (!solved) notSolved.push(q);
  }
  const candidates = notSolved.length ? notSolved : pool;
  return candidates[Math.floor(Math.random() * candidates.length)];
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
  // ─── Objets rares (nécessaires pour apprivoiser certains Familiers — voir FamiliarDef.requiredItemId)
  { itemId: 'ecaille_semaphore',       name: '🔴 Écaille de Sémaphore Écarlate',   category: 'treasure', priceGame: 5000,  effect: {}, active: true },
  { itemId: 'griffe_gel_eternel',      name: '❄️ Griffe de Gel Éternel',           category: 'treasure', priceGame: 4000,  effect: {}, active: true },
  { itemId: 'larme_marais_noir',       name: '🖤 Larme du Marais Noir',            category: 'treasure', priceGame: 6000,  effect: {}, active: true },
  { itemId: 'ecaille_ronce_venin',     name: '☠️ Écaille de Ronce Venimeuse',      category: 'treasure', priceGame: 8000,  effect: {}, active: true },
  { itemId: 'eclat_orage_saphir',      name: '⚡ Éclat d\'Orage Saphir',            category: 'treasure', priceGame: 10000, effect: {}, active: true },
  { itemId: 'braise_coeur_volcan',     name: '🔥 Braise du Cœur du Volcan',        category: 'treasure', priceGame: 15000, effect: {}, active: true },
  { itemId: 'plume_givre_lunaire',     name: '🌙 Plume de Givre Lunaire',          category: 'treasure', priceGame: 20000, effect: {}, active: true },
  { itemId: 'perle_abysse_electrique', name: '🌊 Perle des Abysses Électriques',   category: 'treasure', priceGame: 25000, effect: {}, active: true },
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
  xpCap: number;             // Plafond d'expérience affiché dans la barre "Statistiques" (défaut 100000)
  // Lancer du destin quotidien (widget de dés persistant — 1x/jour, indépendant des combats PNJ)
  dailyLuckThreshold: number;    // Total (1d20+bonus) à atteindre pour gagner (défaut 15)
  dailyLuckWalletReward: number; // Monnaie de jeu gagnée en cas de succès (défaut 25)
  dailyLuckRepReward: number;    // Réputation gagnée en cas de succès (défaut 2)
  dailyLuckXpConsolation: number;// XP de consolation en cas d'échec (défaut 5)
  // Coût informatif de création d'un salon de discussion d'équipe (affiché dans TeamsPanel — aucun
  // paiement n'est actuellement débité, purement indicatif en prévision d'une future monétisation)
  teamChatCreationCostEth: string;      // Montant ETH affiché (défaut "0.00296")
  teamChatCreationCostFiatHint: string; // Équivalent approximatif affiché entre parenthèses (défaut "~2 €")
  // Pondération de l'humeur (statistique "Bonheur" affichée dans "Statistiques") — modificateurs
  // additifs appliqués à la valeur brute stockée, selon la météo, la progression des rencontres
  // PNJ du jour, l'acquisition d'un familier, l'argent en poche et les combats gagnés.
  moodWeatherSunnyBonus: number;   // ☀️ Ensoleillé = très heureux (défaut +20)
  moodWeatherCloudyBonus: number;  // 🌥️ Nuageux = moyennement heureux (défaut +5)
  moodWeatherRainyBonus: number;   // 🌧️ Pluvieux = moins heureux (défaut -15)
  moodWeatherStormyBonus: number;  // ⛈️ Orageux (défaut -25)
  moodWeatherSnowyBonus: number;   // ❄️ Neigeux (défaut -10)
  moodWeatherNightSwing: number;   // 🌙 Nuit = humeur vagabonde, tirage aléatoire ±swing (défaut 20)
  moodEncounterGoalPerDay: number; // 👥 Objectif de rencontres PNJ par jour (défaut 5)
  moodEncounterBonusMax: number;   // 👥 Bonus max si l'objectif du jour est atteint (défaut 15)
  moodFamiliarBonus: number;       // 🐉 Bonus si au moins un familier apprivoisé (défaut 15)
  moodWalletThreshold: number;     // 💰 Montant de référence pour le bonus plein (défaut 200)
  moodWalletBonusMax: number;      // 💰 Bonus max lié au portefeuille (défaut 10)
  moodFightWinBonus: number;       // ⚔️ Bonus par combat gagné (défaut 2)
  moodFightWinBonusCap: number;    // ⚔️ Plafond du bonus cumulé lié aux combats gagnés (défaut 20)
  // Nourrissage régulier de Synk (au moins `moodFeedGoalPerDay` fois par jour via l'action "feed"
  // on-chain) — bonus de Bonheur si l'objectif du jour est atteint ; sinon, pénalité appliquée une
  // fois par fenêtre de 24h manquée (Bonheur/XP/Faim/Portefeuille — voir applyFeedPenalties).
  moodFeedGoalPerDay: number;       // 🍖 Nombre de nourrissages requis par jour (défaut 4)
  moodFeedBonusMax: number;        // 🍖 Bonus de Bonheur si l'objectif du jour est atteint (défaut 10)
  moodFeedHappinessPenalty: number;// 🍖 Bonheur retiré par jour manqué si objectif non atteint (défaut 10)
  moodFeedXpPenalty: number;       // 🍖 XP d'Expérience retiré par jour manqué (défaut 20)
  moodFeedHungerPenalty: number;   // 🍖 Faim retirée par jour manqué (défaut 10)
  moodFeedWalletPenalty: number;   // 🍖 Pièces retirées du portefeuille par jour manqué (défaut 10)
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
  xpCap: 100000,
  dailyLuckThreshold: 15,
  dailyLuckWalletReward: 25,
  dailyLuckRepReward: 2,
  dailyLuckXpConsolation: 5,
  teamChatCreationCostEth: '0.00296',
  teamChatCreationCostFiatHint: '~2 €',
  moodWeatherSunnyBonus: 20,
  moodWeatherCloudyBonus: 5,
  moodWeatherRainyBonus: -15,
  moodWeatherStormyBonus: -25,
  moodWeatherSnowyBonus: -10,
  moodWeatherNightSwing: 20,
  moodEncounterGoalPerDay: 5,
  moodEncounterBonusMax: 15,
  moodFamiliarBonus: 15,
  moodWalletThreshold: 200,
  moodWalletBonusMax: 10,
  moodFightWinBonus: 2,
  moodFightWinBonusCap: 20,
  moodFeedGoalPerDay: 4,
  moodFeedBonusMax: 10,
  moodFeedHappinessPenalty: 10,
  moodFeedXpPenalty: 20,
  moodFeedHungerPenalty: 10,
  moodFeedWalletPenalty: 10,
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

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Bonus (0..~16 par défaut) appliqué au tirage 1d20 du joueur, pondéré par ses indices de Force,
 * Vie, Faim et Sortilèges (poids paramétrables via RepRules). Formule partagée par le combat PNJ
 * (`resolveFight` dans NpcEncounterPopup.tsx) et le widget de dés persistant (`DiceRollWidget.tsx`),
 * pour garantir une seule source de vérité sur le calcul du bonus joueur.
 */
export function computePlayerDiceBonus(
  player: { hp: number; hpMax: number; hunger: number; hungerMax: number; force: number; forceMax: number; spells: number; spellsMax: number },
  rules: RepRules,
): number {
  const hpPct     = clamp01(player.hp     / (player.hpMax     || 100));
  const hungerPct = clamp01(player.hunger / (player.hungerMax || 100));
  const forcePct  = clamp01(player.force  / (player.forceMax  || 100));
  const spellsPct = clamp01(player.spells / (player.spellsMax || 100));
  return Math.round(
    forcePct  * (rules.fightForceWeight  ?? 6) +
    hpPct     * (rules.fightHpWeight     ?? 4) +
    hungerPct * (rules.fightHungerWeight ?? 3) +
    spellsPct * (rules.fightSpellsWeight ?? 3),
  );
}

export const rollD20 = () => 1 + Math.floor(Math.random() * 20);

/** Clé du jour courant (UTC device), ex. "2024-06-05" — utilisée pour les mécaniques 1x/jour. */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Vrai si le joueur a déjà effectué son lancer du destin quotidien aujourd'hui. */
export async function hasRolledDailyLuck(address: string): Promise<boolean> {
  const db = getFirebaseDb();
  if (!db) return false;
  const snap = await get(ref(db, `players/${KEY(address)}/dailyLuck/${todayKey()}`));
  return snap.exists();
}

/** Enregistre le lancer du destin quotidien du jour (empêche de relancer avant minuit). */
export async function markDailyLuckRolled(address: string, win: boolean): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `players/${KEY(address)}/dailyLuck/${todayKey()}`), { win, rolledAt: Date.now() });
}

// ─────────────────────────────────────── Familiers ───────────────────────────────────────

/**
 * Compagnons chimériques rencontrés au fil de la progression de Synk (dragons, elfes des forêts,
 * etc.). Catalogue 100% hors-chaîne, paramétrable par l'admin : XP cumulé requis + un objet rare
 * optionnel à posséder dans la besace (consommé lors de l'apprivoisement).
 * Clé RTDB : catalog/familiars/{id} · ownership : players/{addr}/familiars/{id}
 */
export interface FamiliarDef {
  id: string;
  label: string;
  xpRequired: number;
  requiredItemId?: string; // ID d'un item (catalogue boutique) à posséder — consommé, optionnel
  active: boolean;
  createdAt: number;
  order?: number;          // ordre d'affichage explicite — même logique que QuestDef.order
  i18nKey?: string;        // clé i18n (ex. "familiar.dragon_gold") pour un libellé traduit — voir localizeName()
}

/** Sanitise un id lisible (ex. "dragon.gold") en clé RTDB valide (Firebase interdit ".#$[]"). */
export function familiarKeyOf(id: string): string {
  return id.toLowerCase().replace(/[.#$[\]]/g, '_');
}

/** Crée/modifie un familier (admin). Aucune transaction blockchain : écriture Firebase uniquement. */
export async function addFamiliarDef(def: FamiliarDef): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `catalog/familiars/${familiarKeyOf(def.id)}`), def);
}

export async function removeFamiliarDef(id: string): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `catalog/familiars/${familiarKeyOf(id)}`), null);
}

/** Liste tous les familiers du catalogue, triés par `order` explicite puis date de création. */
export async function getFamiliarDefs(): Promise<FamiliarDef[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  const snap = await get(ref(db, 'catalog/familiars'));
  const v = snap.val() as Record<string, FamiliarDef> | null;
  if (!v) return [];
  return Object.values(v).sort((a, b) => {
    const ao = a.order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return (a.createdAt ?? 0) - (b.createdAt ?? 0);
  });
}

/** Familiers déjà apprivoisés par un joueur (abonnement temps réel). */
export function subscribeFamiliars(
  address: string, cb: (owned: Record<string, { obtainedAt: number }>) => void,
): () => void {
  const db = getFirebaseDb();
  if (!db) { cb({}); return () => {}; }
  const r = ref(db, `players/${KEY(address)}/familiars`);
  const handler = (snap: DataSnapshot) => cb((snap.val() as Record<string, { obtainedAt: number }>) ?? {});
  onValue(r, handler);
  return () => off(r, 'value', handler);
}

/**
 * Tente d'apprivoiser un familier : vérifie le XP cumulé du joueur (on-chain + off-chain) et,
 * si `requiredItemId` est défini, consomme 1 exemplaire de l'objet rare dans la besace.
 * Retourne 'ok' | 'needXp' | 'needItem' | 'already'. Aucun gas requis.
 */
export async function tameFamiliar(
  address: string, familiar: FamiliarDef, playerXp: number,
): Promise<'ok' | 'needXp' | 'needItem' | 'already'> {
  const db = getFirebaseDb();
  if (!db) return 'needXp';
  await ensureAnonSignIn();
  const key = familiarKeyOf(familiar.id);
  const ownedSnap = await get(ref(db, `players/${KEY(address)}/familiars/${key}`));
  if (ownedSnap.exists()) return 'already';
  if (playerXp < familiar.xpRequired) return 'needXp';
  if (familiar.requiredItemId) {
    const consumed = await removeFromInventory(address, familiar.requiredItemId, 1);
    if (!consumed) return 'needItem';
  }
  await set(ref(db, `players/${KEY(address)}/familiars/${key}`), { obtainedAt: Date.now() });
  return 'ok';
}

// ─────────────────────────────────────── Dialogues PNJ (chat) ───────────────────────────────────────

/**
 * Mécanique de discussion avec un PNJ (offre "chat") : à l'acceptation, le PNJ ouvre une réplique
 * et le joueur répond via 5 boutons fixes ("Oui"/"Non"/"Je ne sais pas"/"Continue"/"Donne plus
 * d'indices"). Chaque réaction peut octroyer un peu de XP/réputation bonus, révéler l'indice de la
 * prochaine énigme non résolue (`revealHint`), et/ou enchaîner vers un autre `ChatScript`
 * (`nextScriptId`) pour simuler une conversation à plusieurs échanges — sans arbre de dialogue
 * récursif : on référence simplement un autre script du même catalogue plat par son id (même
 * convention que `FamiliarDef.requiredItemId`).
 * Catalogue 100% hors-chaîne, paramétrable par l'admin. Clé RTDB : catalog/chatScripts/{id}
 */
export type ChatResponseId = 'yes' | 'no' | 'dontknow' | 'continue' | 'moreHints';

export const CHAT_RESPONSE_IDS: ChatResponseId[] = ['yes', 'no', 'dontknow', 'continue', 'moreHints'];

export interface ChatReaction {
  line: string;             // réplique du PNJ suite à la réponse du joueur (repli FR/admin)
  i18nKey?: string;         // clé i18n optionnelle (scripts par défaut uniquement) — voir localizeName()
  xp?: number;              // XP hors-chaîne bonus/malus (optionnel, en plus du barème chatFriendly/...)
  rep?: number;             // réputation bonus/malus (optionnel, en plus du barème chatFriendly/...)
  revealHint?: boolean;     // révèle l'indice de la prochaine énigme non résolue (voir getNextQuestHint)
  nextScriptId?: string;    // enchaîne vers un autre ChatScript du catalogue (conversation multi-tours)
}

export interface ChatScript {
  id: string;
  npcLine: string;           // réplique d'ouverture du PNJ (repli FR/admin)
  npcLineI18nKey?: string;   // clé i18n optionnelle (scripts par défaut uniquement)
  reactions: Partial<Record<ChatResponseId, ChatReaction>>;
  active: boolean;
  createdAt: number;
  order?: number;
}

/**
 * Scripts par défaut (repli si `catalog/chatScripts` est vide en base) — démontrent la mécanique
 * dès le premier lancement : "greeting" enchaîne vers "legend" via la réponse "Continue", et
 * "moreHints" révèle l'indice de la prochaine énigme non résolue du joueur.
 */
export const DEFAULT_CHAT_SCRIPTS: ChatScript[] = [
  {
    id: 'chat.default.greeting',
    npcLine: "Une belle journée pour explorer, tu ne trouves pas ?",
    npcLineI18nKey: 'npc.chat.script.greeting.npc',
    active: true, createdAt: 0, order: 0,
    reactions: {
      yes:       { line: 'Ravi de voir un aventurier optimiste !', i18nKey: 'npc.chat.script.greeting.yes', xp: 5, rep: 1 },
      no:        { line: 'Ah... les temps sont durs, je te l\'accorde.', i18nKey: 'npc.chat.script.greeting.no', xp: 2 },
      dontknow:  { line: "L'important, c'est de rester en mouvement !", i18nKey: 'npc.chat.script.greeting.dontknow', xp: 2 },
      continue:  { line: 'Alors laisse-moi te raconter une légende...', i18nKey: 'npc.chat.script.greeting.continue', nextScriptId: 'chat.default.legend' },
      moreHints: { line: 'Cherche du côté de tes énigmes non résolues, un indice t\'y attend peut-être...', i18nKey: 'npc.chat.script.greeting.hints', revealHint: true },
    },
  },
  {
    id: 'chat.default.legend',
    npcLine: 'On raconte qu\'un ancien gardien protège un secret au cœur du Nexus Temporel...',
    npcLineI18nKey: 'npc.chat.script.legend.npc',
    active: true, createdAt: 0, order: 1,
    reactions: {
      yes:       { line: "J'en étais sûr ! Sois prudent, aventurier.", i18nKey: 'npc.chat.script.legend.yes', xp: 8, rep: 2 },
      no:        { line: 'Peu importe, certains secrets restent scellés.', i18nKey: 'npc.chat.script.legend.no' },
      dontknow:  { line: "Beaucoup l'ignorent, c'est ce qui rend l'histoire fascinante.", i18nKey: 'npc.chat.script.legend.dontknow', xp: 3 },
      continue:  { line: "Je n'en sais pas plus, mais bonne chance à toi !", i18nKey: 'npc.chat.script.legend.continue' },
      moreHints: { line: 'Un indice ? Regarde du côté de tes énigmes non résolues...', i18nKey: 'npc.chat.script.legend.hints', revealHint: true },
    },
  },
];

/** Sanitise un id lisible (ex. "chat.default.greeting") en clé RTDB valide. */
export function chatScriptKeyOf(id: string): string {
  return id.toLowerCase().replace(/[.#$[\]]/g, '_');
}

/** Crée/modifie un script de dialogue (admin). Aucune transaction blockchain : écriture Firebase uniquement. */
export async function addChatScript(def: ChatScript): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `catalog/chatScripts/${chatScriptKeyOf(def.id)}`), def);
}

export async function removeChatScript(id: string): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `catalog/chatScripts/${chatScriptKeyOf(id)}`), null);
}

/**
 * Liste les scripts de dialogue du catalogue (triés par `order` puis date de création), avec repli
 * sur `DEFAULT_CHAT_SCRIPTS` si la base est vide (même logique que `getShopCatalog`/`DEFAULT_SHOP`).
 */
export async function getChatScripts(): Promise<ChatScript[]> {
  const db = getFirebaseDb();
  if (!db) return DEFAULT_CHAT_SCRIPTS;
  const snap = await get(ref(db, 'catalog/chatScripts'));
  const v = snap.val() as Record<string, ChatScript> | null;
  if (!v || Object.keys(v).length === 0) return DEFAULT_CHAT_SCRIPTS;
  return Object.values(v).sort((a, b) => {
    const ao = a.order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return (a.createdAt ?? 0) - (b.createdAt ?? 0);
  });
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

// ───────────────────────────────────── Widgets personnalisés ─────────────────────────────────────

/**
 * Widgets flottants génériques, entièrement définis par l'admin (titre, contenu, animation,
 * boutons + action de chaque bouton) — même esprit que le widget de dés / chat d'équipe, mais
 * paramétrable sans code. Catalogue 100% hors-chaîne. Clé RTDB : catalog/customWidgets/{id}
 */
export type CustomWidgetActionType = 'none' | 'link' | 'message' | 'effect';
export type CustomWidgetAnimation = 'none' | 'pulse' | 'bounce' | 'glow';

/** Effet appliqué au joueur (mêmes champs que `applyEffect`) quand actionType === 'effect'. */
export interface CustomWidgetEffect {
  wallet?: number; xpBonus?: number; reputation?: number;
  hp?: number; hunger?: number; happiness?: number; force?: number; spells?: number;
}

export interface CustomWidgetButton {
  label: string;                  // texte affiché sur le bouton (repli mono-langue, contenu admin)
  actionType: CustomWidgetActionType;
  actionUrl?: string;              // si actionType === 'link' (ouvert dans un nouvel onglet)
  actionMessage?: string;          // si actionType === 'message' (affiché sous le bouton)
  effect?: CustomWidgetEffect;     // si actionType === 'effect' (appliqué via applyEffect)
}

export interface CustomWidgetDef {
  id: string;
  title: string;
  content: string;                 // texte/description affiché dans le corps du widget
  icon?: string;                   // emoji affiché sur la bulle réduite (défaut 🧩)
  animation?: CustomWidgetAnimation;// anime la bulle réduite pour attirer l'attention
  minXp?: number;                  // condition d'affichage : XP minimum requis (0/absent = toujours visible)
  buttons: CustomWidgetButton[];
  active: boolean;
  createdAt: number;
  order?: number;
}

/** Un widget de démonstration livré par défaut (visible dès le premier lancement). */
export const DEFAULT_CUSTOM_WIDGETS: CustomWidgetDef[] = [
  {
    id: 'widget.default.community',
    title: '📯 Communauté Horizon ZeldCraft',
    content: 'Rejoins la communauté sur Instagram pour suivre les nouveautés, les saisons et les événements du royaume !',
    icon: '📯',
    animation: 'pulse',
    minXp: 0,
    active: true, createdAt: 0, order: 0,
    buttons: [
      { label: 'Suivre sur Instagram', actionType: 'link', actionUrl: 'https://instagram.com/horizon.zeldcraft' },
    ],
  },
];

/** Sanitise un id lisible (ex. "widget.default.community") en clé RTDB valide. */
export function customWidgetKeyOf(id: string): string {
  return id.toLowerCase().replace(/[.#$[\]]/g, '_');
}

/** Crée/modifie un widget personnalisé (admin). Aucune transaction blockchain : écriture Firebase uniquement. */
export async function addCustomWidget(def: CustomWidgetDef): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `catalog/customWidgets/${customWidgetKeyOf(def.id)}`), def);
}

export async function removeCustomWidget(id: string): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `catalog/customWidgets/${customWidgetKeyOf(id)}`), null);
}

/**
 * Liste les widgets personnalisés du catalogue (triés par `order` puis date de création), avec
 * repli sur `DEFAULT_CUSTOM_WIDGETS` si la base est vide (même logique que `getChatScripts`).
 */
export async function getCustomWidgets(): Promise<CustomWidgetDef[]> {
  const db = getFirebaseDb();
  if (!db) return DEFAULT_CUSTOM_WIDGETS;
  const snap = await get(ref(db, 'catalog/customWidgets'));
  const v = snap.val() as Record<string, CustomWidgetDef> | null;
  if (!v || Object.keys(v).length === 0) return DEFAULT_CUSTOM_WIDGETS;
  return Object.values(v).sort((a, b) => {
    const ao = a.order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return (a.createdAt ?? 0) - (b.createdAt ?? 0);
  });
}

