'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, useReadContract, useChainId } from 'wagmi';
import { HORIZON_ABI, NPC_SKINS, NPC_NAME_SUFFIXES } from '@/lib/contract';
import { applyEffect, logEncounter, addToInventory, type EncounterRecord } from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';

/**
 * Popup de rencontres PNJ aléatoires — 3 à 5×/jour selon le réglage admin
 * (`npcMaxPerDay` on-chain, réutilisé). Le tirage est stocké en localStorage
 * pour éviter de rejouer la même journée après refresh.
 */
type PopupNpc = {
  key: string;         // id local du tirage (pas on-chain)
  name: string;
  skin: number;        // index dans NPC_SKINS
  alignment: 'friendly' | 'neutral' | 'hostile' | 'unknown';
  offer: 'trade' | 'quest' | 'fight' | 'chat';
  force: number;
  xp: number;
};

const ALIGN_ICONS = { friendly: '😇', neutral: '🙂', hostile: '👿', unknown: '❓' };
const OFFER_ICONS = { trade: '💰', quest: '📜', fight: '⚔️', chat: '💬' };
const OFFER_KEYS  = { trade: 'trade', quest: 'quest', fight: 'fight', chat: 'chat' };

// Archétypes de PNJ (nom base ; skin choisi aléatoirement)
const ARCHETYPES = [
  { base: 'Marchand', align: 'friendly', offer: 'trade' },
  { base: 'Chevalier', align: 'neutral', offer: 'quest' },
  { base: 'Combattant', align: 'hostile', offer: 'fight' },
  { base: 'Sorcier', align: 'unknown', offer: 'trade' },
  { base: 'Villageois', align: 'friendly', offer: 'chat' },
  { base: 'Voleur', align: 'hostile', offer: 'fight' },
  { base: 'Templier', align: 'neutral', offer: 'quest' },
  { base: 'Hobbit', align: 'friendly', offer: 'chat' },
] as const;

function pick<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

function rollNpc(): PopupNpc {
  const a = pick(ARCHETYPES);
  return {
    key: Math.random().toString(36).slice(2, 10),
    name: `${a.base} ${pick(NPC_NAME_SUFFIXES)}`,
    skin: Math.floor(Math.random() * NPC_SKINS.length),
    alignment: a.align as PopupNpc['alignment'],
    offer: a.offer as PopupNpc['offer'],
    force: 5 + Math.floor(Math.random() * 40),
    xp: 10 + Math.floor(Math.random() * 90),
  };
}

export function NpcEncounterPopup({ contract, tokenId }: { contract: `0x${string}`; tokenId: bigint }) {
  const { t } = useI18n();
  const { address } = useAccount();
  const chainId = useChainId();
  const [current, setCurrent] = useState<PopupNpc | null>(null);
  const timerRef = useRef<any>(null);

  const { data: maxPerDay } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'npcMaxPerDay',
    query: { enabled: !!contract },
  });

  // Planificateur : découpe la journée en N tranches et déclenche la popup
  // dans une fenêtre aléatoire de chaque tranche, tant que quota non atteint.
  useEffect(() => {
    if (!address) return;
    const max = Number(maxPerDay ?? 4);
    const storageKey = `zc.popupCount.${address.toLowerCase()}.${new Date().toDateString()}`;
    const count = Number(localStorage.getItem(storageKey) ?? 0);
    if (count >= max) return;

    // Prochain popup dans 60s à 25min (accéléré pour démo ; ajustable)
    const delay = 60_000 + Math.random() * 25 * 60_000;
    timerRef.current = setTimeout(() => {
      const npc = rollNpc();
      setCurrent(npc);
      localStorage.setItem(storageKey, String(count + 1));
    }, delay);
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, maxPerDay, current, chainId]);

  const close = () => setCurrent(null);

  const accept = async () => {
    if (!current || !address) return;
    const npc = current;
    let outcome: EncounterRecord['outcome'] = 'accepted';
    let xpDelta = npc.xp;
    let repDelta = 0;
    let hpDelta = 0;
    let forceDelta = 0;
    let spellsDelta = 0;
    let walletDelta = 0;

    if (npc.offer === 'fight') {
      // Résolution de combat : win = +rep +force, loss = -rep -hp
      const win = Math.random() > 0.4;
      outcome = win ? 'won' : 'lost';
      xpDelta = win ? npc.xp : Math.floor(npc.xp / 3);
      hpDelta = win ? -8 : -30;
      forceDelta = win ? 3 : 0;
      // Rép : rép si le PNJ était hostile (voleur/combattant) → chargée émotionnellement
      repDelta = win ? (npc.alignment === 'hostile' ? 8 : 4) : -6;
    } else if (npc.offer === 'trade') {
      if (npc.alignment === 'hostile') {
        // Voleur déguisé en marchand : perte de wallet + rép fortement négative
        const stolen = Math.min(50, 20 + Math.floor(Math.random() * 30));
        walletDelta = -stolen;
        repDelta = -5;
        outcome = 'lost';
      } else {
        // Vrai marchand : cadeau + rép positive
        const items = [
          { itemId: 'potion_hp', name: '🧪 Potion de vie', category: 'potion' as const, effect: { hp: 40 } },
          { itemId: 'apple',     name: '🍎 Pomme',         category: 'food'   as const, effect: { hunger: 10 } },
          { itemId: 'spell_fire',name: '🔥 Sort de feu',   category: 'spell'  as const, effect: { spells: 25 } },
        ];
        const gift = items[Math.floor(Math.random() * items.length)];
        await addToInventory(address, { ...gift, qty: 1 });
        walletDelta = 5;
        repDelta = npc.alignment === 'friendly' ? 4 : 2;
      }
    } else if (npc.offer === 'quest') {
      spellsDelta = 3;
      repDelta = 5; // bonne rencontre : promesse d'aventure
    } else {
      // chat : bonheur + rép selon alignement
      xpDelta = Math.floor(npc.xp / 2);
      repDelta = npc.alignment === 'friendly' ? 3 : npc.alignment === 'hostile' ? -2 : 1;
    }

    await applyEffect(address, {
      hp: hpDelta, force: forceDelta, spells: spellsDelta,
      reputation: repDelta, wallet: walletDelta, happiness: 5,
    });
    await logEncounter(address, {
      npcId: npc.key, npcName: npc.name, npcSkin: npc.skin,
      alignment: npc.alignment, offer: npc.offer,
      timestamp: Date.now(), outcome, xpGained: xpDelta,
    });
    close();
  };

  const refuse = async () => {
    if (!current || !address) return;
    await logEncounter(address, {
      npcId: current.key, npcName: current.name, npcSkin: current.skin,
      alignment: current.alignment, offer: current.offer,
      timestamp: Date.now(), outcome: 'refused', xpGained: 0,
    });
    close();
  };

  if (!current) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={close}>
      <div className="bg-slate-900 border-2 border-cyan-500 rounded-xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="text-center">
          <div className="text-6xl mb-3">{NPC_SKINS[current.skin]}</div>
          <h3 className="text-xl font-bold text-cyan-300">{current.name}</h3>
          <p className="text-sm text-slate-400 mt-1">
            {ALIGN_ICONS[current.alignment]} {t(`npc.align.${current.alignment}`)} · {OFFER_ICONS[current.offer]} {t(`npc.offer.${OFFER_KEYS[current.offer]}`)}
          </p>
          <div className="flex justify-around bg-slate-800/60 rounded p-2 mt-3 text-sm">
            <span>⚔️ {current.force}</span>
            <span>✨ {current.xp} XP</span>
          </div>
        </div>
        <p className="text-sm text-slate-300 mt-4 text-center">{t(`npc.dialogue.${OFFER_KEYS[current.offer]}`, { name: current.name })}</p>
        <div className="flex gap-3 mt-5">
          <button className="btn-primary flex-1" onClick={accept}>{t('npc.accept')}</button>
          <button className="btn-secondary flex-1" onClick={refuse}>{t('npc.refuse')}</button>
        </div>
      </div>
    </div>
  );
}
