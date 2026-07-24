'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { getShopCatalog, addToInventory, applyEffect, subscribePlayer, subscribeInventory,
  removeFromInventory, subscribeFamiliars, getFamiliarDefs, familiarKeyOf,
  type ShopItem, type PlayerState, type InventoryItem, type FamiliarDef } from '@/lib/gameState';
import { ITEM_TAB_CATEGORIES, ITEM_TAB_ORDER, ITEM_TAB_ICON, type ItemTab } from '@/lib/itemTabs';
import { useI18n, itemLabel, localizeName } from '@/lib/i18n';
import { ConfirmDialog } from './ConfirmDialog';
import { DragonSkin, dragonKindFromId } from './DragonSkin';

/**
 * Boutique — achat/vente d'objets. Utilise la monnaie de jeu (wallet) pour éviter
 * du gas ETH pour chaque petit item. Les gros items (engins mécaniques, sorts épiques)
 * peuvent toujours être vendus on-chain via le catalogue existant.
 * Découpée en onglets par catégorie, identiques à ceux de la besace (voir itemTabs.ts).
 */
export function ShopPanel() {
  const { t } = useI18n();
  const { address } = useAccount();
  const [catalog, setCatalog] = useState<ShopItem[]>([]);
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [tab, setTab] = useState<'buy' | 'sell'>('buy');
  const [itemTab, setItemTab] = useState<ItemTab>('weapon');
  const [familiars, setFamiliars] = useState<FamiliarDef[]>([]);
  const [owned, setOwned] = useState<Record<string, { obtainedAt: number }>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    | { kind: 'buy'; item: ShopItem }
    | { kind: 'sell'; item: InventoryItem; price: number }
    | null
  >(null);

  useEffect(() => { getShopCatalog().then(setCatalog); }, []);
  useEffect(() => {
    if (!address) return;
    const u1 = subscribePlayer(address, setPlayer);
    const u2 = subscribeInventory(address, setInventory);
    return () => { u1(); u2(); };
  }, [address]);
  useEffect(() => { getFamiliarDefs().then(setFamiliars).catch(() => {}); }, []);
  useEffect(() => {
    if (!address) return;
    return subscribeFamiliars(address, setOwned);
  }, [address]);

  const buy = async (item: ShopItem) => {
    if (!address || !item.priceGame) return;
    const cur = player?.wallet ?? 0;
    const name = itemLabel(t, item.itemId, item.name);
    if (cur < item.priceGame) {
      setFeedback(t('game.shop.notEnough'));
      setTimeout(() => setFeedback(null), 2500);
      return;
    }
    try {
      await applyEffect(address, { wallet: -item.priceGame });
      // Reporte l'intégralité des propriétés d'équipement du catalogue vers la besace (slot,
      // rareté, dégâts, défense, durabilité, arc) — sans quoi un objet acheté en boutique perdait
      // ses stats de combat et devenait impossible à équiper (glisser-déposer refusé, "mauvais
      // emplacement") sur la fenêtre Équipement. `effect` n'est ajouté que s'il existe réellement
      // (un objet sans effet stocké en base via {} finit sans ce champ — Firebase l'élague).
      await addToInventory(address, {
        itemId: item.itemId, name: item.name, category: item.category, qty: 1,
        ...(item.effect ? { effect: item.effect } : {}),
        ...(item.slot ? { slot: item.slot } : {}),
        ...(item.rarity ? { rarity: item.rarity } : {}),
        ...(item.damage ? { damage: item.damage } : {}),
        ...(item.defense ? { defense: item.defense } : {}),
        ...(item.durabilityMax ? { durabilityMax: item.durabilityMax } : {}),
        ...(item.requiresArrow ? { requiresArrow: true } : {}),
      });
      setFeedback(t('game.shop.bought', { name }));
    } catch (e: any) {
      console.error('[shop] buy failed:', e);
      setFeedback('❌ ' + (e?.message?.slice(0, 60) ?? 'error'));
    }
    setTimeout(() => setFeedback(null), 3000);
  };

  const sell = async (it: InventoryItem, salePrice: number) => {
    if (!address) return;
    const ok = await removeFromInventory(address, it.itemId, 1);
    if (!ok) return;
    // Vente : +wallet, +reputation (générosité envers le commerçant)
    await applyEffect(address, { wallet: salePrice, reputation: 1 });
    setFeedback(t('game.shop.sold', { name: itemLabel(t, it.itemId, it.name), v: salePrice }));
    setTimeout(() => setFeedback(null), 2500);
  };

  const askBuy = (item: ShopItem) => {
    if (!item.priceGame) return;
    setConfirm({ kind: 'buy', item });
  };
  const askSell = (it: InventoryItem) => {
    const cat = catalog.find(c => c.itemId === it.itemId);
    const salePrice = cat?.priceGame ? Math.floor(cat.priceGame / 2) : 5;
    setConfirm({ kind: 'sell', item: it, price: salePrice });
  };
  const runConfirm = async () => {
    if (!confirm) return;
    const c = confirm;
    setConfirm(null);
    if (c.kind === 'buy')  await buy(c.item);
    if (c.kind === 'sell') await sell(c.item, c.price);
  };

  const activeFamiliars = familiars.filter((f) => f.active && owned[familiarKeyOf(f.id)]);
  const visibleCatalog = itemTab !== 'familiars'
    ? catalog.filter((c) => ITEM_TAB_CATEGORIES[itemTab].includes(c.category))
    : [];
  const visibleInventory = itemTab !== 'familiars'
    ? inventory.filter((it) => ITEM_TAB_CATEGORIES[itemTab].includes(it.category))
    : [];

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

      <div className="flex flex-wrap gap-1 mb-3">
        {ITEM_TAB_ORDER.map((tb) => (
          <button
            key={tb}
            className={`px-2 py-1 rounded text-xs ${itemTab === tb ? 'bg-indigo-600' : 'bg-slate-700'}`}
            onClick={() => setItemTab(tb)}
          >
            {ITEM_TAB_ICON[tb]} {t(`game.inventory.tab.${tb}`)}
          </button>
        ))}
      </div>

      {itemTab === 'familiars' ? (
        activeFamiliars.length === 0 ? (
          <p className="text-sm text-slate-400">{t('game.inventory.tab.familiars.empty')}</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {activeFamiliars.map((f) => {
              const kind = dragonKindFromId(f.id);
              return (
                <div key={f.id} className="bg-slate-800/60 rounded p-2 text-center">
                  {kind && <div className="flex justify-center mb-1"><DragonSkin kind={kind} size={40} /></div>}
                  <p className="text-xs font-semibold truncate">{localizeName(t, f.i18nKey, f.label)}</p>
                </div>
              );
            })}
          </div>
        )
      ) : tab === 'buy' ? (
        visibleCatalog.length === 0 ? (
          <p className="text-sm text-slate-400">{t('game.inventory.empty')}</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {visibleCatalog.map((c) => {
              const resell = c.priceGame ? Math.floor(c.priceGame / 2) : 5;
              return (
                <div key={c.itemId} className="bg-slate-800/60 rounded p-2">
                  <p className="text-sm font-semibold truncate">{itemLabel(t, c.itemId, c.name)}</p>
                  <p className="text-xs text-slate-400">{c.priceGame ?? '—'} 💰</p>
                  {(c.damage || c.defense) && (
                    <p className="text-[10px] mb-1">
                      {c.damage ? <span className="text-emerald-400">⚔️ {c.damage}</span> : null}
                      {c.defense ? <span className="text-sky-400"> 🛡️ {c.defense}</span> : null}
                      {c.rarity ? <span className="text-amber-400"> · {t(`equip.rarity.${c.rarity}`)}</span> : null}
                    </p>
                  )}
                  <p className="text-[10px] text-emerald-400 mb-2">
                    ↩ {t('game.shop.resellAt')} {resell} 💰
                  </p>
                  <button className="btn-primary text-xs w-full" disabled={!c.priceGame} onClick={() => askBuy(c)}>
                    {t('game.shop.buy')}
                  </button>
                </div>
              );
            })}
          </div>
        )
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {visibleInventory.length === 0 && <p className="text-sm text-slate-400 col-span-full">{t('game.inventory.empty')}</p>}
          {visibleInventory.map((it) => {
            const cat = catalog.find(c => c.itemId === it.itemId);
            const salePrice = cat?.priceGame ? Math.floor(cat.priceGame / 2) : 5;
            return (
              <div key={it.itemId} className="bg-slate-800/60 rounded p-2">
                <p className="text-sm font-semibold truncate">{itemLabel(t, it.itemId, it.name)}</p>
                <p className="text-xs text-slate-400">×{it.qty}</p>
                <p className="text-[10px] text-emerald-400 mb-2">↩ {salePrice} 💰</p>
                <button className="btn-secondary text-xs w-full" onClick={() => askSell(it)}>
                  {t('game.shop.sellOne')}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {feedback && <p className="text-sm mt-3 text-cyan-400">{feedback}</p>}
      <p className="text-xs text-slate-500 mt-3">{t('game.shop.hint')}</p>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === 'buy'
          ? t('game.shop.confirmBuyTitle')
          : t('game.shop.confirmSellTitle')}
        message={confirm?.kind === 'buy'
          ? t('game.shop.confirmBuyMsg', { name: itemLabel(t, confirm.item.itemId, confirm.item.name), price: confirm.item.priceGame ?? 0 })
          : confirm?.kind === 'sell'
            ? t('game.shop.confirmSellMsg', { name: itemLabel(t, confirm.item.itemId, confirm.item.name), price: confirm.price })
            : ''}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

