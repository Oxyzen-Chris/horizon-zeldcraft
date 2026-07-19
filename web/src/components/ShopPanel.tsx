'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { getShopCatalog, addToInventory, applyEffect, subscribePlayer, subscribeInventory,
  removeFromInventory, type ShopItem, type PlayerState, type InventoryItem } from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';

/**
 * Boutique — achat/vente d'objets. Utilise la monnaie de jeu (wallet) pour éviter
 * du gas ETH pour chaque petit item. Les gros items (engins mécaniques, sorts épiques)
 * peuvent toujours être vendus on-chain via le catalogue existant.
 */
export function ShopPanel() {
  const { t } = useI18n();
  const { address } = useAccount();
  const [catalog, setCatalog] = useState<ShopItem[]>([]);
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [tab, setTab] = useState<'buy' | 'sell'>('buy');
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => { getShopCatalog().then(setCatalog); }, []);
  useEffect(() => {
    if (!address) return;
    const u1 = subscribePlayer(address, setPlayer);
    const u2 = subscribeInventory(address, setInventory);
    return () => { u1(); u2(); };
  }, [address]);

  const buy = async (item: ShopItem) => {
    if (!address || !item.priceGame) return;
    const cur = player?.wallet ?? 0;
    if (cur < item.priceGame) {
      setFeedback(t('game.shop.notEnough'));
      setTimeout(() => setFeedback(null), 2500);
      return;
    }
    try {
      await applyEffect(address, { wallet: -item.priceGame });
      await addToInventory(address, { itemId: item.itemId, name: item.name, category: item.category, qty: 1, effect: item.effect });
      setFeedback(t('game.shop.bought', { name: item.name }));
    } catch (e: any) {
      console.error('[shop] buy failed:', e);
      setFeedback('❌ ' + (e?.message?.slice(0, 60) ?? 'error'));
    }
    setTimeout(() => setFeedback(null), 3000);
  };

  const sell = async (it: InventoryItem) => {
    if (!address) return;
    const cat = catalog.find(c => c.itemId === it.itemId);
    const salePrice = cat?.priceGame ? Math.floor(cat.priceGame / 2) : 5;
    const ok = await removeFromInventory(address, it.itemId, 1);
    if (!ok) return;
    // Vente : +wallet, +reputation (générosité envers le commerçant)
    await applyEffect(address, { wallet: salePrice, reputation: 1 });
    setFeedback(t('game.shop.sold', { name: it.name, v: salePrice }));
    setTimeout(() => setFeedback(null), 2500);
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">🛒 {t('game.shop.title')}</h3>
        <div className="flex gap-2 text-sm">
          <button className={`px-3 py-1 rounded ${tab === 'buy' ? 'bg-emerald-600' : 'bg-slate-700'}`} onClick={() => setTab('buy')}>{t('game.shop.buy')}</button>
          <button className={`px-3 py-1 rounded ${tab === 'sell' ? 'bg-emerald-600' : 'bg-slate-700'}`} onClick={() => setTab('sell')}>{t('game.shop.sell')}</button>
        </div>
      </div>
      <p className="text-xs text-slate-400 mb-3">💰 {t('game.stats.wallet')} : <b className="text-amber-400">{player?.wallet ?? 0}</b></p>

      {tab === 'buy' ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {catalog.map((c) => {
            const resell = c.priceGame ? Math.floor(c.priceGame / 2) : 5;
            return (
              <div key={c.itemId} className="bg-slate-800/60 rounded p-2">
                <p className="text-sm font-semibold truncate">{c.name}</p>
                <p className="text-xs text-slate-400">{c.priceGame ?? '—'} 💰</p>
                <p className="text-[10px] text-emerald-400 mb-2">
                  ↩ {t('game.shop.resellAt')} {resell} 💰
                </p>
                <button className="btn-primary text-xs w-full" disabled={!c.priceGame} onClick={() => buy(c)}>
                  {t('game.shop.buy')}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {inventory.length === 0 && <p className="text-sm text-slate-400 col-span-full">{t('game.inventory.empty')}</p>}
          {inventory.map((it) => {
            const cat = catalog.find(c => c.itemId === it.itemId);
            const salePrice = cat?.priceGame ? Math.floor(cat.priceGame / 2) : 5;
            return (
              <div key={it.itemId} className="bg-slate-800/60 rounded p-2">
                <p className="text-sm font-semibold truncate">{it.name}</p>
                <p className="text-xs text-slate-400">×{it.qty}</p>
                <p className="text-[10px] text-emerald-400 mb-2">↩ {salePrice} 💰</p>
                <button className="btn-secondary text-xs w-full" onClick={() => sell(it)}>
                  {t('game.shop.sellOne')}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {feedback && <p className="text-sm mt-3 text-cyan-400">{feedback}</p>}
      <p className="text-xs text-slate-500 mt-3">{t('game.shop.hint')}</p>
    </div>
  );
}
