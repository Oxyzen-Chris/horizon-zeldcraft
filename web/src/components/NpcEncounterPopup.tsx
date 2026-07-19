'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, useReadContract, useChainId } from 'wagmi';
import { ref, get } from 'firebase/database';
import { HORIZON_ABI, NPC_SKINS, NPC_NAME_SUFFIXES } from '@/lib/contract';
import { applyEffect, logEncounter, addToInventory, removeFromInventory, getRepRules, getOrCreatePlayer, type EncounterRecord, type RepRules } from '@/lib/gameState';
import { getFirebaseDb } from '@/lib/firebase';
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
  const [rules, setRules] = useState<RepRules | null>(null);
  const timerRef = useRef<any>(null);

  // Charge les règles de reconnaissance paramétrables (admin)
  useEffect(() => {
    getRepRules().then(setRules).catch(() => {});
  }, []);

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

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const close = () => { setCurrent(null); setErrorMsg(null); };

  const accept = async () => {
    if (!current || !address || busy) return;
    setBusy(true);
    setErrorMsg(null);
    const npc = current;
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

      if (npc.offer === 'fight') {
        const win = Math.random() > 0.4;
        outcome = win ? 'won' : 'lost';
        xpDelta = win ? npc.xp : Math.floor(npc.xp / 3);
        xpBonusDelta = xpDelta;
        hpDelta = win ? -8 : -30;
        forceDelta = win ? 3 : 0;
        repDelta = win
          ? (npc.alignment === 'hostile' ? r.fightWinHostile : r.fightWinNormal)
          : r.fightLoss;
      } else if (npc.offer === 'trade') {
        if (npc.alignment === 'hostile') {
          const stealFromBag = Math.random() < 0.5;
          let stolenItemName: string | undefined;
          if (stealFromBag) {
            const db = getFirebaseDb();
            if (db) {
              const invSnap = await get(ref(db, `players/${address.toLowerCase()}/inventory`));
              const inv = invSnap.val() as Record<string, { name: string; qty: number }> | null;
              const stealable = inv ? Object.entries(inv).filter(([, it]) => it.qty > 0) : [];
              if (stealable.length > 0) {
                const [itemId, it] = stealable[Math.floor(Math.random() * stealable.length)];
                const maxQty = Math.max(1, r.theftMaxItems ?? 1);
                const qtyStolen = Math.min(it.qty, maxQty);
                await removeFromInventory(address, itemId, qtyStolen);
                stolenItemName = qtyStolen > 1 ? `${it.name} ×${qtyStolen}` : it.name;
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
          walletDelta = 5;
          repDelta = npc.alignment === 'friendly' ? r.tradeFriendly : r.tradeNeutral;
        }
      } else if (npc.offer === 'quest') {
        spellsDelta = 3;
        xpBonusDelta = xpDelta;
        repDelta = r.questAccepted;
      } else {
        xpDelta = Math.floor(npc.xp / 2);
        xpBonusDelta = xpDelta;
        repDelta = npc.alignment === 'friendly' ? r.chatFriendly
                : npc.alignment === 'hostile'   ? r.chatHostile
                : r.chatNeutral;
      }

      await applyEffect(address, {
        hp: hpDelta, force: forceDelta, spells: spellsDelta,
        reputation: repDelta, wallet: walletDelta, happiness: 5,
        xpBonus: xpBonusDelta,
      });
      await logEncounter(address, {
        npcId: npc.key, npcName: npc.name, npcSkin: npc.skin,
        alignment: npc.alignment, offer: npc.offer,
        timestamp: Date.now(), outcome, xpGained: xpDelta,
        itemName, walletDelta, hpDelta, repDelta,
      });
      close();
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

  if (!current) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => !busy && close()}>
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
        {errorMsg && <p className="text-xs text-rose-400 mt-3 text-center">{errorMsg}</p>}
        <div className="flex gap-3 mt-5">
          <button className="btn-primary flex-1 disabled:opacity-50" disabled={busy} onClick={accept}>
            {busy ? '⏳' : t('npc.accept')}
          </button>
          <button className="btn-secondary flex-1 disabled:opacity-50" disabled={busy} onClick={refuse}>
            {t('npc.refuse')}
          </button>
        </div>
      </div>
    </div>
  );
}
