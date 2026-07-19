'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { subscribeInventory, applyEffect, removeFromInventory, type InventoryItem } from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';

/** Sac du joueur — inventaire off-chain (Firebase), pas de gas pour manipuler. */
export function InventoryPanel() {
  const { t } = useI18n();
  const { address } = useAccount();
  const [items, setItems] = useState<InventoryItem[]>([]);

  useEffect(() => {
    if (!address) return;
    return subscribeInventory(address, setItems);
  }, [address]);

  const use = async (it: InventoryItem) => {
    if (!address) return;
    if (it.effect) await applyEffect(address, it.effect);
    await removeFromInventory(address, it.itemId, 1);
  };

  const renderEffect = (e: InventoryItem['effect']) => {
    if (!e) return null;
    const parts: string[] = [];
    if (e.hp)        parts.push(`❤️ +${e.hp}`);
    if (e.hunger)    parts.push(`🍖 +${e.hunger}`);
    if (e.happiness) parts.push(`😊 +${e.happiness}`);
    if (e.force)     parts.push(`⚔️ +${e.force}`);
    if (e.spells)    parts.push(`✨ +${e.spells}`);
    if (e.maxHp)     parts.push(`❤️max +${e.maxHp}`);
    if (e.maxForce)  parts.push(`⚔️max +${e.maxForce}`);
    if (e.maxSpells) parts.push(`✨max +${e.maxSpells}`);
    return parts.length ? <p className="text-[10px] text-cyan-300 mb-1">{parts.join(' · ')}</p> : null;
  };

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-3">🎒 {t('game.inventory.title')}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">{t('game.inventory.empty')}</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {items.map((it) => (
            <div key={it.itemId} className="bg-slate-800/60 rounded p-2 text-center">
              <p className="text-sm font-semibold truncate">{it.name}</p>
              <p className="text-xs text-slate-400 mb-1">×{it.qty}</p>
              {renderEffect(it.effect)}
              {it.effect && (
                <button className="btn-secondary text-xs w-full" onClick={() => use(it)}>
                  {t('game.inventory.use')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-500 mt-2">{t('game.inventory.hint')}</p>
    </div>
  );
}
