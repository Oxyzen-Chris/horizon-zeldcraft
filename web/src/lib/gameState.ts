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
 *   catalog/aiAnalyticsSettings         → AiAnalyticsSettings (interrupteur global + config module « Intelligence IA GamePlay »)
 *   catalog/aiInsightsCache             → AiInsightsCache (dernière analyse générée par le LLM gratuit, voir web/src/app/api/ai/insights/route.ts)
 *   catalog/analytics/dauGlobal/{jour}         → nombre de joueurs actifs ce jour (compteur O(1), voir markPlayerActiveToday)
 *   catalog/analytics/widgetUsageGlobal/{id}   → WidgetUsageAgg agrégé tous joueurs (voir trackWidgetUsage, useDraggableWidget)
 *   catalog/analytics/questFunnelGlobal/{id}   → compteurs blocked/fail/solved agrégés (voir trackQuestFunnelEvent)
 *   catalog/analytics/mapHeatmapGlobal/{map}   → densité de fréquentation de la carte, en mailles (voir trackMapHeatmap)
 *   catalog/analytics/faintHeatmapGlobal/{map} → densité des évanouissements sur la carte (voir trackFaintEvent)
 *   catalog/analytics/faintCauseGlobal         → répartition oxygène/fatigue des évanouissements
 *   players/{addr}/analytics/trackingOverride  → 'enabled'|'disabled' (opt-in/opt-out ciblé pour CE joueur, prime sur
 *                                                  aiAnalyticsSettings.enabled — voir getPlayerAnalyticsOverride/setPlayerAnalyticsOverride)
 *   players/{addr}/analytics/dailyActive/{jour} → présence du joueur ce jour (rétention/DAU)
 *   players/{addr}/analytics/lastSeenAt         → horodatage de dernière activité (score de décrochage)
 *   players/{addr}/analytics/widgetUsage/{id}   → WidgetUsageAgg par joueur (temps passé par widget)
 *   players/{addr}/analytics/questEvents/{ts}   → historique des évènements d'entonnoir de quête (par joueur)
 *   players/{addr}/analytics/faintEvents/{ts}   → historique des évanouissements du joueur
 * Tous ces nouveaux chemins restent sous players/$addr ou catalog (déjà couverts par les règles
 * génériques publiées, voir docs/FIREBASE_CHAT.md §4 — aucune republication requise).
 */
import {
  ref, get, set, update, remove, onValue, off, push, runTransaction, serverTimestamp, DataSnapshot,
} from 'firebase/database';
import { keccak256, toBytes } from 'viem';
import { getFirebaseDb, ensureAnonSignIn } from './firebase';
import { normalizeAnswer } from './contract';

// ─────────────────────────────────────────── Types ───────────────────────────────────────────

export interface PlayerState {
  address: string;
  displayName?: string;
  hp: number;              // valeur courante
  hpMax: number;           // plafond (100 par défaut, boostable via super-fioles jusqu'à hpMaxCap, voir RepRules)
  hunger: number;
  hungerMax: number;
  happiness: number;
  happinessMax: number;
  force: number;
  forceMax: number;        // 100 par défaut, boostable via super-fioles jusqu'à forceMaxCap (voir RepRules)
  spells: number;
  spellsMax: number;       // 100 par défaut, boostable via super-fioles jusqu'à spellsMaxCap (voir RepRules)
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
  // ─── Comptes sans portefeuille crypto (accès Démo / paiement fiat — voir docs/DEMO_FIAT.md) ───
  // 'wallet' (défaut, absent = wallet) : joueur connecté via un vrai portefeuille crypto (Sepolia/
  // Mainnet), identité = adresse EVM réelle. 'demo' : invité gueststar avec accès immédiat (Google)
  // ou session anonyme (voir RepRules.demoAccessEnabled/demoAnonymousEnabled), identité = adresse
  // virtuelle dérivée de son UID Firebase Auth (voir deriveVirtualAddress). 'fiat' : joueur ayant
  // payé par CB/PayPal/Apple Pay/Google Pay (voir RepRules.fiatPaymentEnabled), même mécanisme
  // d'adresse virtuelle que 'demo' mais sans plafond de sessions concurrentes ni pièces offertes.
  // Dans les deux cas 'demo'/'fiat', AUCUN appel on-chain (mint/feed/topup) n'est jamais tenté :
  // toute la progression (xp/niveau/objets/portefeuille) est 100% portée par ce PlayerState
  // Firebase, le tuple `v` normalement lu depuis le smart contract est synthétisé côté client
  // (voir synthesizeOffchainVoxlyn dans game/page.tsx).
  accountType?: 'wallet' | 'demo' | 'fiat';
  demoApproved?: boolean;   // conservé pour compat historique — l'accès Démo/fiat est désormais immédiat (voir logAccountAccess)
  // UID Firebase Auth (Google/e-mail) et e-mail associés à ce compte 'demo'/'fiat' — permet à
  // l'admin d'identifier le joueur (menu Administration §"Statistiques par joueur") et de libérer
  // sa session/son entrée `demoAccessRequests` lors d'une suppression (voir deletePlayerAccount).
  // Renseignés une seule fois, à la création du compte (jamais réécrits ensuite, même logique que
  // `accountType` ci-dessus — voir getOrCreatePlayer). Absents pour un compte 'wallet'.
  uid?: string;
  email?: string;
  // Méthode d'authentification Firebase Auth utilisée pour ce compte 'demo'/'fiat' : 'google' (pas
  // de mot de passe, aucun reset possible) ou 'email' (compte e-mail/mot de passe — voir
  // NoWalletAccessPanel.tsx). Détermine si le bouton "Reset mot de passe" (admin et en jeu) est
  // affiché — voir docs/EMAIL_NOTIFICATIONS.md § Réinitialisation de mot de passe. Renseignée une
  // seule fois à la création (même logique que uid/email/accountType), absente pour un compte
  // 'wallet' ou une session Démo anonyme (aucun credential Firebase avec mot de passe).
  authMethod?: 'google' | 'email';
  // Nombre de fois où le mot de passe de ce compte a été changé (reset admin OU changement
  // volontaire du joueur en jeu) et date du dernier changement — affichés dans "Statistiques par
  // joueur" (menu Administration). Incrémenté par `incrementPasswordResetCount()` ci-dessous.
  passwordResetCount?: number;
  lastPasswordResetAt?: number;
  // Langue de préférence au moment de la création du compte (capturée depuis le sélecteur de
  // langue de la page d'accueil, voir i18n.tsx::Locale) — utilisée pour localiser les emails
  // transactionnels (bienvenue, rapports, annonces). Absente = 'fr' par défaut (voir
  // web/src/lib/email/templates.ts). Jamais réécrite ensuite (même logique que uid/email/accountType).
  lang?: 'fr' | 'en' | 'es' | 'pt';
  // Programmation d'un envoi automatique de rapport de progression par email (voir
  // Administration §"Statistiques par joueur" et docs/EMAIL_NOTIFICATIONS.md). Le job cron
  // (web/src/app/api/email/cron-reports/route.ts) parcourt tous les joueurs ayant `enabled: true`
  // et envoie le rapport dès que la date/cycle correspond, en évitant les doublons via `lastSentAt`.
  scheduledReport?: {
    enabled: boolean;
    startDate: number;         // horodatage (ms) du premier envoi possible
    cycle: 'daily' | 'weekly' | 'monthly' | 'yearly';
    weeklyDays?: number[];     // 0=dimanche..6=samedi, utilisé seulement si cycle==='weekly'
    monthlyDay?: number;       // 1-31, utilisé seulement si cycle==='monthly' (plafonné au dernier jour du mois)
    customMessage?: string;    // texte libre optionnel ajouté à chaque envoi programmé
    imageUrl?: string;         // image optionnelle ajoutée à chaque envoi programmé
    lastSentAt?: number;       // anti-doublon : ne renvoie pas deux fois le même jour
  };
  // Statut du dernier envoi de l'e-mail de bienvenue (voir NoWalletAccessPanel.tsx::startFiatEmailCreate
  // et PlayerEmailPanel.tsx bouton "🔁 Renvoyer l'e-mail de bienvenue") — auparavant l'échec était
  // silencieusement avalé (`.catch(() => {})`), rendant le problème invisible pour l'admin (bug
  // corrigé). Cause la plus fréquente d'échec : adresse d'expédition Resend en mode test
  // (`onboarding@resend.dev`), qui ne peut envoyer qu'à l'adresse du compte Resend lui-même tant
  // qu'aucun domaine n'est vérifié (voir docs/EMAIL_NOTIFICATIONS.md § Piège de déploiement).
  welcomeEmailStatus?: 'sent' | 'failed';
  welcomeEmailError?: string;
  welcomeEmailSentAt?: number;
  // ─── Élixirs combinés (voir PotionCombo/combinePotions, widget "Sac / Besace") ───
  // Horodatages de fin d'effet des 4 buffs temporisés obtenus en combinant plusieurs potions/
  // sortilèges dans la besace. Ces 3 boucliers sont lus par LE seul point d'entrée qui modifie
  // hp/oxygen/fatigue — `applyEffect()` ci-dessous — donc AUCUNE autre fonction du jeu (combat,
  // noyade, altitude, épuisement...) n'a besoin d'être modifiée pour respecter ces protections
  // temporaires : elles s'appliquent automatiquement partout, sans risque de trou de couverture.
  hpInvulnerableUntil?: number;      // "Élixir d'Invulnérabilité" — ignore toute perte de Vie
  oxygenShieldUntil?: number;        // "Élixir de Souffle Éternel" — ignore toute perte d'Oxygène
  fatigueShieldUntil?: number;       // "Élixir de Vigueur Sans Fin" — ignore toute perte de Fatigue
  // "Élixir de Force Titanesque" — multiplie (par `forceBoostMultiplier`, défaut 2) la contribution
  // de la Force au bonus de dé de combat (voir computePlayerDiceBonus) tant qu'actif ; NE modifie
  // JAMAIS le stock brut de Force (toujours plafonné à forceMax comme d'habitude).
  forceBoostUntil?: number;
  forceBoostMultiplier?: number;
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
// `hands` : gants — emplacement de protection dédié aux mains, distinct de `weapon`/`offhand` qui
// portent l'arme/le bouclier tenus en main (voir EquipmentWidget.tsx).
export type EquipSlot = 'weapon' | 'offhand' | 'head' | 'body' | 'legs' | 'feet' | 'belt' | 'arrows'
  | 'amulet' | 'vehicle' | 'familiar' | 'saddle' | 'hands';
export const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'offhand', 'head', 'body', 'legs', 'feet', 'belt', 'arrows',
  'amulet', 'vehicle', 'familiar', 'saddle', 'hands'];

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
  // Usure courante conservée quand l'objet est déséquipé et remis en besace (voir unequipSlot()/
  // equipItem() dans gameState.ts) — absent/undefined = objet neuf (jamais encore équipé/usé),
  // équivaut alors à `durabilityMax` au moment de l'équiper. Sans ce champ, une arme/protection
  // usée en combat retrouvait son usure à 100% dès qu'on la retirait puis remettait sur Synk (bug
  // signalé : l'usure "disparaissait" au déséquipement).
  durability?: number;
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
  type: 'mint' | 'feed' | 'buy' | 'sell' | 'quest' | 'other' | 'fiat_topup';
  label: string;
  valueEth: string;    // en ETH lisible (ex "0.0001") — "0" pour une transaction fiat/simulée
  gasEth?: string;     // frais réseau (gasUsed * gasPrice) en ETH
  timestamp: number;
  chainId: number;
  status?: 'pending' | 'confirmed' | 'failed';
  // ─── Paiement fiat / démo (voir WalletTopupWidget.tsx, docs/DEMO_FIAT.md) ───
  // `offchain: true` = pas de transaction blockchain réelle (compte 'demo'/'fiat' ou nourrissage
  // simulé) : PlayerStats.tsx masque le lien Etherscan pour ces lignes (aucun hash exploitable).
  offchain?: boolean;
  provider?: 'card' | 'paypal' | 'apple_pay' | 'google_pay' | 'demo_seed'; // moyen de paiement fiat utilisé
  valueFiat?: string;  // montant affiché en devise fiat (ex "4.99 €"), si provider défini
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

/** Type de récompense obtenue en combinant plusieurs potions/sortilèges à la fois dans la besace
 * (voir InventoryWidget.tsx "🧪 Combiner des potions" et combinePotions() ci-dessous). Les 4
 * premiers sont des buffs TEMPORAIRES (horodatage de fin stocké sur PlayerState, voir plus haut,
 * lus par applyEffect()/computePlayerDiceBonus()) ; `hungerFull` est un effet INSTANTANÉ (pas de
 * minuteur) ; `grantItem` offre un objet unique (arme/monture/trésor "divin", potentiellement
 * introuvable ailleurs) directement dans la besace. */
export type PotionComboEffectKind = 'invulnerability' | 'forceX2' | 'oxygenFull' | 'fatigueFull' | 'hungerFull' | 'grantItem';

/** Recette de combinaison de potions — paramétrable en Administration (voir
 * PotionComboAdminPanel.tsx), stockée hors-chaîne à `catalog/potionCombos/{id}`. Le joueur
 * sélectionne dans l'onglet "Potions & Sortilèges" de la besace un multi-ensemble d'objets
 * possédés correspondant EXACTEMENT à `ingredients` (mêmes itemId/qty, ordre indifférent — voir
 * findMatchingPotionCombo()) pour déclencher la combinaison. */
export interface PotionCombo {
  id: string;
  label: string;         // libellé FR de repli (affiché dans le pop-up sablier — voir ActiveElixirsBanner.tsx)
  i18nKey?: string;       // clé i18n optionnelle (voir localizeName)
  icon: string;           // emoji affiché dans la besace et le pop-up
  ingredients: { itemId: string; qty: number }[]; // potions/sortilèges requis SIMULTANÉMENT (2+)
  effectKind: PotionComboEffectKind;
  durationMinutes?: number;  // ignoré pour hungerFull/grantItem (effet instantané)
  forceMultiplier?: number;  // uniquement pour forceX2 — défaut 2 (voir combinePotions)
  // Objet offert si effectKind === 'grantItem' (spécification complète auto-suffisante, façon
  // NPC_FIGHT_LOOT_TABLE — pas besoin d'exister dans catalog/shop, peut donc être un objet
  // "divin" uniquement obtenable via cette combinaison).
  grantItem?: {
    itemId: string; name: string; category: InventoryItem['category'];
    slot?: EquipSlot; rarity?: ItemRarity; damage?: number; defense?: number; durabilityMax?: number;
    effect?: InventoryItem['effect'];
  };
  active: boolean;
}

// ────────────────────────────────────── Init player ──────────────────────────────────────

const KEY = (addr: string) => addr.toLowerCase();

/** Clé RTDB sûre : les segments de chemin Firebase interdisent ".", "#", "$", "[", "]"
 * (ex. ids hérités de l'ancien slug on-chain "npc.zelda_princess" — voir migrateNpcsTreasuresWorldsToFirebase.mjs).
 * Le champ `id` d'origine (avec points) est conservé tel quel dans la valeur stockée ; seul le
 * segment de chemin est assaini, pour ne jamais planter sur un id admin mal formé. */
export const RKEY = (id: string) => id.toLowerCase().replace(/[.#$[\]]/g, '_');

/** Récupère ou crée le PlayerState.
 * `opts.accountType` ('demo'|'fiat') et `opts.initialWallet` permettent de créer un compte sans
 * portefeuille crypto (voir docs/DEMO_FIAT.md) — n'affecte JAMAIS la création d'un compte 'wallet'
 * classique (comportement 100% inchangé, `opts` omis partout ailleurs dans le code existant).
 * `opts.uid`/`opts.email` (compte 'demo'/'fiat' uniquement) sont enregistrés une seule fois, à la
 * création, pour permettre à l'admin d'identifier le joueur et de libérer sa session/son entrée
 * `demoAccessRequests` lors d'une suppression (voir deletePlayerAccount, menu Administration). */
export async function getOrCreatePlayer(
  address: string,
  displayName?: string,
  opts?: { accountType?: 'demo' | 'fiat'; initialWallet?: number; uid?: string; email?: string; authMethod?: 'google' | 'email'; lang?: 'fr' | 'en' | 'es' | 'pt' },
): Promise<PlayerState> {
  const db = getFirebaseDb();
  if (!db) throw new Error('Firebase non configuré');
  await ensureAnonSignIn();
  const k = KEY(address);
  const snap = await get(ref(db, `players/${k}`));
  if (snap.exists()) {
    markPlayerActiveToday(k).catch(() => {}); // Intelligence IA GamePlay — DAU/rétention, jamais bloquant
    const existing = snap.val() as PlayerState;
    // Rattrapage ("backfill") : un compte 'demo'/'fiat' créé AVANT l'ajout d'un de ces champs (ex.
    // `authMethod`, ajouté après `uid`/`email`/`accountType`) ne les recevait plus jamais, `opts`
    // n'étant utilisé qu'à la création — ce qui masquait indéfiniment le bouton admin "Reset mot
    // de passe" (nécessite `authMethod === 'email'`, voir PlayerStats.tsx). On complète donc ici
    // UNIQUEMENT les champs manquants (jamais d'écrasement d'une valeur déjà présente).
    const patch: Partial<PlayerState> = {};
    if (opts?.uid && !existing.uid) patch.uid = opts.uid;
    if (opts?.email && !existing.email) patch.email = opts.email;
    if (opts?.accountType && !existing.accountType) patch.accountType = opts.accountType;
    if (opts?.authMethod && !existing.authMethod) patch.authMethod = opts.authMethod;
    if (Object.keys(patch).length > 0) {
      await update(ref(db, `players/${k}`), patch).catch(() => {});
      Object.assign(existing, patch);
    }
    return applyDecay(existing, k);
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
    reputation: 0, wallet: opts?.initialWallet ?? 100,
    score: 0,
    lastTick: now, createdAt: now, updatedAt: now,
    ...(opts?.accountType ? { accountType: opts.accountType } : {}),
    ...(opts?.uid ? { uid: opts.uid } : {}),
    ...(opts?.email ? { email: opts.email } : {}),
    ...(opts?.authMethod ? { authMethod: opts.authMethod } : {}),
    ...(opts?.lang ? { lang: opts.lang } : {}),
  };
  await set(ref(db, `players/${k}`), initial);
  await set(ref(db, `playerIndex/${k}`), true);
  markPlayerActiveToday(k).catch(() => {}); // Intelligence IA GamePlay — DAU/rétention, jamais bloquant
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
  const handler = (snap: DataSnapshot) => {
    if (!snap.exists()) { cb(null); return; }
    const p = snap.val() as PlayerState;
    cb(p);
    // Auto-correction douce d'éventuelles données historiques où hpMax/forceMax/spellsMax
    // dépasseraient le plafond configuré (hpMaxCap/forceMaxCap/spellsMaxCap dans RepRules) —
    // corrige le bug de cumul illimité des Super-fioles dès l'ouverture du jeu, sans attendre une
    // nouvelle action du joueur (applyEffect() empêche déjà toute NOUVELLE dérive). Écriture
    // silencieuse ; le nouvel appel à `cb` viendra automatiquement via ce même abonnement.
    getCapRules().then((capRules) => {
      const hpMaxCap = capRules.hpMaxCap ?? 300;
      const forceMaxCap = capRules.forceMaxCap ?? 200;
      const spellsMaxCap = capRules.spellsMaxCap ?? 200;
      const fixes: Partial<PlayerState> = {};
      if ((p.hpMax ?? 100) > hpMaxCap) { fixes.hpMax = hpMaxCap; fixes.hp = Math.min(p.hp ?? 100, hpMaxCap); }
      if ((p.forceMax ?? 100) > forceMaxCap) { fixes.forceMax = forceMaxCap; fixes.force = Math.min(p.force ?? 10, forceMaxCap); }
      if ((p.spellsMax ?? 100) > spellsMaxCap) { fixes.spellsMax = spellsMaxCap; fixes.spells = Math.min(p.spells ?? 5, spellsMaxCap); }
      if (Object.keys(fixes).length) update(ref(db, `players/${KEY(address)}`), fixes).catch(() => {});
    }).catch(() => {});
  };
  onValue(r, handler);
  return () => off(r, 'value', handler);
}

export async function updatePlayer(address: string, patch: Partial<PlayerState>): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await update(ref(db, `players/${KEY(address)}`), { ...patch, updatedAt: Date.now() });
}

// Cache mémoire (30s) des plafonds de statistiques configurés par l'administrateur (hpMaxCap/
// forceMaxCap/spellsMaxCap dans RepRules) — utilisé exclusivement par applyEffect ci-dessous pour
// borner hpMax/forceMax/spellsMax sans ajouter une lecture Firebase à chaque appel : applyEffect
// est invoqué en continu par les mécaniques de tick (oxygène, fatigue, faim…), donc relire
// catalog/repRules à chaque fois serait coûteux. Invalidé immédiatement par setRepRules() quand
// l'administrateur enregistre de nouveaux plafonds.
let _capRulesCache: { value: RepRules; at: number } | null = null;
async function getCapRules(): Promise<RepRules> {
  const now = Date.now();
  if (_capRulesCache && now - _capRulesCache.at < 30000) return _capRulesCache.value;
  const value = await getRepRules().catch(() => DEFAULT_REP_RULES);
  _capRulesCache = { value, at: now };
  return value;
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
  // Plafonds finaux des statistiques boostables par Super-fioles (paramétrables en Administration,
  // voir RepRulesPanel) — corrige le bug de cumul illimité (chaque Super-fiole ajoutait +100 sans
  // jamais s'arrêter) tout en gardant le principe du boost permanent. Bornage appliqué à CHAQUE
  // appel (pas seulement lors de la consommation d'une Super-fiole) pour aussi corriger
  // automatiquement, dès le prochain tick, toute donnée déjà au-delà de la limite.
  const capRules = await getCapRules();
  const hpMax        = Math.min((cur.hpMax        ?? 100) + (delta.maxHp     ?? 0), capRules.hpMaxCap     ?? 300);
  const forceMax     = Math.min((cur.forceMax     ?? 100) + (delta.maxForce  ?? 0), capRules.forceMaxCap  ?? 200);
  const spellsMax    = Math.min((cur.spellsMax    ?? 100) + (delta.maxSpells ?? 0), capRules.spellsMaxCap ?? 200);
  const hungerMax    = cur.hungerMax    ?? 100;
  const happinessMax = cur.happinessMax ?? 100;
  const oxygenMax    = cur.oxygenMax    ?? 100;
  const fatigueMax   = cur.fatigueMax   ?? 100;
  // ─── Boucliers d'Élixirs combinés (voir PlayerState.hpInvulnerableUntil/oxygenShieldUntil/
  // fatigueShieldUntil et combinePotions() plus bas) — applyEffect() étant le SEUL point d'entrée
  // qui modifie hp/oxygen/fatigue dans tout le jeu (combat, noyade, altitude, épuisement, dés
  // d'action...), neutraliser ici toute perte (delta négatif) tant que le bouclier est actif
  // protège automatiquement TOUTES ces sources sans avoir à toucher un seul de leurs appelants.
  // Les gains (delta positif, ex. une potion de vie bue pendant l'invulnérabilité) restent inchangés.
  const now = Date.now();
  const hpShielded      = !!cur.hpInvulnerableUntil && cur.hpInvulnerableUntil > now;
  const oxygenShielded  = !!cur.oxygenShieldUntil   && cur.oxygenShieldUntil   > now;
  const fatigueShielded = !!cur.fatigueShieldUntil  && cur.fatigueShieldUntil  > now;
  const hpDelta      = hpShielded      && (delta.hp      ?? 0) < 0 ? 0 : (delta.hp      ?? 0);
  const oxygenDelta  = oxygenShielded  && (delta.oxygen  ?? 0) < 0 ? 0 : (delta.oxygen  ?? 0);
  const fatigueDelta = fatigueShielded && (delta.fatigue ?? 0) < 0 ? 0 : (delta.fatigue ?? 0);
  const clamped: PlayerState = {
    ...cur,
    hp:         clamp((cur.hp        ?? 100) + hpDelta, 0, hpMax),
    hpMax,
    hunger:     clamp((cur.hunger    ?? 80)  + (delta.hunger    ?? 0), 0, hungerMax),
    hungerMax,
    happiness:  clamp((cur.happiness ?? 60)  + (delta.happiness ?? 0), 0, happinessMax),
    happinessMax,
    force:      clamp((cur.force     ?? 10)  + (delta.force     ?? 0), 0, forceMax),
    forceMax,
    spells:     clamp((cur.spells    ?? 5)   + (delta.spells    ?? 0), 0, spellsMax),
    spellsMax,
    oxygen:     clamp((cur.oxygen    ?? 100) + oxygenDelta, 0, oxygenMax),
    oxygenMax,
    fatigue:    clamp((cur.fatigue   ?? 100) + fatigueDelta, 0, fatigueMax),
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
  // Marqueur permanent "déjà possédé un jour" (voir players/{addr}/itemsEverOwned/{itemId}, jamais
  // supprimé même si l'objet est ensuite entièrement consommé/retiré via removeFromInventory) —
  // seule et unique écriture nécessaire ici puisque addToInventory() est le point d'entrée
  // centralisé de TOUTE acquisition d'objet (boutique, récompense de quête/coffre/PNJ). Alimente le
  // widget "État d'avancement / inventaire" et la rubrique admin "Statistiques par joueur" (voir
  // getPlayerProgressLedger ci-dessous). Écriture "fire-and-forget" (non bloquante pour l'appelant).
  set(ref(db, `players/${KEY(address)}/itemsEverOwned/${item.itemId}`), true).catch(() => {});
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
      'slot', 'rarity', 'damage', 'defense', 'durabilityMax', 'durability', 'requiresArrow', 'requiresFamiliarId', 'effect',
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

// ──────────────────────────── Combinaison de potions (Élixirs, D&D) ────────────────────────────
// Voir InventoryWidget.tsx "🧪 Combiner des potions" (widget "Sac / Besace") : le joueur coche
// plusieurs potions/sortilèges possédés dans l'onglet Potions, le jeu cherche une recette
// (PotionCombo) dont `ingredients` correspond EXACTEMENT à la sélection, puis affiche un pop-up
// clignotant avec sablier ⏳ et décompte (voir ActiveElixirsBanner.tsx) pour les effets temporisés.

/** Recettes par défaut (seed si `catalog/potionCombos` est vide) — illustrent les 5 types d'effet
 * demandés (invulnérabilité 24h, force ×2 30min, oxygène plein 30min, fatigue pleine 10min, faim
 * pleine instantanée) plus un exemple d'arme "divine" obtenue par combinaison. 100% paramétrable/
 * remplaçable ensuite par l'admin (PotionComboAdminPanel.tsx) — ce ne sont que des points de départ. */
export const DEFAULT_POTION_COMBOS: PotionCombo[] = [
  {
    id: 'combo_invulnerabilite',
    label: '🛡️✨ Élixir d\'Invulnérabilité',
    i18nKey: 'invulnerability',
    icon: '🛡️✨',
    ingredients: [{ itemId: 'super_hp', qty: 1 }, { itemId: 'legend_hp', qty: 1 }],
    effectKind: 'invulnerability',
    durationMinutes: 1440, // 24h
    active: true,
  },
  {
    id: 'combo_force_titan',
    label: '💪⚡ Élixir de Force Titanesque',
    i18nKey: 'forceX2',
    icon: '💪⚡',
    ingredients: [{ itemId: 'super_force', qty: 1 }, { itemId: 'potion_sp', qty: 1 }],
    effectKind: 'forceX2',
    durationMinutes: 30,
    forceMultiplier: 2,
    active: true,
  },
  {
    id: 'combo_souffle_eternel',
    label: '🫧♾️ Élixir de Souffle Éternel',
    i18nKey: 'oxygenFull',
    icon: '🫧♾️',
    ingredients: [{ itemId: 'potion_sp', qty: 1 }, { itemId: 'spell_fire', qty: 1 }],
    effectKind: 'oxygenFull',
    durationMinutes: 30,
    active: true,
  },
  {
    id: 'combo_vigueur_sans_fin',
    label: '🥱🔋 Élixir de Vigueur Sans Fin',
    i18nKey: 'fatigueFull',
    icon: '🥱🔋',
    ingredients: [{ itemId: 'super_spells', qty: 1 }, { itemId: 'potion_hp', qty: 1 }],
    effectKind: 'fatigueFull',
    durationMinutes: 10,
    active: true,
  },
  {
    id: 'combo_festin_royal',
    label: '🍗✨ Élixir du Festin Royal',
    i18nKey: 'hungerFull',
    icon: '🍗✨',
    ingredients: [{ itemId: 'potion_hp', qty: 2 }, { itemId: 'potion_sp', qty: 1 }],
    effectKind: 'hungerFull',
    active: true,
  },
  {
    id: 'combo_epee_divine',
    label: '⚔️🌟 Épée Divine de Lumière',
    i18nKey: 'grantDivineSword',
    icon: '⚔️🌟',
    ingredients: [{ itemId: 'super_force', qty: 1 }, { itemId: 'super_hp', qty: 1 }, { itemId: 'super_spells', qty: 1 }],
    effectKind: 'grantItem',
    grantItem: {
      itemId: 'epee_divine', name: '⚔️🌟 Épée Divine de Lumière', category: 'weapon', slot: 'weapon',
      rarity: 'legendary', damage: 60, durabilityMax: 40, effect: { force: 40, hp: 20, spells: 20 },
    },
    active: true,
  },
];

export async function getPotionCombos(): Promise<PotionCombo[]> {
  const db = getFirebaseDb();
  if (!db) return DEFAULT_POTION_COMBOS;
  try {
    const snap = await get(ref(db, 'catalog/potionCombos'));
    const v = snap.val() as Record<string, PotionCombo> | null;
    if (!v || !Object.keys(v).length) return DEFAULT_POTION_COMBOS;
    // Fusionne avec les recettes par défaut (Firebase prioritaire par id) — même logique anti-
    // régression que getShopCatalog() : un ajout partiel en base ne fait jamais disparaître les
    // recettes de base qui n'y ont jamais été explicitement repoussées.
    const merged: Record<string, PotionCombo> = {};
    for (const c of DEFAULT_POTION_COMBOS) merged[c.id] = c;
    for (const c of Object.values(v)) merged[c.id] = c;
    return Object.values(merged).filter((c) => c.active !== false);
  } catch (e) {
    console.warn('[potionCombos] catalog read failed, using DEFAULT_POTION_COMBOS:', e);
    return DEFAULT_POTION_COMBOS;
  }
}

/** Variante admin (inclut aussi les recettes désactivées, pour pouvoir les réactiver). */
export async function getAllPotionCombos(): Promise<PotionCombo[]> {
  const db = getFirebaseDb();
  if (!db) return DEFAULT_POTION_COMBOS;
  try {
    const snap = await get(ref(db, 'catalog/potionCombos'));
    const v = snap.val() as Record<string, PotionCombo> | null;
    const merged: Record<string, PotionCombo> = {};
    for (const c of DEFAULT_POTION_COMBOS) merged[c.id] = c;
    if (v) for (const c of Object.values(v)) merged[c.id] = c;
    return Object.values(merged);
  } catch {
    return DEFAULT_POTION_COMBOS;
  }
}

export async function setPotionCombo(combo: PotionCombo): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `catalog/potionCombos/${RKEY(combo.id)}`), combo);
}

export async function removePotionCombo(id: string): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `catalog/potionCombos/${RKEY(id)}`), null);
}

/** Cherche, parmi les recettes actives, celle dont `ingredients` correspond EXACTEMENT (mêmes
 * itemId et quantités, ordre indifférent, aucun ingrédient en trop ni manquant) à la sélection du
 * joueur dans la besace. Retourne `null` si aucune recette ne correspond. */
export function findMatchingPotionCombo(selected: { itemId: string; qty: number }[], combos: PotionCombo[]): PotionCombo | null {
  const selMap = new Map(selected.map((s) => [s.itemId, s.qty]));
  for (const combo of combos) {
    if (combo.active === false) continue;
    if (combo.ingredients.length !== selMap.size) continue;
    const matches = combo.ingredients.every((ing) => selMap.get(ing.itemId) === ing.qty);
    if (matches) return combo;
  }
  return null;
}

export type CombinePotionsResult =
  | { ok: true; combo: PotionCombo }
  | { ok: false; reason: 'notFound' | 'missingIngredients' };

/** Consomme les ingrédients d'une recette (vérifiés en quantité suffisante AVANT toute écriture,
 * pour ne jamais retirer un ingrédient si un autre manque) puis applique l'effet obtenu — buff
 * temporisé (Vie/Force/Oxygène/Fatigue, voir PlayerState), remplissage instantané de la Faim, ou
 * objet unique ajouté à la besace (voir addToInventory). */
export async function combinePotions(address: string, comboId: string): Promise<CombinePotionsResult> {
  const db = getFirebaseDb();
  if (!db) return { ok: false, reason: 'notFound' };
  const combos = await getPotionCombos();
  const combo = combos.find((c) => c.id === comboId);
  if (!combo) return { ok: false, reason: 'notFound' };
  await ensureAnonSignIn();
  const k = KEY(address);
  for (const ing of combo.ingredients) {
    const snap = await get(ref(db, `players/${k}/inventory/${RKEY(ing.itemId)}`));
    const it = snap.val() as InventoryItem | null;
    if (!it || it.qty < ing.qty) return { ok: false, reason: 'missingIngredients' };
  }
  for (const ing of combo.ingredients) await removeFromInventory(address, ing.itemId, ing.qty);

  const now = Date.now();
  switch (combo.effectKind) {
    case 'invulnerability':
      await update(ref(db, `players/${k}`), { hpInvulnerableUntil: now + Math.max(1, combo.durationMinutes ?? 1440) * 60_000 });
      break;
    case 'forceX2':
      await update(ref(db, `players/${k}`), {
        forceBoostUntil: now + Math.max(1, combo.durationMinutes ?? 30) * 60_000,
        forceBoostMultiplier: combo.forceMultiplier ?? 2,
      });
      break;
    case 'oxygenFull': {
      const cur = await getOrCreatePlayer(address);
      await update(ref(db, `players/${k}`), { oxygenShieldUntil: now + Math.max(1, combo.durationMinutes ?? 30) * 60_000 });
      const missing = Math.max(0, (cur.oxygenMax ?? 100) - (cur.oxygen ?? 100));
      if (missing > 0) await applyEffect(address, { oxygen: missing });
      break;
    }
    case 'fatigueFull': {
      const cur = await getOrCreatePlayer(address);
      await update(ref(db, `players/${k}`), { fatigueShieldUntil: now + Math.max(1, combo.durationMinutes ?? 10) * 60_000 });
      const missing = Math.max(0, (cur.fatigueMax ?? 100) - (cur.fatigue ?? 100));
      if (missing > 0) await applyEffect(address, { fatigue: missing });
      break;
    }
    case 'hungerFull': {
      const cur = await getOrCreatePlayer(address);
      const missing = Math.max(0, (cur.hungerMax ?? 100) - (cur.hunger ?? 100));
      if (missing > 0) await applyEffect(address, { hunger: missing });
      break;
    }
    case 'grantItem':
      if (combo.grantItem) await addToInventory(address, { ...combo.grantItem, qty: 1 });
      break;
  }
  return { ok: true, combo };
}

// ────────────────────────────────────── Équipement (Vitruve) ──────────────────────────────────────
// Le joueur équipe une arme/protection/flèches par glisser-déposer depuis la besace vers
// EquipmentWidget.tsx. Contrairement à l'inventaire (empilé par itemId), chaque emplacement
// d'équipement porte sa propre usure (`durability`) : équiper consomme 1 unité (ou toute la pile
// pour les flèches) de l'inventaire ; déséquiper restitue l'objet à la besace EN CONSERVANT son
// usure courante (voir `InventoryItem.durability`) — ré-équiper ensuite le même objet reprend
// l'usure là où elle en était, seule la casse totale (durability ≤ 0) le fait disparaître pour de
// bon. Simplification assumée : cette usure n'est pas fractionnée par exemplaire au sein d'une
// pile empilée par `qty` (rare en pratique, l'équipement portant un `slot` n'étant quasiment
// jamais acheté/obtenu en plusieurs exemplaires identiques).

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
    // Reprend l'usure conservée en besace (`item.durability`, voir unequipSlot()) si l'objet a déjà
    // servi ; sinon objet neuf → pleine durabilité (comportement historique inchangé).
    durability: item.durability ?? item.durabilityMax ?? 100, durabilityMax: item.durabilityMax ?? 100,
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

/** Retire l'objet équipé d'un emplacement et le restitue à la besace, en conservant son usure
 * courante (`durability`, voir champ ajouté à `InventoryItem`) pour qu'un ré-équipement ultérieur
 * du même objet ne réinitialise pas sa durabilité — seule la casse totale (durability ≤ 0, gérée
 * ailleurs par applyEquipmentWear) fait définitivement disparaître l'objet. Le slot 'familiar' est
 * un cas particulier : ce n'est pas un objet de besace (juste une référence vers un familier déjà
 * apprivoisé, voir equipFamiliar), donc rien n'est restitué — le familier reste possédé
 * indéfiniment, on ne fait que le retirer du rang de compagnon de combat actif. */
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
    ...(it.durabilityMax ? { durabilityMax: it.durabilityMax, durability: it.durability } : {}),
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
  (['offhand', 'head', 'body', 'legs', 'feet', 'belt', 'amulet', 'hands'] as EquipSlot[]).forEach((slot) => {
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

/** Enregistrement persistant d'un objet cassé (durabilité tombée à 0) — voir applyEquipmentWear()
 * et le thème "Cimetière des équipements" du widget "État d'avancement / inventaire"
 * (getPlayerProgressLedger()). Contrairement au déséquipement classique (unequipSlot()), un objet
 * cassé N'EST PAS remis en besace : il est considéré définitivement inexploitable/trop abîmé (voir
 * demande utilisateur), seule cette trace en garde le souvenir. Clé RTDB :
 * players/{addr}/equipmentGraveyard/{pushId}
 */
export interface EquipmentGraveyardEntry {
  id: string; itemId: string; name: string; category: EquippedItem['category']; slot: EquipSlot;
  rarity?: ItemRarity; brokenAt: number;
}

/** Lit l'historique des objets cassés d'un joueur, du plus récent au plus ancien. */
export async function getEquipmentGraveyard(address: string): Promise<EquipmentGraveyardEntry[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  const snap = await get(ref(db, `players/${KEY(address)}/equipmentGraveyard`));
  const v = snap.val() as Record<string, Omit<EquipmentGraveyardEntry, 'id'>> | null;
  if (!v) return [];
  return Object.entries(v)
    .map(([id, e]) => ({ id, ...e }))
    .sort((a, b) => b.brokenAt - a.brokenAt);
}

/** Applique l'usure de combat aux emplacements utilisés (arme/protections) : réduit la durabilité
 * de `wearPct` % du plafond (arrondi, minimum 1) ; si elle atteint 0, l'objet casse et disparaît
 * (pop-up dédié côté UI, voir FightResultModal.tsx) SANS être remis en besace — trop abîmé pour
 * être réutilisé (voir demande utilisateur) — et une trace est archivée dans le "Cimetière des
 * équipements" (equipmentGraveyard, voir getEquipmentGraveyard() ci-dessus). Les flèches sont
 * consommées séparément (1 par tir, qty décrémentée), sans notion de durabilité ni de casse : ce
 * mécanisme de munitions existant n'est pas concerné par le cimetière. */
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
      const entry: Omit<EquipmentGraveyardEntry, 'id'> = {
        itemId: it.itemId, name: it.name, category: it.category, slot, brokenAt: Date.now(),
        ...(it.rarity ? { rarity: it.rarity } : {}),
      };
      push(ref(db, `players/${KEY(address)}/equipmentGraveyard`), entry).catch(() => {});
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
  // ─── Quêtes des îles (50 quêtes intermédiaires supplémentaires, voir seedIslandQuests.mjs) ───
  // Simples quêtes PNJ (`npcGiver: true`) classées à part pour l'affichage/l'admin — n'affecte NI
  // le déblocage (identique à toute quête npcGiver, via pickNpcQuestForPlayer) NI le filtrage
  // Mapmonde (reste `questCategory: 'npc'`, voir mapFilters.ts) : purement une étiquette narrative/
  // administrative, zéro régression sur le système de quêtes intermédiaires existant.
  islandKind?: 'archipelago' | 'wildIsland';
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
  // ─── Niveau de complexité additionnel « Convergence » (voir submitQuestAnswerOffchain ci-dessous)
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Inspiré des fragments de l'Anneau (Tolkien)/quêtes légendaires de World Of Warcraft : certaines
  // quêtes du Royaume de fin de chaîne exigent, EN PLUS de la bonne réponse, la possession d'objets
  // spécifiques dans la besace (généralement des `itemReward` d'autres quêtes intermédiaires/du
  // Royaume disséminées plus tôt dans l'histoire) — consommés à la résolution. Une quête sans ce
  // champ se comporte EXACTEMENT comme avant (zéro régression). `name` est ré-affiché tel quel
  // (repli) dans le message d'objets manquants — voir game.quests.missingItems.
  requiresItems?: { itemId: string; qty: number; name: string }[];
  // ─── Extensions (DLC) — voir ContentPackDef plus bas. undefined = jeu de base (toujours visible).
  contentPack?: string;
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
): Promise<'correct' | 'wrong' | 'already' | 'missing-items'> {
  const already = await getSolvedQuest(address, quest.id);
  if (already) return 'already';
  const normalized = normalizeAnswer(rawAnswer);
  if (hashAnswer(normalized).toLowerCase() !== quest.answerHash.toLowerCase()) {
    trackQuestFunnelEvent(address, quest.id, deriveQuestCategory(quest), 'fail').catch(() => {});
    return 'wrong';
  }
  // ─── Quête « Convergence » (voir QuestDef.requiresItems) : la bonne réponse ne suffit pas tant
  // que les objets requis (ex. Fragments du Sceau Runique glanés plus tôt dans l'histoire) ne sont
  // pas dans la besace — vérifiés AVANT tout octroi d'XP/score/objet pour rester atomique, puis
  // consommés (Seigneur des Anneaux : les fragments se "brisent" en scellant le destin de Zorghon).
  if (quest.requiresItems?.length) {
    const inv = await getInventoryOnce(address);
    const held = new Map(inv.map(i => [i.itemId, i.qty]));
    const missing = quest.requiresItems.some(r => (held.get(r.itemId) ?? 0) < r.qty);
    if (missing) {
      trackQuestFunnelEvent(address, quest.id, deriveQuestCategory(quest), 'blocked').catch(() => {});
      return 'missing-items';
    }
  }
  await applyEffect(address, {
    xpBonus: quest.xpReward, score: quest.scoreReward, reputation: reputationReward,
  });
  if (quest.requiresItems?.length) {
    for (const r of quest.requiresItems) await removeFromInventory(address, r.itemId, r.qty);
  }
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
  trackQuestFunnelEvent(address, quest.id, deriveQuestCategory(quest), 'solved').catch(() => {});
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
  const [quests, unlocked, season, packs] = await Promise.all([getQuestDefs(), getUnlockedQuestIds(address), getCurrentSeason(), getContentPackDefs()]);
  const pool = quests.filter(q => q.active && q.npcGiver && !unlocked.has(q.id.toLowerCase()) && (!q.season || q.season === season) && isContentPackVisible(q.contentPack, packs));
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
  const [quests, solved, intermediateCount, moonFull, rules, packs] = await Promise.all([
    getQuestDefs(), getAllSolvedQuestIds(address), getSolvedIntermediateCount(address), isFullMoonToday(), getRepRules(), getContentPackDefs(),
  ]);
  const kingdomQuests = quests
    .filter(q => q.active && q.kingdomQuest && isContentPackVisible(q.contentPack, packs))
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

// ─────────────────────────────── Zorghon, PocaPoka & El Pipo ───────────────────────────────────
// Mécanique narrative de fin de saison (voir RepRules::zorghon*) : une fois
// `zorghonAppearKingdomSolvedCount` Quêtes du Royaume résolues, Zorghon le maléfique et ses deux
// prisonniers (PocaPoka + El Pipo, matérialisés par un seul marqueur "captive") apparaissent
// quelque part sur la carte (îles comprises). Tant que Synk reste à distance de
// `zorghonProximityPct`, rien ne se passe ; en-deçà, Zorghon a `zorghonRelocationChancePct` % de
// chance, à chaque vérification périodique (voir GameCanvas2D.tsx), de déplacer ses prisonniers
// ailleurs. Atteindre la case des prisonniers déclenche `rescuePocaPoka` (délivrance + XP), qui
// clôt la traque pour la saison en cours. État persistant par joueur (players/{addr}/zorghonEncounter)
// pour survivre aux rechargements de page, indépendant de la Quête du Royaume finale elle-même (le
// combat de boss proprement dit reste un développement futur — v1 = traque + délivrance).
export interface ZorghonEncounterState {
  zorghonX: number; zorghonY: number;   // position (fixe pour la saison) de Zorghon
  captiveX: number; captiveY: number;   // position courante de PocaPoka & El Pipo
  relocations: number;                  // nb de fois où Zorghon a déjà déplacé ses prisonniers
  rescued: boolean;                     // true une fois la délivrance effectuée
  createdAt: number;
  updatedAt: number;
}

/** Types de POI considérés comme "terre ferme" (jamais l'eau profonde) pour tirer une position
 * plausible de Zorghon/ses prisonniers — inclut les îles (accessibles via Engin, voir
 * RepRules::islandVehicleRequired) pour respecter la demande "n'importe où sur la carte ou une des
 * nombreuses îles". */
const ZORGHON_LAND_POI_TYPES: MapPoiType[] = [
  'plain', 'forest', 'village_ally', 'village_enemy', 'path', 'bridge', 'tavern', 'stable', 'hut',
  'beach', 'island',
];

async function randomZorghonSpot(): Promise<{ x: number; y: number }> {
  const pois = (await getMapPoiDefs(DEFAULT_MAP_ID)).filter(p => p.active && ZORGHON_LAND_POI_TYPES.includes(p.type));
  if (pois.length) {
    const pick = pois[Math.floor(Math.random() * pois.length)];
    const jitterX = Math.round((Math.random() * 8 - 4) * 10) / 10;
    const jitterY = Math.round((Math.random() * 8 - 4) * 10) / 10;
    return { x: clamp(pick.x + jitterX, 2, 98), y: clamp(pick.y + jitterY, 2, 98) };
  }
  // Repli si le catalogue de POI est vide (nouvelle carte fraîchement créée) : position aléatoire
  // sur la moitié "terre" habituelle (loin des bordures mer/océan, voir worldTerrain.ts).
  return { x: 20 + Math.random() * 60, y: 20 + Math.random() * 60 };
}

/**
 * Récupère (en le créant paresseusement au premier appel) l'état de la traque de Zorghon pour ce
 * joueur — retourne `null` tant que la mécanique est désactivée (RepRules::zorghonEnabled) ou que
 * le seuil de Quêtes du Royaume résolues (zorghonAppearKingdomSolvedCount) n'est pas atteint.
 */
export async function getZorghonEncounter(address: string): Promise<ZorghonEncounterState | null> {
  const db = getFirebaseDb();
  if (!db) return null;
  const rules = await getRepRules();
  if (!rules.zorghonEnabled) return null;
  const progress = await computeKingdomProgress(address);
  if (progress.solvedCount < (rules.zorghonAppearKingdomSolvedCount ?? 6)) return null;
  const path = `players/${KEY(address)}/zorghonEncounter`;
  const snap = await get(ref(db, path));
  let state = snap.val() as ZorghonEncounterState | null;
  if (!state) {
    const z = await randomZorghonSpot();
    const c = await randomZorghonSpot();
    state = { zorghonX: z.x, zorghonY: z.y, captiveX: c.x, captiveY: c.y, relocations: 0, rescued: false, createdAt: Date.now(), updatedAt: Date.now() };
    await ensureAnonSignIn();
    await set(ref(db, path), state);
  }
  return state;
}

/** Écoute temps réel de la traque de Zorghon (voir getZorghonEncounter) — synchronise instantanément
 * WorldMapWidget.tsx et GameCanvas2D.tsx dès qu'une relocalisation ou une délivrance survient. */
export function subscribeZorghonEncounter(address: string, cb: (s: ZorghonEncounterState | null) => void): () => void {
  const db = getFirebaseDb();
  if (!db) { cb(null); return () => {}; }
  const r = ref(db, `players/${KEY(address)}/zorghonEncounter`);
  const handler = (snap: DataSnapshot) => cb(snap.exists() ? snap.val() as ZorghonEncounterState : null);
  onValue(r, handler);
  return () => off(r, 'value', handler);
}

/**
 * Zorghon "sent" Synk trop proche (voir RepRules::zorghonProximityPct, vérification périodique dans
 * GameCanvas2D.tsx) : tire une chance de relocalisation (zorghonRelocationChancePct) et, si elle
 * réussit, déplace PocaPoka & El Pipo ailleurs. Ne fait rien si déjà délivrés ou état inexistant.
 * Retourne le nouvel état (ou l'état inchangé si la relocalisation n'a pas eu lieu / était inutile).
 */
export async function relocateZorghonCaptives(address: string): Promise<{ state: ZorghonEncounterState | null; relocated: boolean }> {
  const db = getFirebaseDb();
  if (!db) return { state: null, relocated: false };
  const path = `players/${KEY(address)}/zorghonEncounter`;
  const snap = await get(ref(db, path));
  const state = snap.val() as ZorghonEncounterState | null;
  if (!state || state.rescued) return { state, relocated: false };
  const c = await randomZorghonSpot();
  const updated: ZorghonEncounterState = {
    ...state, captiveX: c.x, captiveY: c.y, relocations: (state.relocations ?? 0) + 1, updatedAt: Date.now(),
  };
  await ensureAnonSignIn();
  await set(ref(db, path), updated);
  return { state: updated, relocated: true };
}

/**
 * Délivrance de PocaPoka et El Pipo (Synk a atteint leur case) — octroie l'XP de récompense
 * (RepRules::zorghonRescueXpReward) et fige `rescued: true` (idempotent : un second appel ne
 * ré-octroie pas l'XP). Retourne 'rescued' la première fois, 'already' sinon.
 */
export async function rescuePocaPoka(address: string): Promise<'rescued' | 'already'> {
  const db = getFirebaseDb();
  if (!db) return 'already';
  const path = `players/${KEY(address)}/zorghonEncounter`;
  const snap = await get(ref(db, path));
  const state = snap.val() as ZorghonEncounterState | null;
  if (!state || state.rescued) return 'already';
  const rules = await getRepRules();
  await applyEffect(address, { xpBonus: rules.zorghonRescueXpReward ?? 2000 });
  await ensureAnonSignIn();
  await update(ref(db, path), { rescued: true, updatedAt: Date.now() });
  return 'rescued';
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
  // ─── Extensions (DLC) — voir ContentPackDef plus bas. undefined = jeu de base (toujours visible).
  contentPack?: string;
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
  // ─── Extensions (DLC) — voir ContentPackDef plus bas. undefined = jeu de base (toujours visible).
  contentPack?: string;
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
  // ─── Extensions (DLC) — voir ContentPackDef plus bas. undefined = jeu de base (toujours visible).
  contentPack?: string;
}

/**
 * Type de point d'intérêt (décor/terrain) affiché sur la mapmonde — voir MapPoiDef ci-dessous.
 * Volontairement large pour couvrir tous les éléments demandés (plaines, cours d'eau, reliefs,
 * villages amis/ennemis, structures de halte...) tout en restant simple à étendre depuis l'admin.
 */
export type MapPoiType =
  | 'plain' | 'stream' | 'lake' | 'mountain' | 'forest' | 'cave' | 'beach' | 'waterfall'
  | 'village_ally' | 'village_enemy' | 'path' | 'bridge' | 'tavern' | 'stable' | 'hut'
  // ─── Géographie étendue (altitude/profondeur/îles) — voir worldTerrain.ts::worldTileAt.
  // 'sea'/'ocean' génèrent de grandes étendues d'eau profonde en bordure de carte, 'pond' un petit
  // plan d'eau peu profond (étang), 'island' un îlot de terre entouré par la mer/l'océan alentour
  // (accès conditionné à la possession d'un Engin — voir ShopItem.category === 'vehicle').
  | 'sea' | 'ocean' | 'pond' | 'island';

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
  radius?: number;       // rayon d'influence (unités mapmonde, %) — remplace le rayon par défaut du
                         // type (voir POI_RADIUS_BY_TYPE dans worldTerrain.ts) quand renseigné, afin
                         // de permettre par exemple 3 îles d'un même archipel de tailles différentes
                         // (petite/moyenne/grande) ou des lacs/étangs/mers de gabarits variés sans
                         // changer WORLD_SIZE ni ajouter de nouveaux types. undefined = comportement
                         // historique inchangé (rayon uniforme par type — aucune régression).
  contentPack?: string;  // voir ContentPackDef ci-dessous — undefined = jeu de base (toujours visible).
}

export const DEFAULT_MAP_ID = 'map.synk_territory';

// ─── Extensions (DLC) — packs de contenu additionnel (voir demande utilisateur : « prévois cette
// évolution pour l'extensibilité du jeu (…) une nouvelle histoire, de nouvelles missions, quêtes,
// énigmes, boss (…) objets ou éléments cosmétiques (…) nouvelles terres, territoires, cartes,
// mondes ») ──────────────────────────────────────────────────────────────────────────────────
// Un `ContentPackDef` est un simple conteneur nommé/activable (façon "saison narrative"/DLC) : les
// quêtes (`QuestDef`), PNJ (`NpcDef`), décors de carte (`MapPoiDef`), mondes (`WorldDef`) et trésors
// (`TreasureDef`) peuvent référencer un pack via leur champ optionnel `contentPack`. TOUT contenu
// sans `contentPack` (les 400 Quêtes du Royaume, PNJ officiels, POI, mondes et trésors existants)
// reste `contentPack: undefined` ⇒ TOUJOURS visible, exactement comme avant : zéro régression. Un
// pack désactivé (`active: false`) masque instantanément tout le contenu qui lui est rattaché, dans
// getAllMapMarkers()/pickNpcQuestForPlayer()/computeKingdomProgress, sans supprimer aucune donnée
// (permet de préparer un DLC en coulisses puis de l'activer d'un coup en admin, ou de le retirer
// temporairement). Une seule instance de jeu couvre donc le jeu de base + un nombre illimité de
// packs additionnels, sans dupliquer de code ni de collection Firebase.
export interface ContentPackDef {
  id: string;            // ex. "dlc.saison2_ombres_renaissantes"
  name: string;
  i18nKey?: string;      // clé i18n (ex. "contentpack.saison2") — voir localizeName()
  description?: string;  // résumé narratif court affiché en admin (mono-langue, repli)
  active: boolean;       // false = masqué pour tous les joueurs, sans rien supprimer
  createdAt: number;
  order?: number;
}

/** Crée/modifie un pack de contenu (admin). Aucune transaction blockchain. */
export async function addContentPackDef(def: ContentPackDef): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `catalog/contentPacks/${RKEY(def.id)}`), def);
}

export async function removeContentPackDef(id: string): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `catalog/contentPacks/${RKEY(id)}`), null);
}

export async function getContentPackDefs(): Promise<ContentPackDef[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  const snap = await get(ref(db, 'catalog/contentPacks'));
  const v = snap.val() as Record<string, ContentPackDef> | null;
  return v ? sortDefsByOrder(Object.values(v)) : [];
}

/** true si ce contenu doit être visible/jouable : jeu de base (`contentPack` non renseigné) =
 * toujours oui ; sinon dépend du pack correspondant dans `packs` (actif par défaut si le pack a été
 * supprimé entre-temps — comportement permissif pour ne jamais faire disparaître du contenu par
 * accident lors d'une simple erreur de configuration). */
export function isContentPackVisible(contentPack: string | undefined, packs: ContentPackDef[]): boolean {
  if (!contentPack) return true;
  const pack = packs.find(p => p.id === contentPack);
  return pack ? pack.active !== false : true;
}

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

/** Catégorie d'un marqueur localisé sur la mapmonde/plateforme isométrique — voir MapMarker.
 * 'zorghon'/'captive' : marqueurs narratifs uniques (voir ZorghonEncounterState ci-dessous),
 * purement visuels (non "interactable" dans le sens PoiInteractionModal — voir onMarkerClick de
 * GameCanvas2D.tsx), fusionnés au rendu comme kingdomMarker (aucun ajout à getAllMapMarkers()). */
export type MapMarkerKind = 'poi' | 'world' | 'npc' | 'treasure' | 'familiar' | 'quest' | 'zorghon' | 'captive';

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
  radius?: number;       // rayon d'influence terrain (voir MapPoiDef.radius) — repris tel quel pour
                          // kind==='poi' afin que worldTileAt() applique le même gabarit personnalisé
                          // dans GameCanvas2D.tsx ET WorldMapWidget.tsx.
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

/** 10 grands lacs/étangs fixes, répartis sur toute la mapmonde (voir RepRules.defaultLakesEnabled)
 * — corrige la demande utilisateur "créer des bassins/lacs assez larges pour laisser Synk y nager,
 * en clairsemant la map d'une dizaine de grandes étendues d'eau". Positions choisies pour couvrir
 * les 4 quadrants + le centre de la carte 100x100, avec un rayon généreux (`radius`, voir
 * POI_RADIUS_BY_TYPE dans worldTerrain.ts) pour obtenir de vraies étendues nageables plutôt que de
 * petites flaques ambiantes. Purement additif (voir getAllMapMarkers ci-dessous) : fusionné aux
 * MapPoiDef saisis manuellement par l'admin, jamais à leur place — aucune régression sur le
 * territoire déjà configuré en base. */
export const DEFAULT_LAKE_POIS: { id: string; type: 'lake' | 'pond'; name: string; icon: string; x: number; y: number; radius: number }[] = [
  { id: 'default_lake_1', type: 'lake', name: 'Lac des Brumes', icon: '💧', x: 15, y: 20, radius: 14 },
  { id: 'default_lake_2', type: 'pond', name: 'Étang du Roseau', icon: '💧', x: 35, y: 15, radius: 8 },
  { id: 'default_lake_3', type: 'lake', name: 'Lac Argenté', icon: '💧', x: 62, y: 12, radius: 13 },
  { id: 'default_lake_4', type: 'pond', name: 'Étang des Grenouilles', icon: '💧', x: 85, y: 25, radius: 7 },
  { id: 'default_lake_5', type: 'lake', name: 'Lac Zéphyria', icon: '💧', x: 20, y: 45, radius: 16 },
  { id: 'default_lake_6', type: 'lake', name: 'Lac du Cœur', icon: '💧', x: 50, y: 50, radius: 12 },
  { id: 'default_lake_7', type: 'pond', name: 'Étang du Vieux Saule', icon: '💧', x: 78, y: 55, radius: 9 },
  { id: 'default_lake_8', type: 'lake', name: 'Lac Turquoise', icon: '💧', x: 12, y: 75, radius: 14 },
  { id: 'default_lake_9', type: 'pond', name: 'Étang des Nénuphars', icon: '💧', x: 45, y: 80, radius: 8 },
  { id: 'default_lake_10', type: 'lake', name: 'Lac Profond', icon: '💧', x: 72, y: 85, radius: 16 },
];

/** Construit la liste unifiée des marqueurs d'une carte (voir MapMarker). `season`/`unlockedWorlds`
 * sont facultatifs : sans eux, tous les éléments actifs sont renvoyés (repli permissif). */
export async function getAllMapMarkers(
  mapId: string = DEFAULT_MAP_ID, season?: Season | null,
): Promise<MapMarker[]> {
  const [pois, worlds, npcs, treasures, familiars, quests, packs, rules] = await Promise.all([
    getMapPoiDefs(mapId), getWorldDefs(), getNpcDefs(), getTreasureDefs(), getFamiliarDefs(), getQuestDefs(), getContentPackDefs(), getRepRules(),
  ]);
  const markers: MapMarker[] = [];
  for (const p of pois) {
    if (p.season && season !== undefined && p.season !== season) continue; // filtré finement par appelant si besoin (visité)
    if (!isContentPackVisible(p.contentPack, packs)) continue; // voir ContentPackDef (Extensions/DLC)
    markers.push({ id: p.id, kind: 'poi', name: p.name, icon: p.icon || '📍', x: p.x, y: p.y, poiType: p.type, radius: p.radius });
  }
  // Lacs/étangs par défaut (voir DEFAULT_LAKE_POIS ci-dessus) — uniquement pour `mapId ===
  // DEFAULT_MAP_ID` (territoire principal de Synk) et seulement si l'admin n'a pas déjà créé un
  // MapPoiDef portant le même id (permet de le personnaliser/remplacer sans doublon).
  if ((rules.defaultLakesEnabled ?? true) && mapId === DEFAULT_MAP_ID) {
    const existingIds = new Set(pois.map(p => p.id));
    for (const l of DEFAULT_LAKE_POIS) {
      if (existingIds.has(l.id)) continue;
      markers.push({ id: l.id, kind: 'poi', name: l.name, icon: l.icon, x: l.x, y: l.y, poiType: l.type, radius: l.radius });
    }
  }
  for (const w of worlds.filter(w2 => w2.active !== false && isContentPackVisible(w2.contentPack, packs))) {
    const x = w.mapX ?? 50, y = w.mapY ?? 50;
    markers.push({ id: w.id, kind: 'world', name: w.name, i18nKey: w.i18nKey, icon: '🌀', x, y });
  }
  for (const n of npcs.filter(n2 => n2.active && isContentPackVisible(n2.contentPack, packs))) {
    const fp = poiFallbackPos(n.id, 101);
    markers.push({ id: n.id, kind: 'npc', name: n.name, i18nKey: n.i18nKey, icon: '🧙', x: n.mapX ?? fp.x, y: n.mapY ?? fp.y });
  }
  for (const tr of treasures.filter(t2 => t2.active && isContentPackVisible(t2.contentPack, packs))) {
    const fp = poiFallbackPos(tr.id, 102);
    markers.push({ id: tr.id, kind: 'treasure', name: tr.name, i18nKey: tr.i18nKey, icon: '🎁', x: tr.mapX ?? fp.x, y: tr.mapY ?? fp.y });
  }
  for (const f of familiars) {
    const fp = poiFallbackPos(f.id, 103);
    markers.push({ id: f.id, kind: 'familiar', name: f.label, i18nKey: f.i18nKey, icon: '🐾', x: f.mapX ?? fp.x, y: f.mapY ?? fp.y });
  }
  for (const q of quests.filter(q2 => q2.active && q2.npcGiver && isContentPackVisible(q2.contentPack, packs))) {
    const fp = poiFallbackPos(q.id, 104);
    markers.push({ id: q.id, kind: 'quest', name: q.label, i18nKey: q.i18nKey, icon: '❓', x: q.mapX ?? fp.x, y: q.mapY ?? fp.y, questCategory: 'npc' });
  }
  // Quêtes CLASSIQUES (sans PNJ ni Royaume) : historiquement absentes de la carte (seules les
  // quêtes PNJ y apparaissaient) — ajoutées ici pour permettre le bouton "Quêtes classiques" (voir
  // demande utilisateur) de réellement filtrer quelque chose. Purement additif : ces marqueurs sont
  // nouveaux, aucune autre logique (npcGiver, déblocage) n'est modifiée. Icône dédiée (📜) pour les
  // distinguer visuellement des quêtes révélées par un PNJ (❓).
  for (const q of quests.filter(q2 => q2.active && !q2.npcGiver && !q2.kingdomQuest && isContentPackVisible(q2.contentPack, packs))) {
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
  /** "Filtre intelligent" par défaut (voir lib/mapFilters.ts::MapFilterState.declutter) — `false`
   * par défaut (comportement historique inchangé). */
  declutter: boolean;
  updatedAt: number;
}
export const DEFAULT_MAP_FILTER_DEFAULTS: MapFilterDefaults = {
  showPois: true, showWorlds: true, showNpcs: true, showTreasures: true, showFamiliars: true,
  showQuestsClassic: true, showQuestsNpc: true, showQuestsKingdom: true, kingdomFullMoonMode: 'all',
  declutter: false, updatedAt: 0,
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
  const cx = Math.max(0, Math.min(100, x));
  const cy = Math.max(0, Math.min(100, y));
  await set(ref(db, `players/${KEY(address)}/mapPos`), {
    mapId, x: cx, y: cy, updatedAt: Date.now(),
  });
  // Intelligence IA GamePlay — heatmap de fréquentation de la carte (Mapmonde + Plateforme 2D
  // isométrique partagent ce seul point d'écriture) : fire-and-forget, jamais bloquant.
  trackMapHeatmap(address, mapId, cx, cy).catch(() => {});
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
/** Objets protégés contre la perte aléatoire (évanouissement Oxygène/Fatigue, voir
 * removeRandomInventoryItem ci-dessous) — les reliques de quête (`relic_*`, voir
 * seedKingdomQuests.mjs) et le titre final ne sont jamais tirés au sort : ce sont des récompenses
 * uniques et non-refarmables (une quête ne peut être résolue qu'une fois), notamment utilisées
 * comme Fragments du Sceau Runique par la quête de convergence finale (voir QuestDef.requiresItems)
 * — les perdre accidentellement créerait un blocage définitif de progression.
 */
function isProtectedFromRandomLoss(itemId: string): boolean {
  return itemId.startsWith('relic_') || itemId === 'titre_liberateur_royaume';
}

export async function removeRandomInventoryItem(address: string): Promise<{ itemId: string; name: string } | null> {
  const items = (await getInventoryOnce(address)).filter(i => !isProtectedFromRandomLoss(i.itemId));
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

/**
 * Corrige l'incohérence saisonnière de la météo du smart contract (`currentWeather`, index WEATHER
 * 0-5 dans contract.ts) : la météo on-chain est purement aléatoire et peut donc afficher "Neigeux"
 * (index 5) en plein été, ce qui n'est pas cohérent. Cette fonction PURE (aucun accès réseau, aucune
 * écriture on-chain — la valeur brute stockée sur la chaîne n'est jamais modifiée) recalcule
 * uniquement l'index à AFFICHER (et à utiliser pour le calcul d'humeur, voir computeHappinessDelta)
 * en dehors de l'hiver : remplace "Neigeux" par une météo plausible pour la saison en cours, choisie
 * de façon déterministe (aucun flicker aléatoire à chaque re-render) à partir du jour de l'année.
 * En hiver, l'index brut est toujours restitué tel quel (la neige y est toujours cohérente).
 * L'exception "neige de haute montagne" (>2000m, voir RepRules.mountainSnowAltitudeM et
 * worldTerrain.ts::Tile.altitudeM) est gérée séparément par GameCanvas2D (décor de dalle, pas la
 * météo globale) et n'a donc pas besoin d'intervenir ici. */
export function seasonalWeatherIndex(rawIdx: number, season: Season, date: Date = new Date()): number {
  const SNOWY_IDX = 5;
  if (rawIdx !== SNOWY_IDX || season === 'winter') return rawIdx;
  const dayOfYear = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86_400_000);
  const pick = (options: number[]) => options[dayOfYear % options.length];
  if (season === 'summer') return pick([0, 0, 3]); // majoritairement ensoleillé, parfois orageux
  return pick([1, 2, 2]); // printemps/automne : majoritairement pluvieux/nuageux
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

/** Entrée légère pour le menu déroulant "Statistiques par joueur" (menu Administration) — voir
 * `listPlayersWithMeta()` ci-dessous. `label` affiche l'e-mail (comptes Démo/fiat Google/e-mail)
 * ou le pseudo, avec repli sur l'adresse tronquée pour un compte portefeuille classique. */
export interface PlayerListEntry {
  address: string;
  label: string;
  accountType?: 'wallet' | 'demo' | 'fiat';
  email?: string;
  lang?: 'fr' | 'en' | 'es' | 'pt';
  authMethod?: 'google' | 'email';
  uid?: string;
}

/** Liste tous les joueurs enregistrés avec leurs métadonnées d'affichage (e-mail/pseudo/mode
 * d'accès) — une seule lecture de tout le nœud `players` (pas un aller-retour par joueur), pour le
 * menu déroulant de "📊 Statistiques par joueur" (voir PlayerStats.tsx). Complète `listPlayers()`
 * ci-dessus (conservée telle quelle pour les usages existants qui n'ont besoin que des adresses). */
export async function listPlayersWithMeta(): Promise<PlayerListEntry[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  await ensureAnonSignIn();
  const snap = await get(ref(db, 'players'));
  const v = snap.val() as Record<string, PlayerState> | null;
  if (!v) return [];
  return Object.entries(v)
    .map(([addr, p]) => ({
      address: addr,
      accountType: p?.accountType,
      email: p?.email,
      lang: p?.lang,
      authMethod: p?.authMethod,
      uid: p?.uid,
      label: p?.email || p?.displayName || `${addr.slice(0, 10)}…${addr.slice(-6)}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Écoute en temps réel la liste des joueurs (panneau "📊 Statistiques par joueur", menu
 * Administration) — remplace l'ancien chargement ponctuel `listPlayersWithMeta()` + rappel manuel
 * après chaque suppression : toute suppression/création (y compris depuis un AUTRE onglet/admin,
 * ou déclenchée par un autre panneau comme les anciens boutons de "Demandes d'accès Démo") est
 * désormais reflétée immédiatement, sans avoir à recharger la page (bug corrigé). */
export function subscribePlayersWithMeta(cb: (list: PlayerListEntry[]) => void): () => void {
  const db = getFirebaseDb();
  if (!db) { cb([]); return () => {}; }
  const r = ref(db, 'players');
  const handler = (snap: DataSnapshot) => {
    const v = snap.val() as Record<string, PlayerState> | null;
    if (!v) { cb([]); return; }
    const list = Object.entries(v)
      .map(([addr, p]) => ({
        address: addr,
        accountType: p?.accountType,
        email: p?.email,
        lang: p?.lang,
        authMethod: p?.authMethod,
        uid: p?.uid,
        label: p?.email || p?.displayName || `${addr.slice(0, 10)}…${addr.slice(-6)}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    cb(list);
  };
  onValue(r, handler);
  return () => off(r, 'value', handler);
}

/**
 * Supprime définitivement un joueur : son PlayerState (`players/{addr}`, y compris tout ce qui y
 * est imbriqué — inventaire, équipement, transactions, rencontres…), son entrée d'index
 * (`playerIndex/{addr}`) et, pour un compte Démo/fiat (voir PlayerState.uid), son entrée de
 * registre (`demoAccessRequests/{uid}`) et sa session active éventuelle (`demoSessions/demo|anon/
 * {uid}`) — ce qui libère immédiatement un emplacement de connexion concurrente (menu
 * Administration §"Statistiques par joueur" / §"Demandes d'accès Démo"). Un compte 'wallet' n'a pas
 * d'UID Firebase : seules les deux premières suppressions s'appliquent alors.
 *
 * ⚠️ Garde-fou : une adresse vide/invalide ne doit JAMAIS être transmise à `remove()`, sous peine
 * de résoudre le chemin `players/${''}` = `players/` = la racine du nœud `players` tout entier et
 * donc de supprimer TOUS les joueurs d'un coup (bug de suppression en masse constaté et corrigé) —
 * on vérifie ici explicitement le format d'adresse EVM avant toute écriture destructrice. */
export async function deletePlayerAccount(address: string): Promise<void> {
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error(`deletePlayerAccount: adresse invalide, refus par sécurité (${address})`);
  }
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  const k = KEY(address);
  const snap = await get(ref(db, `players/${k}`));
  const p = snap.val() as PlayerState | null;
  const ops = [remove(ref(db, `players/${k}`)), remove(ref(db, `playerIndex/${k}`))];
  if (p?.uid) {
    const ru = RKEY(p.uid);
    ops.push(remove(ref(db, `demoAccessRequests/${ru}`)));
    ops.push(remove(ref(db, `demoSessions/demo/${ru}`)));
    ops.push(remove(ref(db, `demoSessions/anon/${ru}`)));
  }
  await Promise.all(ops);
  // ⚠️ Bug corrigé : la suppression de l'annonce ciblée (`announcements/targeted/{addr}`, un
  // simple ménage cosmétique) était auparavant incluse dans le MÊME `Promise.all()` que les
  // suppressions CRITIQUES ci-dessus. Si ce chemin n'était pas (encore) couvert par les règles de
  // sécurité RTDB publiées (PERMISSION_DENIED), tout le `Promise.all()` échouait et l'admin voyait
  // un message d'erreur — alors même que players/{addr} et playerIndex/{addr} avaient déjà été
  // supprimés avec succès juste avant (chaque `remove()` envoie sa requête indépendamment, un rejet
  // de Promise.all n'annule pas les écritures déjà parties). Isolée ici en "best effort" : une
  // éventuelle erreur sur ce nettoyage cosmétique ne doit plus jamais faire échouer la suppression
  // du joueur ni afficher une fausse erreur à l'admin (voir docs/FIREBASE_CHAT.md pour la règle
  // manquante, désormais ajoutée).
  await remove(ref(db, `announcements/targeted/${k}`)).catch((e) => {
    console.warn('[deletePlayerAccount] nettoyage announcements/targeted ignoré (non bloquant):', e);
  });
}


/** Réinitialise TOUT le jeu à zéro : supprime la totalité des joueurs, de l'index, du registre
 * d'accès Démo/fiat et des sessions actives. Action destructive et irréversible, réservée au menu
 * Administration §"Statistiques par joueur" (double confirmation côté UI — voir PlayerStats.tsx). */
export async function deleteAllPlayers(): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await Promise.all([
    remove(ref(db, 'players')),
    remove(ref(db, 'playerIndex')),
    remove(ref(db, 'demoAccessRequests')),
    remove(ref(db, 'demoSessions')),
  ]);
  // Même logique "best effort" que deletePlayerAccount() ci-dessus : le nettoyage des annonces ne
  // doit jamais faire échouer la réinitialisation totale, ni afficher une fausse erreur à l'admin.
  await remove(ref(db, 'announcements')).catch((e) => {
    console.warn('[deleteAllPlayers] nettoyage announcements ignoré (non bloquant):', e);
  });
}

/**
 * Supprime un LOT ciblé de joueurs (par ex. tous les comptes "Accès Démo", tous les comptes de test
 * "playwright"/"dbg-move" créés par les campagnes de vérification automatisée, ou tous les comptes
 * "Jouer sans portefeuille") sans toucher aux autres — contrairement à `deleteAllPlayers()` qui
 * vide TOUT le jeu. Réutilise le même garde-fou de format d'adresse et le même nettoyage
 * (playerIndex, registre Démo/fiat, sessions actives, annonce ciblée) que `deletePlayerAccount()`,
 * mais en un seul aller-retour Firebase par lot (`Promise.all`) plutôt qu'un appel séquentiel par
 * adresse. La sélection des joueurs à inclure (catégorie) est calculée côté appelant (voir
 * PlayerStats.tsx § "Suppression ciblée par catégorie") à partir de `PlayerListEntry` déjà chargé en
 * mémoire (aucune lecture Firebase supplémentaire nécessaire). */
export async function deletePlayersBulk(entries: { address: string; uid?: string }[]): Promise<void> {
  const db = getFirebaseDb();
  if (!db || entries.length === 0) return;
  await ensureAnonSignIn();
  const ops: Promise<unknown>[] = [];
  for (const { address, uid } of entries) {
    // Même garde-fou que deletePlayerAccount() : une adresse vide/invalide résoudrait le chemin
    // `players/` (racine du nœud) et supprimerait TOUS les joueurs au lieu du lot ciblé.
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) continue;
    const k = KEY(address);
    ops.push(remove(ref(db, `players/${k}`)));
    ops.push(remove(ref(db, `playerIndex/${k}`)));
    if (uid) {
      const ru = RKEY(uid);
      ops.push(remove(ref(db, `demoAccessRequests/${ru}`)));
      ops.push(remove(ref(db, `demoSessions/demo/${ru}`)));
      ops.push(remove(ref(db, `demoSessions/anon/${ru}`)));
    }
    ops.push(remove(ref(db, `announcements/targeted/${k}`)).catch((e) => {
      console.warn('[deletePlayersBulk] nettoyage announcements/targeted ignoré (non bloquant):', e);
    }));
  }
  await Promise.all(ops);
}

// ────────────────────────────── Annonces en jeu (bandeau live admin) ──────────────────────────────
// Bandeau clignotant affiché en haut de l'écran de jeu (AnnouncementBanner.tsx, monté dans
// game/page.tsx) — voir Administration → "Statistiques par joueur" § "Annonce en direct". Deux
// portées indépendantes :
//  - `announcements/global` : diffusée à TOUS les joueurs actuellement connectés (ex : maintenance
//    programmée, nouvelle fonctionnalité).
//  - `announcements/targeted/{addr}` : visible UNIQUEMENT par ce joueur (ex : message personnel).
// Un joueur voit les DEUX s'il y en a (la ciblée d'abord, puis la globale) — voir
// subscribeAnnouncements() ci-dessous. Écriture temps réel (onValue) : le joueur voit le message
// apparaître SANS recharger la page, y compris en pleine partie.
export interface Announcement {
  message: string;
  imageUrl?: string;
  createdAt: number;
}

export async function setGlobalAnnouncement(message: string, imageUrl?: string): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, 'announcements/global'), { message, ...(imageUrl ? { imageUrl } : {}), createdAt: Date.now() });
}

export async function clearGlobalAnnouncement(): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await remove(ref(db, 'announcements/global'));
}

export async function setPlayerAnnouncement(address: string, message: string, imageUrl?: string): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `announcements/targeted/${KEY(address)}`), { message, ...(imageUrl ? { imageUrl } : {}), createdAt: Date.now() });
}

export async function clearPlayerAnnouncement(address: string): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await remove(ref(db, `announcements/targeted/${KEY(address)}`));
}

/** Écoute temps réel des annonces visibles par un joueur (globale + ciblée sur son adresse) —
 * utilisé par AnnouncementBanner.tsx. Le callback est invoqué avec un tableau (0, 1 ou 2 entrées,
 * ciblée en premier) à chaque changement de l'une ou l'autre. Retourne la fonction unsubscribe. */
export function subscribeAnnouncements(address: string | null, cb: (list: Announcement[]) => void): () => void {
  const db = getFirebaseDb();
  if (!db) { cb([]); return () => {}; }
  let latestGlobal: Announcement | null = null;
  let latestTargeted: Announcement | null = null;
  const emit = () => cb([...(latestTargeted ? [latestTargeted] : []), ...(latestGlobal ? [latestGlobal] : [])]);
  const gRef = ref(db, 'announcements/global');
  const gHandler = (snap: DataSnapshot) => { latestGlobal = snap.exists() ? (snap.val() as Announcement) : null; emit(); };
  onValue(gRef, gHandler);
  let tRef: ReturnType<typeof ref> | null = null;
  let tHandler: ((snap: DataSnapshot) => void) | null = null;
  if (address) {
    tRef = ref(db, `announcements/targeted/${KEY(address)}`);
    tHandler = (snap: DataSnapshot) => { latestTargeted = snap.exists() ? (snap.val() as Announcement) : null; emit(); };
    onValue(tRef, tHandler);
  }
  return () => {
    off(gRef, 'value', gHandler);
    if (tRef && tHandler) off(tRef, 'value', tHandler);
  };
}

/** Enregistre la programmation d'un envoi automatique de rapport par e-mail pour un joueur (voir
 * PlayerState.scheduledReport, PlayerStats.tsx, api/email/cron-reports/route.ts). `cfg === null`
 * désactive/supprime la programmation. */
export async function setPlayerScheduledReport(
  address: string,
  cfg: {
    enabled: boolean; startDate: number; cycle: 'daily' | 'weekly' | 'monthly' | 'yearly';
    weeklyDays?: number[]; monthlyDay?: number; customMessage?: string; imageUrl?: string;
  } | null,
): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  const path = `players/${KEY(address)}/scheduledReport`;
  if (!cfg) { await remove(ref(db, path)); return; }
  await set(ref(db, path), {
    enabled: cfg.enabled, startDate: cfg.startDate, cycle: cfg.cycle,
    ...(cfg.weeklyDays ? { weeklyDays: cfg.weeklyDays } : {}),
    ...(cfg.monthlyDay ? { monthlyDay: cfg.monthlyDay } : {}),
    ...(cfg.customMessage ? { customMessage: cfg.customMessage } : {}),
    ...(cfg.imageUrl ? { imageUrl: cfg.imageUrl } : {}),
  });
}

/** Incrémente `PlayerState.passwordResetCount` et met à jour `lastPasswordResetAt` — appelée après
 * CHAQUE changement de mot de passe réussi d'un compte "Jouer sans portefeuille" par e-mail/mot de
 * passe, que ce soit un reset forcé par l'admin (menu Administration §"Statistiques par joueur",
 * zone de danger) ou un changement volontaire du joueur en jeu (voir EffectiveAccountBadge.tsx,
 * docs/EMAIL_NOTIFICATIONS.md § Réinitialisation de mot de passe). Écriture via le SDK client
 * Firebase (comme le reste des mutations admin de ce fichier) : ne nécessite aucun secret serveur,
 * contrairement au changement du mot de passe Firebase Auth lui-même (voir
 * lib/firebaseAdmin.ts::adminSetUserPassword, réservé au reset forcé par l'admin). */
export async function incrementPasswordResetCount(address: string): Promise<number> {
  const db = getFirebaseDb();
  if (!db) return 0;
  await ensureAnonSignIn();
  const k = KEY(address);
  const snap = await get(ref(db, `players/${k}/passwordResetCount`));
  const next = (snap.val() as number | null ?? 0) + 1;
  await set(ref(db, `players/${k}/passwordResetCount`), next);
  await set(ref(db, `players/${k}/lastPasswordResetAt`), Date.now());
  return next;
}

/** Enregistre le résultat du dernier envoi de l'e-mail de bienvenue (voir
 * NoWalletAccessPanel.tsx::startFiatEmailCreate) — permet à l'admin de voir dans "Statistiques par
 * joueur" si l'envoi a réussi ou échoué (et pourquoi), au lieu d'un échec auparavant totalement
 * silencieux (`.catch(() => {})`, bug corrigé). Écriture best-effort : ne doit jamais faire
 * échouer la création de compte elle-même si elle échoue à son tour. */
export async function setPlayerWelcomeEmailStatus(
  address: string, status: 'sent' | 'failed', error?: string,
): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  const k = KEY(address);
  await update(ref(db, `players/${k}`), {
    welcomeEmailStatus: status,
    welcomeEmailSentAt: Date.now(),
    ...(status === 'failed' && error ? { welcomeEmailError: error.slice(0, 300) } : {}),
    ...(status === 'sent' ? { welcomeEmailError: null } : {}),
  });
}



/** Butin possible lors d'une victoire de combat PNJ (récupéré sur le PNJ vaincu) — voir
 * NpcEncounterPopup.tsx. Reçoit les mêmes champs d'équipement (slot/rarité/dégâts ou défense/
 * durabilité) que les objets de boutique. Exporté depuis gameState.ts (plutôt que déclaré en local
 * dans le composant) afin que getPlayerProgressLedger() ci-dessous connaisse ces 3 itemIds
 * "hors-catalogue-boutique" et les affiche correctement dans le widget "État d'avancement /
 * inventaire" — sans quoi un butin de combat resterait invisible dans ce widget bien que possédé
 * (bug signalé : mêmes symptômes que les objets de coffre au trésor, voir itemReward plus bas). */
export const NPC_FIGHT_LOOT_TABLE: { itemId: string; name: string; category: InventoryItem['category']; slot?: EquipSlot; rarity?: ItemRarity; damage?: number; defense?: number; durabilityMax?: number; effect: InventoryItem['effect'] }[] = [
  { itemId: 'dague_rouillee', name: '🗡️ Dague rouillée',         category: 'weapon', slot: 'weapon', rarity: 'common', damage: 8, durabilityMax: 12, effect: { force: 5 } },
  { itemId: 'bourse_pnj',     name: '💰 Bourse trouvée',          category: 'treasure', effect: {} },
  { itemId: 'amulette_prot',  name: '📿 Amulette de protection',  category: 'armor', slot: 'amulet', rarity: 'common', defense: 6, durabilityMax: 15, effect: { hp: 10 } },
];

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
  // ─── Engins nautiques/aériens supplémentaires (gate d'accès aux ÎLES — voir RepRules::
  // islandVehicleRequired et worldTerrain.ts::Tile.isIsland) — s'inspirent du Seigneur des Anneaux,
  // de World Of Warcraft, de Zelda et de Minecraft.
  { itemId: 'radeau_fortune', name: '🪵 Radeau de fortune',         category: 'vehicle', slot: 'vehicle', priceGame: 300,  effect: {}, active: true },
  { itemId: 'kayak',          name: '🛶 Kayak agile',               category: 'vehicle', slot: 'vehicle', priceGame: 450,  effect: {}, active: true },
  { itemId: 'canoe',          name: '🛶 Canoë des brumes',          category: 'vehicle', slot: 'vehicle', priceGame: 450,  effect: {}, active: true },
  { itemId: 'bateau_pecheur', name: '⛵ Bateau de pêcheur',         category: 'vehicle', slot: 'vehicle', priceGame: 900,  effect: {}, active: true },
  { itemId: 'galion',         name: '🚢 Galion des mers profondes', category: 'vehicle', slot: 'vehicle', priceGame: 2500, effect: {}, active: true },
  { itemId: 'galere',         name: '🚣 Galère des anciens rois',   category: 'vehicle', slot: 'vehicle', priceGame: 2200, effect: {}, active: true },
  { itemId: 'cerf_volant',    name: '🪁 Cerf-volant enchanté',      category: 'vehicle', slot: 'vehicle', priceGame: 600,  effect: {}, active: true },
  { itemId: 'engin_volant',   name: '🛸 Engin volant runique',      category: 'vehicle', slot: 'vehicle', priceGame: 3000, effect: {}, active: true },
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
  // ── 60 nouvelles armes (demande utilisateur) — inspirées du Seigneur des Anneaux/Tolkien, World
  // of Warcraft, Zelda et Minecraft (voir aussi seedEquipmentCatalog.mjs, même liste exacte).
  { itemId: 'epee_paysanne', name: '🗡️ Épée paysanne', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 10, durabilityMax: 28, priceGame: 220000, effect: {}, active: true },
  { itemId: 'hachette_bucheron', name: '🪓 Hachette de bûcheron', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 11, durabilityMax: 26, priceGame: 200000, effect: {}, active: true },
  { itemId: 'faux_moisson', name: '🌾 Faux du moissonneur', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 13, durabilityMax: 24, priceGame: 200000, effect: {}, active: true },
  { itemId: 'fourche_ferme', name: '🍴 Fourche de ferme', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 9, durabilityMax: 26, priceGame: 190000, effect: {}, active: true },
  { itemId: 'baton_pelerin', name: '🥢 Bâton du pèlerin', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 8, durabilityMax: 28, priceGame: 180000, effect: {}, active: true },
  { itemId: 'epee_garde_village', name: '🗡️ Épée de la garde du village', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 14, durabilityMax: 24, priceGame: 210000, effect: {}, active: true },
  { itemId: 'hache_bucheron_naine', name: '🪓 Hache de bûcheron naine', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 16, durabilityMax: 22, priceGame: 220000, effect: {}, active: true },
  { itemId: 'dague_voleur', name: '🔪 Dague de voleur', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 12, durabilityMax: 26, priceGame: 200000, effect: {}, active: true },
  { itemId: 'marteau_forgeron', name: '🔨 Marteau de forgeron', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 15, durabilityMax: 24, priceGame: 210000, effect: {}, active: true },
  { itemId: 'lance_milicien', name: '🛡️ Lance de milicien', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 17, durabilityMax: 22, priceGame: 215000, effect: {}, active: true },
  { itemId: 'arc_court_hobbit', name: '🏹 Arc court de Hobbit', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 5, durabilityMax: 28, requiresArrow: true, priceGame: 200000, effect: {}, active: true },
  { itemId: 'fronde_gobelin', name: '🪨 Fronde de gobelin', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 6, durabilityMax: 30, priceGame: 180000, effect: {}, active: true },
  { itemId: 'epee_courte_naine', name: '⚔️ Épée courte naine', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 18, durabilityMax: 22, priceGame: 225000, effect: {}, active: true },
  { itemId: 'hallebarde_garde', name: '🗡️ Hallebarde de la garde royale', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 19, durabilityMax: 20, priceGame: 230000, effect: {}, active: true },
  { itemId: 'epee_diamant_minecraft', name: '💎 Épée en diamant', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 20, durabilityMax: 24, priceGame: 230000, effect: {}, active: true },
  { itemId: 'hache_diamant_minecraft', name: '💎 Hache en diamant', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 22, durabilityMax: 22, priceGame: 235000, effect: {}, active: true },
  { itemId: 'epee_fer_minecraft', name: '⛏️ Épée en fer', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 16, durabilityMax: 24, priceGame: 210000, effect: {}, active: true },
  { itemId: 'arc_enchante_minecraft', name: '🏹 Arc enchanté', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 8, durabilityMax: 26, requiresArrow: true, priceGame: 220000, effect: {}, active: true },
  { itemId: 'arbalete_chasseur', name: '🏹 Arbalète du chasseur', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 9, durabilityMax: 24, requiresArrow: true, priceGame: 210000, effect: {}, active: true },
  { itemId: 'gourdin_troll', name: '🪵 Gourdin de troll des cavernes', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 20, durabilityMax: 26, priceGame: 220000, effect: {}, active: true },
  { itemId: 'dague_ombre', name: '🗡️ Dague de l\'ombre', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 14, durabilityMax: 24, priceGame: 205000, effect: {}, active: true },
  { itemId: 'epee_ecuyer', name: '🗡️ Épée d\'écuyer', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 12, durabilityMax: 26, priceGame: 195000, effect: {}, active: true },
  { itemId: 'lance_cavalier_leger', name: '🐎 Lance de cavalier léger', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 17, durabilityMax: 22, priceGame: 215000, effect: {}, active: true },
  { itemId: 'masse_pierre', name: '🪨 Masse de pierre runique', category: 'weapon', slot: 'weapon', rarity: 'common', damage: 15, durabilityMax: 24, priceGame: 205000, effect: {}, active: true },
  { itemId: 'glamdring_replique', name: '⚔️ Réplique de Frappe-Gnome', category: 'weapon', slot: 'weapon', rarity: 'rare', damage: 38, durabilityMax: 18, priceGame: 400000, effect: {}, active: true },
  { itemId: 'orcrist_replique', name: '⚔️ Réplique de Morsure-Gobelin', category: 'weapon', slot: 'weapon', rarity: 'rare', damage: 40, durabilityMax: 18, priceGame: 410000, effect: {}, active: true },
  { itemId: 'herugrim_replique', name: '⚔️ Réplique de l\'épée du Roi-Cavalier', category: 'weapon', slot: 'weapon', rarity: 'rare', damage: 36, durabilityMax: 18, priceGame: 390000, effect: {}, active: true },
  { itemId: 'guthwine_replique', name: '⚔️ Réplique de la Lame du Neveu', category: 'weapon', slot: 'weapon', rarity: 'rare', damage: 34, durabilityMax: 19, priceGame: 380000, effect: {}, active: true },
  { itemId: 'hache_durin', name: '🪓 Hache de Durin', category: 'weapon', slot: 'weapon', rarity: 'rare', damage: 42, durabilityMax: 17, priceGame: 420000, effect: {}, active: true },
  { itemId: 'lance_intendant_gondor', name: '🗡️ Lance de l\'Intendant de Gondor', category: 'weapon', slot: 'weapon', rarity: 'rare', damage: 35, durabilityMax: 18, priceGame: 390000, effect: {}, active: true },
  { itemId: 'marteau_destin_orque', name: '⚒️ Marteau du Destin orque', category: 'weapon', slot: 'weapon', rarity: 'rare', damage: 44, durabilityMax: 16, priceGame: 430000, effect: {}, active: true },
  { itemId: 'lame_givre_maudite', name: '❄️ Lame gelée maudite', category: 'weapon', slot: 'weapon', rarity: 'rare', damage: 40, durabilityMax: 17, priceGame: 410000, effect: {}, active: true },
  { itemId: 'hache_bataille_horde', name: '🪓 Hache de bataille de la Horde', category: 'weapon', slot: 'weapon', rarity: 'rare', damage: 39, durabilityMax: 18, priceGame: 400000, effect: {}, active: true },
  { itemId: 'epee_geant_montagnes', name: '⚔️ Épée du Géant des Montagnes', category: 'weapon', slot: 'weapon', rarity: 'rare', damage: 45, durabilityMax: 16, priceGame: 440000, effect: {}, active: true },
  { itemId: 'marteau_megatonique', name: '🔨 Marteau mégatonique', category: 'weapon', slot: 'weapon', rarity: 'rare', damage: 43, durabilityMax: 16, priceGame: 420000, effect: {}, active: true },
  { itemId: 'baton_feu_ancien', name: '🔥 Bâton de feu ancien', category: 'weapon', slot: 'weapon', rarity: 'rare', damage: 30, durabilityMax: 20, priceGame: 370000, effect: {}, active: true },
  { itemId: 'baton_glace_ancien', name: '❄️ Bâton de glace ancien', category: 'weapon', slot: 'weapon', rarity: 'rare', damage: 30, durabilityMax: 20, priceGame: 370000, effect: {}, active: true },
  { itemId: 'trident_profondeurs', name: '🔱 Trident des profondeurs', category: 'weapon', slot: 'weapon', rarity: 'rare', damage: 37, durabilityMax: 18, priceGame: 400000, effect: {}, active: true },
  { itemId: 'arbalete_lourde_naine', name: '🏹 Arbalète lourde naine', category: 'weapon', slot: 'weapon', rarity: 'rare', damage: 14, durabilityMax: 20, requiresArrow: true, priceGame: 380000, effect: {}, active: true },
  { itemId: 'arc_sylvain_elfe', name: '🏹 Arc sylvain elfique', category: 'weapon', slot: 'weapon', rarity: 'rare', damage: 13, durabilityMax: 22, requiresArrow: true, priceGame: 390000, effect: {}, active: true },
  { itemId: 'hache_netherite', name: '🟫 Hache en Netherite', category: 'weapon', slot: 'weapon', rarity: 'rare', damage: 41, durabilityMax: 17, priceGame: 420000, effect: {}, active: true },
  { itemId: 'epee_netherite', name: '🟫 Épée en Netherite', category: 'weapon', slot: 'weapon', rarity: 'rare', damage: 40, durabilityMax: 17, priceGame: 415000, effect: {}, active: true },
  { itemId: 'porte_cendres', name: '✨ Porte-Cendres, la lame sacrée', category: 'weapon', slot: 'weapon', rarity: 'legendary', damage: 58, durabilityMax: 14, priceGame: 780000, effect: {}, active: true },
  { itemId: 'fureur_tonnerre', name: '⚡ Fureur du Tonnerre', category: 'weapon', slot: 'weapon', rarity: 'legendary', damage: 60, durabilityMax: 13, priceGame: 800000, effect: {}, active: true },
  { itemId: 'epee_ceremonial_gondor', name: '👑 Épée cérémoniale de Gondor', category: 'weapon', slot: 'weapon', rarity: 'legendary', damage: 52, durabilityMax: 15, priceGame: 700000, effect: {}, active: true },
  { itemId: 'hache_bataille_naine_royale', name: '🪓 Hache de bataille naine royale', category: 'weapon', slot: 'weapon', rarity: 'legendary', damage: 55, durabilityMax: 15, priceGame: 720000, effect: {}, active: true },
  { itemId: 'arc_dame_bois_dore', name: '🏹 Arc de la Dame du Bois Doré', category: 'weapon', slot: 'weapon', rarity: 'legendary', damage: 22, durabilityMax: 18, requiresArrow: true, priceGame: 750000, effect: {}, active: true },
  { itemId: 'lame_celeste', name: '🗡️ Lame céleste scellée', category: 'weapon', slot: 'weapon', rarity: 'legendary', damage: 62, durabilityMax: 13, priceGame: 800000, effect: {}, active: true },
  { itemId: 'marteau_forge_montagne', name: '⚒️ Marteau de la Forge de la Montagne', category: 'weapon', slot: 'weapon', rarity: 'legendary', damage: 57, durabilityMax: 14, priceGame: 760000, effect: {}, active: true },
  { itemId: 'trident_roi_mer', name: '🔱 Trident du Roi des Mers', category: 'weapon', slot: 'weapon', rarity: 'legendary', damage: 56, durabilityMax: 14, priceGame: 750000, effect: {}, active: true },
  { itemId: 'baton_archimage', name: '🔮 Bâton de l\'archimage', category: 'weapon', slot: 'weapon', rarity: 'legendary', damage: 48, durabilityMax: 16, priceGame: 700000, effect: {}, active: true },
  { itemId: 'faux_faucheur_ames', name: '💀 Faux du faucheur d\'âmes', category: 'weapon', slot: 'weapon', rarity: 'legendary', damage: 60, durabilityMax: 13, priceGame: 790000, effect: {}, active: true },
  { itemId: 'dague_reine_ombres', name: '🗡️ Dague de la Reine des Ombres', category: 'weapon', slot: 'weapon', rarity: 'legendary', damage: 50, durabilityMax: 15, priceGame: 700000, effect: {}, active: true },
  { itemId: 'arc_vent_eternel', name: '🏹 Arc du Vent Éternel', category: 'weapon', slot: 'weapon', rarity: 'legendary', damage: 24, durabilityMax: 17, requiresArrow: true, priceGame: 780000, effect: {}, active: true },
  { itemId: 'deuil_ombres', name: '🖤 Deuil des Ombres, lame maudite', category: 'weapon', slot: 'weapon', rarity: 'epic', damage: 95, durabilityMax: 10, priceGame: 1700000, effect: {}, active: true },
  { itemId: 'sulfuron_marteau_flammes', name: '🔥 Marteau de Sulfuron', category: 'weapon', slot: 'weapon', rarity: 'epic', damage: 92, durabilityMax: 10, priceGame: 1650000, effect: {}, active: true },
  { itemId: 'epee_maitre_temps', name: '⏳ Épée du Maître du Temps', category: 'weapon', slot: 'weapon', rarity: 'epic', damage: 88, durabilityMax: 11, priceGame: 1600000, effect: {}, active: true },
  { itemId: 'hache_titan_dechu', name: '🪓 Hache du Titan déchu', category: 'weapon', slot: 'weapon', rarity: 'epic', damage: 90, durabilityMax: 10, priceGame: 1650000, effect: {}, active: true },
  { itemId: 'lame_hylienne_eternelle', name: '✨ Lame Hylienne Éternelle', category: 'weapon', slot: 'weapon', rarity: 'epic', damage: 85, durabilityMax: 12, priceGame: 1550000, effect: {}, active: true },
  { itemId: 'trident_empereur_abysses', name: '🔱 Trident de l\'Empereur des Abysses', category: 'weapon', slot: 'weapon', rarity: 'epic', damage: 93, durabilityMax: 10, priceGame: 1700000, effect: {}, active: true },
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
  // ── 60 nouvelles protections/vêtements (casques, bandanas, bonnets, casquettes, guêtres, habits,
  // gilets, pantalons/shorts/pantalons été/cuir/hiver, gants, chaussures/bottes) inspirées du
  // Seigneur des Anneaux/Tolkien, World of Warcraft, Zelda et Minecraft — voir demande utilisateur.
  // Toutes paramétrables/modifiables dans "Catalogue Équipement (armes & protections)" du menu
  // Administration (EquipmentAdminPanel.tsx, générique par EQUIP_SLOTS — aucune modif nécessaire
  // là-bas). `hands` est un nouveau slot (gants), voir EquipSlot ci-dessus.
  // ── Casques additionnels (slot 'head')
  { itemId: 'casque_acier',      name: '⛑️ Casque d\'acier trempé',        category: 'armor', slot: 'head', rarity: 'common',    defense: 10, durabilityMax: 22, priceGame: 210000,  effect: {}, active: true },
  { itemId: 'casque_orque',      name: '👹 Heaume orque de guerre',        category: 'armor', slot: 'head', rarity: 'rare',      defense: 16, durabilityMax: 18, priceGame: 390000,  effect: {}, active: true },
  { itemId: 'casque_elfique',    name: '🍃 Heaume elfique du Crépuscule',  category: 'armor', slot: 'head', rarity: 'epic',      defense: 22, durabilityMax: 15, priceGame: 820000,  effect: {}, active: true },
  { itemId: 'casque_nain',       name: '⚒️ Heaume nain des Forges Profondes', category: 'armor', slot: 'head', rarity: 'legendary', defense: 28, durabilityMax: 12, priceGame: 950000, effect: {}, active: true },
  // ── Bandanas (slot 'head')
  { itemId: 'bandana_voyageur',  name: '🧣 Bandana du voyageur',           category: 'armor', slot: 'head', rarity: 'common',    defense: 3,  durabilityMax: 25, priceGame: 60000,   effect: {}, active: true },
  { itemId: 'bandana_pirate',    name: '🏴\u200d☠️ Bandana du corsaire des mers', category: 'armor', slot: 'head', rarity: 'rare',   defense: 6,  durabilityMax: 20, priceGame: 150000,  effect: {}, active: true },
  { itemId: 'bandana_ranger',    name: '🍃 Bandana du Rôdeur des Bois',    category: 'armor', slot: 'head', rarity: 'epic',      defense: 9,  durabilityMax: 16, priceGame: 320000,  effect: {}, active: true },
  { itemId: 'bandana_dragon',    name: '🐉 Bandana écarlate du Dragon',    category: 'armor', slot: 'head', rarity: 'legendary', defense: 12, durabilityMax: 12, priceGame: 500000,  effect: {}, active: true },
  // ── Bonnets (slot 'head')
  { itemId: 'bonnet_hobbit',     name: '🎩 Bonnet de Hobbit douillet',     category: 'armor', slot: 'head', rarity: 'common',    defense: 4,  durabilityMax: 24, priceGame: 70000,   effect: {}, active: true },
  { itemId: 'bonnet_nain',       name: '🧔 Bonnet nain fourré',            category: 'armor', slot: 'head', rarity: 'rare',      defense: 8,  durabilityMax: 20, priceGame: 170000,  effect: {}, active: true },
  { itemId: 'bonnet_hiver',      name: '❄️ Bonnet des Cimes Glacées',      category: 'armor', slot: 'head', rarity: 'epic',      defense: 12, durabilityMax: 16, priceGame: 340000,  effect: {}, active: true },
  { itemId: 'bonnet_mage',       name: '🔮 Bonnet du Mage Ancestral',      category: 'armor', slot: 'head', rarity: 'legendary', defense: 16, durabilityMax: 12, priceGame: 520000,  effect: {}, active: true },
  // ── Casquettes (slot 'head')
  { itemId: 'casquette_explorateur', name: '🧢 Casquette de l\'Éclaireur',     category: 'armor', slot: 'head', rarity: 'common',    defense: 3,  durabilityMax: 25, priceGame: 65000,  effect: {}, active: true },
  { itemId: 'casquette_marin',       name: '⚓ Casquette du Capitaine des mers', category: 'armor', slot: 'head', rarity: 'rare',      defense: 6,  durabilityMax: 20, priceGame: 160000, effect: {}, active: true },
  { itemId: 'casquette_chasseur',    name: '🏹 Casquette du Chasseur de primes', category: 'armor', slot: 'head', rarity: 'epic',      defense: 9,  durabilityMax: 16, priceGame: 330000, effect: {}, active: true },
  { itemId: 'casquette_royale',      name: '👑 Casquette Royale ornée d\'or',   category: 'armor', slot: 'head', rarity: 'legendary', defense: 13, durabilityMax: 12, priceGame: 510000, effect: {}, active: true },
  // ── Habits (slot 'body')
  { itemId: 'habit_voyageur',    name: '🥼 Habit du voyageur',             category: 'armor', slot: 'body', rarity: 'common',    defense: 8,  durabilityMax: 24, priceGame: 180000,  effect: {}, active: true },
  { itemId: 'habit_mage',        name: '🧙 Habit du Mage des Arcanes',     category: 'armor', slot: 'body', rarity: 'rare',      defense: 16, durabilityMax: 20, priceGame: 360000,  effect: {}, active: true },
  { itemId: 'habit_hobbit',      name: '🍀 Habit chaud de la Comté',       category: 'armor', slot: 'body', rarity: 'epic',      defense: 24, durabilityMax: 16, priceGame: 650000,  effect: {}, active: true },
  { itemId: 'habit_seigneur',    name: '👑 Habit du Seigneur des Terres',  category: 'armor', slot: 'body', rarity: 'legendary', defense: 45, durabilityMax: 12, priceGame: 1300000, effect: {}, active: true },
  // ── Gilets (slot 'body')
  { itemId: 'gilet_cuir',        name: '🦺 Gilet de cuir renforcé',        category: 'armor', slot: 'body', rarity: 'common',    defense: 10, durabilityMax: 22, priceGame: 190000,  effect: {}, active: true },
  { itemId: 'gilet_ranger',      name: '🍃 Gilet du Rôdeur d\'Ithilien',   category: 'armor', slot: 'body', rarity: 'rare',      defense: 18, durabilityMax: 18, priceGame: 380000,  effect: {}, active: true },
  { itemId: 'gilet_templier',    name: '⚔️ Gilet templier béni',          category: 'armor', slot: 'body', rarity: 'epic',      defense: 32, durabilityMax: 14, priceGame: 700000,  effect: {}, active: true },
  { itemId: 'gilet_dragon',      name: '🐲 Gilet en écailles de Dragon Noir', category: 'armor', slot: 'body', rarity: 'legendary', defense: 55, durabilityMax: 10, priceGame: 1400000, effect: {}, active: true },
  // ── Guêtres (slot 'legs')
  { itemId: 'guetres_cuir',      name: '🥾 Guêtres de cuir tanné',         category: 'armor', slot: 'legs', rarity: 'common',    defense: 5,  durabilityMax: 22, priceGame: 150000,  effect: {}, active: true },
  { itemId: 'guetres_ranger',    name: '🍃 Guêtres du Rôdeur',             category: 'armor', slot: 'legs', rarity: 'rare',      defense: 10, durabilityMax: 18, priceGame: 300000,  effect: {}, active: true },
  { itemId: 'guetres_acier',     name: '⚙️ Guêtres d\'acier renforcé',    category: 'armor', slot: 'legs', rarity: 'epic',      defense: 16, durabilityMax: 14, priceGame: 600000,  effect: {}, active: true },
  { itemId: 'guetres_dragon',    name: '🐲 Guêtres en écailles de Dragon', category: 'armor', slot: 'legs', rarity: 'legendary', defense: 24, durabilityMax: 10, priceGame: 1100000, effect: {}, active: true },
  // ── Pantalons (slot 'legs')
  { itemId: 'pantalon_toile',    name: '👖 Pantalon de toile robuste',     category: 'armor', slot: 'legs', rarity: 'common',    defense: 6,  durabilityMax: 24, priceGame: 160000,  effect: {}, active: true },
  { itemId: 'pantalon_soldat',   name: '🎖️ Pantalon du Soldat de la Garde', category: 'armor', slot: 'legs', rarity: 'rare',      defense: 12, durabilityMax: 20, priceGame: 320000,  effect: {}, active: true },
  { itemId: 'pantalon_noble',    name: '👑 Pantalon noble brodé d\'or',    category: 'armor', slot: 'legs', rarity: 'epic',      defense: 20, durabilityMax: 16, priceGame: 620000,  effect: {}, active: true },
  { itemId: 'pantalon_royal',    name: '🏰 Pantalon Royal des Terres du Nord', category: 'armor', slot: 'legs', rarity: 'legendary', defense: 30, durabilityMax: 12, priceGame: 1150000, effect: {}, active: true },
  // ── Shorts (slot 'legs')
  { itemId: 'short_explorateur', name: '🩳 Short de l\'explorateur',       category: 'armor', slot: 'legs', rarity: 'common',    defense: 4,  durabilityMax: 25, priceGame: 90000,   effect: {}, active: true },
  { itemId: 'short_ete',         name: '☀️ Short d\'été léger',            category: 'armor', slot: 'legs', rarity: 'rare',      defense: 7,  durabilityMax: 20, priceGame: 190000,  effect: {}, active: true },
  { itemId: 'short_combat',      name: '⚔️ Short de combat renforcé',     category: 'armor', slot: 'legs', rarity: 'epic',      defense: 12, durabilityMax: 16, priceGame: 380000,  effect: {}, active: true },
  { itemId: 'short_aventurier',  name: '🗺️ Short légendaire de l\'Aventurier', category: 'armor', slot: 'legs', rarity: 'legendary', defense: 18, durabilityMax: 12, priceGame: 600000, effect: {}, active: true },
  // ── Pantalons d'été (slot 'legs')
  { itemId: 'pantalon_ete_lin',    name: '🌾 Pantalon d\'été en lin',          category: 'armor', slot: 'legs', rarity: 'common',    defense: 4,  durabilityMax: 24, priceGame: 85000,   effect: {}, active: true },
  { itemId: 'pantalon_ete_coton',  name: '☁️ Pantalon d\'été en coton léger',   category: 'armor', slot: 'legs', rarity: 'rare',      defense: 8,  durabilityMax: 20, priceGame: 180000,  effect: {}, active: true },
  { itemId: 'pantalon_ete_soie',   name: '🎐 Pantalon d\'été en soie elfique',  category: 'armor', slot: 'legs', rarity: 'epic',      defense: 13, durabilityMax: 16, priceGame: 370000,  effect: {}, active: true },
  { itemId: 'pantalon_ete_desert', name: '🏜️ Pantalon d\'été des Sables Ardents', category: 'armor', slot: 'legs', rarity: 'legendary', defense: 19, durabilityMax: 12, priceGame: 580000, effect: {}, active: true },
  // ── Pantalons de cuir (slot 'legs')
  { itemId: 'pantalon_cuir_brut',   name: '🥾 Pantalon de cuir brut',              category: 'armor', slot: 'legs', rarity: 'common',    defense: 9,  durabilityMax: 22, priceGame: 200000,  effect: {}, active: true },
  { itemId: 'pantalon_cuir_cloute', name: '🔩 Pantalon de cuir clouté',            category: 'armor', slot: 'legs', rarity: 'rare',      defense: 15, durabilityMax: 18, priceGame: 390000,  effect: {}, active: true },
  { itemId: 'pantalon_cuir_noir',   name: '🖤 Pantalon de cuir noir des Ombres',   category: 'armor', slot: 'legs', rarity: 'epic',      defense: 24, durabilityMax: 14, priceGame: 680000,  effect: {}, active: true },
  { itemId: 'pantalon_cuir_dragon', name: '🐲 Pantalon de cuir tanné au feu du Dragon', category: 'armor', slot: 'legs', rarity: 'legendary', defense: 34, durabilityMax: 10, priceGame: 1200000, effect: {}, active: true },
  // ── Pantalons d'hiver (slot 'legs')
  { itemId: 'pantalon_hiver_laine',    name: '🧶 Pantalon d\'hiver en laine',              category: 'armor', slot: 'legs', rarity: 'common',    defense: 10, durabilityMax: 22, priceGame: 210000,  effect: {}, active: true },
  { itemId: 'pantalon_hiver_fourrure', name: '🐻 Pantalon d\'hiver fourré',                category: 'armor', slot: 'legs', rarity: 'rare',      defense: 17, durabilityMax: 18, priceGame: 400000,  effect: {}, active: true },
  { itemId: 'pantalon_hiver_ours',     name: '🐻\u200d❄️ Pantalon d\'hiver en peau d\'ours polaire', category: 'armor', slot: 'legs', rarity: 'epic', defense: 27, durabilityMax: 14, priceGame: 720000, effect: {}, active: true },
  { itemId: 'pantalon_hiver_givre',    name: '❄️ Pantalon du Seigneur des Glaces',         category: 'armor', slot: 'legs', rarity: 'legendary', defense: 38, durabilityMax: 10, priceGame: 1250000, effect: {}, active: true },
  // ── Chaussures (slot 'feet')
  { itemId: 'chaussures_toile',    name: '👟 Chaussures de toile souple',    category: 'armor', slot: 'feet', rarity: 'common',    defense: 3,  durabilityMax: 24, priceGame: 90000,   effect: {}, active: true },
  { itemId: 'chaussures_cuir',     name: '🥿 Chaussures de cuir fin',        category: 'armor', slot: 'feet', rarity: 'rare',      defense: 7,  durabilityMax: 20, priceGame: 200000,  effect: {}, active: true },
  { itemId: 'chaussures_elfiques', name: '🍃 Chaussures elfiques silencieuses', category: 'armor', slot: 'feet', rarity: 'epic',      defense: 11, durabilityMax: 16, priceGame: 420000,  effect: {}, active: true },
  { itemId: 'chaussures_royales',  name: '👑 Chaussures royales dorées',     category: 'armor', slot: 'feet', rarity: 'legendary', defense: 16, durabilityMax: 12, priceGame: 650000,  effect: {}, active: true },
  // ── Bottes additionnelles (slot 'feet')
  { itemId: 'bottes_combat',    name: '🥾 Bottes de combat renforcées',        category: 'armor', slot: 'feet', rarity: 'common',    defense: 8,  durabilityMax: 22, priceGame: 180000,  effect: {}, active: true },
  { itemId: 'bottes_naines',    name: '⚒️ Bottes naines cloutées',            category: 'armor', slot: 'feet', rarity: 'rare',      defense: 13, durabilityMax: 18, priceGame: 360000,  effect: {}, active: true },
  { itemId: 'bottes_fourrure',  name: '🐻 Bottes fourrées des Terres Gelées', category: 'armor', slot: 'feet', rarity: 'epic',      defense: 18, durabilityMax: 14, priceGame: 640000,  effect: {}, active: true },
  { itemId: 'bottes_dragon',    name: '🐲 Bottes en écailles de Dragon d\'Argent', category: 'armor', slot: 'feet', rarity: 'legendary', defense: 24, durabilityMax: 10, priceGame: 1050000, effect: {}, active: true },
  // ── Gants (nouveau slot 'hands')
  { itemId: 'gants_cuir',    name: '🧤 Gants de cuir souple',        category: 'armor', slot: 'hands', rarity: 'common',    defense: 4,  durabilityMax: 24, priceGame: 120000, effect: {}, active: true },
  { itemId: 'gants_acier',   name: '⚙️ Gants d\'acier articulé',    category: 'armor', slot: 'hands', rarity: 'rare',      defense: 9,  durabilityMax: 20, priceGame: 260000, effect: {}, active: true },
  { itemId: 'gants_mithril', name: '💎 Gants de mithril',            category: 'armor', slot: 'hands', rarity: 'epic',      defense: 15, durabilityMax: 16, priceGame: 550000, effect: {}, active: true },
  { itemId: 'gants_dragon',  name: '🐲 Gants en écailles de Dragon d\'Or', category: 'armor', slot: 'hands', rarity: 'legendary', defense: 22, durabilityMax: 12, priceGame: 950000, effect: {}, active: true },
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

/** Coin d'écran (voir RepRules::depthAltitudePopupPosition) — réutilisable pour tout futur pop-up
 * non bloquant dont la position doit être paramétrable par l'admin. */
export type CornerPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export const CORNER_POSITION_CLASSES: Record<CornerPosition, string> = {
  'top-left': 'top-4 left-4', 'top-right': 'top-4 right-4',
  'bottom-left': 'bottom-4 left-4', 'bottom-right': 'bottom-4 right-4',
};

/** 8 directions de déplacement de Synk (cardinales + diagonales) — voir SynkSkin.tsx (articulation
 * visuelle des membres) et GameCanvas2D.tsx (clavier/pavé directionnel). */
export type SynkDirection = 'up' | 'down' | 'left' | 'right' | 'up-left' | 'up-right' | 'down-left' | 'down-right';

/**
 * Registre admin-paramétrable des comportements de déplacement par type d'objet/décor DANS LA
 * PLATEFORME 3D UNIQUEMENT (voir Platform3DWidget.tsx::move()) — remplace la logique jusqu'ici
 * figée en dur (montagne toujours franchissable au saut, eau toujours immergeante, arbres jamais
 * bloquants) par un système de 3 interrupteurs par type d'objet (terrain OU décor), modifiable
 * librement dans le menu Administration (rubrique "🧱 Comportements des objets — Plateforme 3D") :
 *  - `obstacle`   : bloque le déplacement incrémental (clavier/pavé/souris maintenue) — Synk le
 *                   contourne au lieu de le traverser (comme les huttes/villages, voir
 *                   worldTerrain.ts::isObstacleAt, qui reste la mécanique 2D historique inchangée).
 *  - `climbable`  : autorise à grimper DESSUS (nécessite Espace maintenu si le point d'arrivée est
 *                   plus haut que la position courante de Synk — voir platform3dCubeHeightM et les
 *                   seuils de dégâts de chute) ; si false, un dénivelé positif reste bloqué même
 *                   avec Espace. Descendre (dénivelé nul ou négatif) ne nécessite JAMAIS Espace.
 *  - `water`      : immerge Synk à mi-torse en y marchant (voir waterSurfaceY) et rend disponible
 *                   le menu clic droit "Plonger" (voir platform3dUnderwaterWorldEnabled).
 * Seuls les décors/terrains listés ci-dessous sont couverts ; tout nouveau type ajouté à
 * `worldTerrain.ts::Terrain`/`PropKind` devra être ajouté ici avec un comportement par défaut
 * raisonnable (aucune régression sur les types déjà listés).
 */
export type Platform3DObjectKind =
  | 'terrain:grass' | 'terrain:sand' | 'terrain:path' | 'terrain:rock' | 'terrain:water'
  | 'prop:tree' | 'prop:bamboo' | 'prop:baobab' | 'prop:palm' | 'prop:hut' | 'prop:castle' | 'prop:portal'
  // `marker:npc`/`marker:familiar` : uniquement le `scale` est pertinent ici (taille du PNJ voxel /
  // du dragon-familier affiché sur la carte 3D — voir NpcVoxel/DragonMarker dans Platform3DWidget.tsx).
  // `obstacle`/`climbable`/`water` restent présents pour réutiliser la même interface/table admin
  // mais ne sont jamais lus pour un marqueur (seul `platform3dTileFlags()` sur `tile.prop` les lit).
  | 'marker:npc' | 'marker:familiar';

export const PLATFORM3D_OBJECT_KINDS: Platform3DObjectKind[] = [
  'terrain:grass', 'terrain:sand', 'terrain:path', 'terrain:rock', 'terrain:water',
  'prop:tree', 'prop:bamboo', 'prop:baobab', 'prop:palm', 'prop:hut', 'prop:castle', 'prop:portal',
  'marker:npc', 'marker:familiar',
];

export interface Platform3DObjectFlags { obstacle: boolean; climbable: boolean; water: boolean; scale: number }

/** Comportement par défaut de chaque type d'objet/décor (voir Platform3DObjectFlags ci-dessus) —
 * reproduit EXACTEMENT le comportement historique déjà en place (montagne franchissable au saut,
 * eau immergeante, huttes/châteaux déjà bloqués via worldTerrain.ts::isObstacleAt) et AJOUTE les
 * arbres/bambous/baobabs/palmiers comme obstacles (correctif du bug "je traverse les arbres"),
 * modifiable ensuite librement par l'admin sans toucher au code.
 * `scale` (défaut 1) est un multiplicateur appliqué à la géométrie 3D déjà proportionnée de façon
 * réaliste (voir Platform3DWidget.tsx::PropBlock) — permet à l'admin d'ajuster librement la taille
 * de chaque décor (ex. rapetisser un peu les baobabs, ou grossir le château) sans toucher au code ;
 * ignoré pour les `terrain:*` (le sol reste toujours une dalle 1×1, redimensionner n'aurait pas de
 * sens visuellement — champ conservé pour la simplicité du type mais non exposé dans l'admin pour
 * ces lignes-là). */
export const DEFAULT_PLATFORM3D_OBJECT_FLAGS: Record<Platform3DObjectKind, Platform3DObjectFlags> = {
  'terrain:grass': { obstacle: false, climbable: false, water: false, scale: 1 },
  'terrain:sand':  { obstacle: false, climbable: false, water: false, scale: 1 },
  'terrain:path':  { obstacle: false, climbable: false, water: false, scale: 1 },
  'terrain:rock':  { obstacle: false, climbable: true,  water: false, scale: 1 },
  'terrain:water': { obstacle: false, climbable: false, water: true,  scale: 1 },
  'prop:tree':     { obstacle: true,  climbable: false, water: false, scale: 1 },
  'prop:bamboo':   { obstacle: true,  climbable: false, water: false, scale: 1 },
  'prop:baobab':   { obstacle: true,  climbable: false, water: false, scale: 1 },
  'prop:palm':     { obstacle: true,  climbable: false, water: false, scale: 1 },
  'prop:hut':      { obstacle: true,  climbable: false, water: false, scale: 1 },
  'prop:castle':   { obstacle: true,  climbable: false, water: false, scale: 1 },
  'prop:portal':   { obstacle: false, climbable: false, water: false, scale: 1 },
  // PNJ voxel (style Minecraft, voir NpcVoxel) légèrement plus grand que Synk (~1.2 unité) pour
  // rester bien visible/lisible sur la carte. Le familier-dragon doit être NETTEMENT plus grand
  // que Synk (le joueur doit pouvoir imaginer le chevaucher) — voir DragonMarker.
  'marker:npc':      { obstacle: false, climbable: false, water: false, scale: 1.6 },
  'marker:familiar': { obstacle: false, climbable: false, water: false, scale: 2.4 },
};

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
  // ─── Dé d'Action D&D (Flight/Fight/Freeze/Fawn — voir DiceRollWidget.tsx::rollActionDice et
  // resolveActionDiceRoll ci-dessous) — SECOND mécanisme possible pour le jet OBLIGATOIRE de combat
  // PNJ ("Lancer..."), tiré au sort (équilibré, `actionDiceChancePct`) contre le mécanisme 2d20
  // classique ci-dessus à CHAQUE combat, sans jamais le remplacer (les deux cohabitent). Un dé à 4
  // faces (tétraèdre) par défaut, façon Dungeons & Dragons ; `actionDiceSides` permet de choisir un
  // dé plus grand (6/8/10/12/20/100 faces) — les faces au-delà des 4 canoniques accordent alors un
  // bonus générique (XP, objet de la boutique, ou très rarement l'Objet Ultra, capé à 1x/jour).
  actionDiceEnabled: boolean;    // Active le Dé d'Action pendant les combats PNJ (défaut true)
  actionDiceChancePct: number;   // % de chance d'utiliser le Dé d'Action plutôt que le jet 2d20 classique (défaut 50, équilibré)
  actionDiceSides: number;       // Nombre de faces du dé utilisé : 4/6/8/10/12/20/100 (défaut 4 = tétraèdre)
  actionDiceFlightXp: number;    // Face "Flight" (Fuir) : delta XP (défaut -5)
  actionDiceFlightHp: number;    // Face "Flight" (Fuir) : delta Vie (défaut -10)
  actionDiceFlightForce: number; // Face "Flight" (Fuir) : delta Force (défaut -5)
  actionDiceFightXp: number;     // Face "Fight" (Combattre) : delta XP (défaut +10)
  actionDiceFightHp: number;     // Face "Fight" (Combattre) : delta Vie (défaut +5)
  actionDiceFightForce: number;  // Face "Fight" (Combattre) : delta Force (défaut +5)
  actionDiceFreezeXp: number;    // Face "Freeze" (Figer/Paniquer) : delta XP (défaut -10), retire aussi 1 objet aléatoire du sac
  actionDiceFawnXp: number;      // Face "Fawn" (Flatter/Négocier) : delta XP (défaut +15)
  actionDiceFawnHp: number;      // Face "Fawn" (Flatter/Négocier) : delta Vie (défaut +5), + 1 objet boutique (hors familier/selle/engin/trésor)
  actionDiceExtraUltraChancePct: number; // % de chance qu'une face "bonus" (au-delà des 4 canoniques, dés >4 faces) octroie l'Objet Ultra plutôt qu'XP/objet boutique (défaut 8, capé à 1x/jour tous mécanismes confondus)
  actionDiceUltraItemName: string;    // Nom affiché de l'Objet Ultra, jamais en vente en boutique (défaut "🌟 Éclat de Synk")
  actionDiceUltraForceBonus: number;  // Bonus Force accordé par l'Objet Ultra (défaut 15)
  actionDiceUltraXpBonus: number;     // Bonus XP accordé par l'Objet Ultra (défaut 50)
  actionDiceUltraSpellsBonus: number; // Bonus Sortilèges ("magie") accordé par l'Objet Ultra (défaut 15)
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
  // ─── Plafonds finaux des statistiques boostables par Super-fioles (voir DEFAULT_SHOP,
  // catégorie 'super_potion' : maxHp/maxForce/maxSpells) — chaque Super-fiole/fiole légendaire
  // augmente le plafond de façon PERMANENTE mais jamais au-delà de cette limite, quel que soit le
  // nombre de fioles consommées (corrige un bug de cumul illimité). Appliqué dans applyEffect().
  hpMaxCap: number;     // Plafond final de Vie atteignable (défaut 300 = 100 base + 100 super-fiole + 200 fiole légendaire)
  forceMaxCap: number;  // Plafond final de Force atteignable (défaut 200 = 100 base + 100 super-fiole)
  spellsMaxCap: number; // Plafond final de Sortilèges atteignable (défaut 200 = 100 base + 100 super-fiole)
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
  // ─── Pondération "moins d'énergie" de la décroissance de Fatigue (voir GameCanvas2D.tsx) —
  // quand Synk se déplace alors que sa Vie, sa Faim, sa Force OU son Oxygène sont sous
  // `fatigueLowStatsThresholdPct` (% de leur plafond respectif), il se fatigue un peu plus vite :
  // chaque statistique basse ajoute `fatigueLowStatsExtraDrainPerStat` au pourcentage de Fatigue
  // perdu à chaque palier (en plus de `fatigueDrainPct`), plafonné au total à
  // `fatigueLowStatsMaxExtraPct` pour que la pénalité reste toujours raisonnable (au plus +4% par
  // défaut, même si les 4 statistiques sont basses en même temps). Désactivable indépendamment de
  // la mécanique de Fatigue globale.
  fatigueLowStatsPenaltyEnabled: boolean;    // Active/désactive cette pondération (défaut true)
  fatigueLowStatsThresholdPct: number;       // Seuil (%) sous lequel Vie/Faim/Force/Oxygène comptent comme "bas" (défaut 30)
  fatigueLowStatsExtraDrainPerStat: number;  // % de Fatigue supplémentaire perdu par statistique basse (défaut 1)
  fatigueLowStatsMaxExtraPct: number;        // Plafond du cumul de cette pénalité, toutes statistiques basses confondues (défaut 4)
  // ─── Épuisement par manque de Fatigue (voir GameCanvas2D.tsx) — quand la Fatigue passe sous
  // `fatigueFaintThresholdPct`, Synk s'évanouit d'épuisement : interface bloquée pendant
  // `fatigueFaintDurationSec` (comme l'évanouissement par manque d'oxygène), `fatigueFaintHpLoss`
  // points de Vie retirés immédiatement, puis la Fatigue est restaurée à 100% une fois le décompte
  // écoulé. `fatigueFaintResultPopupEnabled` permet de désactiver spécifiquement le pop-up
  // d'information affiché au réveil ("Synk a perdu X points de vie").
  fatigueFaintThresholdPct: number;        // Seuil de Fatigue déclenchant l'évanouissement d'épuisement (défaut 10)
  fatigueFaintDurationSec: number;         // Durée du blocage / récupération à 100% (défaut 50)
  fatigueFaintHpLoss: number;              // Vie perdue lors de l'évanouissement d'épuisement (défaut 30)
  fatigueFaintResultPopupEnabled: boolean; // Affiche le pop-up d'information des pertes au réveil (défaut true)
  // ─── Altitude & raréfaction de l'air (voir worldTerrain.ts::Tile.altitudeM et GameCanvas2D.tsx)
  // — au-delà de `altitudeRarefactionStartM`, l'air se raréfie progressivement jusqu'à
  // `altitudeMaxM` (sommet le plus haut généré) : les décomptes Oxygène ET Fatigue s'accélèrent
  // (l'intervalle entre deux paliers de décroissance est multiplié par un facteur qui descend
  // linéairement jusqu'à `altitudeRarefactionMinIntervalFactor` au sommet). `altitudeSnowThresholdM`
  // permet, INDÉPENDAMMENT DE LA SAISON, d'afficher un sommet enneigé dès cette altitude (voir
  // rendu de la neige d'altitude dans GameCanvas2D.tsx/WorldMapWidget.tsx — corrige l'incohérence
  // "neige en été" tout en gardant la possibilité de neige permanente en haute montagne).
  altitudeEnabled: boolean;                     // Active/désactive toute la mécanique d'altitude (défaut true)
  altitudeMaxM: number;                         // Plafond des sommets générés, en mètres (défaut 6000)
  altitudeSnowThresholdM: number;               // Altitude à partir de laquelle un sommet est enneigé toute l'année (défaut 2000)
  altitudeRarefactionStartM: number;            // Altitude à partir de laquelle l'air commence à se raréfier (défaut 1500)
  altitudeRarefactionMinIntervalFactor: number; // Facteur minimal (au sommet) appliqué à l'intervalle Oxygène/Fatigue (défaut 0.4 = 2,5x plus rapide)
  // ─── Profondeur d'eau (voir worldTerrain.ts::Tile.depthM/waterKind) — plus une dalle d'eau est
  // profonde (mer/océan), plus la décroissance d'Oxygène s'accélère, sur le même principe que la
  // raréfaction de l'air en altitude (voir ci-dessus) ; les ruisseaux/étangs peu profonds restent
  // proches du comportement historique.
  waterDepthEnabled: boolean;                     // Active/désactive la pondération par profondeur (défaut true)
  waterDepthMaxM: number;                         // Profondeur maximale générée (fosse océanique), en mètres (défaut 6000)
  waterDepthRarefactionMinIntervalFactor: number; // Facteur minimal (profondeur maximale) appliqué à l'intervalle Oxygène (défaut 0.5)
  // ─── Pop-up profondeur/altitude (voir worldTerrain.ts::Tile.depthM/altitudeM, GameCanvas2D.tsx et
  // WorldMapWidget.tsx) — petit indicateur non bloquant et clignotant affiché tant que Synk se
  // trouve sur une dalle d'eau (profondeur) ou de montagne/roche (altitude), sur le même principe
  // visuel que les pop-ups Oxygène/Fatigue mais purement informatif (aucun impact sur les
  // statistiques). `depthAltitudePopupPosition` choisit le coin d'affichage (voir CornerPosition
  // ci-dessus). `depthAltitudePopupWaterTemplate`/`MountainTemplate` permettent à l'admin de
  // personnaliser le texte affiché (jeton `{value}` remplacé par la profondeur/l'altitude en
  // mètres) ; un gabarit vide (défaut) utilise le texte traduit (voir game.depthAltitude.water/
  // game.depthAltitude.mountain dans i18n).
  depthAltitudePopupEnabled: boolean;             // Active/désactive ce pop-up (défaut true)
  depthAltitudePopupPosition: CornerPosition;     // Coin d'affichage à l'écran (défaut 'top-left')
  depthAltitudePopupWaterTemplate: string;        // Gabarit eau, ex. "🌊 Profondeur : {value} m" (vide = texte traduit)
  depthAltitudePopupMountainTemplate: string;     // Gabarit montagne, ex. "🏔️ Altitude : {value} m" (vide = texte traduit)
  // ─── Articulation des mouvements de Synk (voir SynkSkin.tsx et GameCanvas2D.tsx) — anime
  // jambes/bras/torse/tête (léger balancement de marche) sur les 8 directions de déplacement
  // (cardinales + diagonales) dans la Plateforme 2D isométrique. Désactiver revient au rendu
  // statique d'origine (aucune régression : SynkSkin ignore alors direction/walking).
  synkLimbAnimationEnabled: boolean;              // Active/désactive l'animation d'articulation (défaut true)
  // ─── Paramétrage de Synk — clignement des yeux (voir Platform3DWidget.tsx::SynkVoxel) : deux
  // petites billes blanches (pupilles) incrustées dans les yeux de Synk en vue 3D, qui se ferment
  // puis se rouvrent brièvement à intervalle irrégulier (comme un clignement humain naturel) pour
  // rendre le personnage plus vivant. Purement visuel/cosmétique, aucune mécanique de jeu associée
  // (zéro risque de régression sur le combat/l'usure/les stats). `synkEyeBlinkIntervalSec` est un
  // intervalle MOYEN (voir randomisation +/-30% dans SynkVoxel) plutôt qu'une cadence figée, pour
  // éviter un clignotement mécanique/robotique.
  synkEyeBlinkEnabled: boolean;      // Active/désactive le clignement des yeux (défaut true)
  synkEyeBlinkIntervalSec: number;   // Intervalle moyen entre deux clignements, en secondes (défaut 4)
  // ─── Accès aux îles (voir worldTerrain.ts::Tile.isIsland et GameCanvas2D.tsx) — foulée d'une
  // dalle d'île nécessite un Engin (ShopItem.category === 'vehicle') dans la besace tant que ce
  // réglage est actif ; sinon le déplacement est bloqué et un message l'explique au joueur.
  islandVehicleRequired: boolean; // Exige un Engin dans la besace pour accéder aux îles (défaut true)
  // ─── Cadence de déplacement & course à la touche maintenue (voir GameCanvas2D.tsx/
  // Platform3DWidget.tsx::move()/useHoldMovement) — remplace la dépendance à la répétition
  // automatique native du clavier (variable selon l'OS, cause du bug "avance de 2 cases") par une
  // cadence entièrement pilotée par le jeu : un appui court = exactement 1 case, un maintien
  // continu (clavier, pavé directionnel virtuel ou bouton de souris) déclenche la marche au pas
  // `movementWalkStepMs`, puis bascule sur la cadence de course `movementRunStepMs` après
  // `movementRunHoldThresholdMs` de maintien ininterrompu.
  movementWalkStepMs: number;          // Intervalle (ms) entre deux pas en maintien "marche" (défaut 220)
  movementRunStepMs: number;           // Intervalle (ms) entre deux pas en maintien "course" (défaut 110)
  movementRunHoldThresholdMs: number;  // Durée de maintien (ms) avant de passer en course (défaut 1500)
  // ─── Collision avec les POI "obstacles" (voir worldTerrain.ts::OBSTACLE_POI_TYPES et
  // GameCanvas2D.tsx/Platform3DWidget.tsx::move()) — bloque UNIQUEMENT le déplacement incrémental
  // au clavier/pavé directionnel/souris maintenue vers une case portant un POI structurel (hutte,
  // village, taverne, étable) ou un décor hutte/château généré : Synk le contourne au lieu de le
  // traverser. Le clic direct sur un marqueur/une case lointaine (approche automatique via
  // moveTo/teleport, voir onMarkerClick/onHutTileClick/onPortalTileClick) N'EST PAS concerné et
  // continue de fonctionner à l'identique (sinon un joueur resterait bloqué en cliquant sur un
  // village pour s'en approcher). Montagnes/roches restent volontairement franchissables (voir le
  // mécanisme de saut de la Plateforme 3D) : elles ne font PAS partie des obstacles bloquants.
  poiObstacleCollisionEnabled: boolean; // Active/désactive cette collision (défaut true)
  // ─── Plateforme 3D — rendu de l'équipement de Synk, saut (franchissement de montagne) et
  // redimensionnement de la fenêtre jusqu'au plein écran (voir Platform3DWidget.tsx). Ces trois
  // réglages sont indépendants de `platform3dWidgetEnabled` (qui contrôle l'affichage du widget
  // lui-même) : ils permettent de désactiver individuellement chacun de ces raffinements en cas de
  // souci de performance ou de régression, sans devoir masquer tout le widget.
  platform3dEquipmentRenderEnabled: boolean; // Affiche l'équipement (arme, bouclier, casque, etc.) sur le modèle 3D de Synk (défaut true)
  platform3dJumpEnabled: boolean;            // Active le saut (barre espace) pour franchir montagnes/roches en 3D (défaut true)
  platform3dResizableEnabled: boolean;       // Autorise le redimensionnement (jusqu'au plein écran) du widget 3D (défaut true)
  // ─── Escalade/saut de montagne en Plateforme 3D (voir Platform3DWidget.tsx::move()) — grimper
  // sur une dalle plus haute que la position courante de Synk nécessite de maintenir Espace (voir
  // platform3dJumpEnabled/Platform3DObjectFlags.climbable) ; DESCENDRE reste toujours libre (jamais
  // besoin d'Espace). Le dénivelé est converti en « cubes » via `platform3dCubeHeightM` (mètres par
  // cube) à partir de `Tile.altitudeM` (terre ferme/eau = altitude 0) : au-delà de
  // `platform3dFallDamageMinCubes` cubes de dénivelé en une seule fois, Synk perd immédiatement
  // `platform3dFallDamageHp` PV et `platform3dFallDamageXp` XP (petite chute) ; au-delà de
  // `platform3dFallDeathCubes` cubes, la chute est mortelle : Synk perd `platform3dFallDeathXp` XP
  // et toute sa Vie, un pop-up "chute mortelle" reste affiché `platform3dFallDeathReviveSec`
  // secondes (défaut 51, bloque le déplacement comme un évanouissement), puis Synk revit avec sa
  // Vie entièrement restaurée (voir applyEffect). Entre les deux seuils : dégâts mineurs, pas de
  // mort. En dessous du 1er seuil : aucune pénalité (simple saut/escalade).
  platform3dCubeHeightM: number;           // Mètres d'altitude représentant "1 cube" pour ce calcul (défaut 400)
  platform3dFallDamageMinCubes: number;    // Dénivelé (en cubes) déclenchant les dégâts mineurs de chute (défaut 4)
  platform3dFallDamageHp: number;          // Vie perdue lors d'une chute mineure (défaut 20)
  platform3dFallDamageXp: number;          // XP perdue lors d'une chute mineure (défaut 50)
  platform3dFallDeathCubes: number;        // Dénivelé (en cubes) déclenchant la chute mortelle (défaut 10)
  platform3dFallDeathXp: number;           // XP perdue lors d'une chute mortelle (défaut 300)
  platform3dFallDeathReviveSec: number;    // Durée (s) du pop-up "chute mortelle" avant réanimation (défaut 51)
  // ─── Registre des comportements par objet/décor (voir Platform3DObjectKind/Platform3DObjectFlags
  // ci-dessus) — modifiable dans le menu Administration, rubrique "🧱 Comportements des objets".
  platform3dObjectFlags: Record<Platform3DObjectKind, Platform3DObjectFlags>;
  // ─── Monde sous-marin (plongée totale) en Plateforme 3D — quand Synk se trouve sur une dalle
  // marquée `water: true` (voir platform3dObjectFlags), un clic droit propose de nager en surface
  // (comportement par défaut, mi-torse immergé) OU de plonger entièrement pour explorer un paysage
  // sous-marin généré (poissons et créatures marines inspirées de Donjons & Dragons) — purement
  // exploratoire/cosmétique : ne modifie AUCUNE mécanique d'oxygène/fatigue existante (celles-ci
  // restent intégralement pilotées par GameCanvas2D.tsx).
  platform3dUnderwaterWorldEnabled: boolean;  // Active le menu clic droit "Plonger" et le monde sous-marin (défaut true)
  platform3dUnderwaterFishCount: number;      // Nombre de poissons décoratifs générés (défaut 10)
  platform3dUnderwaterMonsterCount: number;   // Nombre de créatures marines générées (défaut 2)
  // Déplacement réel de Synk une fois en plongée totale (voir UnderwaterScene/moveUnderwater dans
  // Platform3DWidget.tsx) — corrige le bug rapporté "je ne peux pas me déplacer sous l'eau" (le
  // monde sous-marin était jusqu'ici purement décoratif, Synk fixe au centre). Purement une
  // progression visuelle bornée dans cette vue exploratoire, AUCUNE nouvelle mécanique de jeu
  // (oxygène/fatigue restent intégralement pilotés par GameCanvas2D.tsx).
  platform3dUnderwaterMoveEnabled: boolean;   // Autorise à nager/se déplacer en plongée totale (défaut true)
  platform3dUnderwaterMoveRadius: number;     // Rayon d'exploration borné autour du point de plongée (défaut 6)
  // ─── Grands lacs/bassins par défaut (voir demande utilisateur "créer une dizaine de grandes
  // étendues d'eau pour nager") — DEFAULT_LAKE_POIS ci-dessus fournit une dizaine de lacs/étangs
  // fixes, répartis sur toute la mapmonde, FUSIONNÉS à getAllMapMarkers() en plus des MapPoiDef
  // saisis manuellement par l'admin (jamais à la place) : aucune régression sur les POI déjà créés
  // en base. Désactivable ici si l'admin préfère composer entièrement son propre territoire aquatique.
  defaultLakesEnabled: boolean;                // Affiche les 10 lacs/étangs par défaut (défaut true)
  // ─── Quêtes du Royaume (voir section dédiée gameState.ts) ───────────────────────────────────
  kingdomMinIntermediateSolved: number; // Nb de quêtes intermédiaires (classiques+PNJ) résolues
                                         // nécessaires avant de débloquer la 1ère Quête du Royaume (défaut 3)
  // ─── Zorghon le Maléfique, PocaPoka & El Pipo (voir ZorghonEncounterState, getZorghonEncounter,
  // relocateZorghonCaptives, rescuePocaPoka ci-dessous + GameCanvas2D.tsx pour la vérification
  // périodique de proximité) — Zorghon et ses prisonniers n'apparaissent sur la carte qu'une fois
  // suffisamment de Quêtes du Royaume résolues ; tant que Synk s'approche trop de Zorghon, ce
  // dernier a une chance de déplacer PocaPoka et El Pipo ailleurs sur la carte/les îles.
  zorghonEnabled: boolean;               // Active/désactive toute la mécanique (défaut true)
  zorghonAppearKingdomSolvedCount: number; // Nb de Quêtes du Royaume résolues nécessaire à l'apparition
                                            // de Zorghon et de ses prisonniers (défaut 6)
  zorghonProximityPct: number;           // Distance (en % de carte) en-deçà de laquelle Zorghon "sent"
                                          // Synk et peut relocaliser ses prisonniers (défaut 12)
  zorghonRelocationChancePct: number;    // Probabilité (%) de relocalisation à chaque vérification de
                                         // proximité déclenchée (défaut 35)
  zorghonCheckIntervalSec: number;      // Fréquence de vérification de la proximité, en secondes (défaut 20)
  zorghonRescueXpReward: number;        // XP octroyée à la délivrance de PocaPoka et El Pipo (défaut 2000)
  // ─── Écrans d'accueil & widget "Aides" (voir onboardingContent.ts, OnboardingWizard.tsx et
  // HelpWidget.tsx) — visite guidée pédagogique (contexte du monde, quêtes, mécaniques, widgets)
  // affichée une seule fois par navigateur à la première entrée en jeu (drapeau localStorage,
  // voir game/page.tsx), et rejouable à tout moment via le widget flottant "Aides" qui reprend
  // exactement le même contenu. `onboardingEnabled` ne contrôle QUE l'affichage automatique de la
  // première visite ; `helpWidgetEnabled` contrôle la présence du widget flottant lui-même.
  onboardingEnabled: boolean;   // Affiche automatiquement la visite guidée à la 1ère visite (défaut true)
  helpWidgetEnabled: boolean;   // Affiche le widget flottant "Aides" (défaut true)
  // ─── Widget "État d'avancement / inventaire" (voir ProgressWidget.tsx, ProgressLedgerView.tsx et
  // getPlayerProgressLedger() ci-dessous) — voir demande utilisateur.
  progressWidgetEnabled: boolean; // Affiche le widget flottant "État d'avancement / inventaire" (défaut true)
  // ─── Temps de jeu par joueur (voir trackPlaytimeHeartbeat/getPlayerPlaytimeStats ci-dessous et
  // rubrique "Statistiques par joueur" du menu Administration) — statistique de jeu de base,
  // TOUJOURS active (indépendante de l'interrupteur optionnel `AiAnalyticsSettings.enabled`).
  playtimeTrackingEnabled: boolean; // Active le suivi du temps de jeu total/quotidien (défaut true)
  playtimeHeartbeatSec: number;     // Fréquence d'envoi du "battement" de temps de jeu, en secondes (défaut 30)
  // ─── Activation/désactivation des widgets flottants existants (rubrique admin "Widgets
  // personnalisés" — voir CustomWidgetsAdminPanel.tsx) : chaque widget flottant du jeu (hors
  // widgets flottants personnalisés créés par l'admin, qui ont déjà leur propre `active` par
  // widget) peut être masqué globalement pour tous les joueurs, ex. pour désactiver
  // temporairement une fonctionnalité en maintenance sans toucher au code. Tous par défaut à
  // true (comportement strictement identique à avant l'introduction de ces interrupteurs).
  diceRollWidgetEnabled: boolean;
  teamChatWidgetEnabled: boolean;
  equipmentWidgetEnabled: boolean;
  inventoryWidgetEnabled: boolean;
  shopWidgetEnabled: boolean;
  worldMapWidgetEnabled: boolean;
  statsWidgetEnabled: boolean;
  kingdomQuestsWidgetEnabled: boolean;
  questsZeldaCraftWidgetEnabled: boolean; // Nouveau widget "Quêtes de ZeldaCraft" (voir QuestsZeldaCraftWidget.tsx)
  // Nouveau widget flottant "Rechargement du portefeuille" (voir WalletTopupWidget.tsx), duplique
  // le mécanisme d'achat de monnaie de jeu contre ETH déjà en place dans WalletPanel.tsx (section
  // fixe "Portefeuille") — même sémantique par défaut `true` que les autres widgets ci-dessus.
  walletTopupWidgetEnabled: boolean;
  // Nouveau widget flottant "Plateforme 3D" (voir Platform3DWidget.tsx, Phase 3 Roadmap — Moteur
  // de jeu) : rendu 3D façon Minecraft (voxels/blocs) de Synk et de tout son univers (PNJ,
  // familiers, monstres, Zorghon/PocaPoka/El Pipo, huttes, eau, montagnes, trésors, engins),
  // synchronisé EN TEMPS RÉEL avec la même position (`players/{addr}/mapPos`) que la Plateforme 2D
  // isométrique et la Mapmonde — mêmes fonctions `worldTileAt`/`getAllMapMarkers`, donc AUCUNE
  // divergence possible entre les 3 vues. Bâti en Three.js/React Three Fiber (et non un moteur
  // Godot/Unity/Unreal séparé) pour rester un widget React natif, sans pipeline d'export externe —
  // voir ROADMAP.md § Phase 3 pour la justification de ce choix technique. Même sémantique par
  // défaut `true` que les autres widgets ci-dessus (comportement additif, ne retire rien).
  platform3dWidgetEnabled: boolean;
  // Affiche/masque la rubrique "Nourrir Synk" (les 4 boutons de repas on-chain + leur cooldown)
  // dans le jeu — voir game/page.tsx. Distinct de `onchainFeedButtonsEnabled` ci-dessous qui ne
  // gère QUE les boutons on-chain eux-mêmes (déjà masqués par défaut à cause du bug connu) :
  // `feedSectionEnabled` permet en plus à l'admin de masquer toute la rubrique (titre inclus,
  // y compris le message "repas suspendus") si le nourrissage on-chain n'est pas souhaité du
  // tout dans l'UI, par ex. le temps de communiquer sur la Boutique comme alternative. Défaut
  // `true` (comportement identique à avant l'introduction de cet interrupteur).
  feedSectionEnabled: boolean;
  // ─── Repas on-chain de Synk (section "Nourrir Synk" de game/page.tsx, 4 boutons journalier/
  // hebdomadaire/mensuel/annuel qui appellent `feed()` sur le smart contract Sepolia). Masqués et
  // désactivés PAR DÉFAUT (contrairement aux autres interrupteurs de widgets ci-dessus, tous par
  // défaut `true`) car le contrat actuellement déployé sur Sepolia contient un bug connu : les 4
  // types de repas partagent à tort le même horodatage on-chain, donc nourrir Synk avec un repas
  // journalier bloque à tort le festin hebdomadaire (et le banquet mensuel / rituel annuel). Le
  // correctif est déjà écrit dans `contracts/contracts/HorizonZeldCraft.sol` (mapping
  // `lastFedAtByType` séparé par type) mais nécessite un REDÉPLOIEMENT du contrat pour prendre
  // effet (nouvelle adresse, réinitialise xp/niveau/stage de Synk) — voir ROADMAP.md pour la
  // procédure. En attendant, les joueurs nourrissent/soignent Synk via la Boutique (achats
  // hors-chaîne, voir ShopPanel.tsx/applyEffect). L'admin peut réactiver ce bloc à tout moment ici
  // s'il souhaite malgré tout autoriser le nourrissage on-chain (le bug de cooldown partagé
  // persistera alors jusqu'au redéploiement).
  onchainFeedButtonsEnabled: boolean; // défaut false

  // ─── Accès Démo & paiement fiat sans portefeuille crypto (voir docs/DEMO_FIAT.md) ───
  // Permet de jouer sans Metamask/Rainbow/etc. via une identité virtuelle dérivée d'un compte
  // Firebase Auth (Google/email) — voir deriveVirtualAddress(). Deux entrées indépendantes :
  // 1) « Démo » (accès gratuit accordé par l'admin, en avant-première, à des gueststars) ;
  // 2) « Fiat » (paiement réel CB/PayPal/Apple Pay/Google Pay, aucune limite de sessions).
  // Interrupteur du bouton <ConnectButton /> ("Connecter le portefeuille") sur l'écran d'accueil —
  // reste toujours affiché pour un joueur DÉJÀ connecté par un vrai portefeuille (ne le déconnecte
  // jamais), ne masque que la possibilité d'en connecter un NOUVEAU depuis l'écran de choix.
  walletConnectEnabled: boolean;       // défaut true
  // Interrupteur général : masque/affiche le bouton "Accès Démo" sur la page d'accueil.
  demoAccessEnabled: boolean;          // défaut true
  // Sous-mode "anonyme" (aucune authentification, ni email ni Google) — accès instantané sans
  // validation admin, mais plafonné bas et clairement annoncé comme temporaire/non persistant
  // d'une session à l'autre (l'UID anonyme Firebase change si le navigateur est vidé).
  demoAnonymousEnabled: boolean;       // défaut true
  // Plafond de connexions simultanées "Démo approuvée" (Google/email, validée par l'admin) — la
  // Realtime Database gratuite (plan Spark) n'autorise que 100 connexions simultanées au total ;
  // on se garde une marge de 10 pour l'admin/l'usage interne.
  demoMaxConcurrentSessions: number;   // défaut 90
  // Plafond de connexions simultanées "Démo anonyme" (distinct du précédent, cumulable avec lui).
  demoAnonymousMaxConcurrentSessions: number; // défaut 40
  // Pièces de jeu offertes à la création d'un compte Démo (voir getOrCreatePlayer opts.initialWallet).
  demoInitialCoins: number;            // défaut 4000
  // Durée maximale (en minutes) d'une session "Accès Démo" (Google approuvé OU anonyme) avant
  // déconnexion forcée automatique — voir DemoSessionTimerWidget.tsx (petit pop-up permanent avec
  // sablier animé + compte à rebours dans le jeu) et gameState.ts::ensureDemoAccountTimer/
  // ensureDemoAnonTimer/resetDemoAccountTimer. Ne s'applique JAMAIS à un compte "Jouer sans
  // portefeuille" (fiat, payant) ni à un vrai portefeuille crypto. Le chrono démarre à la première
  // connexion et n'est PAS réinitialisé par une simple reconnexion (empêcherait sinon de
  // contourner la limite) — seul l'admin peut le relancer pour un joueur en particulier (menu
  // Administration §"Demandes d'accès Démo", bouton "🔄 Réactiver le chrono Démo").
  demoSessionMaxDurationMin: number;   // défaut 120 (2h)

  // Interrupteur général : affiche/masque le bouton "Jouer sans portefeuille (paiement)" sur la
  // page d'accueil et l'option fiat dans le widget "Rechargement du portefeuille".
  fiatPaymentEnabled: boolean;         // défaut true
  fiatMethodCardEnabled: boolean;      // défaut true — Carte Bancaire (Stripe Checkout)
  fiatMethodPaypalEnabled: boolean;    // défaut true — PayPal (Stripe Checkout)
  fiatMethodApplePayEnabled: boolean;  // défaut true — Apple Pay (Stripe Checkout)
  fiatMethodGooglePayEnabled: boolean; // défaut true — Google Pay (Stripe Checkout)
  // Mode simulation : aucune clé Stripe/PayPal réelle fournie pour l'instant (voir ROADMAP.md) —
  // les paiements fiat créditent directement le portefeuille de jeu sans appel à une API de
  // paiement externe. Passer à `false` dès que de vraies clés Stripe seront configurées côté
  // serveur (web/src/app/api/payments/*) pour basculer sur un vrai Stripe Checkout Session.
  fiatSimulationMode: boolean;         // défaut true

  // ─── Emails transactionnels & annonces (voir docs/EMAIL_NOTIFICATIONS.md) ───
  // Interrupteur général de l'envoi d'e-mails réels — nécessite RESEND_API_KEY côté serveur
  // (Vercel). Si la clé est absente, les boutons d'envoi restent visibles en Administration mais
  // affichent un avertissement explicite (même logique que NEXT_PUBLIC_ETHERSCAN_KEY manquante).
  emailNotificationsEnabled: boolean;  // défaut true
  // E-mail de bienvenue envoyé automatiquement à la création d'un compte "Jouer sans portefeuille"
  // par e-mail/mot de passe (voir NoWalletAccessPanel.tsx) — sert aussi à vérifier que l'adresse
  // saisie existe réellement (un email qui rebondit = adresse invalide, visible dans le dashboard
  // Resend). Ne contient JAMAIS le mot de passe en clair (bonne pratique de sécurité).
  welcomeEmailEnabled: boolean;        // défaut true
  // URL absolue d'une image d'illustration (bannière) à inclure dans les emails du jeu — laissée
  // vide par défaut (le template utilise alors un habillage décoratif à base d'émojis, cohérent
  // avec le reste de l'UI). Modifiable en Administration dès qu'une vraie image de Synk/skin sera
  // disponible et hébergée (ex. Vercel Blob, Cloudinary, ou simplement `public/`).
  emailBannerImageUrl: string;         // défaut ''
  // Nom d'expéditeur affiché dans les emails sortants (l'adresse d'expédition reste définie côté
  // serveur par RESEND_FROM_EMAIL, une adresse ne pouvant être choisie librement sans domaine
  // vérifié chez Resend).
  emailFromName: string;               // défaut 'Horizon ZeldCraft'
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
  actionDiceEnabled: true,
  actionDiceChancePct: 50,
  actionDiceSides: 4,
  actionDiceFlightXp: -5,
  actionDiceFlightHp: -10,
  actionDiceFlightForce: -5,
  actionDiceFightXp: 10,
  actionDiceFightHp: 5,
  actionDiceFightForce: 5,
  actionDiceFreezeXp: -10,
  actionDiceFawnXp: 15,
  actionDiceFawnHp: 5,
  actionDiceExtraUltraChancePct: 8,
  actionDiceUltraItemName: '🌟 Éclat de Synk',
  actionDiceUltraForceBonus: 15,
  actionDiceUltraXpBonus: 50,
  actionDiceUltraSpellsBonus: 15,
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
  hpMaxCap: 300,
  forceMaxCap: 200,
  spellsMaxCap: 200,
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
  fatigueLowStatsPenaltyEnabled: true,
  fatigueLowStatsThresholdPct: 30,
  fatigueLowStatsExtraDrainPerStat: 1,
  fatigueLowStatsMaxExtraPct: 4,
  fatigueFaintThresholdPct: 10,
  fatigueFaintDurationSec: 50,
  fatigueFaintHpLoss: 30,
  fatigueFaintResultPopupEnabled: true,
  altitudeEnabled: true,
  altitudeMaxM: 6000,
  altitudeSnowThresholdM: 2000,
  altitudeRarefactionStartM: 1500,
  altitudeRarefactionMinIntervalFactor: 0.4,
  waterDepthEnabled: true,
  waterDepthMaxM: 6000,
  waterDepthRarefactionMinIntervalFactor: 0.5,
  depthAltitudePopupEnabled: true,
  depthAltitudePopupPosition: 'top-left',
  depthAltitudePopupWaterTemplate: '',
  depthAltitudePopupMountainTemplate: '',
  synkLimbAnimationEnabled: true,
  synkEyeBlinkEnabled: true,
  synkEyeBlinkIntervalSec: 4,
  islandVehicleRequired: true,
  movementWalkStepMs: 220,
  movementRunStepMs: 110,
  movementRunHoldThresholdMs: 1500,
  poiObstacleCollisionEnabled: true,
  platform3dEquipmentRenderEnabled: true,
  platform3dJumpEnabled: true,
  platform3dResizableEnabled: true,
  platform3dCubeHeightM: 400,
  platform3dFallDamageMinCubes: 4,
  platform3dFallDamageHp: 20,
  platform3dFallDamageXp: 50,
  platform3dFallDeathCubes: 10,
  platform3dFallDeathXp: 300,
  platform3dFallDeathReviveSec: 51,
  platform3dObjectFlags: DEFAULT_PLATFORM3D_OBJECT_FLAGS,
  platform3dUnderwaterWorldEnabled: true,
  platform3dUnderwaterFishCount: 10,
  platform3dUnderwaterMonsterCount: 2,
  platform3dUnderwaterMoveEnabled: true,
  platform3dUnderwaterMoveRadius: 6,
  defaultLakesEnabled: true,
  kingdomMinIntermediateSolved: 3,
  zorghonEnabled: true,
  zorghonAppearKingdomSolvedCount: 6,
  zorghonProximityPct: 12,
  zorghonRelocationChancePct: 35,
  zorghonCheckIntervalSec: 20,
  zorghonRescueXpReward: 2000,
  onboardingEnabled: true,
  helpWidgetEnabled: true,
  progressWidgetEnabled: true,
  playtimeTrackingEnabled: true,
  playtimeHeartbeatSec: 30,
  diceRollWidgetEnabled: true,
  teamChatWidgetEnabled: true,
  equipmentWidgetEnabled: true,
  inventoryWidgetEnabled: true,
  shopWidgetEnabled: true,
  worldMapWidgetEnabled: true,
  statsWidgetEnabled: true,
  kingdomQuestsWidgetEnabled: true,
  questsZeldaCraftWidgetEnabled: true,
  walletTopupWidgetEnabled: true,
  platform3dWidgetEnabled: true,
  feedSectionEnabled: true,
  // Défaut false (voir commentaire sur l'interface RepRules) : bug de cooldown partagé sur le
  // contrat Sepolia actuellement déployé, correctif écrit mais en attente de redéploiement.
  onchainFeedButtonsEnabled: false,
  walletConnectEnabled: true,
  demoAccessEnabled: true,
  demoAnonymousEnabled: true,
  demoMaxConcurrentSessions: 90,
  demoAnonymousMaxConcurrentSessions: 40,
  demoInitialCoins: 4000,
  demoSessionMaxDurationMin: 120,
  fiatPaymentEnabled: true,
  fiatMethodCardEnabled: true,
  fiatMethodPaypalEnabled: true,
  fiatMethodApplePayEnabled: true,
  fiatMethodGooglePayEnabled: true,
  fiatSimulationMode: true,
  emailNotificationsEnabled: true,
  welcomeEmailEnabled: true,
  emailBannerImageUrl: '',
  emailFromName: 'Horizon ZeldCraft',
}

/** Merge une valeur brute Firebase (`catalog/repRules`, potentiellement partielle/absente) avec
 * les valeurs par défaut — factorisé pour être partagé entre `getRepRules()` (lecture ponctuelle)
 * et `subscribeRepRules()` (écoute temps réel, voir plus bas). */
function mergeRepRules(v: Partial<RepRules> | null): RepRules {
  const merged: RepRules = { ...DEFAULT_REP_RULES, ...(v || {}) };
  // Merge profond de platform3dObjectFlags : une sauvegarde Firebase partielle/ancienne (avant
  // l'ajout d'un nouveau Platform3DObjectKind, ou tout simplement absente) ne doit JAMAIS faire
  // disparaître les types par défaut — voir commentaire sur DEFAULT_PLATFORM3D_OBJECT_FLAGS.
  const savedFlags = (v || {}).platform3dObjectFlags as Partial<Record<Platform3DObjectKind, Partial<Platform3DObjectFlags>>> | undefined;
  merged.platform3dObjectFlags = PLATFORM3D_OBJECT_KINDS.reduce((acc, kind) => {
    acc[kind] = { ...DEFAULT_PLATFORM3D_OBJECT_FLAGS[kind], ...(savedFlags?.[kind] || {}) };
    return acc;
  }, {} as Record<Platform3DObjectKind, Platform3DObjectFlags>);
  return merged;
}

export async function getRepRules(): Promise<RepRules> {
  const db = getFirebaseDb();
  if (!db) return DEFAULT_REP_RULES;
  const snap = await get(ref(db, 'catalog/repRules'));
  return mergeRepRules(snap.val() as Partial<RepRules> | null);
}

/** Écoute en temps réel `catalog/repRules` (voir `getRepRules` pour la version ponctuelle) — utile
 * pour qu'un widget affiché en jeu (ex. `DemoSessionTimerWidget.tsx`) reflète INSTANTANÉMENT tout
 * changement fait par l'admin (ex. durée max de session Démo), sans attendre un rechargement de
 * page ni un intervalle de sondage. */
export function subscribeRepRules(cb: (rules: RepRules) => void): () => void {
  const db = getFirebaseDb();
  if (!db) { cb(DEFAULT_REP_RULES); return () => {}; }
  const r = ref(db, 'catalog/repRules');
  const handler = (snap: DataSnapshot) => cb(mergeRepRules(snap.val() as Partial<RepRules> | null));
  onValue(r, handler);
  return () => off(r, 'value', handler);
}


export async function setRepRules(rules: RepRules): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, 'catalog/repRules'), rules);
  _capRulesCache = null; // Applique immédiatement les nouveaux plafonds (hpMaxCap/forceMaxCap/spellsMaxCap) sans attendre l'expiration du cache de 30s.
}

/**
 * Enregistre IMMÉDIATEMENT un sous-ensemble de champs de `catalog/repRules` (écriture partielle
 * via `update()`, PAS `set()`) — utilisé pour les interrupteurs à effet critique/instantané (ex.
 * les 3 boutons de l'écran d'accueil dans la section "🏠 Écran d'accueil") afin qu'ils ne dépendent
 * PLUS du bouton "Enregistrer" global situé tout en bas d'un très long formulaire (bug constaté :
 * l'admin bascule un interrupteur mais oublie de faire défiler jusqu'au bouton, la bascule est
 * alors perdue à la prochaine visite de la page puisque jamais persistée). `update()` fusionne
 * uniquement les clés fournies et NE TOUCHE PAS aux autres réglages potentiellement en cours
 * d'édition (non sauvegardés) ailleurs dans le même formulaire. */
export async function updateRepRulesFields(patch: Partial<RepRules>): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await update(ref(db, 'catalog/repRules'), patch);
  _capRulesCache = null;
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
 *
 * `forceBoostUntil`/`forceBoostMultiplier` (optionnels) portent l'effet temporaire "Élixir de
 * Force Titanesque" (voir PlayerState/combinePotions ci-dessus) : tant qu'actif, seule la
 * CONTRIBUTION de la Force au bonus est multipliée (jamais le stock brut de Force, qui reste
 * plafonné à forceMax comme d'habitude) — cohérent avec un buff de combat D&D à durée limitée.
 */
export function computePlayerDiceBonus(
  player: {
    hp: number; hpMax: number; hunger: number; hungerMax: number; force: number; forceMax: number; spells: number; spellsMax: number;
    forceBoostUntil?: number; forceBoostMultiplier?: number;
  },
  rules: RepRules,
): number {
  const hpPct     = clamp01(player.hp     / (player.hpMax     || 100));
  const hungerPct = clamp01(player.hunger / (player.hungerMax || 100));
  let forcePct    = clamp01(player.force  / (player.forceMax  || 100));
  if (player.forceBoostUntil && player.forceBoostUntil > Date.now()) {
    forcePct = clamp01(forcePct * (player.forceBoostMultiplier ?? 2));
  }
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

// ─────────────────────────────── Dé d'Action D&D (Flight/Fight/Freeze/Fawn) ───────────────────────────────

/** Résultat d'un lancer du Dé d'Action (voir DiceRollWidget.tsx) — second mécanisme possible pour
 * le jet OBLIGATOIRE de combat PNJ, tiré au sort contre le 2d20 classique (RepRules.actionDiceChancePct,
 * défaut 50/50). `flight`/`fight`/`freeze`/`fawn` sont les 4 faces canoniques d'un d4 (toujours
 * présentes, quel que soit `RepRules.actionDiceSides`) ; `bonusXp`/`bonusItem`/`bonusUltra` ne
 * peuvent survenir que sur les faces SUPPLÉMENTAIRES d'un dé à plus de 4 faces (index 4..sides-1). */
export type ActionDiceFaceKind = 'flight' | 'fight' | 'freeze' | 'fawn' | 'bonusXp' | 'bonusItem' | 'bonusUltra';

export interface ActionDiceResult {
  face: ActionDiceFaceKind;
  faceIndex: number; // index 0-based réellement tiré (0..sides-1)
  sides: number;
  xpDelta: number;
  hpDelta: number;
  forceDelta: number;
  spellsDelta: number;
  itemGained?: string; // nom de l'objet gagné (Fawn / bonusItem / bonusUltra)
  itemLost?: string;   // nom de l'objet perdu (Freeze)
  isUltra?: boolean;
  /** Modificateur additif compatible avec le pipeline resolveFight() existant (voir
   * classifyEventRoll côté 2d20 classique) — bonus pour Fight/Fawn/bonus*, malus pour
   * Flight/Freeze. Contrairement au 2d20, jamais neutre : chaque face du Dé d'Action a un parti pris. */
  modifier: number;
  tier: 'bonus' | 'malus' | 'neutral';
}

/** Vrai si le joueur a déjà remporté l'Objet Ultra aujourd'hui (capé à 1x/jour, tous mécanismes de
 * Dé d'Action confondus — voir RepRules.actionDiceExtraUltraChancePct). */
export async function hasRolledActionDiceUltraToday(address: string): Promise<boolean> {
  const db = getFirebaseDb();
  if (!db) return false;
  const snap = await get(ref(db, `players/${KEY(address)}/actionDiceUltra/${todayKey()}`));
  return snap.exists();
}

async function markActionDiceUltraRolled(address: string): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, `players/${KEY(address)}/actionDiceUltra/${todayKey()}`), { rolledAt: Date.now() });
}

/** Catégories volontairement exclues du tirage boutique de la face "Fawn" — ni familier, ni selle,
 * ni engin/véhicule, ni trésor (un objet utile en aventure, pas une monture ni un bien de collection). */
const ACTION_DICE_FAWN_EXCLUDED_CATEGORIES: InventoryItem['category'][] = ['vehicle', 'saddle', 'treasure'];

function pickActionDiceFawnItem(shop: ShopItem[]): ShopItem | null {
  const pool = shop.filter(it => it.active && !ACTION_DICE_FAWN_EXCLUDED_CATEGORIES.includes(it.category));
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Résout un lancer du Dé d'Action (D&D) : tire une face 0..sides-1, applique ses effets (XP/Vie/
 * Force directement via applyEffect, objet gagné/perdu via addToInventory/removeRandomInventoryItem)
 * et renvoie un résultat prêt à afficher (DiceRollWidget.tsx) + un modificateur additif compatible
 * avec resolveFight() (NpcEncounterPopup.tsx), exactement comme le jet 2d20 classique.
 * Les 4 faces canoniques (0=Flight,1=Fight,2=Freeze,3=Fawn) sont TOUJOURS incluses, quel que soit
 * `rules.actionDiceSides` — les faces suivantes (dés à 6+ faces) accordent un bonus générique
 * (XP, objet boutique, ou très rarement l'Objet Ultra — capé à 1x/jour).
 */
export async function resolveActionDiceRoll(address: string, rules: RepRules): Promise<ActionDiceResult> {
  const sides = Math.max(4, Math.round(rules.actionDiceSides || 4));
  const faceIndex = Math.floor(Math.random() * sides);

  if (faceIndex === 0) { // Flight (Fuir)
    await applyEffect(address, { xpBonus: rules.actionDiceFlightXp, hp: rules.actionDiceFlightHp, force: rules.actionDiceFlightForce });
    return {
      face: 'flight', faceIndex, sides,
      xpDelta: rules.actionDiceFlightXp, hpDelta: rules.actionDiceFlightHp, forceDelta: rules.actionDiceFlightForce, spellsDelta: 0,
      modifier: -(rules.fightDiceEventMalusAmount ?? 3), tier: 'malus',
    };
  }
  if (faceIndex === 1) { // Fight (Combattre)
    await applyEffect(address, { xpBonus: rules.actionDiceFightXp, hp: rules.actionDiceFightHp, force: rules.actionDiceFightForce });
    return {
      face: 'fight', faceIndex, sides,
      xpDelta: rules.actionDiceFightXp, hpDelta: rules.actionDiceFightHp, forceDelta: rules.actionDiceFightForce, spellsDelta: 0,
      modifier: rules.fightDiceEventBonusAmount ?? 3, tier: 'bonus',
    };
  }
  if (faceIndex === 2) { // Freeze (Figer / Paniquer)
    await applyEffect(address, { xpBonus: rules.actionDiceFreezeXp });
    const lost = await removeRandomInventoryItem(address);
    return {
      face: 'freeze', faceIndex, sides,
      xpDelta: rules.actionDiceFreezeXp, hpDelta: 0, forceDelta: 0, spellsDelta: 0, itemLost: lost?.name,
      modifier: -(rules.fightDiceEventMalusAmount ?? 3), tier: 'malus',
    };
  }
  if (faceIndex === 3) { // Fawn / Adapt (Flatter / Négocier / Improviser)
    await applyEffect(address, { xpBonus: rules.actionDiceFawnXp, hp: rules.actionDiceFawnHp });
    let itemGained: string | undefined;
    try {
      const shop = await getShopCatalog();
      const drop = pickActionDiceFawnItem(shop);
      if (drop) {
        await addToInventory(address, {
          itemId: drop.itemId, name: drop.name, category: drop.category, qty: 1,
          ...(drop.slot ? { slot: drop.slot } : {}),
          ...(drop.rarity ? { rarity: drop.rarity } : {}),
          ...(drop.damage ? { damage: drop.damage } : {}),
          ...(drop.defense ? { defense: drop.defense } : {}),
          ...(drop.durabilityMax ? { durabilityMax: drop.durabilityMax } : {}),
          ...(drop.requiresArrow ? { requiresArrow: true } : {}),
          ...(drop.effect ? { effect: drop.effect } : {}),
        });
        itemGained = drop.name;
      }
    } catch { /* l'XP/Vie reste appliqué même si le tirage boutique échoue */ }
    return {
      face: 'fawn', faceIndex, sides,
      xpDelta: rules.actionDiceFawnXp, hpDelta: rules.actionDiceFawnHp, forceDelta: 0, spellsDelta: 0, itemGained,
      modifier: rules.fightDiceEventBonusAmount ?? 3, tier: 'bonus',
    };
  }

  // Faces "bonus" (dés à plus de 4 faces uniquement, index >= 4) : XP, objet boutique, ou (rare,
  // capé 1x/jour) l'Objet Ultra — jamais en vente en boutique, gagnable UNIQUEMENT ainsi.
  const ultraAlreadyWon = await hasRolledActionDiceUltraToday(address);
  const ultraChance = ultraAlreadyWon ? 0 : clamp01((rules.actionDiceExtraUltraChancePct ?? 8) / 100);
  const roll = Math.random();
  if (roll < ultraChance) {
    await applyEffect(address, {
      xpBonus: rules.actionDiceUltraXpBonus, force: rules.actionDiceUltraForceBonus, spells: rules.actionDiceUltraSpellsBonus,
    });
    await markActionDiceUltraRolled(address);
    return {
      face: 'bonusUltra', faceIndex, sides,
      xpDelta: rules.actionDiceUltraXpBonus, hpDelta: 0, forceDelta: rules.actionDiceUltraForceBonus, spellsDelta: rules.actionDiceUltraSpellsBonus,
      itemGained: rules.actionDiceUltraItemName, isUltra: true,
      modifier: rules.fightDiceEventBonusAmount ?? 3, tier: 'bonus',
    };
  }
  const grantItem = roll < ultraChance + 0.3; // ~30% des faces bonus restantes = objet boutique, le reste = XP pure
  const xp = Math.round((rules.actionDiceFightXp ?? 10) / 2);
  if (grantItem) {
    let itemGained: string | undefined;
    try {
      const shop = await getShopCatalog();
      const drop = pickActionDiceFawnItem(shop);
      if (drop) {
        await addToInventory(address, { itemId: drop.itemId, name: drop.name, category: drop.category, qty: 1 });
        itemGained = drop.name;
      }
    } catch { /* ignore */ }
    await applyEffect(address, { xpBonus: xp });
    return { face: 'bonusItem', faceIndex, sides, xpDelta: xp, hpDelta: 0, forceDelta: 0, spellsDelta: 0, itemGained, modifier: rules.fightDiceEventBonusAmount ?? 3, tier: 'bonus' };
  }
  await applyEffect(address, { xpBonus: xp });
  return { face: 'bonusXp', faceIndex, sides, xpDelta: xp, hpDelta: 0, forceDelta: 0, spellsDelta: 0, modifier: rules.fightDiceEventBonusAmount ?? 3, tier: 'bonus' };
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

/** Ids des familiers déjà apprivoisés par ce joueur, en un seul accès (Set pour lookup O(1)) —
 * pendant one-shot de subscribeFamiliars() (temps réel), utilisé par getPlayerProgressLedger()
 * ci-dessous qui n'a besoin que d'une photo instantanée. */
export async function getTamedFamiliarIds(address: string): Promise<Set<string>> {
  const db = getFirebaseDb();
  if (!db) return new Set();
  const snap = await get(ref(db, `players/${KEY(address)}/familiars`));
  const v = snap.val() as Record<string, unknown> | null;
  return new Set(v ? Object.keys(v) : []);
}

// ────────────────────── État d'avancement / inventaire (ledger combiné) ──────────────────────
// Voir demande utilisateur : nouveau widget flottant "État d'avancement / inventaire" (repliable
// par grand thème, icône ✅/❌ par élément) + même détail dans la rubrique admin "Statistiques par
// joueur". Combine TOUT le catalogue paramétrable (boutique, quêtes, PNJ, trésors, mondes,
// familiers) avec les enregistrements permanents (jamais supprimés) de possession/réussite du
// joueur, afin qu'une seule fonction fasse autorité pour les deux affichages (évite toute
// divergence, comme le bug XP déjà rencontré entre le jeu et l'admin).

/** Ids d'objets (armes/protections/nourriture/potions & sortilèges/engins/trésors boutique/selles)
 * déjà possédés AU MOINS UNE FOIS par ce joueur — marqueur permanent écrit par addToInventory()
 * (`players/{addr}/itemsEverOwned/{itemId}`), jamais supprimé même si l'objet est ensuite
 * entièrement consommé ou retiré de la besace (contrairement à `players/{addr}/inventory` qui,
 * lui, reflète uniquement la quantité COURANTE). */
export async function getItemsEverOwnedIds(address: string): Promise<Set<string>> {
  const db = getFirebaseDb();
  if (!db) return new Set();
  const snap = await get(ref(db, `players/${KEY(address)}/itemsEverOwned`));
  const v = snap.val() as Record<string, unknown> | null;
  return new Set(v ? Object.keys(v) : []);
}

/** Une entrée individuelle affichée dans le widget "État d'avancement / inventaire" : possédé
 * (actuellement ou par le passé)/résolu ou non par le joueur, avec icône ✅/❌ côté UI. `brokenAt`
 * (optionnel) marque une entrée du thème spécial "Cimetière des équipements" : un objet cassé au
 * combat (durabilité à 0, voir applyEquipmentWear) affiché avec sa date de casse plutôt que ✅/❌.
 * `itemId` (optionnel) sert de clé i18n de secours (`item.<itemId>`) quand `id` n'est PAS l'itemId
 * du catalogue — cas du cimetière, où `id` est la clé Firebase unique de chaque casse (un même
 * modèle d'arme peut casser plusieurs fois, `id` doit donc rester unique pour React). */
export interface ProgressEntry { id: string; name: string; i18nKey?: string; owned: boolean; brokenAt?: number; itemId?: string }

/** Sous-groupe repliable au sein d'un thème — utilisé UNIQUEMENT pour "Quêtes du Royaume" afin
 * d'éviter d'afficher les 400 quêtes en une seule liste plate (regroupement par chapitre, voir
 * KINGDOM_CHAPTERS). */
export interface ProgressSubgroup {
  key: string; label: string; icon: string; i18nKey?: string; title?: string; entries: ProgressEntry[];
  ownedCount: number; totalCount: number;
}

/** Un thème complet (ex. "Armes", "Quêtes du Royaume") du widget "État d'avancement / inventaire"
 * — soit une liste plate (`entries`), soit des sous-groupes repliables (`subgroups`). */
export interface ProgressTheme {
  key: string; labelI18nKey: string; icon: string;
  entries?: ProgressEntry[]; subgroups?: ProgressSubgroup[];
  ownedCount: number; totalCount: number;
}

export interface PlayerProgressLedger { themes: ProgressTheme[] }

function progressTheme(key: string, labelI18nKey: string, icon: string, entries: ProgressEntry[]): ProgressTheme {
  return { key, labelI18nKey, icon, entries, ownedCount: entries.filter(e => e.owned).length, totalCount: entries.length };
}

/**
 * Assemble la progression complète d'un joueur, tous thèmes confondus : équipement/consommables
 * de la boutique (armes, protections, nourriture, potions & sortilèges, engins, trésors, selles —
 * via le marqueur permanent itemsEverOwned), familiers apprivoisés, quêtes (classiques/PNJ/
 * archipel/îles sauvages/Royaume — Royaume sous-groupé par chapitre), mondes débloqués, PNJ
 * officiels rencontrés, trésors d'exploration trouvés et historique des équipements cassés au
 * combat ("Cimetière des équipements", voir applyEquipmentWear/getEquipmentGraveyard). Utilisée à
 * la fois par le widget flottant "État d'avancement / inventaire" (ProgressWidget.tsx) et par la
 * rubrique admin "Statistiques par joueur" (PlayerStats.tsx) — une seule fonction fait autorité
 * pour les deux, aucune duplication de logique de classification.
 */
export async function getPlayerProgressLedger(address: string): Promise<PlayerProgressLedger> {
  const [
    shop, quests, npcs, treasures, worlds, familiars, everOwned, solvedQuests, metNpcs, foundTreasures,
    unlockedWorlds, tamedFamiliars, packs, currentInventory, currentEquipment, graveyard,
  ] = await Promise.all([
    getShopCatalog(), getQuestDefs(), getNpcDefs(), getTreasureDefs(), getWorldDefs(), getFamiliarDefs(),
    getItemsEverOwnedIds(address), getAllSolvedQuestIds(address), getMetNpcIds(address), getFoundTreasureIds(address),
    getUnlockedWorldIds(address), getTamedFamiliarIds(address), getContentPackDefs(),
    // ─── Correctif régression : un objet ACHETÉ/GAGNÉ avant l'introduction du marqueur
    // `itemsEverOwned` (ou équipé — voir equipItem() ci-dessus qui le retire de la besace via
    // removeFromInventory SANS jamais passer par addToInventory) n'apparaissait jamais ✅ ici alors
    // qu'il est bel et bien dans la besace ou porté par Synk (bug signalé : épée de maître, amulette
    // d'argile/du voyageur, potions, bourse de rubis en besace + épée épique/flèches/amulette
    // équipées absentes du widget). On complète donc `everOwned` par la photo COURANTE de la besace
    // ET de l'équipement porté, en plus du marqueur permanent — voir fusion juste après.
    getInventoryOnce(address), getEquipment(address), getEquipmentGraveyard(address),
  ]);

  // Fusionne le marqueur permanent avec la possession ACTUELLE (besace + équipement porté) : un
  // objet est considéré "possédé" s'il l'a un jour été marqué OU s'il est encore présent maintenant
  // (couvre tous les objets acquis avant l'ajout du marqueur, sans script de migration séparé).
  const ownedIds = new Set(everOwned);
  for (const it of currentInventory) ownedIds.add(it.itemId);
  // Exclut le slot 'familiar' : son `itemId` est l'id du familier (ex. "dragon.gold", avec un point
  // interdit dans un segment de chemin Firebase — voir RKEY), pas un itemId de boutique ; il est de
  // toute façon déjà couvert séparément par `tamedFamiliars` (voir familiarTheme ci-dessous).
  for (const eq of Object.values(currentEquipment)) if (eq && eq.category !== 'familiar') ownedIds.add(eq.itemId);
  // Auto-réparation silencieuse et non bloquante : persiste dès maintenant le marqueur permanent
  // pour tout objet actuellement possédé/équipé qui ne l'était pas encore, afin que ce correctif
  // n'ait besoin de s'appliquer qu'une seule fois par joueur (les lectures suivantes n'auront plus
  // besoin de fusionner avec la besace/l'équipement pour ces objets-là).
  const db = getFirebaseDb();
  if (db) {
    for (const id of ownedIds) {
      if (!everOwned.has(id)) set(ref(db, `players/${KEY(address)}/itemsEverOwned/${id}`), true).catch(() => {});
    }
  }

  // Mêmes 7 catégories d'objets que les onglets besace/boutique (voir lib/itemTabs.ts) — dupliquées
  // ici en constantes locales plutôt qu'importées, pour ne jamais faire dépendre gameState.ts (la
  // couche de données centrale) d'un fichier UI qui, lui, dépend déjà de gameState.ts.
  const SHOP_THEME_CATS: { key: string; labelI18nKey: string; icon: string; cats: InventoryItem['category'][] }[] = [
    { key: 'weapon', labelI18nKey: 'progress.theme.weapon', icon: '⚔️', cats: ['weapon', 'arrow'] },
    { key: 'armor', labelI18nKey: 'progress.theme.armor', icon: '🛡️', cats: ['armor', 'shield'] },
    { key: 'food', labelI18nKey: 'progress.theme.food', icon: '🍖', cats: ['food'] },
    { key: 'potion', labelI18nKey: 'progress.theme.potion', icon: '🧪', cats: ['potion', 'super_potion', 'spell'] },
    { key: 'vehicle', labelI18nKey: 'progress.theme.vehicle', icon: '🎈', cats: ['vehicle'] },
    { key: 'shopTreasure', labelI18nKey: 'progress.theme.shopTreasure', icon: '💎', cats: ['treasure'] },
    { key: 'saddle', labelI18nKey: 'progress.theme.saddle', icon: '🐎', cats: ['saddle'] },
  ];
  // Correctif régression (2e signalement) : un objet gagné UNIQUEMENT via un coffre au trésor, une
  // récompense de quête ou un butin de combat PNJ (itemId "orphelin", jamais enregistré comme
  // ShopItem — ex. `tresor_epee_maitre` pour l'« Épée de maître (Zelda) ») n'apparaissait JAMAIS
  // dans les thèmes ci-dessus car ceux-ci n'énuméraient que `getShopCatalog()` : même possédé,
  // l'objet n'existait tout simplement pas comme *entrée* de la liste (bug plus profond que le
  // simple indicateur "possédé" déjà corrigé au-dessus). On fusionne donc ici, par itemId, le
  // catalogue boutique avec tous les `itemReward` de trésors/quêtes et le butin de combat PNJ.
  const catalogById = new Map<string, { itemId: string; name: string; category: InventoryItem['category'] }>();
  for (const it of shop) catalogById.set(it.itemId, { itemId: it.itemId, name: it.name, category: it.category });
  for (const tr of treasures) {
    const r = tr.itemReward;
    if (r && !catalogById.has(r.itemId)) catalogById.set(r.itemId, { itemId: r.itemId, name: r.name, category: r.category });
  }
  for (const q of quests) {
    const r = q.itemReward;
    if (r && !catalogById.has(r.itemId)) catalogById.set(r.itemId, { itemId: r.itemId, name: r.name, category: r.category });
  }
  for (const loot of NPC_FIGHT_LOOT_TABLE) {
    if (!catalogById.has(loot.itemId)) catalogById.set(loot.itemId, { itemId: loot.itemId, name: loot.name, category: loot.category });
  }
  // Filet de sécurité ultime : tout itemId actuellement possédé/porté ou marqué "déjà possédé un
  // jour" mais absent de TOUTES les sources ci-dessus (objet legacy, futur ou non catalogué) est
  // quand même ajouté au catalogue fusionné — via son propre nom/catégorie stockés en besace ou en
  // équipement — pour garantir qu'aucun objet réellement possédé ne puisse plus jamais disparaître
  // silencieusement de ce widget, quelle qu'en soit l'origine future.
  for (const it of currentInventory) if (!catalogById.has(it.itemId)) catalogById.set(it.itemId, { itemId: it.itemId, name: it.name, category: it.category });
  for (const eq of Object.values(currentEquipment)) {
    if (eq && eq.category !== 'familiar' && !catalogById.has(eq.itemId)) {
      catalogById.set(eq.itemId, { itemId: eq.itemId, name: eq.name, category: eq.category as InventoryItem['category'] });
    }
  }
  const fullCatalog = Array.from(catalogById.values());
  const shopThemes = SHOP_THEME_CATS.map(({ key, labelI18nKey, icon, cats }) => {
    const catSet = new Set(cats);
    const entries: ProgressEntry[] = fullCatalog.filter(it => catSet.has(it.category))
      .map(it => ({ id: it.itemId, name: it.name, owned: ownedIds.has(it.itemId) }));
    return progressTheme(key, labelI18nKey, icon, entries);
  });

  const familiarTheme = progressTheme('familiar', 'progress.theme.familiar', '🐲',
    familiars.filter(f => f.active).map(f => ({
      id: f.id, name: f.label, i18nKey: f.i18nKey, owned: tamedFamiliars.has(familiarKeyOf(f.id)),
    })));
  const worldTreasureTheme = progressTheme('worldTreasure', 'progress.theme.worldTreasure', '🎁',
    treasures.filter(tr => tr.active).map(tr => ({
      id: tr.id, name: tr.name, i18nKey: tr.i18nKey, owned: foundTreasures.has(RKEY(tr.id)),
    })));
  const worldTheme = progressTheme('world', 'progress.theme.world', '🌀',
    worlds.filter(w => w.active).map(w => ({
      id: w.id, name: w.name, i18nKey: w.i18nKey, owned: unlockedWorlds.has(RKEY(w.id)),
    })));
  const npcTheme = progressTheme('npc', 'progress.theme.npc', '🧙',
    npcs.filter(n => n.active).map(n => ({
      id: n.id, name: n.name, i18nKey: n.i18nKey, owned: metNpcs.has(RKEY(n.id)),
    })));

  // "Cimetière des équipements" — historique des armes/protections/amulettes/boucliers/habits/
  // gants/bottes cassées au combat (durabilité à 0, voir applyEquipmentWear). Chaque casse est une
  // entrée distincte (pas de déduplication par itemId : un même modèle peut casser plusieurs fois),
  // toujours `owned: true` (l'objet a bien existé) — c'est `brokenAt` qui pilote l'affichage 💀 +
  // date au lieu de ✅/❌ côté UI (voir ProgressLedgerView.tsx). Non concerné : les flèches, qui ne
  // "cassent" pas mais se consomment (qty → 0, mécanisme de munitions déjà existant).
  const graveyardTheme = progressTheme('equipmentGraveyard', 'progress.theme.equipmentGraveyard', '💀',
    graveyard.map(g => ({ id: g.id, itemId: g.itemId, name: g.name, owned: true, brokenAt: g.brokenAt })));

  const visibleQuests = quests.filter(q => q.active && isContentPackVisible(q.contentPack, packs));
  const questEntry = (q: QuestDef): ProgressEntry => ({
    id: q.id, name: q.label, i18nKey: q.i18nKey, owned: solvedQuests.has(q.id.toLowerCase()),
  });
  const classicTheme = progressTheme('questClassic', 'progress.theme.questClassic', '📜',
    visibleQuests.filter(q => !q.kingdomQuest && !q.islandKind && !q.npcGiver).map(questEntry));
  const npcQuestTheme = progressTheme('questNpc', 'progress.theme.questNpc', '❓',
    visibleQuests.filter(q => !q.kingdomQuest && !q.islandKind && q.npcGiver).map(questEntry));
  const archipelagoTheme = progressTheme('questArchipelago', 'progress.theme.questArchipelago', '🏝️',
    visibleQuests.filter(q => q.islandKind === 'archipelago').map(questEntry));
  const wildIslandTheme = progressTheme('questWildIsland', 'progress.theme.questWildIsland', '🌴',
    visibleQuests.filter(q => q.islandKind === 'wildIsland').map(questEntry));

  const kingdomQuests = visibleQuests.filter(q => q.kingdomQuest)
    .sort((a, b) => (a.kingdomOrder ?? Number.MAX_SAFE_INTEGER) - (b.kingdomOrder ?? Number.MAX_SAFE_INTEGER));
  const kingdomSubgroups: ProgressSubgroup[] = KINGDOM_CHAPTERS.map(ch => {
    const entries = kingdomQuests.filter(q => q.kingdomChapter === ch.chapter).map(questEntry);
    return {
      key: `chapter${ch.chapter}`, label: `${ch.icon} ${ch.title}`, icon: ch.icon,
      i18nKey: ch.i18nKey, title: ch.title, entries,
      ownedCount: entries.filter(e => e.owned).length, totalCount: entries.length,
    };
  }).filter(g => g.totalCount > 0);
  const kingdomTheme: ProgressTheme = {
    key: 'questKingdom', labelI18nKey: 'progress.theme.questKingdom', icon: '👑', subgroups: kingdomSubgroups,
    ownedCount: kingdomSubgroups.reduce((n, g) => n + g.ownedCount, 0),
    totalCount: kingdomSubgroups.reduce((n, g) => n + g.totalCount, 0),
  };

  return {
    themes: [
      ...shopThemes, graveyardTheme, familiarTheme, worldTreasureTheme, worldTheme, npcTheme,
      classicTheme, npcQuestTheme, archipelagoTheme, wildIslandTheme, kingdomTheme,
    ],
  };
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

/**
 * Presets de recharge fiat (CB/PayPal/Apple Pay/Google Pay → coins de jeu, sans passer par ETH).
 * Paramétrable via l'admin (catalog/fiatTopupPresets), même esprit que TopupPreset ci-dessus.
 * Voir RepRules.fiatPaymentEnabled/fiatSimulationMode et WalletTopupWidget.tsx.
 */
export interface FiatTopupPreset {
  priceLabel: string; // prix affiché (ex "4,99 €") — informatif tant que fiatSimulationMode=true
  coins: number;       // crédit monnaie du jeu
}

export const DEFAULT_FIAT_TOPUP_PRESETS: FiatTopupPreset[] = [
  { priceLabel: '0,99 €', coins: 500 },
  { priceLabel: '3,99 €', coins: 2000 },
  { priceLabel: '8,99 €', coins: 5000 },
  { priceLabel: '19,99 €', coins: 12000 },
];

export async function getFiatTopupPresets(): Promise<FiatTopupPreset[]> {
  const db = getFirebaseDb();
  if (!db) return DEFAULT_FIAT_TOPUP_PRESETS;
  const snap = await get(ref(db, 'catalog/fiatTopupPresets'));
  const v = snap.val() as FiatTopupPreset[] | null;
  return Array.isArray(v) && v.length > 0 ? v : DEFAULT_FIAT_TOPUP_PRESETS;
}

export async function setFiatTopupPresets(presets: FiatTopupPreset[]): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, 'catalog/fiatTopupPresets'), presets);
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

// ═══════════════════════════ Intelligence IA GamePlay (analyse comportementale) ═══════════════════════════
//
// Système d'analyse fine du comportement des joueurs (sessions/DAU, temps passé par widget,
// entonnoir de quêtes, heatmap de fréquentation de la carte, localisation des évanouissements,
// signaux de monétisation, score de risque de décrochage) + cache d'insights générés par un LLM
// gratuit (voir web/src/app/api/ai/insights/route.ts). 100% hors-chaîne (Firebase RTDB), toujours
// sous players/{addr}/analytics/* ou catalog/analytics*/aiAnalyticsSettings/aiInsightsCache — déjà
// couverts par les règles génériques `players/$addr` et `catalog` (voir docs/FIREBASE_CHAT.md §4,
// aucune republication requise).
//
// Règle absolue : TOUTES les fonctions track*/mark* ci-dessous sont fire-and-forget, avalent leurs
// propres erreurs et respectent l'interrupteur global `AiAnalyticsSettings.enabled` — elles ne
// doivent jamais bloquer, ralentir ou faire échouer une action de jeu existante (voir points
// d'injection : getOrCreatePlayer, setPlayerMapPos, submitQuestAnswerOffchain, useDraggableWidget,
// GameCanvas2D).

export interface AiAnalyticsSettings {
  enabled: boolean;                 // interrupteur global — coupe tout tracking si false (aucune régression du jeu)
  mapHeatmapGridSize: number;       // taille de maille (%) pour regrouper les positions sur la heatmap (défaut 5)
  faintEventsRetentionDays: number; // fenêtre affichée par défaut dans le panneau admin (purge non automatique)
  aiEnabled: boolean;               // active la section « Assistant IA » (bouton Générer une analyse)
  aiProvider: 'gemini' | 'groq' | 'cerebras' | 'openrouter'; // fournisseur LLM 100% gratuit utilisé par la route API serveur
  aiModel: string;                  // ex. "gemini-2.0-flash", "llama-3.3-70b-versatile" (Groq), "llama-3.3-70b" (Cerebras) ou "meta-llama/llama-3.3-70b-instruct:free" (OpenRouter)
  aiAutoRefreshHours: number;       // délai mini entre deux régénérations (respect du quota gratuit)
}

export const DEFAULT_AI_ANALYTICS_SETTINGS: AiAnalyticsSettings = {
  enabled: true,
  mapHeatmapGridSize: 5,
  faintEventsRetentionDays: 90,
  aiEnabled: true,
  aiProvider: 'gemini',
  aiModel: 'gemini-2.0-flash',
  aiAutoRefreshHours: 6,
};

export async function getAiAnalyticsSettings(): Promise<AiAnalyticsSettings> {
  const db = getFirebaseDb();
  if (!db) return DEFAULT_AI_ANALYTICS_SETTINGS;
  const snap = await get(ref(db, 'catalog/aiAnalyticsSettings'));
  const v = snap.val() as Partial<AiAnalyticsSettings> | null;
  return { ...DEFAULT_AI_ANALYTICS_SETTINGS, ...(v || {}) };
}

export async function setAiAnalyticsSettings(settings: AiAnalyticsSettings): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, 'catalog/aiAnalyticsSettings'), settings);
  _aiSettingsCache = null;
}

// Cache 30s (même logique que `getCapRules`/`_capRulesCache`) : évite une lecture Firebase à
// chaque évènement de tracking (potentiellement très fréquent : déplacement, ouverture de widget…).
let _aiSettingsCache: { value: AiAnalyticsSettings; at: number } | null = null;
async function getCachedAiAnalyticsSettings(): Promise<AiAnalyticsSettings> {
  const now = Date.now();
  if (_aiSettingsCache && now - _aiSettingsCache.at < 30000) return _aiSettingsCache.value;
  const value = await getAiAnalyticsSettings().catch(() => DEFAULT_AI_ANALYTICS_SETTINGS);
  _aiSettingsCache = { value, at: now };
  return value;
}

/** Clé du jour courant (UTC), ex. "2024-06-05" — même format que `todayKey()` (dailyLuck), pour
 * rester cohérent dans toute la base. */
function analyticsDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────── Suivi ciblé par joueur (opt-in/opt-out individuel) ───────────────────────────────
//
// Permet à l'admin d'activer ou désactiver l'analyse fine pour UN joueur en particulier — sans
// changer le comportement des autres joueurs (aucune régression) : par défaut ('default'), chaque
// joueur suit simplement l'interrupteur global `AiAnalyticsSettings.enabled`, exactement comme
// avant l'introduction de cette fonctionnalité. Deux cas d'usage :
//   - 'disabled' : opt-out pour ce joueur précis (ex. demande de confidentialité), même si le
//     suivi global est actif — ses évènements ne sont écrits ni côté joueur, ni dans les agrégats
//     globaux.
//   - 'enabled'  : force le suivi pour ce joueur précis même si le suivi global est désactivé —
//     permet d'étudier un joueur ciblé « pas forcément tous les joueurs ».

export type PlayerAnalyticsOverride = 'default' | 'enabled' | 'disabled';

export async function getPlayerAnalyticsOverride(address: string): Promise<PlayerAnalyticsOverride> {
  const db = getFirebaseDb();
  if (!db) return 'default';
  const snap = await get(ref(db, `players/${KEY(address)}/analytics/trackingOverride`));
  const v = snap.val();
  return v === 'enabled' || v === 'disabled' ? v : 'default';
}

export async function setPlayerAnalyticsOverride(address: string, value: PlayerAnalyticsOverride): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  const k = KEY(address);
  await set(ref(db, `players/${k}/analytics/trackingOverride`), value === 'default' ? null : value);
  _playerOverrideCache.delete(k);
}

// Cache 30s par joueur (même logique que `_aiSettingsCache`) : les fonctions track*/mark* peuvent
// être appelées très fréquemment (déplacement, ouverture de widget) et ne doivent jamais ajouter
// de latence perceptible au gameplay.
const _playerOverrideCache = new Map<string, { value: PlayerAnalyticsOverride; at: number }>();
async function getCachedPlayerAnalyticsOverride(address: string): Promise<PlayerAnalyticsOverride> {
  const k = KEY(address);
  const now = Date.now();
  const cached = _playerOverrideCache.get(k);
  if (cached && now - cached.at < 30000) return cached.value;
  const value = await getPlayerAnalyticsOverride(k).catch(() => 'default' as PlayerAnalyticsOverride);
  _playerOverrideCache.set(k, { value, at: now });
  return value;
}

/** Résout si le suivi doit être actif pour ce joueur précis : l'override individuel (s'il existe)
 * prime toujours sur l'interrupteur global, qui reste le comportement par défaut. */
async function isTrackingEnabledForPlayer(address: string, settings: AiAnalyticsSettings): Promise<boolean> {
  const override = await getCachedPlayerAnalyticsOverride(address);
  if (override === 'enabled') return true;
  if (override === 'disabled') return false;
  return settings.enabled;
}

// ─────────────────────────────── Sessions, joueurs actifs (DAU) & rétention ───────────────────────────────

/**
 * Marque le joueur actif aujourd'hui : idempotent (une seule écriture réelle par jour et par
 * joueur, vérifiée via un `get()` préalable), incrémente le compteur global
 * `catalog/analytics/dauGlobal/{jour}` une seule fois par joueur/jour pour permettre un calcul
 * O(1) du nombre de joueurs actifs (pas besoin de parcourir tous les joueurs). Appelé depuis
 * `getOrCreatePlayer` (bootstrap de session, à chaque connexion/chargement du jeu).
 */
export async function markPlayerActiveToday(address: string): Promise<void> {
  const settings = await getCachedAiAnalyticsSettings();
  if (!(await isTrackingEnabledForPlayer(address, settings))) return;
  const db = getFirebaseDb();
  if (!db) return;
  const k = KEY(address);
  const day = analyticsDayKey();
  const path = `players/${k}/analytics/dailyActive/${day}`;
  const already = await get(ref(db, path)).catch(() => null);
  if (already?.exists()) {
    update(ref(db, `players/${k}/analytics`), { lastSeenAt: Date.now() }).catch(() => {});
    return;
  }
  await ensureAnonSignIn();
  await set(ref(db, path), true).catch(() => {});
  update(ref(db, `players/${k}/analytics`), { lastSeenAt: Date.now() }).catch(() => {});
  runTransaction(ref(db, `catalog/analytics/dauGlobal/${day}`), (cur) => (cur ?? 0) + 1).catch(() => {});
}

// ─────────────────────────────────────── Temps de jeu par joueur ───────────────────────────────────────

export interface PlaytimeStats {
  totalMs: number;   // temps de jeu cumulé depuis la toute première session (jamais réinitialisé)
  todayMs: number;   // temps de jeu de la journée calendaire courante (UTC, réinitialisé chaque jour)
}

/**
 * Enregistre un "battement" de temps de jeu écoulé (appelé à intervalle régulier — voir
 * `RepRules.playtimeHeartbeatSec` — tant que la page /game reste ouverte ET l'onglet visible ;
 * voir `VoxlynDashboard` dans `game/page.tsx`, seul point d'appel). Incrémente en une seule
 * transaction O(1) le compteur cumulé ET celui du jour courant (clé `analyticsDayKey()`, identique
 * au format déjà utilisé par `markPlayerActiveToday`/DAU pour rester cohérent dans toute la base).
 * Statistique de jeu DE BASE (temps de vie du compagnon, comme la faim ou l'XP) — volontairement
 * PAS soumise à l'interrupteur optionnel `AiAnalyticsSettings.enabled` (celui-ci ne gouverne que le
 * module d'analyse comportementale « Intelligence IA GamePlay »), seulement à son propre
 * interrupteur dédié `RepRules.playtimeTrackingEnabled`.
 */
export async function trackPlaytimeHeartbeat(address: string, deltaMs: number): Promise<void> {
  if (deltaMs <= 0) return;
  const rules = await getRepRules().catch(() => DEFAULT_REP_RULES);
  if (rules.playtimeTrackingEnabled === false) return;
  const db = getFirebaseDb();
  if (!db) return;
  const k = KEY(address);
  const day = analyticsDayKey();
  await ensureAnonSignIn();
  await Promise.all([
    runTransaction(ref(db, `players/${k}/playtime/totalMs`), (cur) => (cur ?? 0) + deltaMs).catch(() => {}),
    runTransaction(ref(db, `players/${k}/playtime/daily/${day}`), (cur) => (cur ?? 0) + deltaMs).catch(() => {}),
  ]);
}

/** Lit le temps de jeu cumulé + celui de la journée courante d'un joueur — utilisé par la rubrique
 * "Statistiques par joueur" du menu Administration (voir PlayerStats.tsx). */
export async function getPlayerPlaytimeStats(address: string): Promise<PlaytimeStats> {
  const db = getFirebaseDb();
  if (!db) return { totalMs: 0, todayMs: 0 };
  const k = KEY(address);
  const day = analyticsDayKey();
  const [totalSnap, todaySnap] = await Promise.all([
    get(ref(db, `players/${k}/playtime/totalMs`)),
    get(ref(db, `players/${k}/playtime/daily/${day}`)),
  ]);
  return {
    totalMs: (totalSnap.val() as number | null) ?? 0,
    todayMs: (todaySnap.val() as number | null) ?? 0,
  };
}

/** Série temporelle du nombre de joueurs actifs par jour (30 derniers jours par défaut) — une
 * seule lecture Firebase (pas d'itération des joueurs). */
export async function getDauSeries(days = 30): Promise<{ day: string; count: number }[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  const snap = await get(ref(db, 'catalog/analytics/dauGlobal'));
  const v = snap.val() as Record<string, number> | null;
  const out: { day: string; count: number }[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const key = analyticsDayKey(d);
    out.push({ day: key, count: v?.[key] ?? 0 });
  }
  return out;
}

/**
 * Estimation de rétention (approximative) : parmi les joueurs actifs il y a exactement
 * `windowDaysAgo` jours, quelle proportion l'est encore aujourd'hui (ou dans les `toleranceDays`
 * jours suivant l'ancre). Parcourt un échantillon borné de joueurs (`listPlayers()`, plafonné à
 * `sampleCap`) — même ordre de coût que les statistiques admin existantes qui itèrent déjà tous
 * les joueurs (PlayerStats, Scoreboard).
 */
export async function getRetentionEstimate(
  windowDaysAgo: number, toleranceDays = 3, sampleCap = 300,
): Promise<{ cohort: number; retained: number; pct: number }> {
  const db = getFirebaseDb();
  if (!db) return { cohort: 0, retained: 0, pct: 0 };
  const players = (await listPlayers().catch(() => [])).slice(0, sampleCap);
  const now = new Date();
  const anchor = new Date(now); anchor.setDate(anchor.getDate() - windowDaysAgo);
  const anchorKey = analyticsDayKey(anchor);
  let cohort = 0, retained = 0;
  await Promise.all(players.map(async (addr) => {
    const snap = await get(ref(db, `players/${KEY(addr)}/analytics/dailyActive`)).catch(() => null);
    const v = snap?.val() as Record<string, true> | null;
    if (!v || !v[anchorKey]) return;
    cohort++;
    for (let i = 0; i <= toleranceDays; i++) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      if (v[analyticsDayKey(d)]) { retained++; return; }
    }
  }));
  return { cohort, retained, pct: cohort > 0 ? Math.round((retained / cohort) * 100) : 0 };
}

// ─────────────────────────────────────── Temps passé par widget ───────────────────────────────────────

export interface WidgetUsageAgg { opens: number; totalMs: number; lastOpenedAt: number }

/**
 * Enregistre une session d'ouverture d'un widget flottant (appelé en fire-and-forget par
 * `useDraggableWidget`, le seul point d'injection couvrant les 12 fenêtres flottantes du jeu, à
 * chaque fermeture/démontage). `widgetId` = la clé localStorage `posKey` du widget (déjà unique et
 * stable, ex. "zc.statsWidgetPos") — pas besoin d'un identifiant dédié supplémentaire. Ignore les
 * durées < 500 ms (clic accidentel qui ouvre/ferme aussitôt).
 */
export async function trackWidgetUsage(address: string, widgetId: string, durationMs: number): Promise<void> {
  if (durationMs < 500) return;
  const settings = await getCachedAiAnalyticsSettings();
  if (!(await isTrackingEnabledForPlayer(address, settings))) return;
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  const now = Date.now();
  const bump = (cur: WidgetUsageAgg | null) => ({
    opens: (cur?.opens ?? 0) + 1, totalMs: (cur?.totalMs ?? 0) + durationMs, lastOpenedAt: now,
  });
  const wid = RKEY(widgetId);
  await Promise.all([
    runTransaction(ref(db, `players/${KEY(address)}/analytics/widgetUsage/${wid}`), bump).catch(() => {}),
    runTransaction(ref(db, `catalog/analytics/widgetUsageGlobal/${wid}`), bump).catch(() => {}),
  ]);
}

export async function getWidgetUsageGlobal(): Promise<Record<string, WidgetUsageAgg>> {
  const db = getFirebaseDb();
  if (!db) return {};
  const snap = await get(ref(db, 'catalog/analytics/widgetUsageGlobal'));
  return (snap.val() as Record<string, WidgetUsageAgg> | null) ?? {};
}

// ─────────────────────────────────────── Entonnoir de quêtes ───────────────────────────────────────

export type QuestFunnelEvent = 'blocked' | 'fail' | 'solved';

/** Catégorise une quête pour l'analyse (ne modifie/n'expose rien côté jeu, purement analytique). */
function deriveQuestCategory(q: Pick<QuestDef, 'kingdomQuest' | 'npcGiver' | 'fullMoonOnly' | 'islandKind'>): string {
  if (q.fullMoonOnly) return 'fullMoon';
  if (q.islandKind) return 'island';
  if (q.kingdomQuest) return 'kingdom';
  if (q.npcGiver) return 'npc';
  return 'classic';
}

/**
 * Trace un évènement d'entonnoir de quête (bloquée par objets manquants, réponse fausse, réussie)
 * — permet de repérer les quêtes qui font perdre le plus de temps ou qui sont le plus abandonnées.
 * Écrit à la fois un évènement horodaté par joueur (deep-dive) et un compteur global agrégé (vue
 * d'ensemble en O(1)). Appelé en fire-and-forget depuis `submitQuestAnswerOffchain` : n'altère
 * jamais sa valeur de retour ni son comportement existant.
 */
export async function trackQuestFunnelEvent(
  address: string, questId: string, category: string, event: QuestFunnelEvent,
): Promise<void> {
  const settings = await getCachedAiAnalyticsSettings();
  if (!(await isTrackingEnabledForPlayer(address, settings))) return;
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  const clean = { questId, category, event, timestamp: Date.now() };
  await Promise.all([
    push(ref(db, `players/${KEY(address)}/analytics/questEvents`), clean).catch(() => {}),
    runTransaction(ref(db, `catalog/analytics/questFunnelGlobal/${RKEY(questId)}/${event}`), (cur) => (cur ?? 0) + 1).catch(() => {}),
  ]);
}

export interface QuestFunnelSummary { questId: string; blocked: number; fail: number; solved: number }

export async function getQuestFunnelGlobal(): Promise<QuestFunnelSummary[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  const snap = await get(ref(db, 'catalog/analytics/questFunnelGlobal'));
  const v = snap.val() as Record<string, Partial<Record<QuestFunnelEvent, number>>> | null;
  if (!v) return [];
  return Object.entries(v).map(([questId, counts]) => ({
    questId, blocked: counts.blocked ?? 0, fail: counts.fail ?? 0, solved: counts.solved ?? 0,
  })).sort((a, b) => (b.blocked + b.fail) - (a.blocked + a.fail));
}

// ─────────────────────────────────────── Heatmap de la carte ───────────────────────────────────────

export interface HeatCell { gx: number; gy: number; count: number }

/** Regroupe une position (0-100, 0-100) en maille de `gridSize` % pour borner la taille de la
 * heatmap (paramétrable via `AiAnalyticsSettings.mapHeatmapGridSize`, menu Administration). */
function gridKeyOf(x: number, y: number, gridSize: number): string {
  const gx = Math.floor(x / Math.max(1, gridSize));
  const gy = Math.floor(y / Math.max(1, gridSize));
  return `${gx}_${gy}`;
}

/** Incrémente la densité de fréquentation de la carte — appelé en fire-and-forget par
 * `setPlayerMapPos` (seul point d'écriture de la position de Synk, partagé par WorldMapWidget et
 * GameCanvas2D). `address` permet de respecter un éventuel override de suivi ciblé par joueur
 * (voir `isTrackingEnabledForPlayer`) avant de contribuer à l'agrégat global. */
async function trackMapHeatmap(address: string, mapId: string, x: number, y: number): Promise<void> {
  const settings = await getCachedAiAnalyticsSettings();
  if (!(await isTrackingEnabledForPlayer(address, settings))) return;
  const db = getFirebaseDb();
  if (!db) return;
  const key = gridKeyOf(x, y, settings.mapHeatmapGridSize);
  runTransaction(ref(db, `catalog/analytics/mapHeatmapGlobal/${RKEY(mapId)}/${key}`), (cur) => (cur ?? 0) + 1).catch(() => {});
}

export async function getMapHeatmap(mapId: string): Promise<HeatCell[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  const snap = await get(ref(db, `catalog/analytics/mapHeatmapGlobal/${RKEY(mapId)}`));
  const v = snap.val() as Record<string, number> | null;
  if (!v) return [];
  return Object.entries(v).map(([k, count]) => {
    const [gx, gy] = k.split('_').map(Number);
    return { gx, gy, count };
  }).sort((a, b) => b.count - a.count);
}

// ─────────────────────────────────────── Évanouissements ───────────────────────────────────────

export interface FaintEventRecord { mapId: string; x: number; y: number; cause: 'oxygen' | 'fatigue'; timestamp: number }

/** Trace un évanouissement (noyade en dalle d'eau ou épuisement) avec sa localisation — utilisé
 * pour repérer les zones où les joueurs perdent le plus de temps/de progression. Appelé en
 * fire-and-forget depuis `GameCanvas2D` (déclencheurs déjà en place, aucune régression). */
export async function trackFaintEvent(
  address: string, mapId: string, x: number, y: number, cause: FaintEventRecord['cause'],
): Promise<void> {
  const settings = await getCachedAiAnalyticsSettings();
  if (!(await isTrackingEnabledForPlayer(address, settings))) return;
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  const rec: FaintEventRecord = { mapId, x: Math.round(x), y: Math.round(y), cause, timestamp: Date.now() };
  await Promise.all([
    push(ref(db, `players/${KEY(address)}/analytics/faintEvents`), rec).catch(() => {}),
    runTransaction(
      ref(db, `catalog/analytics/faintHeatmapGlobal/${RKEY(mapId)}/${gridKeyOf(x, y, settings.mapHeatmapGridSize)}`),
      (cur) => (cur ?? 0) + 1,
    ).catch(() => {}),
    runTransaction(ref(db, `catalog/analytics/faintCauseGlobal/${cause}`), (cur) => (cur ?? 0) + 1).catch(() => {}),
  ]);
}

export async function getFaintHeatmap(mapId: string): Promise<HeatCell[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  const snap = await get(ref(db, `catalog/analytics/faintHeatmapGlobal/${RKEY(mapId)}`));
  const v = snap.val() as Record<string, number> | null;
  if (!v) return [];
  return Object.entries(v).map(([k, count]) => {
    const [gx, gy] = k.split('_').map(Number);
    return { gx, gy, count };
  }).sort((a, b) => b.count - a.count);
}

export async function getFaintCauseBreakdown(): Promise<{ oxygen: number; fatigue: number }> {
  const db = getFirebaseDb();
  if (!db) return { oxygen: 0, fatigue: 0 };
  const snap = await get(ref(db, 'catalog/analytics/faintCauseGlobal'));
  const v = snap.val() as Record<string, number> | null;
  return { oxygen: v?.oxygen ?? 0, fatigue: v?.fatigue ?? 0 };
}

// ─────────────────────────────────────── Signaux de monétisation ───────────────────────────────────────

export interface MonetizationOverview {
  totalConfirmed: number;
  totalFailed: number;
  totalEthSpentApprox: number;
  byType: Record<string, number>;
}

/**
 * Vue d'ensemble monétisation dérivée des transactions déjà loguées (`logTx`, voir
 * `players/{addr}/txs`) — aucune nouvelle écriture nécessaire, on ré-agrège une donnée existante
 * en la parcourant sur un échantillon borné de joueurs (même coût que PlayerStats/Scoreboard, qui
 * itèrent déjà tous les joueurs).
 */
export async function getMonetizationOverview(sampleCap = 300): Promise<MonetizationOverview> {
  const players = (await listPlayers().catch(() => [])).slice(0, sampleCap);
  const byType: Record<string, number> = {};
  let totalConfirmed = 0, totalFailed = 0, totalEthSpentApprox = 0;
  await Promise.all(players.map(async (addr) => {
    const txs = await getTxs(addr).catch(() => []);
    for (const tx of txs) {
      if (tx.status === 'failed') { totalFailed++; continue; }
      totalConfirmed++;
      byType[tx.type] = (byType[tx.type] ?? 0) + 1;
      const amount = parseFloat(tx.valueEth || '0');
      if (!Number.isNaN(amount)) totalEthSpentApprox += amount;
    }
  }));
  return { totalConfirmed, totalFailed, totalEthSpentApprox, byType };
}

/**
 * Vue d'ensemble des rencontres PNJ dérivée de `players/{addr}/encounters` (déjà logué par
 * `logEncounter`) — répartition par type d'offre (combat/troc/quête/discussion) et par issue.
 */
export async function getNpcEncounterOverview(sampleCap = 300): Promise<{
  byOffer: Record<string, number>; byOutcome: Record<string, number>; total: number;
}> {
  const players = (await listPlayers().catch(() => [])).slice(0, sampleCap);
  const byOffer: Record<string, number> = {};
  const byOutcome: Record<string, number> = {};
  let total = 0;
  await Promise.all(players.map(async (addr) => {
    const encs = await getEncounters(addr, 500).catch(() => []);
    for (const e of encs) {
      total++;
      byOffer[e.offer] = (byOffer[e.offer] ?? 0) + 1;
      if (e.outcome) byOutcome[e.outcome] = (byOutcome[e.outcome] ?? 0) + 1;
    }
  }));
  return { byOffer, byOutcome, total };
}

// ─────────────────────────────────────── Profil analytique par joueur ───────────────────────────────────────

export interface PlayerAnalyticsSummary {
  address: string;
  lastSeenAt: number | null;
  daysActiveLast30: number;
  faintCount: number;
  questFail: number;
  questBlocked: number;
  questSolved: number;
  totalWidgetTimeMs: number;
  /** Score de risque de décrochage (0-100, plus haut = plus à risque) — pondère l'inactivité
   * récente, le taux d'échec/blocage de quêtes et la fréquence d'évanouissement. Formule simple et
   * transparente (calculée à la volée, jamais stockée), ajustable si besoin futur. */
  churnScore: number;
}

export async function getPlayerAnalyticsSummary(address: string): Promise<PlayerAnalyticsSummary> {
  const k = KEY(address);
  const empty: PlayerAnalyticsSummary = {
    address: k, lastSeenAt: null, daysActiveLast30: 0, faintCount: 0,
    questFail: 0, questBlocked: 0, questSolved: 0, totalWidgetTimeMs: 0, churnScore: 0,
  };
  const db = getFirebaseDb();
  if (!db) return empty;
  const [analyticsSnap, questEventsSnap, widgetSnap] = await Promise.all([
    get(ref(db, `players/${k}/analytics`)),
    get(ref(db, `players/${k}/analytics/questEvents`)),
    get(ref(db, `players/${k}/analytics/widgetUsage`)),
  ]);
  const a = analyticsSnap.val() as {
    lastSeenAt?: number; dailyActive?: Record<string, true>; faintEvents?: Record<string, FaintEventRecord>;
  } | null;
  const lastSeenAt = a?.lastSeenAt ?? null;
  const nowMs = Date.now();
  const daysActiveLast30 = a?.dailyActive
    ? Object.keys(a.dailyActive).filter(d => (nowMs - new Date(d).getTime()) / 86_400_000 <= 30).length
    : 0;
  const faintCount = a?.faintEvents ? Object.keys(a.faintEvents).length : 0;
  const qeVal = questEventsSnap.val() as Record<string, { event: QuestFunnelEvent }> | null;
  let questFail = 0, questBlocked = 0, questSolved = 0;
  if (qeVal) {
    for (const e of Object.values(qeVal)) {
      if (e.event === 'fail') questFail++;
      else if (e.event === 'blocked') questBlocked++;
      else if (e.event === 'solved') questSolved++;
    }
  }
  const wVal = widgetSnap.val() as Record<string, WidgetUsageAgg> | null;
  const totalWidgetTimeMs = wVal ? Object.values(wVal).reduce((s, w) => s + (w.totalMs ?? 0), 0) : 0;
  const daysSinceSeen = lastSeenAt ? (nowMs - lastSeenAt) / 86_400_000 : 999;
  const inactivityScore = Math.min(50, Math.round(daysSinceSeen * 5));
  const questTotal = questSolved + questFail + questBlocked;
  const questPain = questTotal > 0 ? Math.round(((questFail + questBlocked) / questTotal) * 30) : 0;
  const faintPain = Math.min(20, faintCount * 2);
  const churnScore = Math.min(100, inactivityScore + questPain + faintPain);
  return {
    address: k, lastSeenAt, daysActiveLast30, faintCount, questFail, questBlocked, questSolved,
    totalWidgetTimeMs, churnScore,
  };
}

/**
 * Détail brut (non agrégé) du temps passé par widget pour UN joueur — utilisé par la vue « Suivi
 * ciblé par joueur » du panneau admin pour étudier son gameplay en profondeur, contrairement à
 * `getWidgetUsageGlobal` qui agrège tous les joueurs.
 */
export async function getPlayerWidgetUsageDetail(address: string): Promise<Record<string, WidgetUsageAgg>> {
  const db = getFirebaseDb();
  if (!db) return {};
  const snap = await get(ref(db, `players/${KEY(address)}/analytics/widgetUsage`));
  return (snap.val() as Record<string, WidgetUsageAgg> | null) ?? {};
}

export interface PlayerQuestFunnelEntry { questId: string; category: string; event: QuestFunnelEvent; timestamp: number }

/** Historique brut (le plus récent en premier) des évènements d'entonnoir de quête pour UN joueur
 * — permet de suivre précisément où un joueur ciblé bloque/échoue/réussit ses quêtes. */
export async function getPlayerQuestFunnelDetail(address: string, limitN = 100): Promise<PlayerQuestFunnelEntry[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  const snap = await get(ref(db, `players/${KEY(address)}/analytics/questEvents`));
  const v = snap.val() as Record<string, PlayerQuestFunnelEntry> | null;
  if (!v) return [];
  return Object.values(v).sort((a, b) => b.timestamp - a.timestamp).slice(0, limitN);
}

/** Historique brut (le plus récent en premier) des évanouissements pour UN joueur ciblé. */
export async function getPlayerFaintEventsDetail(address: string, limitN = 100): Promise<FaintEventRecord[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  const snap = await get(ref(db, `players/${KEY(address)}/analytics/faintEvents`));
  const v = snap.val() as Record<string, FaintEventRecord> | null;
  if (!v) return [];
  return Object.values(v).sort((a, b) => b.timestamp - a.timestamp).slice(0, limitN);
}

// ─────────────────────────────────────── Cache des insights IA ───────────────────────────────────────

export interface AiInsightsCache { text: string; generatedAt: number; model: string; provider?: 'gemini' | 'groq' | 'cerebras' | 'openrouter' }

export async function getAiInsightsCache(): Promise<AiInsightsCache | null> {
  const db = getFirebaseDb();
  if (!db) return null;
  const snap = await get(ref(db, 'catalog/aiInsightsCache'));
  return (snap.val() as AiInsightsCache | null) ?? null;
}

export async function setAiInsightsCache(cache: AiInsightsCache): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await set(ref(db, 'catalog/aiInsightsCache'), cache);
}

// ═══════════════════════ Accès Démo & paiement fiat sans portefeuille crypto ═══════════════════════
// Voir docs/DEMO_FIAT.md pour la vue d'ensemble. Chemins RTDB :
//   demoAccessRequests/{uid}     → DemoAccessRequest (registre des comptes Démo/fiat — accès immédiat, voir logAccountAccess)
//   demoSessions/demo/{uid}      → { startedAt } + onDisconnect (compteur de sessions Démo actives)
//   demoSessions/anon/{uid}      → { startedAt } + onDisconnect (compteur de sessions Démo anonymes actives)
// L'adresse virtuelle (jamais une vraie clé privée) est dérivée de façon déterministe de l'UID
// Firebase Auth : keccak256(uid) tronqué à 20 octets, formaté en adresse EVM — permet de réutiliser
// TOUTE l'infrastructure existante (players/{addr}, txs, inventaire...) sans aucune modification.

/** Dérive une adresse EVM virtuelle stable à partir d'un UID Firebase Auth (Google/email/anonyme).
 * Ne correspond à AUCUNE clé privée réelle : sert uniquement de clé Firebase pour les comptes
 * 'demo'/'fiat', afin de réutiliser tel quel le modèle `players/{addr}` existant. */
export function deriveVirtualAddress(uid: string): string {
  const hash = keccak256(toBytes(`horizon-zeldcraft-virtual:${uid}`)); // 0x + 64 hex chars
  return `0x${hash.slice(-40)}`;
}

/** Reproduit côté client la formule de progression du smart contract (voir
 * contracts/contracts/HorizonZeldCraft.sol::_levelFromXp/_stageFromLevel) pour calculer le
 * niveau/stade d'un compte 'demo'/'fiat' dont TOUTE la progression est portée par `xpBonus`
 * (aucune lecture on-chain possible, ces comptes n'ayant pas de Voxlyn minté). `stageIndex`
 * correspond directement à l'index dans STAGE_NAMES (contract.ts) : 0=egg, 1=hatched, 2=juvenile,
 * 3=adult, 4=ancient — même convention que le champ `stage` du tuple on-chain `voxlyns(tokenId)`. */
export function computeOffchainStageLevel(totalXp: number): { level: number; stageIndex: number } {
  let level = 1;
  let threshold = 10;
  let xp = Math.max(0, Math.floor(totalXp));
  while (xp >= threshold) {
    xp -= threshold;
    level++;
    threshold += level * 10;
  }
  const stageIndex = level >= 100 ? 4 : level >= 50 ? 3 : level >= 20 ? 2 : level >= 5 ? 1 : 0;
  return { level, stageIndex };
}

/** Compte "Démo"/"fiat" (sans portefeuille crypto) enregistré au registre admin — voir menu
 * Administration §"Demandes d'accès Démo". Historiquement une file d'attente à valider/rejeter ;
 * l'accès Google/e-mail est désormais accordé IMMÉDIATEMENT sans validation (voir
 * `logAccountAccess` ci-dessous), ce panneau sert maintenant de REGISTRE/AUDIT (une ligne par
 * compte, avec le nombre de connexions et la dernière date) et permet à l'admin de mettre en pause
 * ou de supprimer un compte a posteriori (ex. abus, tricherie). */
export interface DemoAccessRequest {
  uid: string;              // UID Firebase Auth (Google ou e-mail)
  address: string;          // adresse virtuelle dérivée (voir deriveVirtualAddress)
  displayName?: string;
  email?: string;
  method: 'google' | 'email' | 'apple';
  accessMode: 'demo' | 'fiat'; // bouton utilisé : "🎟️ Accès Démo" ou "💳 Jouer sans portefeuille"
  status: 'pending' | 'approved' | 'rejected'; // conservé pour compat d'affichage — toujours 'approved' pour un nouveau compte (accès immédiat, voir logAccountAccess)
  paused?: boolean;          // true = admin a mis ce compte en pause (accès bloqué, données conservées)
  requestedAt: number;       // date de première connexion
  decidedAt?: number;        // conservé pour compat (anciennes entrées 'approved'/'rejected' pré-auto-accès)
  lastLoginAt?: number;      // date de la dernière connexion (mise à jour à chaque login)
  loginCount?: number;       // nombre total de connexions
  // ─── Chrono de session Démo (voir RepRules.demoSessionMaxDurationMin, 2h par défaut) ───
  // Uniquement pour accessMode === 'demo' (Google, connexion identifiée) — la limite de durée ne
  // s'applique jamais à un compte 'fiat' (payant). Horodatage de départ du chrono en cours,
  // renseigné une seule fois (jamais réécrit par une reconnexion normale — seul l'admin peut le
  // relancer via `resetDemoAccountTimer()`, bouton "🔄 Réactiver le chrono Démo" ci-dessous) afin
  // qu'une simple déconnexion/reconnexion ne permette pas de contourner la limite.
  demoSessionStartedAt?: number;
  // Surcharge PAR JOUEUR de la durée max de session Démo (en minutes) — paramétrable depuis
  // Administration > Statistiques par joueur > "Compte Démo / sans portefeuille" (voir
  // `setDemoSessionMaxDurationOverride` ci-dessous). Si absent (undefined), le joueur utilise la
  // valeur GLOBALE `RepRules.demoSessionMaxDurationMin` (120 min = 2h par défaut) — comportement
  // strictement inchangé pour tous les comptes n'ayant jamais reçu de surcharge explicite.
  // Uniquement pertinent pour `accessMode === 'demo'` (jamais pour 'fiat', ni pour le mode anonyme
  // qui n'a pas d'entrée nominative dans ce registre — voir commentaire plus bas).
  maxDurationMinOverride?: number;
}

/**
 * Enregistre/actualise l'accès d'un compte Démo/fiat (Google ou e-mail) — appelée à CHAQUE
 * connexion réussie (voir NoWalletAccessPanel.tsx). L'accès est désormais accordé immédiatement,
 * sans validation admin : cette fonction sert uniquement à journaliser le compte (e-mail, mode
 * d'accès, dates) dans le registre affiché au menu Administration §"Demandes d'accès Démo", et à
 * vérifier si l'admin a mis ce compte en pause (`paused: true`) — auquel cas l'appelant DOIT
 * refuser l'accès (voir le retour `{ paused }`). Idempotente : une reconnexion incrémente juste
 * `loginCount`/`lastLoginAt` sans jamais régresser un compte en pause vers actif.
 */
export async function logAccountAccess(entry: {
  uid: string; address: string; displayName?: string; email?: string;
  method: 'google' | 'email' | 'apple'; accessMode: 'demo' | 'fiat';
}): Promise<{ paused: boolean }> {
  const db = getFirebaseDb();
  if (!db) return { paused: false };
  await ensureAnonSignIn();
  const r = ref(db, `demoAccessRequests/${RKEY(entry.uid)}`);
  const existing = (await get(r)).val() as DemoAccessRequest | null;
  if (existing?.paused) return { paused: true }; // compte bloqué par l'admin : ne pas réactiver silencieusement
  const now = Date.now();
  const displayName = entry.displayName ?? existing?.displayName;
  const email = entry.email ?? existing?.email;
  // ⚠️ Bug corrigé : `set()` remplace TOUT le nœud — `demoSessionStartedAt` (chrono de session
  // Démo, voir plus bas) n'était JAMAIS recopié depuis `existing`, donc CHAQUE reconnexion
  // l'effaçait silencieusement. Conséquence observée : même après une réactivation admin explicite
  // (`resetDemoAccountTimer`, qui vient de fixer `demoSessionStartedAt` à "maintenant"), la
  // reconnexion suivante l'effaçait aussitôt via ce `set()` — et `ensureDemoAccountTimer()`, ne
  // trouvant plus `demoSessionStartedAt`, retombait sur l'ANCIEN `requestedAt` (jamais mis à jour,
  // toujours expiré) : le joueur restait bloqué avec le message de session expirée malgré la
  // réactivation. On recopie donc désormais explicitement ce champ s'il existait déjà.
  // ⚠️ Même bug pour `maxDurationMinOverride` (surcharge personnelle de durée, voir Administration
  // > Statistiques par joueur > "Compte Démo / sans portefeuille") : oublié lors du premier
  // correctif ci-dessus car ce champ a été ajouté ultérieurement. Sans cette recopie, toute
  // reconnexion du joueur (ex. après expiration puis réactivation admin) effaçait silencieusement
  // la durée personnalisée définie par l'admin, qui retombait alors sur la valeur globale (2h) —
  // bug reproduit et corrigé : le joueur reconnecté voyait systématiquement "2h" au lieu de la
  // valeur personnalisée pourtant enregistrée juste avant.
  const merged: DemoAccessRequest = {
    uid: entry.uid, address: entry.address,
    method: entry.method, accessMode: entry.accessMode,
    status: 'approved', paused: false,
    requestedAt: existing?.requestedAt ?? now,
    lastLoginAt: now,
    loginCount: (existing?.loginCount ?? 0) + 1,
    ...(displayName ? { displayName } : {}),
    ...(email ? { email } : {}),
    ...(existing?.decidedAt ? { decidedAt: existing.decidedAt } : {}),
    ...(existing?.demoSessionStartedAt ? { demoSessionStartedAt: existing.demoSessionStartedAt } : {}),
    ...(existing?.maxDurationMinOverride != null ? { maxDurationMinOverride: existing.maxDurationMinOverride } : {}),
  };
  await set(r, merged);
  return { paused: false };
}

/** Écoute en temps réel tous les comptes Démo/fiat enregistrés (panneau Administration). */
export function subscribeDemoAccessRequests(cb: (list: DemoAccessRequest[]) => void): () => void {
  const db = getFirebaseDb();
  if (!db) { cb([]); return () => {}; }
  const r = ref(db, 'demoAccessRequests');
  const handler = (snap: DataSnapshot) => {
    const v = snap.val() as Record<string, DemoAccessRequest> | null;
    cb(v ? Object.values(v).sort((a, b) => (b.lastLoginAt ?? b.requestedAt) - (a.lastLoginAt ?? a.requestedAt)) : []);
  };
  onValue(r, handler);
  return () => off(r, 'value', handler);
}

/** Lecture ponctuelle d'UN compte Démo/fiat (voir page d'accueil — vérifie s'il est en pause). */
export async function getDemoAccessRequest(uid: string): Promise<DemoAccessRequest | null> {
  const db = getFirebaseDb();
  if (!db) return null;
  const snap = await get(ref(db, `demoAccessRequests/${RKEY(uid)}`));
  return (snap.val() as DemoAccessRequest | null) ?? null;
}

/** Met en pause (ou réactive) un compte Démo/fiat — bloque/débloque sa future connexion (voir
 * `logAccountAccess` ci-dessus) SANS supprimer ses données (contrairement à `deletePlayerAccount`).
 * Utile pour suspendre temporairement un joueur (abus, tricherie suspectée) sans effacer sa
 * progression, réversible via un second appel avec `paused: false`. */
export async function pauseAccountAccess(uid: string, paused: boolean): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await update(ref(db, `demoAccessRequests/${RKEY(uid)}`), { paused });
}

/** Écoute EN TEMPS RÉEL le champ `paused` d'UN compte Démo/fiat identifié — voir
 * `EffectiveAccountProvider` (effectiveAccount.tsx) qui l'utilise pour déconnecter IMMÉDIATEMENT
 * une session déjà en cours dès qu'un admin appuie sur "⏸ Mettre en pause" (PlayerStats.tsx),
 * sans attendre une prochaine reconnexion.
 * ⚠️ Bug corrigé : jusqu'ici, `paused` n'était vérifié QUE dans `logAccountAccess` (donc au moment
 * de la connexion) — mettre un joueur en pause pendant qu'il jouait déjà n'avait AUCUN effet
 * visible avant sa prochaine déconnexion/reconnexion volontaire, ce qui n'est pas acceptable pour
 * une action de modération censée être immédiate (abus/triche en cours). Cette écoute `onValue`
 * comble ce trou : toute bascule de `paused` faite par l'admin est reflétée en quelques centaines
 * de ms dans la session du joueur concerné, qu'il soit en mode 'demo' (Accès Démo) ou 'fiat'
 * (Jouer sans portefeuille) — les deux modes sont enregistrés dans le même nœud
 * `demoAccessRequests/{uid}` (voir `logAccountAccess`). Attend `ensureAnonSignIn()` avant
 * d'attacher `onValue` (même correctif de course auth que `subscribeDemoTimerInfo` ci-dessous —
 * `demoAccessRequests` exige `auth != null`, voir docs/FIREBASE_CHAT.md § 4). */
export function subscribePausedStatus(uid: string, cb: (paused: boolean) => void): () => void {
  const db = getFirebaseDb();
  if (!db) { cb(false); return () => {}; }
  let cancelled = false;
  let detach: () => void = () => {};
  ensureAnonSignIn().then(() => {
    if (cancelled) return;
    const r = ref(db, `demoAccessRequests/${RKEY(uid)}/paused`);
    const handler = (snap: DataSnapshot) => cb(snap.val() === true);
    onValue(r, handler);
    detach = () => off(r, 'value', handler);
  });
  return () => { cancelled = true; detach(); };
}

/** Nombre de sessions Démo actives simultanément, par sous-mode ('demo' approuvé vs 'anon' anonyme)
 * — alimenté par registerDemoSession/releaseDemoSession (présence Firebase `onDisconnect`). */
export async function countActiveDemoSessions(kind: 'demo' | 'anon'): Promise<number> {
  const db = getFirebaseDb();
  if (!db) return 0;
  const snap = await get(ref(db, `demoSessions/${kind}`));
  const v = snap.val() as Record<string, { startedAt: number }> | null;
  return v ? Object.keys(v).length : 0;
}

/** Enregistre la présence d'une session Démo active — utilise `onDisconnect()` pour être retirée
 * automatiquement si l'onglet se ferme/perd la connexion (respect strict des plafonds concurrents
 * RepRules.demoMaxConcurrentSessions / demoAnonymousMaxConcurrentSessions). */
export async function registerDemoSession(kind: 'demo' | 'anon', uid: string): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  const path = ref(db, `demoSessions/${kind}/${RKEY(uid)}`);
  await set(path, { startedAt: Date.now() });
  const { onDisconnect } = await import('firebase/database');
  onDisconnect(path).remove().catch(() => {});
}

/** Libère explicitement une session Démo (déconnexion volontaire, avant fermeture d'onglet). */
export async function releaseDemoSession(kind: 'demo' | 'anon', uid: string): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await set(ref(db, `demoSessions/${kind}/${RKEY(uid)}`), null);
}

// ─── Chrono de session Démo (limite de durée — voir RepRules.demoSessionMaxDurationMin) ───
// Distinct de `demoSessions/{kind}/{uid}` ci-dessus (qui ne sert qu'à COMPTER les connexions
// simultanées et disparaît à la fermeture de l'onglet) : ce chrono est PERSISTANT — il survit à
// une déconnexion/reconnexion, pour qu'un joueur ne puisse pas contourner la limite de 2h en se
// reconnectant simplement. Deux emplacements distincts :
//  - `demoAccessRequests/{uid}.demoSessionStartedAt` pour l'Accès Démo IDENTIFIÉ (Google), déjà
//    dans le registre admin (voir DemoAccessRequestsPanel.tsx) — l'admin peut le relancer pour un
//    joueur précis via `resetDemoAccountTimer()`.
//  - `demoSessions/anonTimer/{uid}` pour l'Accès Démo ANONYME (aucune identité — volontairement
//    SANS e-mail/displayName, cohérent avec le principe "aucune journalisation nominative" de ce
//    mode, voir docs/DEMO_FIAT.md) : non listé dans le registre admin, non réactivable
//    individuellement. ⚠️ Volontairement imbriqué SOUS `demoSessions` (plutôt qu'un nouveau noeud
//    racine `demoAnonState`) : les règles de sécurité RTDB actuellement publiées (voir
//    docs/FIREBASE_CHAT.md § 4) n'autorisent QUE les chemins explicitement listés — un nouveau
//    noeud racine y serait bloqué (`PERMISSION_DENIED`, vérifié) tant que les règles ne sont pas
//    republiées manuellement dans la Console Firebase. `demoSessions` a déjà une règle
//    `auth != null` qui s'applique en cascade à tous ses descendants, donc cette clé fonctionne
//    immédiatement sans aucune action de la part de l'administrateur.

/** Démarre (une seule fois) ou lit le chrono Démo d'un compte IDENTIFIÉ (Google) — voir
 * commentaire ci-dessus. Ne réinitialise JAMAIS un chrono déjà démarré (seul
 * `resetDemoAccountTimer()` le peut). Retourne si la limite est dépassée + l'horodatage de départ
 * (pour calculer l'échéance côté widget : `startedAt + maxDurationMin * 60000`).
 * `maxDurationMin` est la valeur GLOBALE (RepRules.demoSessionMaxDurationMin) — si ce joueur a une
 * surcharge personnelle (`maxDurationMinOverride`, voir Administration > Statistiques par joueur),
 * elle prévaut systématiquement sur la valeur globale transmise par l'appelant. */
export async function ensureDemoAccountTimer(uid: string, maxDurationMin: number): Promise<{ expired: boolean; startedAt: number }> {
  const db = getFirebaseDb();
  if (!db) return { expired: false, startedAt: Date.now() };
  const r = ref(db, `demoAccessRequests/${RKEY(uid)}`);
  const existing = (await get(r)).val() as DemoAccessRequest | null;
  let startedAt = existing?.demoSessionStartedAt ?? existing?.requestedAt;
  if (!startedAt) {
    startedAt = Date.now();
    await update(r, { demoSessionStartedAt: startedAt });
  }
  const effectiveMax = existing?.maxDurationMinOverride ?? maxDurationMin;
  return { expired: Date.now() - startedAt >= effectiveMax * 60_000, startedAt };
}

/** Équivalent de `ensureDemoAccountTimer` pour l'Accès Démo ANONYME (voir commentaire ci-dessus) —
 * clé RTDB `demoSessions/anonTimer/{uid}`, sans aucune donnée nominative. */
export async function ensureDemoAnonTimer(uid: string, maxDurationMin: number): Promise<{ expired: boolean; startedAt: number }> {
  const db = getFirebaseDb();
  if (!db) return { expired: false, startedAt: Date.now() };
  const r = ref(db, `demoSessions/anonTimer/${RKEY(uid)}`);
  const existing = (await get(r)).val() as { startedAt?: number } | null;
  let startedAt = existing?.startedAt;
  if (!startedAt) {
    startedAt = Date.now();
    await set(r, { startedAt });
  }
  return { expired: Date.now() - startedAt >= maxDurationMin * 60_000, startedAt };
}

/** Lecture ponctuelle de l'horodatage de départ du chrono Démo en cours (pour le widget
 * compte-à-rebours en jeu, voir DemoSessionTimerWidget.tsx) — ne démarre jamais le chrono elle-même
 * (contrairement à `ensureDemoAccountTimer`/`ensureDemoAnonTimer`, appelées uniquement à la
 * connexion), permet juste de suivre une éventuelle réactivation admin en cours de partie. Renvoie
 * aussi `maxDurationMinOverride` (uniquement pertinent pour mode 'approved') pour que le widget
 * applique la durée personnalisée de ce joueur si l'admin en a défini une, sans avoir à faire une
 * seconde lecture Firebase séparée. */
export async function getDemoTimerStartedAt(
  uid: string, mode: 'approved' | 'anonymous'
): Promise<{ startedAt: number | null; maxDurationMinOverride?: number }> {
  const db = getFirebaseDb();
  if (!db) return { startedAt: null };
  if (mode === 'anonymous') {
    const snap = await get(ref(db, `demoSessions/anonTimer/${RKEY(uid)}`));
    return { startedAt: (snap.val() as { startedAt?: number } | null)?.startedAt ?? null };
  }
  const snap = await get(ref(db, `demoAccessRequests/${RKEY(uid)}`));
  const v = snap.val() as DemoAccessRequest | null;
  return { startedAt: v?.demoSessionStartedAt ?? v?.requestedAt ?? null, maxDurationMinOverride: v?.maxDurationMinOverride };
}

/** Version TEMPS RÉEL de `getDemoTimerStartedAt` (voir ci-dessus) — écoute en direct (`onValue`)
 * plutôt qu'une lecture ponctuelle, pour que le widget de compte à rebours en jeu
 * (`DemoSessionTimerWidget.tsx`) reflète INSTANTANÉMENT toute action admin faite PENDANT que le
 * joueur est déjà connecté et en train de jouer : réactivation du chrono ("🔄 Réactiver le chrono
 * Démo") ou changement de la durée personnalisée ("Durée max de session Démo pour ce joueur",
 * Administration > Statistiques par joueur) — sans que le joueur ait besoin de se reconnecter ni
 * d'attendre un sondage périodique (bug corrigé : le sondage à 30s laissait croire que le
 * changement n'était "jamais pris en compte" si le joueur se déconnectait avant l'écoulement du
 * délai).
 *
 * ⚠️ Bug corrigé : `demoAccessRequests`/`demoSessions` exigent `auth != null` (voir
 * docs/FIREBASE_CHAT.md § 4). Juste après un RAFRAÎCHISSEMENT de page (ou la restauration d'une
 * session mémorisée dans `localStorage` par `EffectiveAccountProvider`), le SDK Firebase Auth met
 * un court instant à restaurer l'utilisateur déjà connecté (lecture asynchrone d'IndexedDB) —
 * l'ancien code appelait `onValue()` IMMÉDIATEMENT au montage du widget, AVANT que cette
 * restauration soit terminée, ce qui déclenchait une erreur "permission denied" ponctuelle. Cette
 * erreur n'était jamais rattrapée : le listener mourrait silencieusement et `cb` n'était plus JAMAIS
 * rappelée, laissant `startedAt` bloqué à `null` pour le reste de la session (`deadline` toujours
 * `null` ⇒ le sablier ne s'affichait plus du tout, jusqu'à la prochaine reconnexion complète) —
 * exactement le symptôme rapporté ("le sablier n'apparaît plus après un rafraîchissement"). On
 * attend désormais explicitement `ensureAnonSignIn()` (qui résout dès que
 * `onAuthStateChanged` confirme l'utilisateur restauré — anonyme, Google OU e-mail, cf.
 * firebase.ts — sans jamais écraser une identité déjà connectée) AVANT d'attacher `onValue`, comme
 * le font déjà toutes les fonctions d'écriture de ce module (`logAccountAccess`,
 * `pauseAccountAccess`, etc.). */
export function subscribeDemoTimerInfo(
  uid: string, mode: 'approved' | 'anonymous',
  cb: (info: { startedAt: number | null; maxDurationMinOverride?: number }) => void,
): () => void {
  const db = getFirebaseDb();
  if (!db) { cb({ startedAt: null }); return () => {}; }
  let cancelled = false;
  let detach: () => void = () => {};
  ensureAnonSignIn().then(() => {
    if (cancelled) return;
    if (mode === 'anonymous') {
      const r = ref(db, `demoSessions/anonTimer/${RKEY(uid)}`);
      const handler = (snap: DataSnapshot) => cb({ startedAt: (snap.val() as { startedAt?: number } | null)?.startedAt ?? null });
      onValue(r, handler);
      detach = () => off(r, 'value', handler);
      return;
    }
    const r = ref(db, `demoAccessRequests/${RKEY(uid)}`);
    const handler = (snap: DataSnapshot) => {
      const v = snap.val() as DemoAccessRequest | null;
      cb({ startedAt: v?.demoSessionStartedAt ?? v?.requestedAt ?? null, maxDurationMinOverride: v?.maxDurationMinOverride });
    };
    onValue(r, handler);
    detach = () => off(r, 'value', handler);
  });
  return () => { cancelled = true; detach(); };
}

/** Relance le chrono Démo d'UN joueur identifié (Google) en particulier — bouton admin "🔄
 * Réactiver le chrono Démo" (voir DemoAccessRequestsPanel.tsx). Uniquement pour l'Accès Démo
 * IDENTIFIÉ (registre nominatif) : l'Accès Démo anonyme n'étant pas journalisé, il ne peut pas
 * être réactivé individuellement par l'admin (limitation assumée, cohérente avec l'absence de
 * journalisation de ce mode — voir docs/DEMO_FIAT.md). */
export async function resetDemoAccountTimer(uid: string): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  await update(ref(db, `demoAccessRequests/${RKEY(uid)}`), { demoSessionStartedAt: Date.now() });
}

/** Définit (ou efface, avec `minutes: null`) la surcharge PAR JOUEUR de la durée max de session
 * Démo (voir `DemoAccessRequest.maxDurationMinOverride`) — bouton Administration > Statistiques
 * par joueur > "Compte Démo / sans portefeuille". Uniquement pour l'Accès Démo IDENTIFIÉ (Google) :
 * comme `resetDemoAccountTimer`, ne s'applique pas au mode anonyme (non nominatif). Passer `null`
 * restaure la valeur globale par défaut (`RepRules.demoSessionMaxDurationMin`, 2h) pour ce joueur. */
export async function setDemoSessionMaxDurationOverride(uid: string, minutes: number | null): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await ensureAnonSignIn();
  const r = ref(db, `demoAccessRequests/${RKEY(uid)}/maxDurationMinOverride`);
  await set(r, minutes && minutes > 0 ? minutes : null);
}

