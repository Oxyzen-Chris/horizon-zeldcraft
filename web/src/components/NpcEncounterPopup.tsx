'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { ref, get } from 'firebase/database';
import { NPC_SKINS, NPC_NAME_SUFFIXES, NPC_SUFFIX_KEYS } from '@/lib/contract';
import {
  applyEffect, logEncounter, addToInventory, removeFromInventory, getRepRules, getOrCreatePlayer,
  computePlayerDiceBonus, rollD20, getChatScripts, getNextQuestHint, DEFAULT_CHAT_SCRIPTS, CHAT_RESPONSE_IDS,
  DEFAULT_REP_RULES, pickNpcQuestForPlayer, unlockQuestForPlayer, getCurrentSeason,
  computeEquipmentCombatBonus, applyEquipmentWear, getShopCatalog, rarityForXp,
  subscribeEquipment,
  type EncounterRecord, type RepRules, type ChatScript, type ChatResponseId, type ChatReaction, type QuestDef,
  type EquipSlot, type EquippedItem, type ItemRarity, type ShopItem, type Season, type InventoryItem,
} from '@/lib/gameState';
import { ITEM_TAB_ICON, ITEM_TAB_CATEGORIES, type ItemTab } from '@/lib/itemTabs';
import { getFirebaseDb } from '@/lib/firebase';
import { useI18n, localizeName, itemLabel } from '@/lib/i18n';
import { FightResultModal, type FightResultData } from './FightResultModal';
import type { DiceEventKind, DiceEventOutcome } from './DiceRollWidget';

/**
 * Popup de rencontres PNJ aléatoires — 3 à 5×/jour selon le réglage admin (`RepRules.npcMaxPerDay`,
 * 100% hors-chaîne — voir setNpcMaxPerDay dans gameState.ts). Le tirage est stocké en localStorage
 * pour éviter de rejouer la même journée après refresh.
 *
 * Planificateur en "battement de cœur" (`setInterval`, voir plus bas) plutôt qu'une chaîne de
 * `setTimeout` : une ancienne version replanifiait un nouveau tirage à chaque fois qu'une popup
 * s'affichait (le state `current` était dans le tableau de dépendances de l'effet), pouvant en
 * écraser une déjà ouverte silencieusement, et toute exception dans le corps de l'effet pouvait
 * interrompre définitivement le mécanisme pour le reste de la session. Le battement de cœur relit
 * un horodatage "prochain tirage" persisté en localStorage (survit aux remounts/re-renders), ne
 * dépend d'aucun state instable, et est protégé par un try/catch qui ne peut jamais le bloquer.
 */
type PopupNpc = {
  key: string;         // id local du tirage (pas on-chain)
  baseKey: string;      // clé archétype stable — voir t(`npc.archetype.${baseKey}`)
  baseName: string;     // nom FR brut de repli
  suffixIdx: number;    // index dans NPC_NAME_SUFFIXES / NPC_SUFFIX_KEYS
  name: string;         // nom FR composé (repli/legacy — historique des rencontres)
  skin: number;        // index dans NPC_SKINS
  alignment: 'friendly' | 'neutral' | 'hostile' | 'unknown';
  offer: 'trade' | 'quest' | 'fight' | 'chat';
  force: number;
  xp: number;
};

const ALIGN_ICONS = { friendly: '😇', neutral: '🙂', hostile: '👿', unknown: '❓' };
const OFFER_ICONS = { trade: '💰', quest: '📜', fight: '⚔️', chat: '💬' };
const OFFER_KEYS  = { trade: 'trade', quest: 'quest', fight: 'fight', chat: 'chat' };

/**
 * Infos minimales du PNJ actuellement "en approche" (pop-up de rencontre ouvert) — remontées au
 * parent (game/page.tsx) via `onEncounterChange` pour matérialiser visuellement ce PNJ à côté de
 * Synk dans WorldMapWidget.tsx ET GameCanvas2D.tsx (voir demande : « c'est le PNJ qui vient à la
 * rencontre de Synk, donc c'est à lui de venir sur la case ou à une case de Synk »). Volontairement
 * minimal (pas de position propre) : chaque widget positionne ce marqueur juste à côté de la
 * position RÉELLE de Synk (déjà synchronisée via subscribePlayerMapPos), garantissant que les deux
 * vues restent cohérentes entre elles sans avoir à synchroniser une position dédiée.
 */
export type EncounterMarkerInfo = {
  baseKey: string; skin: number;
  alignment: 'friendly' | 'neutral' | 'hostile' | 'unknown';
  offer: 'trade' | 'quest' | 'fight' | 'chat';
} | null;

/** Onglet de la besace (InventoryPanel.tsx) correspondant à une catégorie d'objet — utilisé par
 * le pop-up de résultat de troc pour indiquer où l'objet échangé/dérobé est rangé. */
function tabForCategory(category?: InventoryItem['category']): ItemTab | undefined {
  if (!category) return undefined;
  return (Object.keys(ITEM_TAB_CATEGORIES) as Exclude<ItemTab, 'familiars'>[])
    .find((tab) => ITEM_TAB_CATEGORIES[tab].includes(category));
}

/** Résultat d'un troc/échange PNJ affiché dans un second pop-up après acceptation (voir runAccept). */
type TradeResultData = {
  npcDisplayName: string;
  lost: boolean; // true = vol subi (PNJ hostile), false = don reçu (PNJ amical/neutre)
  itemName?: string;
  itemQty?: number;
  tab?: ItemTab;
  coinsDelta?: number;
};

// Archétypes de PNJ (nom base ; skin choisi aléatoirement). `key` = clé i18n stable
// (voir t(`npc.archetype.${key}`)), `base` = texte FR brut de repli. Les 4 archétypes saisonniers
// (`season` renseigné) n'apparaissent que pendant la saison effective (voir getCurrentSeason() /
// rollNpc()) — les autres restent disponibles toute l'année.
type NpcArchetype = {
  key: string; base: string;
  align: 'friendly' | 'neutral' | 'hostile' | 'unknown';
  offer: 'trade' | 'quest' | 'fight' | 'chat';
  season?: Season;
};
const ARCHETYPES: readonly NpcArchetype[] = [
  { key: 'marchand',   base: 'Marchand',   align: 'friendly', offer: 'trade' },
  { key: 'chevalier',  base: 'Chevalier',  align: 'neutral',  offer: 'quest' },
  { key: 'combattant', base: 'Combattant', align: 'hostile',  offer: 'fight' },
  { key: 'sorcier',    base: 'Sorcier',    align: 'unknown',  offer: 'trade' },
  { key: 'villageois', base: 'Villageois', align: 'friendly', offer: 'chat' },
  { key: 'voleur',     base: 'Voleur',     align: 'hostile',  offer: 'fight' },
  { key: 'templier',   base: 'Templier',   align: 'neutral',  offer: 'quest' },
  { key: 'hobbit',     base: 'Hobbit',     align: 'friendly', offer: 'chat' },
  { key: 'princesse',        base: 'Princesse Zelda',    align: 'friendly', offer: 'quest' },
  { key: 'marchand_ambulant',base: 'Marchand ambulant',  align: 'neutral',  offer: 'quest' },
  { key: 'dragon_ancestral', base: 'Dragon Ancestral',   align: 'unknown',  offer: 'quest' },
  { key: 'nymphe_printemps', base: 'Nymphe du Printemps', align: 'friendly', offer: 'chat',  season: 'spring' },
  { key: 'esprit_ete',       base: "Esprit de l'Été",     align: 'friendly', offer: 'trade', season: 'summer' },
  { key: 'faucheur_automne', base: "Faucheur d'Automne",  align: 'neutral',  offer: 'quest',  season: 'autumn' },
  { key: 'roi_hiver',        base: "Roi de l'Hiver",      align: 'unknown',  offer: 'fight',  season: 'winter' },
];

function pick<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

/** Tirage d'un PNJ aléatoire — si `season` est fourni, exclut les archétypes des 3 autres saisons
 * (ceux sans `season` restent toujours disponibles), pour laisser réellement apparaître de
 * nouveaux visages au fil de l'année. */
function rollNpc(season: Season | null): PopupNpc {
  const pool = ARCHETYPES.filter(a => !a.season || a.season === season);
  const a = pick(pool.length ? pool : ARCHETYPES);
  const suffixIdx = Math.floor(Math.random() * NPC_NAME_SUFFIXES.length);
  return {
    key: Math.random().toString(36).slice(2, 10),
    baseKey: a.key,
    baseName: a.base,
    suffixIdx,
    name: `${a.base} ${NPC_NAME_SUFFIXES[suffixIdx]}`,
    skin: Math.floor(Math.random() * NPC_SKINS.length),
    alignment: a.align as PopupNpc['alignment'],
    offer: a.offer as PopupNpc['offer'],
    force: 5 + Math.floor(Math.random() * 40),
    xp: 10 + Math.floor(Math.random() * 90),
  };
}

// ─────────────────────────── Combat façon jet de dés (D&D-like) ───────────────────────────

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Butin possible lors d'une victoire (récupéré sur le PNJ vaincu). Reçoit les mêmes champs
 * d'équipement (slot/rarité/dégâts ou défense/durabilité) que les objets de boutique — sans quoi
 * un butin de combat restait visible en besace mais impossible à glisser-déposer ou équiper vers
 * la fenêtre Équipement de Synk, contrairement aux objets achetés (bug déjà rencontré). */
const FIGHT_LOOT_TABLE = [
  { itemId: 'dague_rouillee', name: '🗡️ Dague rouillée',         category: 'weapon' as const, slot: 'weapon' as const, rarity: 'common' as const, damage: 8, durabilityMax: 12, effect: { force: 5 } },
  { itemId: 'bourse_pnj',     name: '💰 Bourse trouvée',          category: 'treasure' as const, effect: {} },
  { itemId: 'amulette_prot',  name: '📿 Amulette de protection',  category: 'armor' as const, slot: 'amulet' as const, rarity: 'common' as const, defense: 6, durabilityMax: 15, effect: { hp: 10 } },
];

interface FightRoll {
  playerRoll: number; npcRoll: number;
  playerBonus: number; npcBonus: number;
  playerTotal: number; npcTotal: number;
  win: boolean;
  npcPurse: number;
}

/**
 * Tirage 1d20 pondéré par les indices de Force, Vie, Faim et Sortilèges du joueur
 * (façon jeu de rôle papier — bonus calculé par `computePlayerDiceBonus`, partagé avec le widget
 * de dés persistant `DiceRollWidget.tsx`). Le PNJ tire aussi 1d20 + bonus dérivé de sa Force.
 * Égalité = défaite du joueur (avantage au défenseur).
 * Tous les poids et plafonds sont paramétrables via le menu Administration (RepRules).
 */
function resolveFight(
  player: { hp: number; hpMax: number; hunger: number; hungerMax: number; force: number; forceMax: number; spells: number; spellsMax: number },
  npc: PopupNpc,
  rules: RepRules,
  equipBonus = 0,
): FightRoll {
  const playerBonus = computePlayerDiceBonus(player, rules) + equipBonus;
  // Bonus PNJ, dérivé de sa seule Force, plafonné à fightNpcBonusMax (défaut 12)
  const npcForceRef = Math.max(1, rules.fightNpcForceRef ?? 45);
  const npcBonus = Math.round(clamp01(npc.force / npcForceRef) * (rules.fightNpcBonusMax ?? 12));

  const playerRoll = rollD20();
  const npcRoll = rollD20();
  const playerTotal = playerRoll + playerBonus;
  const npcTotal = npcRoll + npcBonus;
  const win = playerTotal > npcTotal;
  const npcPurse = 20 + npc.force * 3;

  return { playerRoll, npcRoll, playerBonus, npcBonus, playerTotal, npcTotal, win, npcPurse };
}

// ─────────────────────────── Dialogues PNJ (offre "chat") ───────────────────────────

/** État de la conversation en cours (npcLine ou réaction affichée, indice révélé, cumul XP/rep). */
interface ChatFlowState {
  npc: PopupNpc;
  phase: 'question' | 'reacted';
  script: ChatScript;
  displayLine: string;
  hintText: string | null;
  pendingNext: ChatScript | null;
  xpAccum: number;
  repAccum: number;
}

/**
 * Réactions génériques de repli si le script sélectionné ne définit pas de réaction pour la
 * réponse choisie (ex. script admin incomplet) — garantit qu'un bouton ne reste jamais sans effet.
 */
const CHAT_FALLBACK_REACTIONS: Record<ChatResponseId, ChatReaction> = {
  yes:       { line: 'Ravi de te l\'entendre dire !', i18nKey: 'npc.chat.fallback.yes', xp: 2 },
  no:        { line: 'Ah, dommage...', i18nKey: 'npc.chat.fallback.no' },
  dontknow:  { line: 'Ce n\'est pas grave, une autre fois peut-être.', i18nKey: 'npc.chat.fallback.dontknow', xp: 1 },
  continue:  { line: 'Je n\'ai rien de plus à ajouter pour l\'instant.', i18nKey: 'npc.chat.fallback.continue' },
  moreHints: { line: 'Cherche du côté de tes énigmes non résolues...', i18nKey: 'npc.chat.fallback.morehints', revealHint: true },
};

export function NpcEncounterPopup({ contract, tokenId, onEncounterChange, onRequestDiceRoll, onCombatActiveChange }: {
  contract: `0x${string}`; tokenId: bigint;
  /** Notifie le parent (game/page.tsx) dès qu'un PNJ approche/quitte, pour matérialiser sa
   * présence à côté de Synk sur la mapmonde et la plateforme isométrique (voir EncounterMarkerInfo). */
  onEncounterChange?: (info: EncounterMarkerInfo) => void;
  /** Déclenche un lancer de dés OBLIGATOIRE dans le widget "Lancer de dès" (bouton "Lancer...") —
   * voir beginFightWithDiceRoll(). Renvoie une promesse résolue dès que le joueur a cliqué sur ce
   * bouton, avec le résultat (bonus/malus) à appliquer au combat en cours. */
  onRequestDiceRoll?: (kind: DiceEventKind) => Promise<DiceEventOutcome>;
  /** Notifie le parent tant qu'un combat PNJ est en cours (du lancer de dés requis jusqu'à la
   * fermeture du résultat), pour griser "Test rapide"/"Destin quotidien" dans le widget de dés. */
  onCombatActiveChange?: (active: boolean) => void;
}) {
  const { t } = useI18n();
  const { address } = useAccount();
  const chainId = useChainId();
  const [current, setCurrent] = useState<PopupNpc | null>(null);
  const [rules, setRules] = useState<RepRules | null>(null);
  const [chatScripts, setChatScripts] = useState<ChatScript[]>([]);
  const [equipment, setEquipment] = useState<Partial<Record<EquipSlot, EquippedItem>>>({});
  const [shopCatalog, setShopCatalog] = useState<ShopItem[]>([]);

  // Charge les règles de reconnaissance paramétrables (admin)
  useEffect(() => {
    getRepRules().then(setRules).catch(() => {});
  }, []);

  // Charge le catalogue de scripts de dialogue PNJ (admin), avec repli intégré si base vide
  useEffect(() => {
    getChatScripts().then(setChatScripts).catch(() => {});
  }, []);

  // Équipement porté (arme/protections/flèches) — proposé en bonus de combat (voir accept()/runFight)
  useEffect(() => {
    if (!address) return;
    return subscribeEquipment(address, setEquipment);
  }, [address]);
  // Catalogue boutique — nécessaire pour tirer un équipement au hasard en butin de victoire (par rareté)
  useEffect(() => { getShopCatalog().then(setShopCatalog).catch(() => {}); }, []);

  // Ref toujours à jour avec la popup affichée, lue par le battement de cœur ci-dessous SANS
  // figurer dans son tableau de dépendances (ce qui provoquait l'ancien bug de replanification).
  const currentRef = useRef<PopupNpc | null>(null);
  useEffect(() => { currentRef.current = current; }, [current]);

  // Répercute l'ouverture/fermeture de la popup au parent (voir onEncounterChange) : c'est ce qui
  // permet à WorldMapWidget.tsx et GameCanvas2D.tsx de matérialiser le PNJ à côté de Synk pendant
  // toute la durée de la rencontre (jusqu'à acceptation/refus, ou fermeture du résultat).
  useEffect(() => {
    if (!onEncounterChange) return;
    onEncounterChange(current
      ? { baseKey: current.baseKey, skin: current.skin, alignment: current.alignment, offer: current.offer }
      : null);
  }, [current, onEncounterChange]);
  // Filet de sécurité : si le composant est démonté pendant qu'une rencontre est affichée
  // (changement de page), efface le marqueur pour ne jamais le laisser figé côté parent.
  useEffect(() => () => { if (currentRef.current && onEncounterChange) onEncounterChange(null); }, [onEncounterChange]);

  // Saison effective (voir gameState.ts::getCurrentSeason) — lue dans un ref (pas de re-render
  // requis) pour filtrer les archétypes saisonniers tirés par rollNpc(). Rafraîchie de temps en
  // temps pour suivre un changement de saison en cours de session (rollover de date ou bascule
  // manuelle admin), sans réinterroger Firebase à chaque battement de cœur (15s).
  const seasonRef = useRef<Season | null>(null);
  useEffect(() => {
    const refresh = () => getCurrentSeason().then(s => { seasonRef.current = s; }).catch(() => {});
    refresh();
    const id = setInterval(refresh, 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  // Planificateur "battement de cœur" : toutes les 15s, vérifie si le quota du jour (RepRules.
  // npcMaxPerDay, hors-chaîne) est atteint et si l'horodatage "prochain tirage" (persisté en
  // localStorage, tirée dans une fenêtre aléatoire de 60s à 25min) est dépassé. Aucune dépendance
  // instable (ni `current`, ni une valeur on-chain) : un battement en retard/raté n'empêche jamais
  // définitivement les suivants, et toute exception est absorbée par le try/catch.
  useEffect(() => {
    if (!address) return;
    const dayKey = new Date().toDateString();
    const countKey = `zc.popupCount.${address.toLowerCase()}.${dayKey}`;
    const nextKey = `zc.popupNext.${address.toLowerCase()}.${dayKey}`;

    const scheduleNext = (): number => {
      const next = Date.now() + 60_000 + Math.random() * 25 * 60_000;
      try { localStorage.setItem(nextKey, String(next)); } catch { /* quota localStorage plein, ignoré */ }
      return next;
    };

    let nextAt = Number(localStorage.getItem(nextKey) ?? 0) || scheduleNext();

    const tick = () => {
      try {
        const max = Number((rules ?? DEFAULT_REP_RULES).npcMaxPerDay ?? 4);
        const count = Number(localStorage.getItem(countKey) ?? 0);
        if (count >= max) return;
        if (currentRef.current) return; // une popup est déjà affichée : on patiente
        if (Date.now() < nextAt) return;
        const npc = rollNpc(seasonRef.current);
        setCurrent(npc);
        localStorage.setItem(countKey, String(count + 1));
        nextAt = scheduleNext();
      } catch {
        // Ne jamais laisser une exception bloquer durablement le planificateur.
        nextAt = scheduleNext();
      }
    };

    tick(); // vérifie immédiatement (utile si l'horodatage est déjà dépassé après un rechargement)
    const interval = setInterval(tick, 15_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, chainId, rules?.npcMaxPerDay]);

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fightResult, setFightResult] = useState<FightResultData | null>(null);
  const [chatFlow, setChatFlow] = useState<ChatFlowState | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [questGranted, setQuestGranted] = useState<{ quest: QuestDef | null; npcDisplayName: string } | null>(null);
  const [tradeResult, setTradeResult] = useState<TradeResultData | null>(null);
  const [equipPromptNpc, setEquipPromptNpc] = useState<PopupNpc | null>(null);
  // Combat en attente du lancer de dés OBLIGATOIRE (bouton "Lancer..." du widget "Lancer de dès")
  // et combat en cours de résolution (entre la fin de ce lancer et l'affichage du résultat) — voir
  // beginFightWithDiceRoll(). `combatActive` (dérivé, jamais mis à jour à la main) reste vrai sans
  // interruption tant que l'une des trois étapes est en cours, ce qui évite tout risque de laisser
  // le widget de dés grisé indéfiniment si une erreur survient (voir effet ci-dessous).
  const [awaitingDice, setAwaitingDice] = useState<{ npc: PopupNpc; useEquip: boolean } | null>(null);
  const [fightPending, setFightPending] = useState(false);
  const close = () => { setCurrent(null); setErrorMsg(null); setChatFlow(null); setQuestGranted(null); setTradeResult(null); };

  // Répercute au parent (game/page.tsx → DiceRollWidget) qu'un combat PNJ mobilise le widget de
  // dés, pour qu'il grise "Test rapide"/"Destin quotidien" pendant toute la durée du combat. Purement
  // dérivé de l'état local : jamais de risque de rester grisé après une erreur (voir commentaire ci-dessus).
  useEffect(() => {
    onCombatActiveChange?.(!!awaitingDice || fightPending || !!fightResult);
  }, [awaitingDice, fightPending, fightResult, onCombatActiveChange]);
  // Filet de sécurité au démontage (changement de page en pleine partie) : ne jamais laisser le
  // widget de dés grisé pour la session suivante.
  useEffect(() => () => { onCombatActiveChange?.(false); }, [onCombatActiveChange]);

  /** Vrai si le joueur porte au moins une arme/protection en état de marche (durabilité > 0),
   * utilisable pour un bonus de combat — voir computeEquipmentCombatBonus(). Un arc sans flèche
   * équipée ne compte pas (il ne délivre alors aucun bonus). */
  const hasUsableEquipment = () => {
    const { weapon, offhand, head, body, legs, feet, belt, arrows } = equipment;
    const weaponUsable = !!weapon && weapon.durability > 0 && (!weapon.requiresArrow || !!(arrows && (arrows.qty ?? 0) > 0));
    const armorUsable = [offhand, head, body, legs, feet, belt].some((it) => it && it.durability > 0 && (it.defense ?? 0) > 0);
    return weaponUsable || armorUsable;
  };

  /** Tire un objet aléatoire d'équipement (arme/protection/flèche) dans la limite de la rareté
   * débloquée par l'XP du joueur (RepRules.equipRarityXp*) — voir rarityForXp(). */
  const pickEquipmentLoot = (playerXp: number, r: RepRules): ShopItem | null => {
    const order: ItemRarity[] = ['common', 'rare', 'legendary', 'epic'];
    const maxIdx = order.indexOf(rarityForXp(playerXp, r));
    const eligible = shopCatalog.filter((c) =>
      c.rarity && order.indexOf(c.rarity) <= maxIdx
      && (c.category === 'weapon' || c.category === 'armor' || c.category === 'shield' || c.category === 'arrow'));
    return eligible.length ? pick(eligible) : null;
  };

  /** Démarre la conversation : tire un script aléatoire du catalogue et affiche sa réplique d'ouverture. */
  const startChat = (npc: PopupNpc) => {
    const list = chatScripts.length ? chatScripts : DEFAULT_CHAT_SCRIPTS;
    const script = pick(list);
    setChatFlow({
      npc, phase: 'question', script,
      displayLine: localizeName(t, script.npcLineI18nKey, script.npcLine),
      hintText: null, pendingNext: null, xpAccum: 0, repAccum: 0,
    });
  };

  /** Applique la réaction du PNJ à la réponse choisie par le joueur (5 boutons fixes). */
  const respondChat = async (responseId: ChatResponseId) => {
    if (!chatFlow || chatBusy) return;
    setChatBusy(true);
    try {
      const reaction = chatFlow.script.reactions[responseId] ?? CHAT_FALLBACK_REACTIONS[responseId];
      let hintText: string | null = null;
      if (reaction.revealHint && address) {
        const q = await getNextQuestHint(address);
        hintText = q ? localizeName(t, q.hintKey, q.hint || '') : t('npc.chat.hint.none');
      }
      const nextScript = reaction.nextScriptId
        ? (chatScripts.find(s => s.id === reaction.nextScriptId)
          ?? DEFAULT_CHAT_SCRIPTS.find(s => s.id === reaction.nextScriptId) ?? null)
        : null;
      setChatFlow(prev => prev && ({
        ...prev, phase: 'reacted',
        displayLine: localizeName(t, reaction.i18nKey, reaction.line),
        hintText, pendingNext: nextScript,
        xpAccum: prev.xpAccum + (reaction.xp ?? 0),
        repAccum: prev.repAccum + (reaction.rep ?? 0),
      }));
    } finally {
      setChatBusy(false);
    }
  };

  /** Enchaîne vers le script suivant (si `nextScriptId`) ou clôt la conversation. */
  const continueChat = () => {
    if (!chatFlow) return;
    if (chatFlow.pendingNext) {
      const next = chatFlow.pendingNext;
      setChatFlow(prev => prev && ({
        ...prev, phase: 'question', script: next,
        displayLine: localizeName(t, next.npcLineI18nKey, next.npcLine),
        hintText: null, pendingNext: null,
      }));
    } else {
      finalizeChat();
    }
  };

  /** Applique les effets cumulés (XP/rep de la discussion + barème chatFriendly/... existant), log, ferme. */
  const finalizeChat = async () => {
    if (!chatFlow || !address || chatBusy) return;
    setChatBusy(true);
    setErrorMsg(null);
    const npc = chatFlow.npc;
    try {
      const r = rules ?? (await getRepRules());
      const baseRep = npc.alignment === 'friendly' ? r.chatFriendly
                    : npc.alignment === 'hostile'   ? r.chatHostile
                    : r.chatNeutral;
      const xpDelta = Math.floor(npc.xp / 2) + chatFlow.xpAccum;
      const repDelta = baseRep + chatFlow.repAccum;
      await applyEffect(address, { reputation: repDelta, happiness: 5, xpBonus: xpDelta });
      await logEncounter(address, {
        npcId: npc.key, npcName: npc.name, npcSkin: npc.skin,
        npcBaseKey: npc.baseKey, npcSuffixKey: NPC_SUFFIX_KEYS[npc.suffixIdx],
        alignment: npc.alignment, offer: npc.offer,
        timestamp: Date.now(), outcome: 'accepted', xpGained: xpDelta, repDelta,
      });
      close();
    } catch (e: any) {
      console.error('[NpcEncounter] chat finalize failed:', e);
      setErrorMsg('❌ ' + (e?.message?.slice(0, 120) ?? 'Erreur inconnue'));
    } finally {
      setChatBusy(false);
    }
  };

  const accept = async () => {
    if (!current || !address || busy) return;
    if (current.offer === 'chat') { startChat(current); return; }
    if (current.offer === 'fight') {
      if (hasUsableEquipment()) {
        // Propose d'utiliser l'équipement porté pour un bonus avant de résoudre le combat.
        setEquipPromptNpc(current);
        return;
      }
      await beginFightWithDiceRoll(current, false);
      return;
    }
    await runAccept(current, false);
  };

  /** Réponse au prompt "Utiliser ton équipement pour ce combat ?" */
  const answerEquipPrompt = async (useEquip: boolean) => {
    const npc = equipPromptNpc;
    setEquipPromptNpc(null);
    if (npc) await beginFightWithDiceRoll(npc, useEquip);
  };

  /**
   * Combat PNJ : réclame désormais un lancer de dés OBLIGATOIRE via le widget "Lancer de dès"
   * (bouton "Lancer...") avant de résoudre l'issue. Ce jet ajoute une condition supplémentaire de
   * bonus/malus (voir DiceEventOutcome/classifyEventRoll) en plus du tirage de combat existant
   * (resolveFight, inchangé) — purement additif, aucune régression sur la stratégie de combat déjà
   * en place. Si `onRequestDiceRoll` n'est pas câblé (garde-fou), le combat se résout normalement
   * avec un modificateur neutre, pour ne jamais bloquer le joueur.
   */
  const beginFightWithDiceRoll = async (npc: PopupNpc, useEquip: boolean) => {
    setAwaitingDice({ npc, useEquip });
    let diceOutcome: DiceEventOutcome = { roll: 0, rolls: [0, 0], modifier: 0, tier: 'neutral' };
    try {
      if (onRequestDiceRoll) diceOutcome = await onRequestDiceRoll('fight');
    } finally {
      setAwaitingDice(null);
    }
    setFightPending(true);
    try {
      await runAccept(npc, useEquip, diceOutcome);
    } finally {
      setFightPending(false);
    }
  };

  const runAccept = async (npc: PopupNpc, useEquip: boolean, diceOutcome?: DiceEventOutcome) => {
    if (!address || busy) return;
    setBusy(true);
    setErrorMsg(null);
    const npcDisplayName = `${localizeName(t, `npc.archetype.${npc.baseKey}`, npc.baseName)} ${localizeName(t, `npc.suffix.${NPC_SUFFIX_KEYS[npc.suffixIdx]}`, NPC_NAME_SUFFIXES[npc.suffixIdx])}`;
    try {
      const r = rules ?? (await getRepRules());
      let outcome: EncounterRecord['outcome'] = 'accepted';
      let xpDelta = npc.xp;
      let repDelta = 0;
      let hpDelta = 0;
      let forceDelta = 0;
      let spellsDelta = 0;
      let walletDelta = 0;
      let xpBonusDelta = 0;
      let itemName: string | undefined;
      let itemId: string | undefined;
      let itemQty: number | undefined;
      let itemDirection: EncounterRecord['itemDirection'];
      let itemCategory: InventoryItem['category'] | undefined;
      let itemBaseName: string | undefined; // nom localisé sans préfixe +/- ni suffixe ×qty (pour tradeResult)

      if (npc.offer === 'fight') {
        const p = await getOrCreatePlayer(address);
        const equipInfo = useEquip
          ? computeEquipmentCombatBonus(equipment, r)
          : { bonus: 0, usedSlots: [] as EquipSlot[], arrowsExhausted: false };
        const roll = resolveFight(p, npc, r, equipInfo.bonus + (diceOutcome?.modifier ?? 0));
        const win = roll.win;
        outcome = win ? 'won' : 'lost';
        xpDelta = win ? npc.xp : Math.floor(npc.xp / 3);
        xpBonusDelta = xpDelta;
        hpDelta = win ? -8 : -30;
        forceDelta = win ? 3 : 0;
        repDelta = win
          ? (npc.alignment === 'hostile' ? r.fightWinHostile : r.fightWinNormal)
          : r.fightLoss;

        // Usure de l'équipement utilisé (arme + protections portées) — casse possible en plein combat.
        let brokenItemNames: string[] | undefined;
        if (equipInfo.usedSlots.length) {
          const { broken } = await applyEquipmentWear(address, equipInfo.usedSlots, r.equipDurabilityLossPct ?? 8);
          if (broken.length) brokenItemNames = broken.map((b) => itemLabel(t, b.itemId, b.name));
        }

        // Butin symétrique : le vainqueur prend une part de la bourse du perdant.
        const lootPct = Math.max(0, r.fightLootPct ?? 20) / 100;
        const lootCap = r.fightLootMaxWallet ?? 100;
        const maxLootItems = Math.max(0, r.fightLootMaxItems ?? 1);
        const lootChance = clamp01((r.fightLootChancePct ?? 35) / 100);
        const equipDropChance = clamp01((r.equipDropChancePct ?? 15) / 100);
        let lootItemName: string | undefined;
        let stolenItemName: string | undefined;

        if (win) {
          walletDelta = Math.min(lootCap, Math.max(1, Math.floor(roll.npcPurse * lootPct)));
          if (maxLootItems > 0 && Math.random() < lootChance) {
            // Chance qu'un équipement rare (arme/protection/flèche, selon la rareté débloquée par
            // l'XP du joueur) tombe à la place de l'objet de butin classique.
            const equipDrop = Math.random() < equipDropChance ? pickEquipmentLoot(p.xpBonus ?? 0, r) : null;
            if (equipDrop) {
              await addToInventory(address, {
                itemId: equipDrop.itemId, name: equipDrop.name, category: equipDrop.category, qty: 1,
                ...(equipDrop.slot ? { slot: equipDrop.slot } : {}),
                ...(equipDrop.rarity ? { rarity: equipDrop.rarity } : {}),
                ...(equipDrop.damage ? { damage: equipDrop.damage } : {}),
                ...(equipDrop.defense ? { defense: equipDrop.defense } : {}),
                ...(equipDrop.durabilityMax ? { durabilityMax: equipDrop.durabilityMax } : {}),
                ...(equipDrop.requiresArrow ? { requiresArrow: true } : {}),
              });
              lootItemName = itemLabel(t, equipDrop.itemId, equipDrop.name);
              itemName = `+${equipDrop.name}`;
              itemId = equipDrop.itemId; itemQty = 1; itemDirection = 'gain';
            } else {
              const drop = pick(FIGHT_LOOT_TABLE);
              await addToInventory(address, { ...drop, qty: 1 });
              lootItemName = itemLabel(t, drop.itemId, drop.name);
              itemName = `+${drop.name}`;
              itemId = drop.itemId; itemQty = 1; itemDirection = 'gain';
            }
          }
        } else {
          const lost = Math.min(lootCap, Math.max(1, Math.floor(p.wallet * lootPct)));
          walletDelta = -lost;
          if (maxLootItems > 0 && Math.random() < lootChance) {
            const db = getFirebaseDb();
            if (db) {
              const invSnap = await get(ref(db, `players/${address.toLowerCase()}/inventory`));
              const inv = invSnap.val() as Record<string, { name: string; qty: number }> | null;
              const stealable = inv ? Object.entries(inv).filter(([, it]) => it.qty > 0) : [];
              if (stealable.length > 0) {
                const [stolenId, it] = stealable[Math.floor(Math.random() * stealable.length)];
                await removeFromInventory(address, stolenId, 1);
                stolenItemName = itemLabel(t, stolenId, it.name);
                itemName = `-${it.name}`;
                itemId = stolenId; itemQty = 1; itemDirection = 'loss';
              }
            }
          }
        }

        setFightResult({
          win, playerRoll: roll.playerRoll, npcRoll: roll.npcRoll,
          playerBonus: roll.playerBonus, npcBonus: roll.npcBonus,
          playerTotal: roll.playerTotal, npcTotal: roll.npcTotal,
          npcName: npcDisplayName, xpDelta, hpDelta, coinsDelta: walletDelta,
          lootItemName, stolenItemName,
          equipBonus: equipInfo.bonus || undefined, brokenItemNames,
          diceEventRoll: diceOutcome?.roll, diceEventRolls: diceOutcome?.rolls, diceEventModifier: diceOutcome?.modifier,
        });
      } else if (npc.offer === 'trade') {
        if (npc.alignment === 'hostile') {
          const stealFromBag = Math.random() < 0.5;
          let stolenItemName: string | undefined;
          if (stealFromBag) {
            const db = getFirebaseDb();
            if (db) {
              const invSnap = await get(ref(db, `players/${address.toLowerCase()}/inventory`));
              const inv = invSnap.val() as Record<string, { name: string; qty: number; category?: InventoryItem['category'] }> | null;
              const stealable = inv ? Object.entries(inv).filter(([, it]) => it.qty > 0) : [];
              if (stealable.length > 0) {
                const [stolenId, it] = stealable[Math.floor(Math.random() * stealable.length)];
                const maxQty = Math.max(1, r.theftMaxItems ?? 1);
                const qtyStolen = Math.min(it.qty, maxQty);
                await removeFromInventory(address, stolenId, qtyStolen);
                const localizedItName = itemLabel(t, stolenId, it.name);
                stolenItemName = qtyStolen > 1 ? `${localizedItName} ×${qtyStolen}` : localizedItName;
                itemId = stolenId; itemQty = qtyStolen; itemDirection = 'loss'; itemCategory = it.category;
                itemBaseName = localizedItName;
              }
            }
          }
          if (!stolenItemName) {
            const cur = await getOrCreatePlayer(address);
            const pct = Math.max(0, r.theftMaxPct ?? 5) / 100;
            const stolen = Math.min(r.theftMaxWallet, Math.max(1, Math.floor(cur.wallet * pct)));
            walletDelta = -stolen;
          } else {
            itemName = `-${stolenItemName}`;
          }
          repDelta = r.tradeHostileTheft;
          outcome = 'lost';
        } else {
          const items = [
            { itemId: 'potion_hp', name: '🧪 Potion de vie', category: 'potion' as const, effect: { hp: 40 } },
            { itemId: 'apple',     name: '🍎 Pomme',         category: 'food'   as const, effect: { hunger: 10 } },
            { itemId: 'spell_fire',name: '🔥 Sort de feu',   category: 'spell'  as const, effect: { spells: 25 } },
          ];
          const gift = items[Math.floor(Math.random() * items.length)];
          const cost = 10 + Math.floor(Math.random() * 16);
          xpBonusDelta = -cost;
          xpDelta = -cost;
          await addToInventory(address, { ...gift, qty: 1 });
          itemName = gift.name;
          itemId = gift.itemId; itemQty = 1; itemDirection = 'gain'; itemCategory = gift.category;
          itemBaseName = itemLabel(t, gift.itemId, gift.name);
          walletDelta = 5;
          repDelta = npc.alignment === 'friendly' ? r.tradeFriendly : r.tradeNeutral;
        }
      }

      let grantedQuest: QuestDef | null = null;
      if (npc.offer === 'quest') {
        spellsDelta = 3;
        xpBonusDelta = xpDelta;
        repDelta = r.questAccepted;
        grantedQuest = await pickNpcQuestForPlayer(address);
        if (grantedQuest) {
          await unlockQuestForPlayer(address, grantedQuest.id, npc.baseKey);
        }
      }

      await applyEffect(address, {
        hp: hpDelta, force: forceDelta, spells: spellsDelta,
        reputation: repDelta, wallet: walletDelta, happiness: 5,
        xpBonus: xpBonusDelta,
      });
      await logEncounter(address, {
        npcId: npc.key, npcName: npc.name, npcSkin: npc.skin,
        npcBaseKey: npc.baseKey, npcSuffixKey: NPC_SUFFIX_KEYS[npc.suffixIdx],
        alignment: npc.alignment, offer: npc.offer,
        timestamp: Date.now(), outcome, xpGained: xpDelta,
        itemName, itemId, itemQty, itemDirection, walletDelta, hpDelta, repDelta,
        questId: grantedQuest?.id, questLabel: grantedQuest?.label, questI18nKey: grantedQuest?.i18nKey,
      });
      if (npc.offer === 'quest') {
        // Affiche un résultat dédié (quête ajoutée à "Quêtes à énigmes", ou repli si le pool
        // des 20 énigmes PNJ est déjà épuisé pour ce joueur) au lieu de fermer immédiatement.
        setQuestGranted({ quest: grantedQuest, npcDisplayName });
      } else if (npc.offer === 'trade') {
        // Second pop-up dédié indiquant précisément ce qui a été échangé/dérobé et dans quel
        // compartiment de la besace l'objet est déposé (ou retiré) — voir tabForCategory().
        setTradeResult({
          npcDisplayName,
          lost: outcome === 'lost',
          itemName: itemBaseName,
          itemQty,
          tab: tabForCategory(itemCategory),
          coinsDelta: walletDelta,
        });
      } else {
        close();
      }
    } catch (e: any) {
      console.error('[NpcEncounter] accept failed:', e);
      setErrorMsg('❌ ' + (e?.message?.slice(0, 120) ?? 'Erreur inconnue'));
    } finally {
      setBusy(false);
    }
  };

  const refuse = async () => {
    if (!current || !address || busy) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await logEncounter(address, {
        npcId: current.key, npcName: current.name, npcSkin: current.skin,
        npcBaseKey: current.baseKey, npcSuffixKey: NPC_SUFFIX_KEYS[current.suffixIdx],
        alignment: current.alignment, offer: current.offer,
        timestamp: Date.now(), outcome: 'refused', xpGained: 0,
      });
      close();
    } catch (e: any) {
      console.error('[NpcEncounter] refuse failed:', e);
      setErrorMsg('❌ ' + (e?.message?.slice(0, 120) ?? 'Erreur inconnue'));
    } finally {
      setBusy(false);
    }
  };

  if (!current && !fightResult) return null;
  const currentDisplayName = current
    ? `${localizeName(t, `npc.archetype.${current.baseKey}`, current.baseName)} ${localizeName(t, `npc.suffix.${NPC_SUFFIX_KEYS[current.suffixIdx]}`, NPC_NAME_SUFFIXES[current.suffixIdx])}`
    : '';

  return (
    <>
      {current && !awaitingDice && !fightPending && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[95] p-4" onClick={() => !busy && !chatBusy && close()}>
          <div className="bg-slate-900 border-2 border-cyan-500 rounded-xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="text-center">
              <div className="text-6xl mb-3">{NPC_SKINS[current.skin]}</div>
              <h3 className="text-xl font-bold text-cyan-300">{currentDisplayName}</h3>
              <p className="text-sm text-slate-400 mt-1">
                {ALIGN_ICONS[current.alignment]} {t(`npc.align.${current.alignment}`)} · {OFFER_ICONS[current.offer]} {t(`npc.offer.${OFFER_KEYS[current.offer]}`)}
              </p>
              <div className="flex justify-around bg-slate-800/60 rounded p-2 mt-3 text-sm">
                <span>⚔️ {current.force}</span>
                <span>✨ {current.xp} XP</span>
              </div>
            </div>
            {questGranted ? (
              <>
                {questGranted.quest ? (
                  <>
                    <p className="text-sm text-slate-300 mt-4 text-center">
                      {t('npc.quest.granted.intro', { name: questGranted.npcDisplayName })}
                    </p>
                    <p className="text-sm font-semibold text-amber-300 mt-3 text-center bg-amber-900/20 rounded p-2">
                      🧩 {localizeName(t, questGranted.quest.i18nKey, questGranted.quest.label)}
                    </p>
                    <p className="text-xs text-emerald-400 mt-2 text-center">{t('npc.quest.granted.hint')}</p>
                  </>
                ) : (
                  <p className="text-sm text-slate-300 mt-4 text-center">
                    {t('npc.quest.granted.none', { name: questGranted.npcDisplayName })}
                  </p>
                )}
                <div className="mt-5">
                  <button className="btn-primary w-full" onClick={close}>{t('npc.chat.close')}</button>
                </div>
              </>
            ) : tradeResult ? (
              <>
                <p className="text-sm text-slate-300 mt-4 text-center">
                  {tradeResult.lost
                    ? t('npc.trade.result.lostIntro', { name: tradeResult.npcDisplayName })
                    : t('npc.trade.result.gainIntro', { name: tradeResult.npcDisplayName })}
                </p>
                {tradeResult.itemName && (
                  <>
                    <p className={`text-sm font-semibold mt-3 text-center rounded p-2 ${tradeResult.lost ? 'text-rose-300 bg-rose-900/20' : 'text-amber-300 bg-amber-900/20'}`}>
                      {tradeResult.lost ? '➖' : '➕'} {tradeResult.itemName}{(tradeResult.itemQty ?? 1) > 1 ? ` ×${tradeResult.itemQty}` : ''}
                    </p>
                    {tradeResult.tab && (
                      <p className="text-xs text-emerald-400 mt-2 text-center">
                        {ITEM_TAB_ICON[tradeResult.tab]} {t(tradeResult.lost ? 'npc.trade.result.removedFrom' : 'npc.trade.result.storedIn', { tab: t(`game.inventory.tab.${tradeResult.tab}`) })}
                      </p>
                    )}
                  </>
                )}
                {!!tradeResult.coinsDelta && (
                  <p className={`text-xs mt-2 text-center ${tradeResult.coinsDelta < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                    🪙 {tradeResult.coinsDelta > 0 ? '+' : ''}{tradeResult.coinsDelta} {t('npc.trade.result.coins')}
                  </p>
                )}
                <div className="mt-5">
                  <button className="btn-primary w-full" onClick={close}>{t('npc.chat.close')}</button>
                </div>
              </>
            ) : chatFlow ? (
              <>
                <p className="text-sm text-slate-300 mt-4 text-center italic">💬 {chatFlow.displayLine}</p>
                {chatFlow.hintText && (
                  <p className="text-xs text-amber-300 mt-3 text-center bg-amber-900/20 rounded p-2">
                    🧩 {t('npc.chat.hint.label')} : {chatFlow.hintText}
                  </p>
                )}
                {errorMsg && <p className="text-xs text-rose-400 mt-3 text-center">{errorMsg}</p>}
                {chatFlow.phase === 'question' ? (
                  <div className="grid grid-cols-2 gap-2 mt-5">
                    {CHAT_RESPONSE_IDS.map(rid => (
                      <button key={rid} className="btn-secondary text-sm disabled:opacity-50"
                        disabled={chatBusy} onClick={() => respondChat(rid)}>
                        {t(`npc.chat.answer.${rid}`)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="mt-5">
                    <button className="btn-primary w-full disabled:opacity-50" disabled={chatBusy} onClick={continueChat}>
                      {chatBusy ? '⏳' : (chatFlow.pendingNext ? t('npc.chat.continueBtn') : t('npc.chat.close'))}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-slate-300 mt-4 text-center">{t(`npc.dialogue.${OFFER_KEYS[current.offer]}`, { name: currentDisplayName })}</p>
                {errorMsg && <p className="text-xs text-rose-400 mt-3 text-center">{errorMsg}</p>}
                <div className="flex gap-3 mt-5">
                  <button className="btn-primary flex-1 disabled:opacity-50" disabled={busy} onClick={accept}>
                    {busy ? '⏳' : t('npc.accept')}
                  </button>
                  <button className="btn-secondary flex-1 disabled:opacity-50" disabled={busy} onClick={refuse}>
                    {t('npc.refuse')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {/* Lancer de dés OBLIGATOIRE en attente (voir beginFightWithDiceRoll) : pas de fond assombri
          ni de zone bloquante (pointer-events-none) afin que le widget "Lancer de dès" (DiceRollWidget,
          bouton "Lancer...") reste pleinement cliquable pendant que ce bandeau reste affiché. */}
      {current && (awaitingDice || fightPending) && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[95] pointer-events-none px-4 w-full flex justify-center">
          <div className="bg-slate-900/95 border-2 border-cyan-400 rounded-xl px-4 py-3 shadow-xl text-center max-w-xs animate-pulse">
            {awaitingDice ? (
              <>
                <p className="text-sm font-semibold text-cyan-300">🎲 {t('npc.fight.awaitingDice.title')}</p>
                <p className="text-xs text-slate-400 mt-1">{t('npc.fight.awaitingDice.hint')}</p>
              </>
            ) : (
              <p className="text-sm font-semibold text-cyan-300">⏳ {t('npc.fight.resolving')}</p>
            )}
          </div>
        </div>
      )}
      {fightResult && (
        <FightResultModal data={fightResult} onClose={() => setFightResult(null)} />
      )}
      {equipPromptNpc && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[96] p-4">
          <div className="bg-slate-900 border-2 border-amber-500 rounded-xl p-6 max-w-sm w-full text-center">
            <div className="text-4xl mb-2">⚔️🛡️</div>
            <p className="text-sm text-slate-200 mb-1 font-semibold">{t('equip.useForFight.title')}</p>
            <p className="text-xs text-slate-400 mb-4">{t('equip.useForFight.hint')}</p>
            <div className="flex gap-3">
              <button className="btn-primary flex-1" disabled={busy} onClick={() => answerEquipPrompt(true)}>
                {t('equip.useForFight.yes')}
              </button>
              <button className="btn-secondary flex-1" disabled={busy} onClick={() => answerEquipPrompt(false)}>
                {t('equip.useForFight.no')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
