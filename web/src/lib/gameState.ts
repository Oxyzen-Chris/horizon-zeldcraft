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
 *   players/{addr}/equipment/{slot}    → EquippedItem (arme/protection équipée — voir equipItem/unequipSlot)
 *   catalog/npcDefs/{id}               → NpcDef (PNJ « officiels », paramétrable par admin — voir addNpcDef)
 *   catalog/treasureDefs/{id}          → TreasureDef (coffres à seuil d'XP, paramétrable par admin)
 *   catalog/worldDefs/{id}             → WorldDef (mondes à seuil d'XP, paramétrable par admin)
 *   players/{addr}/npcsMet/{id}        → { metAt } (PNJ officiel rencontré)
 *   players/{addr}/treasuresFound/{id} → { foundAt } (trésor ouvert)
 *   players/{addr}/worldsUnlocked/{id} → { unlockedAt } (monde débloqué)
 *   catalog/maps/{id}                  → MapDef (carte mapmonde, paramétrable par admin — évolutif, multi-cartes)
 *   catalog/mapPois/{id}               → MapPoiDef (point d'intérêt terrain/décor sur une carte — voir WorldMapWidget.tsx)
 *   players/{addr}/mapPos              → { mapId, x, y, updatedAt } (position libre de Synk sur la carte, déplacement libre)
 *   players/{addr}/mapPoisVisited/{id} → { visitedAt } (POI découvert par hasard en explorant — XP de découverte, une fois)
 *   catalog/seasonState                → SeasonState (saison courante — auto (date réelle) ou forcée par l'admin)
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
  oxygen: number;          // niveau d'oxygène (0-100) — décroît sur les dalles d'eau (voir GameCanvas2D.tsx)
  oxygenMax: number;       // plafond (100 par défaut)
  fatigue: number;         // niveau de fatigue (0-100) — décroît en cas de déplacement continu, remonte à
                           // l'arrêt (voir GameCanvas2D.tsx / RepRules.fatigue*), paramétrable en Administration
  fatigueMax: number;      // plafond (100 par défaut)
  reputation: number;      // positif = notoriété (rencontres bienveillantes), négatif = mauvaise réputation (combats perdus, vol)
  wallet: number;
  xpBonus?: number;        // XP off-chain accumulé (peut être négatif après un troc coûteux)
  score?: number;          // score off-chain accumulé (quêtes résolues hors-chaîne — voir QuestDef)
  sleeping?: boolean;      // vrai pendant le sommeil forcé (HP ≤ 20) OU l'évanouissement par manque d'oxygène
  lastTick?: number;
  lastFeedCheckAt?: number; // début de la fenêtre glissante de 24h en cours pour la pénalité "non nourri" (voir applyFeedPenalties)
  invisibleUntil?: number; // horodatage de fin d'invisibilité (cape d'invisibilité — voir activateInvisibility)
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Emplacement d'équipement du personnage (façon "homme de Vitruve" — voir EquipmentWidget.tsx).
 * `arrows` est un slot spécial : consommable par tir (qty), pas de durabilité — un arc
 * (`requiresArrow: true`) ne délivre son bonus de dégâts au combat que si des flèches y sont
 * équipées (voir computeEquipmentCombatBonus).
 */
// `amulet` : protections type collier/cape (ex. cape d'invisibilité). `vehicle` : engin actif pour
// les voyages (char à voile, montgolfière...). `familiar` : compagnon (dragon...) équipé comme
// familier de combat — n'est PAS un objet de la besace (voir equipFamiliar), juste un slot logé
// dans le même arbre `equipment` pour réutiliser l'infrastructure du widget. `saddle` : selle de
// dragon, ne fonctionne qu'associée au familier correspondant (voir InventoryItem.requiresFamiliarId).
export type EquipSlot = 'weapon' | 'offhand' | 'head' | 'body' | 'legs' | 'feet' | 'belt' | 'arrows'
  | 'amulet' | 'vehicle' | 'familiar' | 'saddle';
export const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'offhand', 'head', 'body', 'legs', 'feet', 'belt', 'arrows',
  'amulet', 'vehicle', 'familiar', 'saddle'];

/** Rareté d'un équipement — seuils XP par palier paramétrables dans RepRules (equipRarityXp*). */
export type ItemRarity = 'common' | 'rare' | 'legendary' | 'epic';

/** Saison courante du jeu — gestion tournante (printemps/été/automne/hiver) : par défaut calculée
 * depuis la date réelle (hémisphère nord, voir computeAutoSeason()), ou forcée par l'admin (voir
 * SeasonState/getCurrentSeason ci-dessous). De nouveaux PNJ, quêtes, trésors et POI peuvent être
 * tagués `season` pour n'apparaître que pendant la saison correspondante — voir NpcList.tsx,
 * QuestList.tsx, TreasureList.tsx, WorldMapWidget.tsx et pickNpcQuestForPlayer(). */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_ICONS: Record<Season, string> = { spring: '🌸', summer: '☀️', autumn: '🍂', winter: '❄️' };

export interface InventoryItem {
  itemId: string;
  name: string;
  category: 'food' | 'weapon' | 'armor' | 'shield' | 'arrow' | 'spell' | 'vehicle' | 'potion' | 'treasure' | 'super_potion' | 'saddle';
  qty: number;
  effect?: {
    hp?: number; hunger?: number; happiness?: number; force?: number; spells?: number;
    // Boost permanent du plafond (super-fioles) — appliqué en +100 au max concerné
    maxHp?: number; maxForce?: number; maxSpells?: number;
    // Cape d'invisibilité — durée en minutes (tirée aléatoirement entre capeInvisibilityMin/MaxMinutes
    // au moment de l'usage, voir activateInvisibility) permettant de franchir un passage gardé.
    invisibleMinutes?: number;
  };
  // ─── Équipement (armes/protections/flèches/engins/selles) — voir EquipmentWidget.tsx et equipItem() ───
  slot?: EquipSlot;          // emplacement où l'objet peut être équipé (absent = non équipable)
  rarity?: ItemRarity;
  damage?: number;           // bonus de dégâts en combat (armes/flèches/familier)
  defense?: number;          // bonus de protection en combat (armures/boucliers/amulettes/familier)
  durabilityMax?: number;    // nombre d'utilisations en combat avant de risquer la casse
  requiresArrow?: boolean;   // true pour un arc : inefficace tant qu'aucune flèche n'est équipée
  // Selle (slot 'saddle') : id du familier requis pour pouvoir l'équiper — voir equipItem().
  // Ex. 'dragon.gold' → seule la Selle Solaire fonctionne avec le Dragon d'Or équipé.
  requiresFamiliarId?: string;
  addedAt: number;
}

/** Objet équipé dans un emplacement du personnage — instance distincte de la pile d'inventaire,
 * avec sa propre usure. Casser (durability ≤ 0) retire l'objet de l'équipement (perte définitive).
 * `category` accepte aussi 'familiar', un pseudo-objet non stocké en besace (voir equipFamiliar).
 * RTDB : players/{addr}/equipment/{slot} */
export interface EquippedItem {
  itemId: string;
  name: string;
  category: InventoryItem['category'] | 'familiar';
  slot: EquipSlot;
  rarity?: ItemRarity;
  damage?: number;
  defense?: number;
  requiresArrow?: boolean;
  requiresFamiliarId?: string;
  i18nKey?: string;      // clé i18n du familier équipé (voir localizeName)
  durability: number;     // usure courante (0..durabilityMax) — non applicable aux slots 'arrows'/'familiar'
  durabilityMax: number;
  qty?: number;           // nombre de flèches restantes (slot 'arrows' uniquement)
  equippedAt: number;
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
  // ─── Équipement (armes/protections/flèches) — voir InventoryItem et EquipmentWidget.tsx ───
  slot?: EquipSlot;
  rarity?: ItemRarity;
  damage?: number;
  defense?: number;
  durabilityMax?: number;
  requiresArrow?: boolean;
  requiresFamiliarId?: string;
}

// ────────────────────────────────────── Init player ──────────────────────────────────────

const KEY = (addr: string) => addr.toLowerCase();

/** Clé RTDB sûre : les segments de chemin Firebase interdisent ".", "#", "$", "[", "]"
 * (ex. ids hérités de l'ancien slug on-chain "npc.zelda_princess" — voir migrateNpcsTreasuresWorldsToFirebase.mjs).
 * Le champ `id` d'origine (avec points) est conservé tel quel dans la valeur stockée ; seul le
 * segment de chemin est assaini, pour ne jamais planter sur un id admin mal formé. */
export const RKEY = (id: string) => id.toLowerCase().replace(/[.#$[\]]/g, '_');

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
    oxygen: 100, oxygenMax: 100,
    fatigue: 100, fatigueMax: 100,
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
  const oxygenMax    = cur.oxygenMax    ?? 100;
  const fatigueMax   = cur.fatigueMax   ?? 100;
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
    oxygen:     clamp((cur.oxygen    ?? 100) + (delta.oxygen    ?? 0), 0, oxygenMax),
    oxygenMax,
    fatigue:    clamp((cur.fatigue   ?? 100) + (delta.fatigue   ?? 0), 0, fatigueMax),
    fatigueMax,
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
    // Rafraîchit les champs d'équipement (slot/rareté/dégâts/défense/durabilité/arc/familier requis)
    // avec ceux fournis par l'appelant, en plus d'incrémenter la quantité. Sans cela, un objet déjà
    // possédé AVANT une mise à jour du catalogue (ex. admin qui édite ses stats, ou objet acheté
    // avant l'ajout du glisser-déposer) restait figé sur son ancienne forme incomplète — le rendant
    // par exemple non-glissable (pas de `slot`) même après un nouvel achat du même objet.
    const refresh: Record<string, unknown> = { qty: existing.qty + item.qty };
    const equipFields: (keyof Omit<InventoryItem, 'addedAt'>)[] = [
      'slot', 'rarity', 'damage', 'defense', 'durabilityMax', 'requiresArrow', 'requiresFamiliarId', 'effect',
    ];
    for (const k of equipFields) if (item[k] !== undefined) refresh[k] = item[k];
    await update(ref(db, path), refresh);
  } else {
    // Firebase RTDB rejette toute valeur `undefined` (bug déjà rencontré : un ShopItem sans
    // `effect` explicite en base — objet vidé par Firebase — provoquait un `set()` en échec et
    // empêchait silencieusement l'ajout de l'objet acheté, ex. les flèches). On élimine donc
    // toute clé à valeur undefined avant l'écriture, quel que soit l'appelant.
    const clean: Record<string, unknown> = { addedAt: Date.now() };
    for (const [k, v] of Object.entries(item)) if (v !== undefined) clean[k] = v;
    await set(ref(db, path), clean);
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

/** Active la cape d'invisibilité (durée aléatoire entre les bornes admin, en minutes) — retire
 * l'objet de l'inventaire (usage unique) et enregistre l'expiration sur le PlayerState. */
export async function activateInvisibility(address: string, minMinutes: number, maxMinutes: number): Promise<number> {
  const db = getFirebaseDb();
  if (!db) return 0;
  await ensureAnonSignIn();
  const minutes = Math.max(1, minMinutes) + Math.floor(Math.random() * Math.max(1, maxMinutes - minMinutes + 1));
  const until = Date.now() + minutes * 60_000;
  await update(ref(db, `players/${KEY(address)}`), { invisibleUntil: until });
  return until;
}

/** Consomme un objet de la besace (nourriture/potion/sortilège) : applique son effet — ou
 * déclenche l'invisibilité temporisée pour la cape — puis retire 1 exemplaire de l'inventaire.
 * Logique partagée entre le bouton "Utiliser" de InventoryPanel.tsx et le glisser-déposer vers la
 * "bouche" de Synk dans EquipmentWidget.tsx (deux méthodes équivalentes pour nourrir Synk). */
export async function consumeInventoryItem(address: string, item: InventoryItem, rules: RepRules): Promise<void> {
  if (item.effect?.invisibleMinutes) {
    const min = rules.capeInvisibilityMinMinutes ?? 10;
    const max = rules.capeInvisibilityMaxMinutes ?? 15;
    await activateInvisibility(address, min, max);
  } else if (item.effect) {
    await applyEffect(address, item.effect);
  }
  await removeFromInventory(address, item.itemId, 1);
}

// ────────────────────────────────────── Équipement (Vitruve) ──────────────────────────────────────
// Le joueur équipe une arme/protection/flèches par glisser-déposer depuis la besace vers
// EquipmentWidget.tsx. Contrairement à l'inventaire (empilé par itemId), chaque emplacement
// d'équipement porte sa propre usure (`durability`) : équiper consomme 1 unité (ou toute la pile
// pour les flèches) de l'inventaire ; déséquiper la restitue à l'état neuf (simplification
// volontaire — l'usure partielle n'est pas fractionnée dans la pile d'inventaire empilée par qty).

export function subscribeEquipment(address: string, cb: (equipment: Partial<Record<EquipSlot, EquippedItem>>) => void): () => void {
  const db = getFirebaseDb();
  if (!db) { cb({}); return () => {}; }
  const r = ref(db, `players/${KEY(address)}/equipment`);
  const handler = (snap: DataSnapshot) => cb((snap.val() as Partial<Record<EquipSlot, EquippedItem>> | null) ?? {});
  onValue(r, handler);
  return () => off(r, 'value', handler);
}

export async function getEquipment(address: string): Promise<Partial<Record<EquipSlot, EquippedItem>>> {
  const db = getFirebaseDb();
  if (!db) return {};
  const snap = await get(ref(db, `players/${KEY(address)}/equipment`));
  return (snap.val() as Partial<Record<EquipSlot, EquippedItem>> | null) ?? {};
}

/** Équipe un objet de la besace dans un emplacement (doit correspondre à `item.slot`, ou
 * catégorie 'arrow' → slot 'arrows'). Remet l'éventuel occupant précédent dans la besace.
 * Une selle (`slot === 'saddle'`) liée à un dragon précis (`requiresFamiliarId`) ne peut être
 * équipée que si ce familier est déjà le compagnon de combat actif (slot 'familiar'). */
export type EquipResult = 'ok' | 'wrongSlot' | 'needFamiliar' | 'failed';

export async function equipItem(address: string, item: InventoryItem, slot: EquipSlot): Promise<EquipResult> {
  const db = getFirebaseDb();
  if (!db) return 'failed';
  const validSlot = slot === 'arrows' ? item.category === 'arrow' : item.slot === slot;
  if (!validSlot) return 'wrongSlot';
  if (slot === 'saddle' && item.requiresFamiliarId) {
    const equipment = await getEquipment(address);
    if (equipment.familiar?.itemId !== item.requiresFamiliarId) return 'needFamiliar';
  }
  await ensureAnonSignIn();
  const takeQty = slot === 'arrows' ? item.qty : 1;
  const ok = await removeFromInventory(address, item.itemId, takeQty);
  if (!ok) return 'failed';
  await unequipSlot(address, slot); // restitue l'ancien occupant avant de poser le nouveau
  const equipped: EquippedItem = {
    itemId: item.itemId, name: item.name, category: item.category, slot,
    durability: item.durabilityMax ?? 100, durabilityMax: item.durabilityMax ?? 100,
    equippedAt: Date.now(),
    ...(item.rarity ? { rarity: item.rarity } : {}),
    ...(item.damage ? { damage: item.damage } : {}),
    ...(item.defense ? { defense: item.defense } : {}),
    ...(item.requiresArrow ? { requiresArrow: true } : {}),
    ...(item.requiresFamiliarId ? { requiresFamiliarId: item.requiresFamiliarId } : {}),
    ...(slot === 'arrows' ? { qty: takeQty } : {}),
  };
  await set(ref(db, `players/${KEY(address)}/equipment/${slot}`), equipped);
  return 'ok';
}

/** Retire l'objet équipé d'un emplacement et le restitue à la besace (à l'état neuf). Le slot
 * 'familiar' est un cas particulier : ce n'est pas un objet de besace (juste une référence vers un
 * familier déjà apprivoisé, voir equipFamiliar), donc rien n'est restitué — le familier reste
 * possédé indéfiniment, on ne fait que le retirer du rang de compagnon de combat actif. */
export async function unequipSlot(address: string, slot: EquipSlot): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  const path = `players/${KEY(address)}/equipment/${slot}`;
  const snap = await get(ref(db, path));
  const it = snap.val() as EquippedItem | null;
  if (!it) return;
  if (slot === 'familiar') {
    await set(ref(db, path), null);
    return;
  }
  await addToInventory(address, {
    itemId: it.itemId, name: it.name, category: it.category as InventoryItem['category'], qty: it.qty ?? 1,
    ...(it.slot ? { slot: it.slot } : {}),
    ...(it.rarity ? { rarity: it.rarity } : {}),
    ...(it.damage ? { damage: it.damage } : {}),
    ...(it.defense ? { defense: it.defense } : {}),
    ...(it.durabilityMax ? { durabilityMax: it.durabilityMax } : {}),
    ...(it.requiresArrow ? { requiresArrow: true } : {}),
    ...(it.requiresFamiliarId ? { requiresFamiliarId: it.requiresFamiliarId } : {}),
  });
  await set(ref(db, path), null);
}

/** Bonus de combat dérivé de l'équipement porté (dégâts arme + défense armure/bouclier/amulette
 * + familier de combat), pondéré par les diviseurs admin (RepRules.equipDamageBonusDivisor/
 * equipDefenseBonusDivisor). Un arc (`requiresArrow`) ne compte ses dégâts que si des flèches
 * sont équipées (qty > 0). Le familier (dragon...) ne s'use jamais — jamais ajouté à `usedSlots`. */
export function computeEquipmentCombatBonus(
  equipment: Partial<Record<EquipSlot, EquippedItem>>, rules: RepRules,
): { bonus: number; usedSlots: EquipSlot[]; arrowsExhausted: boolean } {
  let damage = 0;
  let defense = 0;
  const usedSlots: EquipSlot[] = [];
  let arrowsExhausted = false;
  const weapon = equipment.weapon;
  if (weapon && weapon.durability > 0) {
    if (weapon.requiresArrow) {
      const arrows = equipment.arrows;
      if (arrows && (arrows.qty ?? 0) > 0) {
        damage += (weapon.damage ?? 0) + (arrows.damage ?? 0);
        usedSlots.push('weapon', 'arrows');
      } else {
        arrowsExhausted = true;
      }
    } else {
      damage += weapon.damage ?? 0;
      usedSlots.push('weapon');
    }
  }
  (['offhand', 'head', 'body', 'legs', 'feet', 'belt', 'amulet'] as EquipSlot[]).forEach((slot) => {
    const it = equipment[slot];
    if (it && it.durability > 0 && it.defense) {
      defense += it.defense;
      usedSlots.push(slot);
    }
  });
  // Familier de combat (ex. dragon) — bonus fixe, compagnon vivant : ne s'use et ne casse jamais.
  const familiar = equipment.familiar;
  if (familiar) {
    damage += familiar.damage ?? 0;
    defense += familiar.defense ?? 0;
  }
  const damageDivisor = Math.max(1, rules.equipDamageBonusDivisor ?? 4);
  const defenseDivisor = Math.max(1, rules.equipDefenseBonusDivisor ?? 5);
  const bonus = Math.floor(damage / damageDivisor) + Math.floor(defense / defenseDivisor);
  return { bonus, usedSlots, arrowsExhausted };
}

/** Applique l'usure de combat aux emplacements utilisés (arme/protections) : réduit la durabilité
 * de `wearPct` % du plafond (arrondi, minimum 1) ; si elle atteint 0, l'objet casse et disparaît
 * (pop-up dédié côté UI). Les flèches sont consommées séparément (1 par tir), sans casse. */
export async function applyEquipmentWear(
  address: string, usedSlots: EquipSlot[], wearPct: number,
): Promise<{ broken: EquippedItem[] }> {
  const db = getFirebaseDb();
  if (!db) return { broken: [] };
  const broken: EquippedItem[] = [];
  for (const slot of usedSlots) {
    const path = `players/${KEY(address)}/equipment/${slot}`;
    const snap = await get(ref(db, path));
    const it = snap.val() as EquippedItem | null;
    if (!it) continue;
    if (slot === 'arrows') {
      const remaining = Math.max(0, (it.qty ?? 1) - 1);
      if (remaining <= 0) await set(ref(db, path), null);
      else await update(ref(db, path), { qty: remaining });
      continue;
    }
    const loss = Math.max(1, Math.round(it.durabilityMax * (Math.max(0, wearPct) / 100)));
    const remaining = it.durability - loss;
    if (remaining <= 0) {
      await set(ref(db, path), null);
      broken.push(it);
    } else {
      await update(ref(db, path), { durability: remaining });
    }
  }
  return { broken };
}

/** Détermine la rareté max accessible pour un total d'XP donné (paliers paramétrables admin). */
export function rarityForXp(xp: number, rules: RepRules): ItemRarity {
  if (xp >= (rules.equipRarityXpEpic ?? 100000)) return 'epic';
  if (xp >= (rules.equipRarityXpLegendary ?? 80000)) return 'legendary';
  if (xp >= (rules.equipRarityXpRare ?? 20000)) return 'rare';
  return 'common';
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

// Hash déterministe (FNV-1a) d'une chaîne vers un flottant stable dans [0, 1) — utilisé pour que
// les tirages « aléatoires » affichés (ex. humeur vagabonde de nuit ci-dessous) restent identiques
// tant que la clé (joueur + jour) ne change pas, au lieu de varier à chaque rendu React.
function stableUnitRand(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
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
  seed?: string; // adresse du joueur — stabilise le tirage "nuit" (voir plus bas)
}): MoodHappinessResult {
  const { baseHappiness, happinessMax, weatherKey, encountersToday, hasFamiliar, wallet, fightsWon, feedsToday, rules, seed } = input;

  let weather = 0;
  switch (weatherKey) {
    case 'sunny':  weather = rules.moodWeatherSunnyBonus; break;
    case 'cloudy': weather = rules.moodWeatherCloudyBonus; break;
    case 'rainy':  weather = rules.moodWeatherRainyBonus; break;
    case 'stormy': weather = rules.moodWeatherStormyBonus; break;
    case 'snowy':  weather = rules.moodWeatherSnowyBonus; break;
    case 'night': {
      // Tirage "humeur vagabonde" STABLE (déterministe par joueur + jour courant), et non plus
      // Math.random() pur : cette fonction est appelée à chaque rendu (voir PlayerStats.tsx et
      // game/page.tsx), un tirage réellement aléatoire faisait donc « varier » le Bonheur affiché
      // à chaque clic/rafraîchissement tant que la météo restait sur 🌙 Nuit, sans qu'aucune vraie
      // valeur n'ait changé en base — un bug d'affichage, pas une évolution réelle du jeu.
      const day = new Date().toISOString().slice(0, 10);
      const r = stableUnitRand(`${seed ?? 'anon'}|${day}`);
      weather = Math.round((r * 2 - 1) * rules.moodWeatherNightSwing);
      break;
    }
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
  season?: Season;       // si renseigné, quête offerte par PNJ uniquement pendant cette saison (voir
                         // pickNpcQuestForPlayer()) — une fois débloquée/résolue elle reste visible
                         // toute l'année (voir QuestList.tsx). undefined = disponible toute l'année.
  // ─── Quêtes du Royaume (voir section dédiée plus bas, ~KINGDOM_CHAPTERS/computeKingdomProgress) ─
  // 400 quêtes à énigmes formant le fil narratif principal (délivrer la Princesse PocaPoka et son
  // fidèle El Pipo de l'emprise de Zorghon), débloquées PROGRESSIVEMENT par la résolution des
  // quêtes intermédiaires (classiques + PNJ, ci-dessus) puis les unes après les autres dans l'ordre
  // `kingdomOrder`. Totalement indépendant du système classique/PNJ existant : une quête du Royaume
  // n'est JAMAIS un npcGiver et n'affecte pas pickNpcQuestForPlayer()/getUnlockedQuestIds().
  kingdomQuest?: boolean;  // true = fait partie des 400 "Quêtes du Royaume"
  kingdomChapter?: number; // 1-40 : chapitre/région du Royaume (voir KINGDOM_CHAPTERS) — regroupement
                           // d'affichage dans le widget "Quêtes", 10 quêtes par chapitre.
  kingdomOrder?: number;   // 1-400 : rang global dans la chaîne narrative — la quête `kingdomOrder`
                           // N+1 ne se débloque que lorsque la quête `kingdomOrder` N est résolue.
  fullMoonOnly?: boolean;  // true = quête masquée (widget Quêtes, Mapmonde, Plateforme 2D isométrique
                           // et pop-up) tant que ce n'est pas un jour de pleine lune (voir MoonState/
                           // isFullMoonToday() ci-dessous) — réservé à 40 des 400 Quêtes du Royaume.
  fullMoonDate?: string;   // "AAAA-MM-JJ" optionnel (admin, panneau "Quêtes existantes" → calendrier) :
                           // si renseigné, cette quête (fullMoonOnly) n'exige PAS la pleine lune du
                           // calendrier global mais UNIQUEMENT cette date précise (permet d'assigner
                           // à chaque quête son propre jour de pleine lune choisi dans le calendrier
                           // admin plutôt que de partager le même jour global — voir getMoonCalendar()).
  // ─── Positionnement sur la mapmonde/plateforme isométrique (voir WorldMapWidget.tsx et
  // GameCanvas2D.tsx) — facultatif : sans valeur explicite, une position stable est dérivée de
  // l'id (voir poiFallbackPos()) pour que chaque quête ait tout de même un point fixe sur la carte.
  mapX?: number;
  mapY?: number;
  itemReward?: {
    itemId: string; name: string; qty: number; category: InventoryItem['category']; effect?: InventoryItem['effect'];
    // Champs d'équipement (mêmes que ShopItem/InventoryItem) — permet à une quête de remettre un
    // objet glissable/équipable (arme, protection, amulette...) et pas seulement un consommable.
    slot?: EquipSlot; rarity?: ItemRarity; damage?: number; defense?: number; durabilityMax?: number;
    requiresArrow?: boolean; requiresFamiliarId?: string;
  };
                         // objet remis en plus de l'XP/score à la résolution (ex. cape d'invisibilité
                         // de la quête "Gardiens à trois têtes de chameaux") — voir submitQuestAnswerOffchain
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
  if (quest.itemReward) {
    await addToInventory(address, {
      itemId: quest.itemReward.itemId, name: quest.itemReward.name,
      category: quest.itemReward.category, qty: quest.itemReward.qty,
      ...(quest.itemReward.effect ? { effect: quest.itemReward.effect } : {}),
      ...(quest.itemReward.slot ? { slot: quest.itemReward.slot } : {}),
      ...(quest.itemReward.rarity ? { rarity: quest.itemReward.rarity } : {}),
      ...(quest.itemReward.damage ? { damage: quest.itemReward.damage } : {}),
      ...(quest.itemReward.defense ? { defense: quest.itemReward.defense } : {}),
      ...(quest.itemReward.durabilityMax ? { durabilityMax: quest.itemReward.durabilityMax } : {}),
      ...(quest.itemReward.requiresArrow ? { requiresArrow: true } : {}),
      ...(quest.itemReward.requiresFamiliarId ? { requiresFamiliarId: quest.itemReward.requiresFamiliarId } : {}),
    });
  }
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

/**
 * Récupère en un seul accès Firebase l'ensemble des réponses officielles (clé = questId, valeur =
 * réponse en clair) — réservé à l'affichage dans le menu Administration (page `/admin`, protégée
 * par `isOwner`). Ces réponses ne sont JAMAIS exposées dans les composants de jeu accessibles à
 * tous les joueurs (voir `QuestList.tsx`, qui ne révèle une réponse qu'après que LE JOUEUR
 * lui-même l'a soumise et validée).
 */
export async function getAllQuestAnswers(): Promise<Record<string, string>> {
  const db = getFirebaseDb();
  if (!db) return {};
  const snap = await get(ref(db, 'catalog/riddleAnswers'));
  return (snap.val() as Record<string, string> | null) ?? {};
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
 * Abonnement temps réel aux quêtes `npcGiver` débloquées (voir `subscribeEquipment` pour le même
 * principe) — permet à `QuestList.tsx` de refléter instantanément une acceptation de "Quête PNJ"
 * (NpcEncounterPopup / PoiInteractionModal) sans nécessiter un rechargement de la page.
 */
export function subscribeUnlockedQuestIds(address: string, cb: (ids: Set<string>) => void): () => void {
  const db = getFirebaseDb();
  if (!db) { cb(new Set()); return () => {}; }
  const r = ref(db, `players/${KEY(address)}/unlockedQuests`);
  const handler = (snap: DataSnapshot) => {
    const v = snap.val() as Record<string, unknown> | null;
    cb(new Set(v ? Object.keys(v) : []));
  };
  onValue(r, handler);
  return () => off(r, 'value', handler);
}

/**
 * Choisit, parmi le catalogue des quêtes `npcGiver` actives, une énigme non encore débloquée ni
 * résolue par ce joueur (tirage aléatoire) — appelée quand un PNJ "quête" est accepté dans
 * `NpcEncounterPopup`. Renvoie `null` si le joueur a déjà débloqué/résolu les 20 énigmes du pool.
 * Les quêtes tagués `season` ne sont proposées que pendant la saison effective (voir
 * getCurrentSeason()) — une quête sans `season` reste toujours proposable.
 */
export async function pickNpcQuestForPlayer(address: string): Promise<QuestDef | null> {
  const [quests, unlocked, season] = await Promise.all([getQuestDefs(), getUnlockedQuestIds(address), getCurrentSeason()]);
  const pool = quests.filter(q => q.active && q.npcGiver && !unlocked.has(q.id.toLowerCase()) && (!q.season || q.season === season));
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

// ────────────────────────────── Quêtes du Royaume (400 énigmes, fil narratif) ──────────────────────────────
// Chaîne narrative principale de Horizon ZeldCraft, inspirée de Donjons & Dragons, Tolkien/Le
// Seigneur des Anneaux, la trilogie Zelda et Warcraft : délivrer la Princesse PocaPoka et son
// fidèle lutin des sables El Pipo de l'emprise de Zorghon le Maléfique. 400 quêtes (`QuestDef` avec
// `kingdomQuest: true`), réparties en 40 chapitres (`kingdomChapter` 1-40, voir KINGDOM_CHAPTERS) de
// 10 quêtes chacun (`kingdomOrder` 1-400 déterminant l'ordre STRICT de déblocage : la quête N+1 ne
// se débloque que lorsque la quête N est résolue par le joueur). La toute première (kingdomOrder=1)
// se débloque après que le joueur ait résolu `RepRules.kingdomMinIntermediateSolved` quêtes
// intermédiaires (classiques + PNJ, voir getSolvedIntermediateCount ci-dessous) — ce qui garantit
// que la progression classique existante (5 quêtes classiques + 20 quêtes PNJ, XP requis) reste
// INCHANGÉE et continue de faire foi pour l'accès initial au Royaume, sans aucune régression.
// 40 des 400 quêtes (`fullMoonOnly: true`, une par chapitre) restent en plus masquées tant que ce
// n'est pas un jour de pleine lune (voir MoonState/isFullMoonToday ci-dessous).

/** Métadonnées d'affichage des 40 chapitres du Royaume — regroupement dans le widget "Quêtes"
 * uniquement (aucune donnée de jeu, purement descriptif). L'ordre du tableau = ordre narratif. */
export interface KingdomChapterDef { chapter: number; title: string; i18nKey: string; icon: string }
export const KINGDOM_CHAPTERS: KingdomChapterDef[] = [
  { chapter: 1,  icon: '🏘️', title: "Vallée d'Emberrune",        i18nKey: 'kingdom.chapter.1' },
  { chapter: 2,  icon: '🌲', title: 'Forêt de Sylvaltide',        i18nKey: 'kingdom.chapter.2' },
  { chapter: 3,  icon: '🐸', title: 'Marais de Fangrouille',      i18nKey: 'kingdom.chapter.3' },
  { chapter: 4,  icon: '⛰️', title: 'Collines de Pierreflamme',   i18nKey: 'kingdom.chapter.4' },
  { chapter: 5,  icon: '🕳️', title: 'Grottes de Kragmoor',        i18nKey: 'kingdom.chapter.5' },
  { chapter: 6,  icon: '🌉', title: 'Pont Brisé de Ravenoire',    i18nKey: 'kingdom.chapter.6' },
  { chapter: 7,  icon: '🌾', title: 'Plaines de Corenlie',        i18nKey: 'kingdom.chapter.7' },
  { chapter: 8,  icon: '🏛️', title: "Ruines d'Anvieil",           i18nKey: 'kingdom.chapter.8' },
  { chapter: 9,  icon: '🧊', title: 'Lac Glacial de Mirevent',    i18nKey: 'kingdom.chapter.9' },
  { chapter: 10, icon: '🏜️', title: 'Village des Sables',         i18nKey: 'kingdom.chapter.10' },
  { chapter: 11, icon: '🐫', title: 'Désert de Sarrakoth',        i18nKey: 'kingdom.chapter.11' },
  { chapter: 12, icon: '🌴', title: 'Oasis Perdue de Zayira',     i18nKey: 'kingdom.chapter.12' },
  { chapter: 13, icon: '🏞️', title: 'Canyon des Échos',           i18nKey: 'kingdom.chapter.13' },
  { chapter: 14, icon: '🗿', title: 'Temple Enseveli de Nourah',  i18nKey: 'kingdom.chapter.14' },
  { chapter: 15, icon: '🪨', title: 'Forêt Pétrifiée',            i18nKey: 'kingdom.chapter.15' },
  { chapter: 16, icon: '🌊', title: 'Cité Engloutie de Valmoria', i18nKey: 'kingdom.chapter.16' },
  { chapter: 17, icon: '🐴', title: 'Steppe de Khardûn',          i18nKey: 'kingdom.chapter.17' },
  { chapter: 18, icon: '⛺', title: 'Camp des Nomades du Vent',   i18nKey: 'kingdom.chapter.18' },
  { chapter: 19, icon: '🌫️', title: 'Passage des Brumes',         i18nKey: 'kingdom.chapter.19' },
  { chapter: 20, icon: '🏔️', title: 'Sommet de Grisemont',        i18nKey: 'kingdom.chapter.20' },
  { chapter: 21, icon: '🔥', title: 'Terres Calcinées',           i18nKey: 'kingdom.chapter.21' },
  { chapter: 22, icon: '💀', title: 'Champ des Cendres',          i18nKey: 'kingdom.chapter.22' },
  { chapter: 23, icon: '🏚️', title: 'Fort Abandonné de Nathrek',  i18nKey: 'kingdom.chapter.23' },
  { chapter: 24, icon: '🌋', title: 'Rivière de Magma',           i18nKey: 'kingdom.chapter.24' },
  { chapter: 25, icon: '🐲', title: 'Antre du Wyrm Noir',         i18nKey: 'kingdom.chapter.25' },
  { chapter: 26, icon: '⚰️', title: 'Nécropole de Kaldrith',      i18nKey: 'kingdom.chapter.26' },
  { chapter: 27, icon: '🌀', title: 'Labyrinthe de Voss',         i18nKey: 'kingdom.chapter.27' },
  { chapter: 28, icon: '🗼', title: 'Tour des Murmures',          i18nKey: 'kingdom.chapter.28' },
  { chapter: 29, icon: '👻', title: 'Pont des Âmes',              i18nKey: 'kingdom.chapter.29' },
  { chapter: 30, icon: '⛩️', title: 'Sanctuaire Oublié',          i18nKey: 'kingdom.chapter.30' },
  { chapter: 31, icon: '🏰', title: 'Bastion de Zorghon',         i18nKey: 'kingdom.chapter.31' },
  { chapter: 32, icon: '⛓️', title: 'Prison des Cendres',         i18nKey: 'kingdom.chapter.32' },
  { chapter: 33, icon: '🕯️', title: 'Cour des Ombres',            i18nKey: 'kingdom.chapter.33' },
  { chapter: 34, icon: '🗡️', title: 'Salle des Lieutenants',      i18nKey: 'kingdom.chapter.34' },
  { chapter: 35, icon: '⚒️', title: 'Forge Infernale',            i18nKey: 'kingdom.chapter.35' },
  { chapter: 36, icon: '🥀', title: 'Jardins Calcinés',           i18nKey: 'kingdom.chapter.36' },
  { chapter: 37, icon: '🖤', title: 'Grand Escalier Noir',        i18nKey: 'kingdom.chapter.37' },
  { chapter: 38, icon: '👑', title: 'Salle du Trône Déchu',       i18nKey: 'kingdom.chapter.38' },
  { chapter: 39, icon: '🌑', title: 'Cœur de la Citadelle',       i18nKey: 'kingdom.chapter.39' },
  { chapter: 40, icon: '☀️', title: 'La Chute de Zorghon',        i18nKey: 'kingdom.chapter.40' },
];

// ─── Pleine lune (calendrier tournant, admin) — même principe que SeasonState ─────────────────
// Par défaut ("auto"), la pleine lune effective du mois est calculée astronomiquement (cycle
// synodique moyen ≈ 29.53059 jours depuis une pleine lune de référence connue) : un seul jour par
// mois est ainsi "jour de pleine lune", sans aucune intervention admin. L'admin peut forcer un jour
// fixe DÉFAUT du mois (1-31, "manual") pour un contrôle global — voir setMoonState — ET/OU forcer,
// mois par mois (mois en cours ou à venir), un jour PRÉCIS via le calendrier admin (`overrides`,
// clé "AAAA-MM" → jour du mois) qui prévaut toujours sur le mode auto/manuel — voir
// setMoonOverrideForMonth()/getMoonCalendar() (panneau Administration → "Pleine lune").
export interface MoonState {
  mode: 'auto' | 'manual';
  manualDay?: number;
  overrides?: Record<string, number>; // clé "AAAA-MM" (mois 1-12) → jour du mois forcé pour CE mois précis
  updatedAt: number;
}
const DEFAULT_MOON_STATE: MoonState = { mode: 'auto', updatedAt: 0 };
const SYNODIC_MONTH_DAYS = 29.530588853;
const KNOWN_FULL_MOON_MS = Date.UTC(2000, 0, 21, 4, 41); // pleine lune de référence (21 janv. 2000, 04:41 UTC)

/** Horodatage (ms) de la pleine lune exacte la plus proche de `date` — pur/synchrone. */
function nearestFullMoonMs(date: Date = new Date()): number {
  const cycles = (date.getTime() - KNOWN_FULL_MOON_MS) / (SYNODIC_MONTH_DAYS * 86400000);
  return KNOWN_FULL_MOON_MS + Math.round(cycles) * SYNODIC_MONTH_DAYS * 86400000;
}

/** true si `date` (jour civil local) est le jour de la pleine lune astronomique la plus proche. */
export function computeAutoFullMoon(date: Date = new Date()): boolean {
  const exact = new Date(nearestFullMoonMs(date));
  return exact.getFullYear() === date.getFullYear() && exact.getMonth() === date.getMonth() && exact.getDate() === date.getDate();
}

/** Prochaine pleine lune astronomique à partir de `from` (toujours dans le futur ou aujourd'hui). */
export function getNextFullMoonDate(from: Date = new Date()): Date {
  let ms = nearestFullMoonMs(from);
  const startOfToday = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  if (ms < startOfToday) ms += SYNODIC_MONTH_DAYS * 86400000;
  return new Date(ms);
}

/** Jour du mois (1-31) de la pleine lune astronomique dont la date tombe dans le mois calendaire
 * `year`/`month0` (mois 0-indexé) — ancrée sur le 15 du mois pour cibler la pleine lune la plus
 * proche du milieu du mois (chaque mois calendaire compte pour ainsi dire une seule pleine lune). */
export function computeAutoFullMoonDateInMonth(year: number, month0: number): Date {
  return new Date(nearestFullMoonMs(new Date(year, month0, 15)));
}

/** Clé de calendrier "AAAA-MM" (mois 1-12, zero-paddé) utilisée par `MoonState.overrides`. */
export function moonMonthKey(year: number, month0: number): string {
  return `${year}-${String(month0 + 1).padStart(2, '0')}`;
}

/** Jour du mois (1-31) de pleine lune EFFECTIF pour `year`/`month0` donné, dans l'ordre de
 * priorité : 1) override calendrier précis pour ce mois (admin), 2) jour manuel par défaut (mode
 * "manual"), 3) calcul astronomique. Fonction pure/synchrone, réutilisée par isFullMoonOnDate,
 * nextFullMoonDateFromState et le calendrier admin (getMoonCalendar). */
export function resolveFullMoonDayForMonth(state: MoonState, year: number, month0: number): number {
  const override = state.overrides?.[moonMonthKey(year, month0)];
  if (override) return Math.min(31, Math.max(1, override));
  if (state.mode === 'manual' && state.manualDay) return Math.min(31, Math.max(1, state.manualDay));
  return computeAutoFullMoonDateInMonth(year, month0).getDate();
}

/** true si `date` est le jour de pleine lune effectif de son mois (voir resolveFullMoonDayForMonth). */
export function isFullMoonOnDate(state: MoonState, date: Date = new Date()): boolean {
  return date.getDate() === resolveFullMoonDayForMonth(state, date.getFullYear(), date.getMonth());
}

/** Prochaine date de pleine lune EFFECTIVE à partir de `from` (mois en cours si pas encore passé,
 * sinon mois suivant), en tenant compte des overrides calendrier/mode manuel/calcul astronomique. */
export function nextFullMoonDateFromState(state: MoonState, from: Date = new Date()): Date {
  let year = from.getFullYear();
  let month0 = from.getMonth();
  let day = resolveFullMoonDayForMonth(state, year, month0);
  let candidate = new Date(year, month0, day);
  const startOfToday = new Date(year, month0, from.getDate()).getTime();
  if (candidate.getTime() < startOfToday) {
    month0 += 1; if (month0 > 11) { month0 = 0; year += 1; }
    day = resolveFullMoonDayForMonth(state, year, month0);
    candidate = new Date(year, month0, day);
  }
  return candidate;
}

export async function getMoonState(): Promise<MoonState> {
  const db = getFirebaseDb();
  if (!db) return DEFAULT_MOON_STATE;
  const snap = await get(ref(db, 'catalog/moonState'));
  const v = snap.val() as MoonState | null;
  return v ? { ...DEFAULT_MOON_STATE, ...v } : DEFAULT_MOON_STATE;
}

/** Force (ou remet en automatique) le jour de pleine lune par défaut — admin uniquement. Ne touche
 * pas aux overrides calendrier mois-par-mois (voir setMoonOverrideForMonth), qui restent prioritaires. */
export async function setMoonState(mode: 'auto' | 'manual', manualDay?: number): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  const current = await getMoonState();
  await set(ref(db, 'catalog/moonState'), {
    mode, ...(mode === 'manual' && manualDay ? { manualDay } : {}),
    ...(current.overrides ? { overrides: current.overrides } : {}), updatedAt: Date.now(),
  });
}

/** Force (ou efface, si `day` est `null`) le jour précis de pleine lune d'un mois calendaire donné
 * (mois en cours ou à venir) — panneau Administration → "Pleine lune" → calendrier. Prioritaire sur
 * `mode`/`manualDay` pour ce mois précis uniquement ; les autres mois restent inchangés. */
export async function setMoonOverrideForMonth(year: number, month0: number, day: number | null): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  const current = await getMoonState();
  const overrides = { ...(current.overrides ?? {}) };
  const key = moonMonthKey(year, month0);
  if (day === null) delete overrides[key]; else overrides[key] = Math.min(31, Math.max(1, day));
  await set(ref(db, 'catalog/moonState'), { ...current, overrides, updatedAt: Date.now() });
}

/** Calendrier des `monthsAhead` prochains mois (mois en cours inclus) avec, pour chacun, le jour de
 * pleine lune effectif et si celui-ci provient d'un override admin explicite pour ce mois précis —
 * alimente le sélecteur "calendrier" du panneau Administration → "Pleine lune". */
export interface MoonMonthEntry { year: number; month0: number; day: number; date: Date; overridden: boolean }
export async function getMoonCalendar(monthsAhead = 12, from: Date = new Date()): Promise<MoonMonthEntry[]> {
  const state = await getMoonState();
  const out: MoonMonthEntry[] = [];
  let year = from.getFullYear();
  let month0 = from.getMonth();
  for (let i = 0; i < monthsAhead; i++) {
    const day = resolveFullMoonDayForMonth(state, year, month0);
    out.push({ year, month0, day, date: new Date(year, month0, day), overridden: !!state.overrides?.[moonMonthKey(year, month0)] });
    month0 += 1; if (month0 > 11) { month0 = 0; year += 1; }
  }
  return out;
}

/** true si aujourd'hui est le jour de pleine lune effectif (overrides calendrier > mode manuel >
 * calcul astronomique — voir resolveFullMoonDayForMonth). */
export async function isFullMoonToday(): Promise<boolean> {
  const state = await getMoonState();
  return isFullMoonOnDate(state, new Date());
}

/** Prochaine date de pleine lune EFFECTIVE (respecte les overrides calendrier et le mode manuel de
 * l'admin, sinon calcul astronomique) — affichée au même niveau que la météo/saison dans le jeu
 * (voir MoonWidget.tsx) et utilisée pour le compte à rebours du widget "Quêtes du Royaume" quand
 * une quête `fullMoonOnly` est verrouillée (voir KingdomQuestsWidget.tsx). */
export async function getNextFullMoonDisplayDate(from: Date = new Date()): Promise<Date> {
  const state = await getMoonState();
  return nextFullMoonDateFromState(state, from);
}

/** Lit en un seul accès Firebase l'ensemble des ids de quêtes résolues par ce joueur (clé =
 * questId en minuscules) — bien plus efficace qu'un `getSolvedQuest` par quête (voir
 * getSolvedIntermediateCount/computeKingdomProgress ci-dessous qui en ont besoin en masse). */
export async function getAllSolvedQuestIds(address: string): Promise<Set<string>> {
  const db = getFirebaseDb();
  if (!db) return new Set();
  const snap = await get(ref(db, `players/${KEY(address)}/quests`));
  const v = snap.val() as Record<string, unknown> | null;
  return new Set(v ? Object.keys(v) : []);
}

/**
 * Abonnement temps réel aux quêtes résolues (même principe que subscribeUnlockedQuestIds) —
 * permet au widget "Quêtes du Royaume" et au marqueur 👑 (getKingdomQuestMarker) de refléter
 * instantanément la résolution d'une énigme (classique, PNJ ou Royaume) sans rechargement de page.
 */
export function subscribeSolvedQuestIds(address: string, cb: (ids: Set<string>) => void): () => void {
  const db = getFirebaseDb();
  if (!db) { cb(new Set()); return () => {}; }
  const r = ref(db, `players/${KEY(address)}/quests`);
  const handler = (snap: DataSnapshot) => {
    const v = snap.val() as Record<string, unknown> | null;
    cb(new Set(v ? Object.keys(v) : []));
  };
  onValue(r, handler);
  return () => off(r, 'value', handler);
}

/** Nombre de quêtes INTERMÉDIAIRES (classiques + PNJ, `kingdomQuest` absent/false) déjà résolues
 * par ce joueur — condition de déblocage de la toute première Quête du Royaume (voir
 * RepRules.kingdomMinIntermediateSolved). */
export async function getSolvedIntermediateCount(address: string): Promise<number> {
  const [quests, solved] = await Promise.all([getQuestDefs(), getAllSolvedQuestIds(address)]);
  let n = 0;
  for (const q of quests) if (!q.kingdomQuest && solved.has(q.id.toLowerCase())) n += 1;
  return n;
}

export type KingdomQuestStatus = 'solved' | 'unlocked' | 'locked-intermediate' | 'locked-previous' | 'locked-moon';

export interface KingdomProgressEntry { quest: QuestDef; status: KingdomQuestStatus }

export interface KingdomProgress {
  chain: KingdomProgressEntry[];       // triées par kingdomOrder croissant
  solvedCount: number;
  totalCount: number;
  nextQuest: QuestDef | null;          // prochaine quête 'unlocked' non résolue (à afficher/résoudre)
  nextLockedQuest: QuestDef | null;    // sinon, prochaine quête verrouillée (indice de progression)
}

/**
 * Calcule l'état complet de la chaîne des 400 Quêtes du Royaume pour un joueur donné : quêtes
 * actives triées par `kingdomOrder`, statut de chacune (résolue/débloquée/verrouillée + raison), et
 * la prochaine quête à afficher. Utilisée par le widget "Quêtes" (progression détaillée) ainsi que
 * par getKingdomQuestMarker() (matérialisation sur Mapmonde/Plateforme 2D isométrique).
 */
/** true si la condition "pleine lune" d'une quête est satisfaite aujourd'hui : si `fullMoonDate`
 * est renseigné (admin, calendrier par quête), exige cette date calendaire précise (AAAA-MM-JJ) ;
 * sinon retombe sur le jour de pleine lune global (`moonFull`, voir isFullMoonToday()). */
function questFullMoonSatisfied(q: QuestDef, moonFull: boolean, today: Date = new Date()): boolean {
  if (q.fullMoonDate) {
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return iso === q.fullMoonDate;
  }
  return moonFull;
}

export async function computeKingdomProgress(address: string): Promise<KingdomProgress> {
  const [quests, solved, intermediateCount, moonFull, rules] = await Promise.all([
    getQuestDefs(), getAllSolvedQuestIds(address), getSolvedIntermediateCount(address), isFullMoonToday(), getRepRules(),
  ]);
  const kingdomQuests = quests
    .filter(q => q.active && q.kingdomQuest)
    .sort((a, b) => (a.kingdomOrder ?? Number.MAX_SAFE_INTEGER) - (b.kingdomOrder ?? Number.MAX_SAFE_INTEGER));

  const chain: KingdomProgressEntry[] = [];
  let previousSolved = intermediateCount >= (rules.kingdomMinIntermediateSolved ?? 3);
  for (const q of kingdomQuests) {
    const isSolved = solved.has(q.id.toLowerCase());
    let status: KingdomQuestStatus;
    if (isSolved) status = 'solved';
    else if (!previousSolved) status = kingdomQuests.indexOf(q) === 0 ? 'locked-intermediate' : 'locked-previous';
    else if (q.fullMoonOnly && !questFullMoonSatisfied(q, moonFull)) status = 'locked-moon';
    else status = 'unlocked';
    chain.push({ quest: q, status });
    previousSolved = isSolved; // la quête suivante n'exige que CELLE-CI résolue (chaîne stricte)
  }

  const solvedCount = chain.filter(e => e.status === 'solved').length;
  const nextQuest = chain.find(e => e.status === 'unlocked')?.quest ?? null;
  const nextLockedQuest = nextQuest ? null : (chain.find(e => e.status !== 'solved')?.quest ?? null);
  return { chain, solvedCount, totalCount: chain.length, nextQuest, nextLockedQuest };
}

/**
 * Marqueur de la Quête du Royaume actuellement débloquée-et-non-résolue pour ce joueur (ou `null`
 * si aucune, ex. condition intermédiaire pas encore remplie, ou quête suivante réservée à la pleine
 * lune hors de sa date) — à fusionner avec `getAllMapMarkers()` par WorldMapWidget.tsx et
 * GameCanvas2D.tsx pour matérialiser visuellement la Quête du Royaume en cours (icône 👑, réutilise
 * le même pop-up d'interaction que les quêtes PNJ classiques — voir PoiInteractionModal::QuestBody).
 */
export async function getKingdomQuestMarker(address: string): Promise<MapMarker | null> {
  const progress = await computeKingdomProgress(address);
  const q = progress.nextQuest;
  if (!q) return null;
  const fp = poiFallbackPos(q.id, 105);
  return {
    id: q.id, kind: 'quest', name: q.label, i18nKey: q.i18nKey, icon: '👑', x: q.mapX ?? fp.x, y: q.mapY ?? fp.y,
    isKingdom: true, questCategory: 'kingdom', kingdomChapter: q.kingdomChapter, fullMoonOnly: q.fullMoonOnly,
  };
}

// ─────────────────────── PNJ officiels / Trésors / Mondes (100% hors-chaîne) ───────────────────────
// Reprend en Firebase le même principe que les Quêtes ci-dessus : le contrat Solidity n'expose,
// pour les PNJ/trésors/mondes « officiels », que des fonctions de CRÉATION (`addNpc`/`addTreasure`/
// `addWorld`, chacune avec `require(!x[id].active, "exists")`) — aucune fonction de mise à jour d'un
// champ (nom, XP, dialogue). Rendre ces catalogues réellement « modifiables » depuis le menu
// Administration nécessite donc de les stocker en base plutôt que sur la chaîne (comme les quêtes),
// avec les mêmes id/nom/XP que le seed on-chain d'origine pour rester cohérent avec l'historique
// (voir contracts/scripts/deploy.ts et scripts/migrateNpcsTreasuresWorldsToFirebase.mjs).

export interface NpcDef {
  id: string;            // clé stable texte, ex. "npc.zelda_princess"
  name: string;
  i18nKey?: string;      // clé i18n (ex. "npc.official.zelda_princess") — voir localizeName()
  dialog: string;
  xpReward: number;
  questId?: string;      // QuestDef.id proposé/débloqué à la rencontre (facultatif)
  active: boolean;
  createdAt: number;
  order?: number;
  season?: Season;       // si renseigné, ce PNJ officiel n'apparaît dans "PNJ" que pendant cette
                         // saison (voir NpcList.tsx) — undefined = visible toute l'année.
  // ─── Positionnement sur la mapmonde/plateforme isométrique — voir QuestDef.mapX/mapY ci-dessus.
  mapX?: number;
  mapY?: number;
}
export interface TreasureDef {
  id: string;            // ex. "treasure.master_sword"
  name: string;
  i18nKey?: string;      // clé i18n (ex. "treasure.master_sword")
  xpRequired: number;    // XP cumulé nécessaire pour pouvoir ouvrir le coffre
  xpReward: number;      // XP octroyé (une fois) à l'ouverture
  active: boolean;
  createdAt: number;
  order?: number;
  season?: Season;       // si renseigné, coffre visible/ouvrable uniquement pendant cette saison
                         // tant qu'il n'a pas déjà été trouvé (voir TreasureList.tsx) — une fois
                         // trouvé il reste visible toute l'année. undefined = toute l'année.
  // ─── Positionnement sur la mapmonde/plateforme isométrique — voir QuestDef.mapX/mapY ci-dessus.
  mapX?: number;
  mapY?: number;
  // Objet remis dans la besace à l'ouverture (même forme que QuestDef.itemReward) — voir
  // openTreasureOffchain(). Sans ce champ, ouvrir un coffre ne rapportait QUE de l'XP : le rubis/
  // l'épée/la pioche promis par le nom du trésor n'apparaissait jamais dans la besace (bug signalé).
  itemReward?: {
    itemId: string; name: string; qty: number; category: InventoryItem['category']; effect?: InventoryItem['effect'];
    slot?: EquipSlot; rarity?: ItemRarity; damage?: number; defense?: number; durabilityMax?: number;
    requiresArrow?: boolean; requiresFamiliarId?: string;
  };
}
export interface WorldDef {
  id: string;            // ex. "world.zephyria"
  name: string;
  i18nKey?: string;      // clé i18n (ex. "world.zephyria")
  xpRequired: number;    // XP cumulé nécessaire pour débloquer le monde
  active: boolean;
  createdAt: number;
  order?: number;
  // ─── Positionnement sur la mapmonde (voir WorldMapWidget.tsx) ───
  mapId?: string;        // carte sur laquelle ce monde apparaît (défaut "map.synk_territory")
  mapX?: number;         // position horizontale en % (0-100) du portail d'accès à ce monde
  mapY?: number;         // position verticale en % (0-100)
  // Engin requis en besace pour un voyage rapide/instantané et sans risque vers ce monde (voir
  // travelToWorld ci-dessous). Toujours possible d'y aller à pied sans engin, mais plus long et
  // avec un risque de rencontre nocturne hostile (voir RepRules.travelNightEncounterChancePct).
  vehicleItemId?: string;
}

/**
 * Type de point d'intérêt (décor/terrain) affiché sur la mapmonde — voir MapPoiDef ci-dessous.
 * Volontairement large pour couvrir tous les éléments demandés (plaines, cours d'eau, reliefs,
 * villages amis/ennemis, structures de halte...) tout en restant simple à étendre depuis l'admin.
 */
export type MapPoiType =
  | 'plain' | 'stream' | 'lake' | 'mountain' | 'forest' | 'cave' | 'beach' | 'waterfall'
  | 'village_ally' | 'village_enemy' | 'path' | 'bridge' | 'tavern' | 'stable' | 'hut';

/** Carte mapmonde — évolutif : plusieurs cartes pourront coexister (territoire de Synk, futures
 * extensions saisonnières ou nouveaux continents), chacune avec son propre jeu de POI. */
export interface MapDef {
  id: string;            // ex. "map.synk_territory"
  name: string;
  i18nKey?: string;
  active: boolean;
  createdAt: number;
  order?: number;
}

/** Point d'intérêt décoratif/terrain positionné sur une carte (style vieux parchemin — voir
 * WorldMapWidget.tsx). Purement visuel/narratif (contrairement aux mondes, PNJ, trésors et quêtes
 * qui restent les vraies mécaniques de jeu) mais entièrement paramétrable par l'admin pour étendre
 * ou redessiner le territoire au fil des saisons/évolutions. */
export interface MapPoiDef {
  id: string;
  mapId: string;         // carte parente (voir MapDef.id)
  type: MapPoiType;
  name: string;
  icon: string;          // emoji affiché sur la carte
  x: number;             // position horizontale en % (0-100)
  y: number;             // position verticale en % (0-100)
  active: boolean;
  createdAt: number;
  order?: number;
  season?: Season;       // si renseigné, décor visible uniquement pendant cette saison tant qu'il
                         // n'a pas déjà été découvert (voir WorldMapWidget.tsx) — undefined = toute
                         // l'année.
}

export const DEFAULT_MAP_ID = 'map.synk_territory';

/**
 * Position (x, y en %, 0-100) déterministe et STABLE dérivée d'un id texte — sert de repli quand
 * un PNJ/trésor/familier/quête n'a pas de `mapX`/`mapY` explicite en base, pour que ces éléments
 * (demandés « localisés sur la carte » — voir WorldMapWidget.tsx et GameCanvas2D.tsx) aient tout de
 * même un point fixe et reproductible sur la mapmonde/plateforme isométrique, sans intervention
 * admin obligatoire. `salt` décorrèle les différentes catégories (PNJ/trésor/familier/quête) pour
 * qu'elles ne se superposent pas systématiquement sur les mêmes cases pour un même id numérique.
 * Marge de 6 à 94 (jamais tout à fait sur les bords) pour rester lisible sur la carte parchemin.
 */
export function poiFallbackPos(id: string, salt: number): { x: number; y: number } {
  let h1 = salt * 2246822519, h2 = salt * 3266489917;
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    h1 = (Math.imul(h1 ^ c, 2654435761)) | 0;
    h2 = (Math.imul(h2 ^ c, 2246822519)) | 0;
  }
  h1 = (h1 ^ (h1 >>> 15)) >>> 0;
  h2 = (h2 ^ (h2 >>> 13)) >>> 0;
  const x = 6 + (h1 % 89000) / 1000; // 6..95
  const y = 6 + (h2 % 89000) / 1000;
  return { x, y };
}

function sortDefsByOrder<T extends { order?: number; createdAt: number }>(list: T[]): T[] {
  return list.sort((a, b) => {
    const ao = a.order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return (a.createdAt ?? 0) - (b.createdAt ?? 0);
  });
}

// ── PNJ officiels (distincts des rencontres aléatoires du popup — voir NpcEncounterPopup.tsx) ──

/** Crée/modifie un PNJ officiel (admin). Aucune transaction blockchain. */
export async function addNpcDef(def: NpcDef): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `catalog/npcDefs/${RKEY(def.id)}`), def);
}

export async function getNpcDefs(): Promise<NpcDef[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  const snap = await get(ref(db, 'catalog/npcDefs'));
  const v = snap.val() as Record<string, NpcDef> | null;
  return v ? sortDefsByOrder(Object.values(v)) : [];
}

/** Ids des PNJ officiels déjà rencontrés par ce joueur (Set pour lookup O(1)). */
export async function getMetNpcIds(address: string): Promise<Set<string>> {
  const db = getFirebaseDb();
  if (!db) return new Set();
  const snap = await get(ref(db, `players/${KEY(address)}/npcsMet`));
  const v = snap.val() as Record<string, unknown> | null;
  return new Set(v ? Object.keys(v) : []);
}

/** Abonnement temps réel (même principe que subscribeUnlockedQuestIds) — une rencontre effectuée
 * depuis PoiInteractionModal (plateforme isométrique) doit se refléter instantanément dans
 * NpcList.tsx (besace/onglet PNJ) sans recharger la page. */
export function subscribeMetNpcIds(address: string, cb: (ids: Set<string>) => void): () => void {
  const db = getFirebaseDb();
  if (!db) { cb(new Set()); return () => {}; }
  const r = ref(db, `players/${KEY(address)}/npcsMet`);
  const handler = (snap: DataSnapshot) => {
    const v = snap.val() as Record<string, unknown> | null;
    cb(new Set(v ? Object.keys(v) : []));
  };
  onValue(r, handler);
  return () => off(r, 'value', handler);
}

/** Rencontre un PNJ officiel (hors-chaîne) : XP octroyé + déblocage éventuel d'une quête liée. */
export async function meetNpcOffchain(address: string, npc: NpcDef): Promise<'met' | 'already'> {
  const db = getFirebaseDb();
  if (!db) return 'already';
  const key = RKEY(npc.id);
  const already = (await get(ref(db, `players/${KEY(address)}/npcsMet/${key}`))).val();
  if (already) return 'already';
  await applyEffect(address, { xpBonus: npc.xpReward });
  await ensureAnonSignIn();
  await set(ref(db, `players/${KEY(address)}/npcsMet/${key}`), { metAt: Date.now() });
  if (npc.questId) await unlockQuestForPlayer(address, npc.questId, npc.id).catch(() => {});
  return 'met';
}

// ── Trésors (coffres à seuil d'XP, ouverture manuelle une fois le seuil atteint) ──

/** Crée/modifie un trésor (admin). Aucune transaction blockchain. */
export async function addTreasureDef(def: TreasureDef): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `catalog/treasureDefs/${RKEY(def.id)}`), def);
}

export async function getTreasureDefs(): Promise<TreasureDef[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  const snap = await get(ref(db, 'catalog/treasureDefs'));
  const v = snap.val() as Record<string, TreasureDef> | null;
  return v ? sortDefsByOrder(Object.values(v)) : [];
}

export async function getFoundTreasureIds(address: string): Promise<Set<string>> {
  const db = getFirebaseDb();
  if (!db) return new Set();
  const snap = await get(ref(db, `players/${KEY(address)}/treasuresFound`));
  const v = snap.val() as Record<string, unknown> | null;
  return new Set(v ? Object.keys(v) : []);
}

/** Abonnement temps réel (même principe que subscribeUnlockedQuestIds) — un coffre ouvert depuis
 * PoiInteractionModal (plateforme isométrique) doit se refléter instantanément dans
 * TreasureList.tsx (besace/onglet Trésors) sans recharger la page. */
export function subscribeFoundTreasureIds(address: string, cb: (ids: Set<string>) => void): () => void {
  const db = getFirebaseDb();
  if (!db) { cb(new Set()); return () => {}; }
  const r = ref(db, `players/${KEY(address)}/treasuresFound`);
  const handler = (snap: DataSnapshot) => {
    const v = snap.val() as Record<string, unknown> | null;
    cb(new Set(v ? Object.keys(v) : []));
  };
  onValue(r, handler);
  return () => off(r, 'value', handler);
}

/** Objet de récompense d'un trésor formaté pour addToInventory() — factorisé pour être appelé à la
 * fois lors d'une ouverture normale et lors du rattrapage rétroactif (voir claimMissingTreasureItem). */
function treasureRewardItem(treasure: TreasureDef) {
  const r = treasure.itemReward!;
  return {
    itemId: r.itemId, name: r.name, category: r.category, qty: r.qty,
    ...(r.effect ? { effect: r.effect } : {}),
    ...(r.slot ? { slot: r.slot } : {}),
    ...(r.rarity ? { rarity: r.rarity } : {}),
    ...(r.damage ? { damage: r.damage } : {}),
    ...(r.defense ? { defense: r.defense } : {}),
    ...(r.durabilityMax ? { durabilityMax: r.durabilityMax } : {}),
    ...(r.requiresArrow ? { requiresArrow: true } : {}),
    ...(r.requiresFamiliarId ? { requiresFamiliarId: r.requiresFamiliarId } : {}),
  };
}

/** Rattrapage : si ce trésor est déjà marqué "trouvé" par ce joueur mais que son `itemReward`
 * (ajouté après coup, ou jamais octroyé à cause de l'ancien bug de clé RTDB avec points) n'a
 * jamais été remis en besace, on le complète maintenant — sans jamais redonner l'XP déjà perçue.
 * Idempotent (flag `itemGranted`). Appelé automatiquement au chargement de TreasureList. */
export async function claimMissingTreasureItem(address: string, treasure: TreasureDef): Promise<boolean> {
  const db = getFirebaseDb();
  if (!db || !treasure.itemReward) return false;
  const path = `players/${KEY(address)}/treasuresFound/${RKEY(treasure.id)}`;
  const already = (await get(ref(db, path))).val() as { foundAt: number; itemGranted?: boolean } | null;
  if (!already || already.itemGranted) return false;
  await addToInventory(address, treasureRewardItem(treasure));
  await ensureAnonSignIn();
  await update(ref(db, path), { itemGranted: true });
  return true;
}

export async function openTreasureOffchain(address: string, treasure: TreasureDef): Promise<'found' | 'already'> {
  const db = getFirebaseDb();
  if (!db) return 'already';
  const key = RKEY(treasure.id);
  const path = `players/${KEY(address)}/treasuresFound/${key}`;
  const already = (await get(ref(db, path))).val();
  if (already) {
    await claimMissingTreasureItem(address, treasure);
    return 'already';
  }
  await applyEffect(address, { xpBonus: treasure.xpReward });
  if (treasure.itemReward) await addToInventory(address, treasureRewardItem(treasure));
  await ensureAnonSignIn();
  await set(ref(db, path), { foundAt: Date.now(), itemGranted: !!treasure.itemReward });
  return 'found';
}

// ── Mondes (déblocage à seuil d'XP, comme l'ancienne version on-chain) ──

/** Crée/modifie un monde (admin). Aucune transaction blockchain. */
export async function addWorldDef(def: WorldDef): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `catalog/worldDefs/${RKEY(def.id)}`), def);
}

export async function getWorldDefs(): Promise<WorldDef[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  const snap = await get(ref(db, 'catalog/worldDefs'));
  const v = snap.val() as Record<string, WorldDef> | null;
  return v ? sortDefsByOrder(Object.values(v)) : [];
}

export async function getUnlockedWorldIds(address: string): Promise<Set<string>> {
  const db = getFirebaseDb();
  if (!db) return new Set();
  const snap = await get(ref(db, `players/${KEY(address)}/worldsUnlocked`));
  const v = snap.val() as Record<string, unknown> | null;
  return new Set(v ? Object.keys(v) : []);
}

/**
 * Abonnement temps réel aux mondes débloqués (même principe que subscribeUnlockedQuestIds) —
 * un monde découvert via PoiInteractionModal (isométrique) doit apparaître débloqué instantanément
 * dans WorldList.tsx (besace/onglet Mondes) sans recharger la page.
 */
export function subscribeUnlockedWorldIds(address: string, cb: (ids: Set<string>) => void): () => void {
  const db = getFirebaseDb();
  if (!db) { cb(new Set()); return () => {}; }
  const r = ref(db, `players/${KEY(address)}/worldsUnlocked`);
  const handler = (snap: DataSnapshot) => {
    const v = snap.val() as Record<string, unknown> | null;
    cb(new Set(v ? Object.keys(v) : []));
  };
  onValue(r, handler);
  return () => off(r, 'value', handler);
}

export async function discoverWorldOffchain(address: string, world: WorldDef): Promise<'unlocked' | 'already'> {
  const db = getFirebaseDb();
  if (!db) return 'already';
  const key = RKEY(world.id);
  const already = (await get(ref(db, `players/${KEY(address)}/worldsUnlocked/${key}`))).val();
  if (already) return 'already';
  await ensureAnonSignIn();
  await set(ref(db, `players/${KEY(address)}/worldsUnlocked/${key}`), { unlockedAt: Date.now() });
  return 'unlocked';
}

// ───────────────────────── Mapmonde (carte, POI, position libre, voyage) ─────────────────────────
// Socle évolutif : le territoire de Synk est découpé en une (ou plusieurs, à terme) carte(s) style
// vieux parchemin, peuplée(s) de points d'intérêt (terrain/décor) et des portails des 10 mondes
// (voir WorldDef.mapX/mapY ci-dessus). Le joueur s'y déplace librement (voir setPlayerMapPos),
// tombant par hasard sur des POI non encore découverts (petit bonus d'XP unique, voir visitMapPoi).

/** Crée/modifie une carte (admin). */
export async function addMapDef(def: MapDef): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `catalog/maps/${RKEY(def.id)}`), def);
}

export async function getMapDefs(): Promise<MapDef[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  const snap = await get(ref(db, 'catalog/maps'));
  const v = snap.val() as Record<string, MapDef> | null;
  return v ? sortDefsByOrder(Object.values(v)) : [];
}

/** Crée/modifie un point d'intérêt (admin) — voir MapPoiDef. */
export async function addMapPoiDef(def: MapPoiDef): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `catalog/mapPois/${RKEY(def.id)}`), def);
}

export async function removeMapPoiDef(id: string): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `catalog/mapPois/${RKEY(id)}`), null);
}

/** Tous les POI, ou uniquement ceux d'une carte donnée si `mapId` est fourni. */
export async function getMapPoiDefs(mapId?: string): Promise<MapPoiDef[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  const snap = await get(ref(db, 'catalog/mapPois'));
  const v = snap.val() as Record<string, MapPoiDef> | null;
  const all = v ? sortDefsByOrder(Object.values(v)) : [];
  return mapId ? all.filter(p => p.mapId === mapId) : all;
}

/** Catégorie d'un marqueur localisé sur la mapmonde/plateforme isométrique — voir MapMarker. */
export type MapMarkerKind = 'poi' | 'world' | 'npc' | 'treasure' | 'familiar' | 'quest';

/**
 * Marqueur unifié positionné sur la carte : regroupe les décors/terrain (MapPoiDef), les portes de
 * mondes (WorldDef), les PNJ, trésors, familiers et quêtes révélées par PNJ. Utilisé à la fois par
 * WorldMapWidget.tsx (mapmonde grand format) et GameCanvas2D.tsx (caméra isométrique) afin que les
 * DEUX vues affichent strictement les mêmes éléments aux mêmes positions — une seule fonction fait
 * autorité sur "où se trouve quoi" plutôt que de dupliquer la logique de repli (poiFallbackPos) et
 * les filtres (actif/saison) dans chaque composant.
 */
export interface MapMarker {
  id: string; kind: MapMarkerKind; name: string; i18nKey?: string; icon: string; x: number; y: number;
  poiType?: MapPoiType;
  isKingdom?: boolean; // true = quête du Royaume (voir getKingdomQuestMarker) — badge/icône dédiée
  // ─── Métadonnées de filtrage (voir lib/mapFilters.ts) — uniquement pour kind==='quest' : distingue
  // les 3 familles de quêtes affichables/masquables indépendamment sur la Mapmonde/Plateforme 2D
  // isométrique (boutons "Quêtes classiques"/"Quêtes PNJ"/"Quêtes du Royaume", voir demande
  // utilisateur). `kingdomChapter`/`fullMoonOnly` ne sont renseignés que pour questCategory==='kingdom'
  // (repris de QuestDef) afin de permettre le filtre fin par chapitre / par quêtes de pleine lune.
  questCategory?: 'classic' | 'npc' | 'kingdom';
  kingdomChapter?: number;
  fullMoonOnly?: boolean;
}

/** Construit la liste unifiée des marqueurs d'une carte (voir MapMarker). `season`/`unlockedWorlds`
 * sont facultatifs : sans eux, tous les éléments actifs sont renvoyés (repli permissif). */
export async function getAllMapMarkers(
  mapId: string = DEFAULT_MAP_ID, season?: Season | null,
): Promise<MapMarker[]> {
  const [pois, worlds, npcs, treasures, familiars, quests] = await Promise.all([
    getMapPoiDefs(mapId), getWorldDefs(), getNpcDefs(), getTreasureDefs(), getFamiliarDefs(), getQuestDefs(),
  ]);
  const markers: MapMarker[] = [];
  for (const p of pois) {
    if (p.season && season !== undefined && p.season !== season) continue; // filtré finement par appelant si besoin (visité)
    markers.push({ id: p.id, kind: 'poi', name: p.name, icon: p.icon || '📍', x: p.x, y: p.y, poiType: p.type });
  }
  for (const w of worlds.filter(w2 => w2.active !== false)) {
    const x = w.mapX ?? 50, y = w.mapY ?? 50;
    markers.push({ id: w.id, kind: 'world', name: w.name, i18nKey: w.i18nKey, icon: '🌀', x, y });
  }
  for (const n of npcs.filter(n2 => n2.active)) {
    const fp = poiFallbackPos(n.id, 101);
    markers.push({ id: n.id, kind: 'npc', name: n.name, i18nKey: n.i18nKey, icon: '🧙', x: n.mapX ?? fp.x, y: n.mapY ?? fp.y });
  }
  for (const tr of treasures.filter(t2 => t2.active)) {
    const fp = poiFallbackPos(tr.id, 102);
    markers.push({ id: tr.id, kind: 'treasure', name: tr.name, i18nKey: tr.i18nKey, icon: '🎁', x: tr.mapX ?? fp.x, y: tr.mapY ?? fp.y });
  }
  for (const f of familiars) {
    const fp = poiFallbackPos(f.id, 103);
    markers.push({ id: f.id, kind: 'familiar', name: f.label, i18nKey: f.i18nKey, icon: '🐾', x: f.mapX ?? fp.x, y: f.mapY ?? fp.y });
  }
  for (const q of quests.filter(q2 => q2.active && q2.npcGiver)) {
    const fp = poiFallbackPos(q.id, 104);
    markers.push({ id: q.id, kind: 'quest', name: q.label, i18nKey: q.i18nKey, icon: '❓', x: q.mapX ?? fp.x, y: q.mapY ?? fp.y, questCategory: 'npc' });
  }
  // Quêtes CLASSIQUES (sans PNJ ni Royaume) : historiquement absentes de la carte (seules les
  // quêtes PNJ y apparaissaient) — ajoutées ici pour permettre le bouton "Quêtes classiques" (voir
  // demande utilisateur) de réellement filtrer quelque chose. Purement additif : ces marqueurs sont
  // nouveaux, aucune autre logique (npcGiver, déblocage) n'est modifiée. Icône dédiée (📜) pour les
  // distinguer visuellement des quêtes révélées par un PNJ (❓).
  for (const q of quests.filter(q2 => q2.active && !q2.npcGiver && !q2.kingdomQuest)) {
    const fp = poiFallbackPos(q.id, 106);
    markers.push({ id: q.id, kind: 'quest', name: q.label, i18nKey: q.i18nKey, icon: '📜', x: q.mapX ?? fp.x, y: q.mapY ?? fp.y, questCategory: 'classic' });
  }
  return markers;
}

// ─── Filtres d'affichage Mapmonde/Plateforme 2D isométrique (boutons "afficher/masquer" par
// catégorie — voir demande utilisateur) — l'ÉTAT courant (quel joueur a coché quoi) reste une
// préférence 100% côté client (localStorage, voir lib/mapFilters.ts) puisqu'il n'affecte que
// l'affichage, jamais la logique de jeu. Seule la valeur PAR DÉFAUT proposée à un nouveau joueur
// (avant tout choix personnel) est paramétrable ici par l'admin (Firebase), pour permettre par
// exemple de désactiver par défaut une catégorie qui deviendrait trop envahissante sans empêcher un
// joueur de la réactiver lui-même à tout moment.
export interface MapFilterDefaults {
  showPois: boolean; showWorlds: boolean; showNpcs: boolean; showTreasures: boolean; showFamiliars: boolean;
  showQuestsClassic: boolean; showQuestsNpc: boolean; showQuestsKingdom: boolean;
  kingdomFullMoonMode: 'all' | 'onlyFullMoon' | 'onlyNormal';
  updatedAt: number;
}
export const DEFAULT_MAP_FILTER_DEFAULTS: MapFilterDefaults = {
  showPois: true, showWorlds: true, showNpcs: true, showTreasures: true, showFamiliars: true,
  showQuestsClassic: true, showQuestsNpc: true, showQuestsKingdom: true, kingdomFullMoonMode: 'all', updatedAt: 0,
};
export async function getMapFilterDefaults(): Promise<MapFilterDefaults> {
  const db = getFirebaseDb();
  if (!db) return DEFAULT_MAP_FILTER_DEFAULTS;
  const snap = await get(ref(db, 'catalog/mapFilterDefaults'));
  const v = snap.val() as MapFilterDefaults | null;
  return v ? { ...DEFAULT_MAP_FILTER_DEFAULTS, ...v } : DEFAULT_MAP_FILTER_DEFAULTS;
}
export async function setMapFilterDefaults(defaults: Omit<MapFilterDefaults, 'updatedAt'>): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, 'catalog/mapFilterDefaults'), { ...defaults, updatedAt: Date.now() });
}

// ─── Navigation de la Mapmonde (clic droit + glisser pour scroller, molette pour zoomer — voir
// demande utilisateur) — paramétrable en Administration : permet de désactiver l'une ou l'autre
// fonction, et d'ajuster les bornes/vitesse de zoom ainsi que la sensibilité du glisser. Purement
// une préférence d'ergonomie (aucun impact sur la logique de jeu : le clic gauche continue de
// déplacer Synk exactement comme avant, voir WorldMapWidget.tsx::onCanvasClick, inchangé).
export interface MapNavigationSettings {
  rightClickPanEnabled: boolean;
  wheelZoomEnabled: boolean;
  zoomMin: number;
  zoomMax: number;
  zoomStep: number;
  panSpeed: number;
  updatedAt: number;
}
export const DEFAULT_MAP_NAVIGATION_SETTINGS: MapNavigationSettings = {
  rightClickPanEnabled: true, wheelZoomEnabled: true, zoomMin: 0.6, zoomMax: 2.6, zoomStep: 0.1, panSpeed: 1, updatedAt: 0,
};
export async function getMapNavigationSettings(): Promise<MapNavigationSettings> {
  const db = getFirebaseDb();
  if (!db) return DEFAULT_MAP_NAVIGATION_SETTINGS;
  const snap = await get(ref(db, 'catalog/mapNavigationSettings'));
  const v = snap.val() as MapNavigationSettings | null;
  return v ? { ...DEFAULT_MAP_NAVIGATION_SETTINGS, ...v } : DEFAULT_MAP_NAVIGATION_SETTINGS;
}
export async function setMapNavigationSettings(settings: Omit<MapNavigationSettings, 'updatedAt'>): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, 'catalog/mapNavigationSettings'), { ...settings, updatedAt: Date.now() });
}

export interface PlayerMapPos { mapId: string; x: number; y: number; updatedAt: number }

export async function getPlayerMapPos(address: string): Promise<PlayerMapPos | null> {
  const db = getFirebaseDb();
  if (!db) return null;
  const snap = await get(ref(db, `players/${KEY(address)}/mapPos`));
  return snap.val();
}

/** Déplacement libre de Synk sur la carte (clic/drag) — position en % (0-100), bornée. */
export async function setPlayerMapPos(address: string, mapId: string, x: number, y: number): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `players/${KEY(address)}/mapPos`), {
    mapId, x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)), updatedAt: Date.now(),
  });
}

/** Écoute temps réel de la position de Synk sur la mapmonde (voir setPlayerMapPos) — permet de
 * synchroniser en direct le widget Mapmonde (WorldMapWidget) et le widget Plateforme 2D
 * isométrique (GameCanvas2D) : un déplacement (clic carte, flèches clavier ou pavé virtuel dans
 * l'un des deux widgets) se reflète immédiatement dans l'autre. Retourne la fonction unsubscribe. */
export function subscribePlayerMapPos(address: string, cb: (p: PlayerMapPos | null) => void): () => void {
  const db = getFirebaseDb();
  if (!db) { cb(null); return () => {}; }
  const r = ref(db, `players/${KEY(address)}/mapPos`);
  const handler = (snap: DataSnapshot) => cb(snap.exists() ? snap.val() as PlayerMapPos : null);
  onValue(r, handler);
  return () => off(r, 'value', handler);
}

export async function getVisitedMapPoiIds(address: string): Promise<Set<string>> {
  const db = getFirebaseDb();
  if (!db) return new Set();
  const snap = await get(ref(db, `players/${KEY(address)}/mapPoisVisited`));
  const v = snap.val() as Record<string, unknown> | null;
  return new Set(v ? Object.keys(v) : []);
}

/** Découverte fortuite d'un POI en explorant librement (première visite seulement) — petit bonus
 * d'XP paramétrable (RepRules.mapPoiDiscoveryXp), voir WorldMapWidget.tsx. */
export async function visitMapPoi(address: string, poi: MapPoiDef, xpReward: number): Promise<'discovered' | 'already'> {
  const db = getFirebaseDb();
  if (!db) return 'already';
  const key = RKEY(poi.id);
  const path = `players/${KEY(address)}/mapPoisVisited/${key}`;
  const already = (await get(ref(db, path))).val();
  if (already) return 'already';
  if (xpReward) await applyEffect(address, { xpBonus: xpReward });
  await ensureAnonSignIn();
  await set(ref(db, path), { visitedAt: Date.now() });
  return 'discovered';
}

/**
 * Temps restant (ms) avant qu'un joueur puisse à nouveau se reposer dans une hutte (voir
 * RepRules.hutRestCooldownHours) — 0 si le repos est disponible immédiatement. Utilisé par le
 * pop-up d'interaction de GameCanvas2D.tsx pour afficher/masquer le bouton "Se reposer".
 */
export async function getHutRestRemainingMs(address: string, rules: RepRules): Promise<number> {
  const db = getFirebaseDb();
  if (!db) return 0;
  const snap = await get(ref(db, `players/${KEY(address)}/lastHutRestAt`));
  const lastAt = (snap.val() as number) ?? 0;
  const cooldownMs = Math.max(1, rules.hutRestCooldownHours) * 3600_000;
  return Math.max(0, cooldownMs - (Date.now() - lastAt));
}

/**
 * Repos dans une hutte (clic sur une hutte adjacente à Synk, voir GameCanvas2D.tsx) : restaure
 * `rules.hutRestHp` points de vie (plafonnés à hpMax par applyEffect) si le délai de
 * `rules.hutRestCooldownHours` heures est écoulé depuis le dernier repos. Retourne 'ok' | 'cooldown'.
 */
export async function restAtHut(address: string, rules: RepRules): Promise<'ok' | 'cooldown'> {
  const db = getFirebaseDb();
  if (!db) return 'cooldown';
  const remaining = await getHutRestRemainingMs(address, rules);
  if (remaining > 0) return 'cooldown';
  await ensureAnonSignIn();
  await applyEffect(address, { hp: rules.hutRestHp });
  await set(ref(db, `players/${KEY(address)}/lastHutRestAt`), Date.now());
  return 'ok';
}

/** Instantané de la besace (contrairement à `subscribeInventory`, ne garde aucun écouteur ouvert)
 * — utilisé pour vérifier si le joueur possède l'engin requis pour un voyage rapide vers un monde. */
export async function getInventoryOnce(address: string): Promise<InventoryItem[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  const snap = await get(ref(db, `players/${KEY(address)}/inventory`));
  const v = snap.val() as Record<string, InventoryItem> | null;
  return v ? Object.values(v) : [];
}

/** Retire 1 exemplaire d'un objet TIRÉ AU HASARD dans la besace (ex. pénalité d'évanouissement par
 * manque d'oxygène — voir GameCanvas2D.tsx). Renvoie l'objet perdu (itemId/name) pour affichage
 * dans le pop-up de résultat, ou `null` si la besace est vide (aucune perte dans ce cas). */
export async function removeRandomInventoryItem(address: string): Promise<{ itemId: string; name: string } | null> {
  const items = await getInventoryOnce(address);
  if (!items.length) return null;
  const picked = items[Math.floor(Math.random() * items.length)];
  await removeFromInventory(address, picked.itemId, 1);
  return { itemId: picked.itemId, name: picked.name };
}

// ───────────────────────────── Saisons (gestion tournante, admin) ─────────────────────────────
// Par défaut la saison courante est calculée depuis la date réelle (hémisphère nord), pour donner
// vie au monde sans aucune intervention manuelle. L'admin peut à tout moment forcer une saison
// (démo, événement, rattrapage d'hémisphère) via `setSeasonState`. De nouveaux PNJ/quêtes/trésors/
// POI tagués `season` (voir plus haut) n'apparaissent alors que pendant la saison effective.

export interface SeasonState {
  mode: 'auto' | 'manual';
  manualSeason?: Season;
  updatedAt: number;
}

const DEFAULT_SEASON_STATE: SeasonState = { mode: 'auto', updatedAt: 0 };

/** Saison hémisphère nord à partir du mois (0-11) — mars-mai printemps, juin-août été,
 * septembre-novembre automne, décembre-février hiver. Pure/synchrone, sans accès réseau. */
export function computeAutoSeason(date: Date = new Date()): Season {
  const m = date.getMonth();
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  if (m >= 8 && m <= 10) return 'autumn';
  return 'winter';
}

export async function getSeasonState(): Promise<SeasonState> {
  const db = getFirebaseDb();
  if (!db) return DEFAULT_SEASON_STATE;
  const snap = await get(ref(db, 'catalog/seasonState'));
  const v = snap.val() as SeasonState | null;
  return v ? { ...DEFAULT_SEASON_STATE, ...v } : DEFAULT_SEASON_STATE;
}

/** Force (ou remet en automatique) la saison courante — admin uniquement. */
export async function setSeasonState(mode: 'auto' | 'manual', manualSeason?: Season): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, 'catalog/seasonState'), {
    mode, ...(mode === 'manual' && manualSeason ? { manualSeason } : {}), updatedAt: Date.now(),
  });
}

/** Saison effective (mode auto → date réelle, mode manuel → saison forcée par l'admin). */
export async function getCurrentSeason(): Promise<Season> {
  const state = await getSeasonState();
  if (state.mode === 'manual' && state.manualSeason) return state.manualSeason;
  return computeAutoSeason();
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
    if (!v || !Object.keys(v).length) return DEFAULT_SHOP;
    // Fusionne avec DEFAULT_SHOP (Firebase prioritaire par itemId) : un ajout partiel en base
    // (ex. seed d'une nouvelle catégorie d'objets) ne doit jamais faire disparaître les objets
    // du catalogue par défaut qui n'y ont jamais été explicitement repoussés (bug déjà rencontré :
    // le seed de l'équipement avait fait disparaître nourriture/potions/sortilèges de la boutique).
    const merged: Record<string, ShopItem> = {};
    for (const it of DEFAULT_SHOP) merged[it.itemId] = it;
    for (const it of Object.values(v)) merged[it.itemId] = it;
    return Object.values(merged).filter(i => i.active);
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
  // Ces deux objets historiques (antérieurs au système d'équipement) gardent leur effet à
  // usage unique (bouton "Utiliser") mais reçoivent désormais aussi un `slot` — sans quoi ils
  // apparaissaient dans les onglets Armes/Protections de la besace sans jamais être glissables
  // vers la fenêtre Équipement, contrairement à tous les autres objets de ces onglets.
  { itemId: 'sword_ep',  name: '⚔️ Épée épique',        category: 'weapon', slot: 'weapon',  rarity: 'rare', damage: 20, durabilityMax: 20, priceGame: 200, effect: { force: 20 },              active: true },
  { itemId: 'shield_lg', name: '🛡️ Bouclier légendaire', category: 'shield', slot: 'offhand', rarity: 'rare', defense: 20, durabilityMax: 20, priceGame: 250, effect: { force: 15, hp: 20 },      active: true },
  { itemId: 'spell_fire',name: '🔥 Sort de feu',        category: 'spell',   priceGame: 150, effect: { spells: 25 },             active: true },
  // ─── Engins mécaniques (gate d'accès aux mondes) — équipables (slot 'vehicle', voir
  // EquipmentWidget.tsx) pour désigner l'engin actif du voyage en cours.
  { itemId: 'char_voile',name: '🌤️ Char à voile',      category: 'vehicle', slot: 'vehicle', priceGame: 500, effect: {},                          active: true },
  { itemId: 'barque',    name: '🛶 Barque sans fond',   category: 'vehicle', slot: 'vehicle', priceGame: 500, effect: {},                          active: true },
  { itemId: 'montgolf',  name: '🎈 Montgolfière',       category: 'vehicle', slot: 'vehicle', priceGame: 800, effect: {},                          active: true },
  { itemId: 'mototaupe', name: '⛏️ Moto-taupe',         category: 'vehicle', slot: 'vehicle', priceGame: 700, effect: {},                          active: true },
  // ─── Objets rares (nécessaires pour apprivoiser certains Familiers — voir FamiliarDef.requiredItemId)
  { itemId: 'ecaille_semaphore',       name: '🔴 Écaille de Sémaphore Écarlate',   category: 'treasure', priceGame: 5000,  effect: {}, active: true },
  { itemId: 'griffe_gel_eternel',      name: '❄️ Griffe de Gel Éternel',           category: 'treasure', priceGame: 4000,  effect: {}, active: true },
  { itemId: 'larme_marais_noir',       name: '🖤 Larme du Marais Noir',            category: 'treasure', priceGame: 6000,  effect: {}, active: true },
  { itemId: 'ecaille_ronce_venin',     name: '☠️ Écaille de Ronce Venimeuse',      category: 'treasure', priceGame: 8000,  effect: {}, active: true },
  { itemId: 'eclat_orage_saphir',      name: '⚡ Éclat d\'Orage Saphir',            category: 'treasure', priceGame: 10000, effect: {}, active: true },
  { itemId: 'braise_coeur_volcan',     name: '🔥 Braise du Cœur du Volcan',        category: 'treasure', priceGame: 15000, effect: {}, active: true },
  { itemId: 'plume_givre_lunaire',     name: '🌙 Plume de Givre Lunaire',          category: 'treasure', priceGame: 20000, effect: {}, active: true },
  { itemId: 'perle_abysse_electrique', name: '🌊 Perle des Abysses Électriques',   category: 'treasure', priceGame: 25000, effect: {}, active: true },
  // ─── Équipement du personnage (armes/protections/flèches) — voir EquipmentWidget.tsx.
  // Rareté croissante (common → rare → legendary → epic), inspirée de Tolkien/Donjons & Dragons,
  // recherchée pour rester crédible (Andúril, Dard/Sting, mithril, arc de Galadriel…). Prix
  // boutique ≥ 200 000 pièces (armes/protections/boucliers) — seuils admin RepRules.equipShopMinPrice.
  // Peuvent aussi être gagnées via combats/quêtes rares selon la rareté (RepRules.equipRarityXp*).
  // ── Armes (slot 'weapon', dégâts en combat)
  { itemId: 'epee_courte',            name: '🗡️ Épée courte',                    category: 'weapon', slot: 'weapon', rarity: 'common',    damage: 15, durabilityMax: 20, priceGame: 200000, effect: {}, active: true },
  { itemId: 'epee_longue',            name: '⚔️ Épée longue',                    category: 'weapon', slot: 'weapon', rarity: 'common',    damage: 20, durabilityMax: 22, priceGame: 220000, effect: {}, active: true },
  { itemId: 'lance_chevalier',        name: '🛡️ Lance de chevalier',             category: 'weapon', slot: 'weapon', rarity: 'common',    damage: 18, durabilityMax: 20, priceGame: 210000, effect: {}, active: true },
  { itemId: 'gourdin_cloute',         name: '🪵 Gourdin clouté',                  category: 'weapon', slot: 'weapon', rarity: 'common',    damage: 12, durabilityMax: 25, priceGame: 200000, effect: {}, active: true },
  { itemId: 'masse_templiere',        name: '🔨 Masse templière',                 category: 'weapon', slot: 'weapon', rarity: 'common',    damage: 16, durabilityMax: 24, priceGame: 205000, effect: {}, active: true },
  { itemId: 'epee_bataille',          name: '⚔️ Épée de bataille',                category: 'weapon', slot: 'weapon', rarity: 'rare',      damage: 35, durabilityMax: 18, priceGame: 380000, effect: {}, active: true },
  { itemId: 'hache_guerre_naine',     name: '🪓 Hache de guerre naine',           category: 'weapon', slot: 'weapon', rarity: 'rare',      damage: 38, durabilityMax: 18, priceGame: 400000, effect: {}, active: true },
  { itemId: 'marteau_guerre_sacre',   name: '⚒️ Marteau de guerre sacré',         category: 'weapon', slot: 'weapon', rarity: 'rare',      damage: 40, durabilityMax: 17, priceGame: 420000, effect: {}, active: true },
  { itemId: 'dague_sept_eclats',      name: '🗡️ Dague aux Sept Éclats',           category: 'weapon', slot: 'weapon', rarity: 'legendary', damage: 55, durabilityMax: 14, priceGame: 750000, effect: {}, active: true },
  { itemId: 'epee_elfique_argent',    name: '✨ Épée elfique à lame d\'argent',    category: 'weapon', slot: 'weapon', rarity: 'legendary', damage: 60, durabilityMax: 15, priceGame: 800000, effect: {}, active: true },
  { itemId: 'dard_luisant',           name: '🔷 Dard, la lame qui luit près des Orcs', category: 'weapon', slot: 'weapon', rarity: 'legendary', damage: 50, durabilityMax: 16, priceGame: 700000, effect: {}, active: true },
  { itemId: 'anduril_replique',       name: '👑 Réplique d\'Andúril, l\'Épée Reforgée', category: 'weapon', slot: 'weapon', rarity: 'epic', damage: 90, durabilityMax: 10, priceGame: 1500000, effect: {}, active: true },
  // ── Arcs (slot 'weapon', requiresArrow — inefficaces sans flèches équipées dans le slot 'arrows')
  { itemId: 'arc_chasseur',           name: '🏹 Arc du chasseur',                 category: 'weapon', slot: 'weapon', rarity: 'common',    damage: 6,  durabilityMax: 28, requiresArrow: true, priceGame: 200000, effect: {}, active: true },
  { itemId: 'arc_elfique',            name: '🏹 Arc elfique',                     category: 'weapon', slot: 'weapon', rarity: 'rare',      damage: 10, durabilityMax: 30, requiresArrow: true, priceGame: 380000, effect: {}, active: true },
  { itemId: 'arc_galadriel',          name: '🏹 Arc légendaire de Galadriel',     category: 'weapon', slot: 'weapon', rarity: 'legendary', damage: 20, durabilityMax: 20, requiresArrow: true, priceGame: 780000, effect: {}, active: true },
  // ── Flèches (slot 'arrows', consommables — dégâts additionnés à ceux de l'arc)
  { itemId: 'fleche_simple',    name: '➶ Flèche simple',    category: 'arrow', slot: 'arrows', damage: 5,  priceGame: 20,  effect: {}, active: true },
  { itemId: 'fleche_glace',     name: '❄️ Flèche de glace',  category: 'arrow', slot: 'arrows', damage: 12, priceGame: 60,  effect: {}, active: true },
  { itemId: 'fleche_feu',       name: '🔥 Flèche de feu',    category: 'arrow', slot: 'arrows', damage: 15, priceGame: 70,  effect: {}, active: true },
  { itemId: 'fleche_explosive', name: '💥 Flèche explosive', category: 'arrow', slot: 'arrows', damage: 25, priceGame: 120, effect: {}, active: true },
  // ── Protections (casque/torse/jambes/pieds/ceinture — defense en combat)
  { itemId: 'casque_fer',        name: '⛑️ Casque de fer',                 category: 'armor', slot: 'head', rarity: 'common',    defense: 8,  durabilityMax: 20, priceGame: 200000, effect: {}, active: true },
  { itemId: 'casque_dragon',     name: '🐲 Casque en écailles de dragon',  category: 'armor', slot: 'head', rarity: 'legendary', defense: 25, durabilityMax: 14, priceGame: 780000, effect: {}, active: true },
  { itemId: 'cotte_mailles',     name: '🥋 Cotte de mailles',              category: 'armor', slot: 'body', rarity: 'common',    defense: 15, durabilityMax: 22, priceGame: 210000, effect: {}, active: true },
  { itemId: 'armure_plates',     name: '🛡️ Armure de plates',             category: 'armor', slot: 'body', rarity: 'rare',      defense: 30, durabilityMax: 18, priceGame: 400000, effect: {}, active: true },
  { itemId: 'armure_mithril',    name: '💎 Armure de mithril',             category: 'armor', slot: 'body', rarity: 'epic',      defense: 70, durabilityMax: 12, priceGame: 1600000, effect: {}, active: true },
  { itemId: 'jambieres_acier',   name: '🦵 Jambières d\'acier',            category: 'armor', slot: 'legs', rarity: 'common',    defense: 10, durabilityMax: 20, priceGame: 200000, effect: {}, active: true },
  { itemId: 'jambieres_naines',  name: '🦵 Jambières naines renforcées',   category: 'armor', slot: 'legs', rarity: 'rare',      defense: 20, durabilityMax: 18, priceGame: 380000, effect: {}, active: true },
  { itemId: 'bottes_voyageur',   name: '👢 Bottes du voyageur',            category: 'armor', slot: 'feet', rarity: 'common',    defense: 6,  durabilityMax: 25, priceGame: 200000, effect: {}, active: true },
  { itemId: 'bottes_sept_lieues',name: '👢 Bottes de sept lieues',         category: 'armor', slot: 'feet', rarity: 'legendary', defense: 18, durabilityMax: 15, priceGame: 750000, effect: {}, active: true },
  { itemId: 'ceinture_force',    name: '🎗️ Ceinture de force',            category: 'armor', slot: 'belt', rarity: 'common',    defense: 5,  durabilityMax: 22, priceGame: 200000, effect: {}, active: true },
  { itemId: 'ceinture_geant',    name: '🎗️ Ceinture du géant',            category: 'armor', slot: 'belt', rarity: 'rare',      defense: 15, durabilityMax: 18, priceGame: 380000, effect: {}, active: true },
  // ── Boucliers (slot 'offhand')
  { itemId: 'bouclier_bois',     name: '🛡️ Bouclier de bois clouté',      category: 'shield', slot: 'offhand', rarity: 'common',    defense: 10, durabilityMax: 20, priceGame: 200000, effect: {}, active: true },
  { itemId: 'bouclier_fer',      name: '🛡️ Bouclier de fer',              category: 'shield', slot: 'offhand', rarity: 'common',    defense: 16, durabilityMax: 22, priceGame: 220000, effect: {}, active: true },
  { itemId: 'egide_templiere',   name: '🛡️ Égide templière',              category: 'shield', slot: 'offhand', rarity: 'rare',      defense: 30, durabilityMax: 18, priceGame: 400000, effect: {}, active: true },
  { itemId: 'bouclier_dragon_or',name: '🛡️ Bouclier en écailles de Dragon d\'Or', category: 'shield', slot: 'offhand', rarity: 'epic', defense: 65, durabilityMax: 12, priceGame: 1500000, effect: {}, active: true },
  // ── Cape d'invisibilité (10-15 min — voir activateInvisibility et la quête "Gardiens à trois
  // têtes de chameaux" qui la récompense, seedInvisibilityQuest.mjs) — désormais équipable comme
  // amulette (slot 'amulet', protection) : drag & drop vers EquipmentWidget déclenche l'invisibilité
  // ET protège Synk (défense) jusqu'à ce qu'elle s'use en combat ; reste aussi utilisable
  // directement depuis la besace via le bouton "Utiliser" (consommée immédiatement, sans équiper).
  { itemId: 'cape_invisibilite', name: '🫥 Cape d\'invisibilité', category: 'armor', slot: 'amulet', rarity: 'epic', defense: 20, durabilityMax: 6, priceGame: 90000, effect: { invisibleMinutes: 12 }, active: true },
  // ── Amulettes (slot 'amulet', protections légères) ──
  { itemId: 'amulette_vitalite', name: '📿 Amulette de Vitalité', category: 'armor', slot: 'amulet', rarity: 'common', defense: 12, durabilityMax: 24, priceGame: 200000, effect: {}, active: true },
  { itemId: 'amulette_anciens',  name: '📿 Amulette des Anciens', category: 'armor', slot: 'amulet', rarity: 'rare',   defense: 28, durabilityMax: 18, priceGame: 400000, effect: {}, active: true },
  // ── Amulettes d'entrée de gamme (prix symbolique, accessibles dès le début de partie) ──
  { itemId: 'amulette_voyageur', name: '📿 Amulette du Voyageur',      category: 'armor', slot: 'amulet', rarity: 'common', defense: 2, durabilityMax: 10, priceGame: 20, effect: {}, active: true },
  { itemId: 'amulette_bois',     name: '🪵 Amulette de Bois runique',  category: 'armor', slot: 'amulet', rarity: 'common', defense: 3, durabilityMax: 12, priceGame: 25, effect: {}, active: true },
  { itemId: 'amulette_argile',   name: '🏺 Amulette d\'Argile bénie',   category: 'armor', slot: 'amulet', rarity: 'common', defense: 4, durabilityMax: 14, priceGame: 30, effect: {}, active: true },
  // ── Selles de dragon (slot 'saddle') — chacune ne fonctionne qu'avec le dragon correspondant déjà
  // équipé comme familier de combat actif (requiresFamiliarId, voir equipItem()). Prix ≥ 40 000
  // pièces, croissant avec la rareté/puissance du dragon associé (voir migrateFamiliarsToFirebase.mjs).
  { itemId: 'selle_blanc',  name: '❄️ Selle Immaculée du Dragon Blanc',      category: 'saddle', slot: 'saddle', rarity: 'common',    requiresFamiliarId: 'dragon.white',  priceGame: 40000,  effect: {}, active: true },
  { itemId: 'selle_noir',   name: '🌑 Selle d\'Ombre du Dragon Noir',        category: 'saddle', slot: 'saddle', rarity: 'rare',      requiresFamiliarId: 'dragon.black',  priceGame: 50000,  effect: {}, active: true },
  { itemId: 'selle_vert',   name: '🟢 Selle Sylvestre du Dragon Vert',       category: 'saddle', slot: 'saddle', rarity: 'rare',      requiresFamiliarId: 'dragon.green',  priceGame: 55000,  effect: {}, active: true },
  { itemId: 'selle_bleu',   name: '🔵 Selle des Tempêtes du Dragon Bleu',    category: 'saddle', slot: 'saddle', rarity: 'legendary', requiresFamiliarId: 'dragon.blue',   priceGame: 65000,  effect: {}, active: true },
  { itemId: 'selle_rouge',  name: '🔴 Selle Ardente du Dragon Rouge',        category: 'saddle', slot: 'saddle', rarity: 'legendary', requiresFamiliarId: 'dragon.red',    priceGame: 80000,  effect: {}, active: true },
  { itemId: 'selle_or',     name: '🥇 Selle Solaire du Dragon d\'Or',        category: 'saddle', slot: 'saddle', rarity: 'legendary', requiresFamiliarId: 'dragon.gold',   priceGame: 90000,  effect: {}, active: true },
  { itemId: 'selle_argent', name: '🥈 Selle Lunaire du Dragon d\'Argent',    category: 'saddle', slot: 'saddle', rarity: 'epic',      requiresFamiliarId: 'dragon.silver', priceGame: 110000, effect: {}, active: true },
  { itemId: 'selle_bronze', name: '🥉 Selle des Forges du Dragon de Bronze', category: 'saddle', slot: 'saddle', rarity: 'epic',      requiresFamiliarId: 'dragon.bronze', priceGame: 130000, effect: {}, active: true },
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
  // Jet de dés complémentaire OBLIGATOIRE (bouton "Lancer..." du widget de dés persistant —
  // DiceRollWidget.tsx) requis avant de résoudre tout combat PNJ (voir NpcEncounterPopup.tsx::
  // beginFightWithDiceRoll). Vient s'ajouter (purement additif) au bonus déjà calculé par
  // resolveFight() : n'affecte ni le tirage 1d20 du joueur/PNJ, ni la pondération Force/Vie/Faim/
  // Sortilèges existante. Conçu pour être réutilisé plus tard par d'autres événements du jeu
  // (voir DiceEventKind, extensible).
  fightDiceEventMalusMax: number;    // Somme des 2 dés (2-40) ≤ ce seuil = malus (défaut 14)
  fightDiceEventBonusMin: number;    // Somme des 2 dés (2-40) ≥ ce seuil = bonus (défaut 26)
  fightDiceEventBonusAmount: number; // Bonus additionnel appliqué au combat (défaut 3)
  fightDiceEventMalusAmount: number; // Malus additionnel appliqué au combat, soustrait (défaut 3)
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
  // ─── Équipement (armes/protections/flèches — voir EquipmentWidget.tsx et NpcEncounterPopup.tsx) ───
  equipRarityXpCommon: number;    // XP min pour qu'une arme/protection commune apparaisse en butin (défaut 4000)
  equipRarityXpRare: number;      // XP min pour le palier rare (défaut 20000)
  equipRarityXpLegendary: number; // XP min pour le palier légendaire (défaut 80000)
  equipRarityXpEpic: number;      // XP min pour le palier épique (défaut 100000)
  equipShopMinPrice: number;      // Prix boutique minimum indicatif pour une arme/protection (défaut 200000)
  equipDamageBonusDivisor: number;  // Diviseur dégâts arme → bonus du jet de dés (défaut 4)
  equipDefenseBonusDivisor: number; // Diviseur défense armure/bouclier → bonus du jet de dés (défaut 5)
  equipDurabilityLossPct: number;   // % du plafond de durabilité perdu par usage en combat (défaut 8)
  equipDropChancePct: number;       // % de chance qu'un butin de victoire soit un équipement plutôt qu'un objet basique (défaut 15)
  capeInvisibilityMinMinutes: number; // Durée min de la cape d'invisibilité (défaut 10)
  capeInvisibilityMaxMinutes: number; // Durée max de la cape d'invisibilité (défaut 15)
  // Fréquence des rencontres PNJ aléatoires (popup) — voir NpcEncounterPopup.tsx. Anciennement
  // paramétrable uniquement via une transaction on-chain (`setNpcMaxPerDay`) ; désormais 100%
  // hors-chaîne (voir setNpcMaxPerDay ci-dessous), donc gratuit à modifier depuis l'Administration.
  npcMaxPerDay: number; // Nombre max de rencontres PNJ (popup) par jour (défaut 4)
  // ─── Mapmonde / voyage (voir WorldMapWidget.tsx) ───
  mapPoiDiscoveryXp: number;            // XP gagné (une fois) en découvrant un POI en explorant librement (défaut 5)
  travelWalkDurationSec: number;        // Durée simulée d'un voyage à pied vers un monde, en secondes (défaut 6)
  travelNightEncounterChancePct: number;// % de chance de croiser une créature hostile pendant un voyage à pied (défaut 30)
  travelNightMonsterDamage: number;     // Dégâts (Vie) subis en cas de défaite contre cette créature (défaut 15)
  // ─── Repos en hutte (voir GameCanvas2D.tsx / HutRestModal.tsx) — clic sur une hutte adjacente à
  // Synk sur la plateforme 2D isométrique : ouvre une pause (même mécanique que le sommeil forcé
  // de SleepModal.tsx) qui restaure des points de vie, plafonnée à une utilisation toutes les N
  // heures (voir restAtHut()/getHutRestRemainingMs() ci-dessous).
  hutRestHp: number;             // Points de vie restaurés par un repos en hutte (défaut 40)
  hutRestCooldownHours: number;  // Délai minimum entre deux repos en hutte, en heures (défaut 4)
  hutRestDurationSec: number;    // Durée de la pause simulée, en secondes (défaut 50, comme SleepModal)
  // ─── Repos forcé par épuisement (voir SleepModal.tsx) — se déclenche automatiquement, sans
  // action du joueur, dès que la Vie (HP) descend au/sous le seuil ci-dessous : verrouille
  // l'interface pendant `sleepDurationSec`, restaure la Vie à `sleepWakeHp` (ou hpMax si inférieur)
  // et accorde un petit bonus de Bonheur. `sleepGraceSec` évite un redéclenchement immédiat juste
  // après un réveil si la Vie remonte lentement.
  sleepHpThreshold: number;    // Seuil de Vie déclenchant le repos forcé (défaut 20)
  sleepDurationSec: number;    // Durée de la pause simulée, en secondes (défaut 50)
  sleepWakeHp: number;         // Vie restaurée au réveil, plafonnée à hpMax (défaut 75)
  sleepHappinessBonus: number; // Bonheur gagné au réveil (défaut 5)
  sleepGraceSec: number;       // Délai de grâce après réveil avant un nouveau déclenchement possible, en secondes (défaut 5)
  // ─── Oxygène en eau et en montagne/roche (voir GameCanvas2D.tsx) — la jauge "Oxygène"
  // (Statistiques) décroît par intervalles tant que Synk reste sur une dalle d'eau OU de
  // montagne/roche de la plateforme 2D isométrique. Un petit pop-up non bloquant (sablier + jauge +
  // décompte numérique) reste affiché pendant ce temps. À chaque intervalle écoulé SANS que Synk
  // n'ait rejoint une dalle verte (terre) : Oxygène -oxygenDrainPct, XP -oxygenPenaltyXp, Force
  // -oxygenPenaltyForce. Sous oxygenFaintThresholdPct, Synk s'évanouit : interface bloquée pendant
  // oxygenFaintDurationSec (comme SleepModal), Oxygène restauré à 100% et pertes XP/Vie/un objet
  // aléatoire de la besace, puis Synk est repositionné automatiquement sur la dalle verte la plus
  // proche — un pop-up de résultat détaille les pertes. Dès que Synk rejoint une dalle de terre
  // (verte), l'oxygène se restaure par palier de oxygenRecoveryPct toutes les
  // oxygenRecoveryIntervalSec jusqu'à 100%, avec un pop-up non bloquant "Récupération d'oxygène".
  oxygenDrainIntervalSec: number;  // Intervalle (s) de décroissance sur l'eau/montagne (défaut 50)
  oxygenDrainPct: number;          // % d'oxygène perdu par intervalle (défaut 30)
  oxygenPenaltyXp: number;         // XP perdus par intervalle passé sur l'eau/montagne (défaut 10)
  oxygenPenaltyForce: number;      // Force perdue par intervalle passé sur l'eau/montagne (défaut 10)
  oxygenFaintThresholdPct: number; // Seuil d'oxygène déclenchant l'évanouissement (défaut 20)
  oxygenFaintDurationSec: number;  // Durée du blocage / récupération à 100% (défaut 30)
  oxygenFaintXpLoss: number;       // XP perdus lors de l'évanouissement (défaut 50)
  oxygenFaintHpLoss: number;       // Vie perdue lors de l'évanouissement (défaut 10)
  oxygenRecoveryIntervalSec: number; // Intervalle (s) de récupération sur la terre ferme (défaut 1)
  oxygenRecoveryPct: number;         // % d'oxygène regagné par intervalle sur la terre ferme (défaut 10)
  // ─── Fatigue liée aux déplacements (voir GameCanvas2D.tsx) — la jauge "Fatigue" (Statistiques)
  // décroît par intervalles tant que Synk reste en mouvement CONTINU (flèches, pavé directionnel,
  // clic sur la Plateforme 2D isométrique OU sur la Mapmonde — les deux widgets partagent la même
  // position, voir players/{addr}/mapPos) sans marquer de pause d'au moins `fatigueStopGraceSec`
  // secondes. Un petit pop-up non bloquant "État de fatigue" (sablier + jauge + décompte numérique)
  // reste affiché en bas à gauche pendant ce temps. Dès que Synk ralentit ou s'arrête (aucun nouveau
  // déplacement pendant `fatigueStopGraceSec`), la Fatigue se restaure par palier de
  // `fatigueRecoveryPct` toutes les `fatigueRecoveryIntervalSec` jusqu'à 100 %, avec un pop-up non
  // bloquant "Récupération de la fatigue" (barre de progression). `fatigueEnabled` permet de
  // désactiver entièrement la mécanique depuis le menu Administration.
  fatigueEnabled: boolean;           // Active/désactive toute la mécanique de Fatigue (défaut true)
  fatigueDrainIntervalSec: number;   // Intervalle (s) de décroissance en mouvement continu (défaut 3)
  fatigueDrainPct: number;           // % de fatigue perdu par intervalle en mouvement (défaut 2)
  fatigueStopGraceSec: number;       // Délai (s) sans déplacement avant de considérer Synk arrêté/ralenti (défaut 1.5)
  fatigueRecoveryIntervalSec: number; // Intervalle (s) de récupération à l'arrêt (défaut 1)
  fatigueRecoveryPct: number;         // % de fatigue regagné par intervalle à l'arrêt (défaut 20)
  // ─── Quêtes du Royaume (voir section dédiée gameState.ts) ───────────────────────────────────
  kingdomMinIntermediateSolved: number; // Nb de quêtes intermédiaires (classiques+PNJ) résolues
                                         // nécessaires avant de débloquer la 1ère Quête du Royaume (défaut 3)
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
  fightDiceEventMalusMax: 14,
  fightDiceEventBonusMin: 26,
  fightDiceEventBonusAmount: 3,
  fightDiceEventMalusAmount: 3,
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
  equipRarityXpCommon: 4000,
  equipRarityXpRare: 20000,
  equipRarityXpLegendary: 80000,
  equipRarityXpEpic: 100000,
  equipShopMinPrice: 200000,
  equipDamageBonusDivisor: 4,
  equipDefenseBonusDivisor: 5,
  equipDurabilityLossPct: 8,
  equipDropChancePct: 15,
  capeInvisibilityMinMinutes: 10,
  capeInvisibilityMaxMinutes: 15,
  npcMaxPerDay: 4,
  mapPoiDiscoveryXp: 5,
  travelWalkDurationSec: 6,
  travelNightEncounterChancePct: 30,
  travelNightMonsterDamage: 15,
  hutRestHp: 40,
  hutRestCooldownHours: 4,
  hutRestDurationSec: 50,
  sleepHpThreshold: 20,
  sleepDurationSec: 50,
  sleepWakeHp: 75,
  sleepHappinessBonus: 5,
  sleepGraceSec: 5,
  oxygenDrainIntervalSec: 50,
  oxygenDrainPct: 30,
  oxygenPenaltyXp: 10,
  oxygenPenaltyForce: 10,
  oxygenFaintThresholdPct: 20,
  oxygenFaintDurationSec: 30,
  oxygenFaintXpLoss: 50,
  oxygenFaintHpLoss: 10,
  oxygenRecoveryIntervalSec: 1,
  oxygenRecoveryPct: 10,
  fatigueEnabled: true,
  fatigueDrainIntervalSec: 3,
  fatigueDrainPct: 2,
  fatigueStopGraceSec: 1.5,
  fatigueRecoveryIntervalSec: 1,
  fatigueRecoveryPct: 20,
  kingdomMinIntermediateSolved: 3,
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

/**
 * Met à jour uniquement `npcMaxPerDay` (écriture "feuille" — n'écrase pas le reste de RepRules),
 * remplaçant l'ancienne transaction on-chain `setNpcMaxPerDay` : gratuit, appliqué instantanément.
 */
export async function setNpcMaxPerDay(value: number): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await update(ref(db, 'catalog/repRules'), { npcMaxPerDay: Math.max(1, Math.round(value)) });
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
  // ─── Bonus de combat une fois équipé comme familier actif (slot 'familiar') — voir equipFamiliar()
  // et computeEquipmentCombatBonus(). Paramétrable dans le menu Administration (FamiliarsAdminPanel).
  combatDamage?: number;
  combatDefense?: number;
  // ─── Positionnement sur la mapmonde/plateforme isométrique — voir QuestDef.mapX/mapY plus haut.
  mapX?: number;
  mapY?: number;
}

/** Préfixe du id transporté par `dataTransfer` lors du glisser-déposer d'un familier (les
 * familiers ne sont pas des objets de besace empilés par itemId comme les autres — voir
 * `equipFamiliar()`) — permet à EquipmentWidget.tsx de distinguer un familier d'un itemId classique. */
export const FAMILIAR_DRAG_PREFIX = 'familiar:';

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

/**
 * Équipe un familier déjà apprivoisé comme compagnon de combat actif (slot 'familiar' de
 * `players/{addr}/equipment`) — glisser-déposer depuis l'onglet "Familiers" de la besace vers le
 * nouveau compartiment "Familiers" de EquipmentWidget.tsx, ou bouton "Équiper" équivalent.
 * Ce n'est PAS un objet de besace : aucune consommation, aucune casse (compagnon vivant) — voir
 * computeEquipmentCombatBonus() pour le bonus de dégâts/défense qu'il accorde une fois équipé.
 */
export type EquipFamiliarResult = 'ok' | 'notOwned' | 'failed';

export async function equipFamiliar(address: string, familiar: FamiliarDef): Promise<EquipFamiliarResult> {
  const db = getFirebaseDb();
  if (!db) return 'failed';
  await ensureAnonSignIn();
  const ownedSnap = await get(ref(db, `players/${KEY(address)}/familiars/${familiarKeyOf(familiar.id)}`));
  if (!ownedSnap.exists()) return 'notOwned';
  const equipped: EquippedItem = {
    itemId: familiar.id, name: familiar.label, category: 'familiar', slot: 'familiar',
    durability: 1, durabilityMax: 1, equippedAt: Date.now(),
    ...(familiar.i18nKey ? { i18nKey: familiar.i18nKey } : {}),
    ...(familiar.combatDamage ? { damage: familiar.combatDamage } : {}),
    ...(familiar.combatDefense ? { defense: familiar.combatDefense } : {}),
  };
  await set(ref(db, `players/${KEY(address)}/equipment/familiar`), equipped);
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

