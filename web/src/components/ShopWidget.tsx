'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { getShopCatalog, addToInventory, applyEffect, subscribePlayer, subscribeInventory,
  removeFromInventory, subscribeFamiliars, getFamiliarDefs, familiarKeyOf,
  type ShopItem, type PlayerState, type InventoryItem, type FamiliarDef } from '@/lib/gameState';
import { ITEM_TAB_CATEGORIES, ITEM_TAB_ORDER, ITEM_TAB_ICON, type ItemTab } from '@/lib/itemTabs';
import { useI18n, itemLabel, localizeName } from '@/lib/i18n';
import { ConfirmDialog } from './ConfirmDialog';
import { DragonSkin, dragonKindFromId } from './DragonSkin';
import { useWindowZIndex } from '@/lib/windowZOrder';

const POS_KEY = 'zc.shopWidgetPos';
const COLLAPSED_KEY = 'zc.shopWidgetCollapsed';

interface Pos { x: number; y: number }

/**
 * Fenêtre flottante et déplaçable "Boutique des terres de ZeldCraft" — duplique ShopPanel.tsx
 * (section fixe de la page) dans une fenêtre repositionnable, comme StatsWidget.tsx duplique le
 * tableau de statistiques fixe et InventoryWidget.tsx duplique la besace. Mêmes onglets
 * Acheter/Vendre et mêmes 8 compartiments par catégorie (voir itemTabs.ts) que la boutique fixe :
 * Armes, Protections, Nourriture, Potions & Sortilèges, Engins, Trésors, Selles, Familiers.
 * Purement additif : la section fixe ShopPanel.tsx n'est ni retirée ni modifiée, aucune
 * régression sur son fonctionnement existant.
 */
export function ShopWidget() {
  const { t } = useI18n();
  const { address } = useAccount();
  const { z, bringToFront } = useWindowZIndex();
  const [collapsed, setCollapsed] = useState(true);
  const [pos, setPos] = useState<Pos | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef<Pos>({ x: 0, y: 0 });

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

  useEffect(() => {
    setCollapsed((localStorage.getItem(COLLAPSED_KEY) ?? '1') === '1');
    const saved = localStorage.getItem(POS_KEY);
    if (saved) { try { setPos(JSON.parse(saved)); } catch { /* ignore */ } }
    else if (typeof window !== 'undefined') setPos({ x: window.innerWidth - 300, y: 230 });
  }, []);

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

  const onPointerDown = (e: React.PointerEvent) => {
    if (!pos) return;
    setDragging(true);
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
  };
  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    if (pos) localStorage.setItem(POS_KEY, JSON.stringify(pos));
  };
  const toggleCollapsed = () => {
    setCollapsed(prev => { localStorage.setItem(COLLAPSED_KEY, prev ? '0' : '1'); return !prev; });
  };

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
      await addToInventory(address, {
        itemId: item.itemId, name: item.name, category: item.category, qty: 1,
        ...(item.effect ? { effect: item.effect } : {}),
        ...(item.slot ? { slot: item.slot } : {}),
        ...(item.rarity ? { rarity: item.rarity } : {}),
        ...(item.damage ? { damage: item.damage } : {}),
        ...(item.defense ? { defense: item.defense } : {}),
        ...(item.durabilityMax ? { durabilityMax: item.durabilityMax } : {}),
        ...(item.requiresArrow ? { requiresArrow: true } : {}),
        ...(item.requiresFamiliarId ? { requiresFamiliarId: item.requiresFamiliarId } : {}),
      });
      setFeedback(t('game.shop.bought', { name }));
    } catch (e: any) {
      console.error('[shopWidget] buy failed:', e);
      setFeedback('❌ ' + (e?.message?.slice(0, 60) ?? 'error'));
    }
    setTimeout(() => setFeedback(null), 3000);
  };

  const sell = async (it: InventoryItem, salePrice: number) => {
    if (!address) return;
    const ok = await removeFromInventory(address, it.itemId, 1);
    if (!ok) return;
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

  if (!address || !pos) return null;

  if (collapsed) {
    return (
      <button
        className="fixed z-40 w-14 h-14 rounded-full bg-slate-900 border-2 border-amber-500 text-2xl shadow-lg flex items-center justify-center"
        style={{ left: pos.x, top: pos.y, zIndex: z }}
        onPointerDownCapture={bringToFront}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onClick={() => !dragging && toggleCollapsed()}
        title={t('game.shop.widgetTitle')}
      >🏪</button>
    );
  }

  const activeFamiliars = familiars.filter((f) => f.active && owned[familiarKeyOf(f.id)]);
  const visibleCatalog = itemTab !== 'familiars'
    ? catalog.filter((c) => ITEM_TAB_CATEGORIES[itemTab].includes(c.category))
    : [];
  const visibleInventory = itemTab !== 'familiars'
    ? inventory.filter((it) => ITEM_TAB_CATEGORIES[itemTab].includes(it.category))
    : [];

  return (
    <div
      className="fixed z-40 w-80 bg-slate-900 border-2 border-amber-500 rounded-xl shadow-xl select-none"
      style={{ left: pos.x, top: pos.y, zIndex: z }}
      onPointerDownCapture={bringToFront}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-amber-900/30 rounded-t-xl cursor-move"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      >
        <span className="text-sm font-semibold truncate">🏪 {t('game.shop.widgetTitle')}</span>
        <button className="text-xs opacity-70 hover:opacity-100 shrink-0 ml-2" onClick={toggleCollapsed}>✕</button>
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] text-slate-400">💰 <b className="text-amber-400">{player?.wallet ?? 0}</b></p>
          <div className="flex gap-1 text-[10px]">
            <button className={`px-2 py-1 rounded ${tab === 'buy' ? 'bg-emerald-600' : 'bg-slate-700'}`} onClick={() => setTab('buy')}>{t('game.shop.buy')}</button>
            <button className={`px-2 py-1 rounded ${tab === 'sell' ? 'bg-emerald-600' : 'bg-slate-700'}`} onClick={() => setTab('sell')}>{t('game.shop.sell')}</button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 mb-2">
          {ITEM_TAB_ORDER.map((tb) => (
            <button
              key={tb}
              className={`px-2 py-1 rounded text-[10px] ${itemTab === tb ? 'bg-indigo-600' : 'bg-slate-700'}`}
              onClick={() => setItemTab(tb)}
            >
              {ITEM_TAB_ICON[tb]} {t(`game.inventory.tab.${tb}`)}
            </button>
          ))}
        </div>

        <div className="max-h-80 overflow-y-auto pr-1">
          {itemTab === 'familiars' ? (
            activeFamiliars.length === 0 ? (
              <p className="text-xs text-slate-400">{t('game.inventory.tab.familiars.empty')}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {activeFamiliars.map((f) => {
                  const kind = dragonKindFromId(f.id);
                  return (
                    <div key={f.id} className="bg-slate-800/60 rounded p-2 text-center">
                      {kind && <div className="flex justify-center mb-1"><DragonSkin kind={kind} size={32} /></div>}
                      <p className="text-[11px] font-semibold truncate">{localizeName(t, f.i18nKey, f.label)}</p>
                    </div>
                  );
                })}
              </div>
            )
          ) : tab === 'buy' ? (
            visibleCatalog.length === 0 ? (
              <p className="text-xs text-slate-400">{t('game.inventory.empty')}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {visibleCatalog.map((c) => {
                  const resell = c.priceGame ? Math.floor(c.priceGame / 2) : 5;
                  return (
                    <div key={c.itemId} className="bg-slate-800/60 rounded p-2">
                      <p className="text-[11px] font-semibold truncate">{itemLabel(t, c.itemId, c.name)}</p>
                      <p className="text-[10px] text-slate-400">{c.priceGame ?? '—'} 💰</p>
                      {(c.damage || c.defense) && (
                        <p className="text-[9px] mb-1">
                          {c.damage ? <span className="text-emerald-400">⚔️ {c.damage}</span> : null}
                          {c.defense ? <span className="text-sky-400"> 🛡️ {c.defense}</span> : null}
                        </p>
                      )}
                      <p className="text-[9px] text-emerald-400 mb-1">↩ {resell} 💰</p>
                      <button className="btn-primary text-[10px] w-full" disabled={!c.priceGame} onClick={() => askBuy(c)}>
                        {t('game.shop.buy')}
                      </button>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {visibleInventory.length === 0 && <p className="text-xs text-slate-400 col-span-full">{t('game.inventory.empty')}</p>}
              {visibleInventory.map((it) => {
                const cat = catalog.find(c => c.itemId === it.itemId);
                const salePrice = cat?.priceGame ? Math.floor(cat.priceGame / 2) : 5;
                return (
                  <div key={it.itemId} className="bg-slate-800/60 rounded p-2">
                    <p className="text-[11px] font-semibold truncate">{itemLabel(t, it.itemId, it.name)}</p>
                    <p className="text-[10px] text-slate-400">×{it.qty}</p>
                    <p className="text-[9px] text-emerald-400 mb-1">↩ {salePrice} 💰</p>
                    <button className="btn-secondary text-[10px] w-full" onClick={() => askSell(it)}>
                      {t('game.shop.sellOne')}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {feedback && <p className="text-xs text-cyan-400 mt-2 text-center">{feedback}</p>}
      </div>

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
