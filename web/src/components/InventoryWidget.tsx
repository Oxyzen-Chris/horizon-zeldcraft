'use client';

import { useEffect, useState } from 'react';
import {
  subscribeInventory, getRepRules, subscribeFamiliars, getFamiliarDefs, familiarKeyOf,
  consumeInventoryItem, equipItem, equipFamiliar, FAMILIAR_DRAG_PREFIX,
  getPotionCombos, combinePotions,
  type InventoryItem, type RepRules, type FamiliarDef, type PotionCombo,
} from '@/lib/gameState';
import { ITEM_TAB_CATEGORIES as TAB_CATEGORIES, ITEM_TAB_ORDER as TAB_ORDER, ITEM_TAB_ICON as TAB_ICON, type ItemTab as Tab } from '@/lib/itemTabs';
import { useI18n, itemLabel, localizeName } from '@/lib/i18n';
import { ConfirmDialog } from './ConfirmDialog';
import { DragonSkin, dragonKindFromId } from './DragonSkin';
import { useWindowZIndex, handleWidgetPointerDownCapture } from '@/lib/windowZOrder';
import { useDraggableWidget } from '@/lib/useDraggableWidget';
import { WidgetContextMenu } from './WidgetContextMenu';
import { useEffectiveAccount } from '@/lib/effectiveAccount';

const POS_KEY = 'zc.inventoryWidgetPos';
const COLLAPSED_KEY = 'zc.inventoryWidgetCollapsed';

interface Pos { x: number; y: number }

const EQUIP_BUTTON_CATEGORIES = new Set<InventoryItem['category']>(['vehicle', 'saddle']);
const MOUTH_CATEGORIES = new Set<InventoryItem['category']>([...TAB_CATEGORIES.food, ...TAB_CATEGORIES.potion]);

type ConfirmAction =
  | { kind: 'use'; item: InventoryItem }
  | { kind: 'equip'; item: InventoryItem }
  | { kind: 'equipFamiliar'; familiar: FamiliarDef }
  | { kind: 'combine'; combo: PotionCombo };

/**
 * Fenêtre flottante et déplaçable "Sac / Besace" — duplique InventoryPanel.tsx (section fixe de
 * la page) dans une fenêtre repositionnable, comme StatsWidget.tsx duplique le tableau de
 * statistiques fixe. Objectif : pouvoir glisser-déposer directement les objets de la besace vers
 * la fenêtre flottante EquipmentWidget.tsx sans avoir à faire défiler la page (les deux fenêtres
 * peuvent être placées côte à côte à l'écran). Mêmes 8 compartiments/onglets que la besace fixe et
 * la boutique (voir itemTabs.ts) : Armes, Protections, Nourriture, Potions & Sortilèges, Engins,
 * Trésors, Selles, Familiers. Purement additif : la section fixe InventoryPanel.tsx n'est ni
 * retirée ni modifiée, aucune régression sur son fonctionnement existant.
 */
export function InventoryWidget({ enabled = true }: { enabled?: boolean } = {}) {
  const { t } = useI18n();
  const { address } = useEffectiveAccount();
  const { z, bringToFront } = useWindowZIndex();
  const {
    collapsed, pos, onPointerDown, onPointerMove, onPointerUp, onToggleClick, toggleCollapsed,
    containerRef, menuPos, onContextMenu, closeContextMenu, resetPosition,
  } = useDraggableWidget({
    posKey: POS_KEY, collapsedKey: COLLAPSED_KEY,
    defaultPos: () => ({ x: window.innerWidth - 300, y: 160 }),
    onExpand: bringToFront,
  });

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('weapon');
  const [rules, setRules] = useState<RepRules | null>(null);
  const [familiars, setFamiliars] = useState<FamiliarDef[]>([]);
  const [owned, setOwned] = useState<Record<string, { obtainedAt: number }>>({});
  const [combos, setCombos] = useState<PotionCombo[]>([]);

  useEffect(() => {
    if (!address) return;
    return subscribeInventory(address, setItems);
  }, [address]);
  useEffect(() => { getRepRules().then(setRules).catch(() => {}); }, []);
  useEffect(() => { getFamiliarDefs().then(setFamiliars).catch(() => {}); }, []);
  useEffect(() => { getPotionCombos().then(setCombos).catch(() => {}); }, []);
  useEffect(() => {
    if (!address) return;
    return subscribeFamiliars(address, setOwned);
  }, [address]);

  const flash = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(null), 3000); };

  const use = async (it: InventoryItem) => {
    if (!address || !rules) return;
    await consumeInventoryItem(address, it, rules);
  };
  const doEquip = async (it: InventoryItem) => {
    if (!address || !it.slot) return;
    const result = await equipItem(address, it, it.slot);
    if (result === 'ok') flash('✅ ' + t('equip.equipped', { name: itemLabel(t, it.itemId, it.name) }));
    else if (result === 'needFamiliar') flash('❌ ' + t('equip.needFamiliar'));
    else flash('❌ ' + t('equip.failed'));
  };
  const doEquipFamiliar = async (f: FamiliarDef) => {
    if (!address) return;
    const result = await equipFamiliar(address, f);
    if (result === 'ok') flash('✅ ' + t('equip.equipped', { name: localizeName(t, f.i18nKey, f.label) }));
    else flash('❌ ' + t('equip.failed'));
  };
  const doCombine = async (combo: PotionCombo) => {
    if (!address) return;
    const result = await combinePotions(address, combo.id);
    if (result.ok) flash('✨ ' + t('game.inventory.combine.success', { name: elixirName(combo) }));
    else if (result.reason === 'missingIngredients') flash(t('game.inventory.combine.missing'));
    else flash(t('game.inventory.combine.noMatch'));
  };
  /** Résout le libellé localisé d'un Élixir combiné, EN SUBSTITUANT `{mult}` pour l'Élixir de
   * Force Titanesque (`elixir.kind.forceX2` contient ce placeholder — voir ActiveElixirsBanner.tsx
   * qui fait le même remplacement) — `localizeName()` ne supporte pas les variables, d'où cette
   * résolution dédiée plutôt qu'un simple appel à `localizeName`. */
  const elixirName = (combo: PotionCombo): string => {
    if (!combo.i18nKey) return combo.label;
    const key = `elixir.kind.${combo.i18nKey}`;
    const vars = combo.i18nKey === 'forceX2' ? { mult: combo.forceMultiplier ?? 2 } : undefined;
    const translated = t(key, vars);
    return translated === key ? combo.label : translated;
  };
  const runConfirm = async () => {
    const action = confirm;
    setConfirm(null);
    if (!action) return;
    if (action.kind === 'use') await use(action.item);
    else if (action.kind === 'equip') await doEquip(action.item);
    else if (action.kind === 'equipFamiliar') await doEquipFamiliar(action.familiar);
    else if (action.kind === 'combine') await doCombine(action.combo);
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
    if (e.invisibleMinutes) parts.push(`🫥 ~${e.invisibleMinutes}min`);
    return parts.length ? <p className="text-[9px] text-cyan-300 mb-1">{parts.join(' · ')}</p> : null;
  };

  const renderCombatStats = (it: InventoryItem) => {
    if (!it.damage && !it.defense) return null;
    return (
      <p className="text-[9px] mb-1">
        {it.damage ? <span className="text-emerald-400">⚔️ {it.damage}</span> : null}
        {it.defense ? <span className="text-sky-400"> 🛡️ {it.defense}</span> : null}
      </p>
    );
  };

  /** Vrai si le joueur possède, EN QUANTITÉ SUFFISANTE, tous les ingrédients d'une recette —
   * détermine si le bouton "Combiner" de cette recette est actif ou grisé (voir combinePotions). */
  const hasIngredients = (combo: PotionCombo) => combo.ingredients.every((ing) => {
    const owned = items.find((it) => it.itemId === ing.itemId)?.qty ?? 0;
    return owned >= ing.qty;
  });

  if (!enabled || !address || !pos) return null;

  if (collapsed) {
    return (
      <>
        <button
          ref={containerRef}
          className="fixed z-40 w-14 h-14 rounded-full bg-slate-900 border-2 border-emerald-500 text-2xl shadow-lg flex items-center justify-center"
          style={{ left: pos.x, top: pos.y, zIndex: z }}
          onPointerDownCapture={(e) => handleWidgetPointerDownCapture(e, bringToFront)}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onClick={onToggleClick}
          onContextMenu={onContextMenu}
          title={t('game.inventory.title')}
        >🎒</button>
        <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      </>
    );
  }

  const visibleItems = items.filter((it) => tab !== 'familiars' && TAB_CATEGORIES[tab].includes(it.category));
  const activeFamiliars = familiars.filter((f) => f.active && owned[familiarKeyOf(f.id)]);

  return (
    <div
      ref={containerRef}
      className="fixed z-40 w-80 bg-slate-900 border-2 border-emerald-500 rounded-xl shadow-xl select-none"
      style={{ left: pos.x, top: pos.y, zIndex: z }}
      onPointerDownCapture={(e) => handleWidgetPointerDownCapture(e, bringToFront)}
      onContextMenu={onContextMenu}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-emerald-900/30 rounded-t-xl cursor-move"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      >
        <span className="text-sm font-semibold">🎒 {t('game.inventory.title')}</span>
        <button className="text-xs opacity-70 hover:opacity-100" data-widget-close onClick={toggleCollapsed}>✕</button>
      </div>
      <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      <div className="p-3">
        <div className="flex flex-wrap gap-1 mb-2">
          {TAB_ORDER.map((tb) => (
            <button
              key={tb}
              className={`px-2 py-1 rounded text-[10px] ${tab === tb ? 'bg-emerald-600' : 'bg-slate-700'}`}
              onClick={() => setTab(tb)}
            >
              {TAB_ICON[tb]} {t(`game.inventory.tab.${tb}`)}
            </button>
          ))}
        </div>

        <div className="max-h-80 overflow-y-auto pr-1">
          {tab === 'familiars' ? (
            activeFamiliars.length === 0 ? (
              <p className="text-xs text-slate-400">{t('game.inventory.tab.familiars.empty')}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {activeFamiliars.map((f) => {
                  const kind = dragonKindFromId(f.id);
                  return (
                    <div
                      key={f.id}
                      className="bg-slate-800/60 rounded p-2 text-center cursor-grab"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', `${FAMILIAR_DRAG_PREFIX}${f.id}`)}
                      title={t('game.inventory.dragHint')}
                    >
                      {kind && <div className="flex justify-center mb-1"><DragonSkin kind={kind} size={32} /></div>}
                      <p className="text-[11px] font-semibold truncate">{localizeName(t, f.i18nKey, f.label)}</p>
                      <button className="btn-secondary text-[10px] w-full mt-1" onClick={() => setConfirm({ kind: 'equipFamiliar', familiar: f })}>
                        🧝 {t('game.inventory.equip')}
                      </button>
                    </div>
                  );
                })}
              </div>
            )
          ) : visibleItems.length === 0 ? (
            <p className="text-xs text-slate-400">{t('game.inventory.empty')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {visibleItems.map((it) => {
                const draggableItem = !!it.slot || it.category === 'arrow' || MOUTH_CATEGORIES.has(it.category);
                return (
                  <div
                    key={it.itemId}
                    className={`bg-slate-800/60 rounded p-2 text-center ${draggableItem ? 'cursor-grab' : ''}`}
                    draggable={draggableItem}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', it.itemId)}
                    title={draggableItem ? t('game.inventory.dragHint') : undefined}
                  >
                    <p className="text-[11px] font-semibold truncate">{itemLabel(t, it.itemId, it.name)}</p>
                    <p className="text-[10px] text-slate-400 mb-1">×{it.qty}</p>
                    {renderCombatStats(it)}
                    {renderEffect(it.effect)}
                    {it.effect && (
                      <button className="btn-secondary text-[10px] w-full" onClick={() => setConfirm({ kind: 'use', item: it })}>
                        {t('game.inventory.use')}
                      </button>
                    )}
                    {it.slot && EQUIP_BUTTON_CATEGORIES.has(it.category) && (
                      <button className="btn-secondary text-[10px] w-full mt-1" onClick={() => setConfirm({ kind: 'equip', item: it })}>
                        🧝 {t('game.inventory.equip')}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {tab === 'potion' && combos.length > 0 && (
          <div className="mt-3 border-t border-emerald-800/50 pt-2">
            <p className="text-xs font-semibold text-fuchsia-300 mb-1">{t('game.inventory.combine.title')}</p>
            <p className="text-[9px] text-slate-500 mb-2">{t('game.inventory.combine.hint')}</p>
            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
              {combos.map((combo) => {
                const ready = hasIngredients(combo);
                return (
                  <div key={combo.id} className="bg-slate-800/60 rounded p-2">
                    <p className="text-[11px] font-semibold">{combo.icon} {localizeName(t, combo.i18nKey ? `elixir.kind.${combo.i18nKey}` : undefined, combo.label)}</p>
                    <p className="text-[9px] text-slate-400 mt-0.5">
                      {combo.ingredients.map((ing) => {
                        const owned = items.find((it) => it.itemId === ing.itemId)?.qty ?? 0;
                        return `${itemLabel(t, ing.itemId, ing.itemId)} ×${ing.qty} (${owned}/${ing.qty})`;
                      }).join(' + ')}
                    </p>
                    <button
                      className="btn-secondary text-[10px] w-full mt-1 disabled:opacity-40"
                      disabled={!ready}
                      onClick={() => setConfirm({ kind: 'combine', combo })}
                    >{t('game.inventory.combine.button')}</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {feedback && <p className="text-xs text-cyan-400 mt-2 text-center">{feedback}</p>}
        <p className="text-[9px] text-slate-500 mt-2 text-center">{t('game.inventory.dragHint')}</p>
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === 'use' ? t('game.inventory.confirmUseTitle') : confirm?.kind === 'combine' ? t('game.inventory.combine.confirmTitle') : t('game.inventory.confirmEquipTitle')}
        message={
          confirm?.kind === 'use' ? t('game.inventory.confirmUseMsg', { name: itemLabel(t, confirm.item.itemId, confirm.item.name) })
          : confirm?.kind === 'equip' ? t('game.inventory.confirmEquipMsg', { name: itemLabel(t, confirm.item.itemId, confirm.item.name) })
          : confirm?.kind === 'equipFamiliar' ? t('game.inventory.confirmEquipFamiliarMsg', { name: localizeName(t, confirm.familiar.i18nKey, confirm.familiar.label) })
          : confirm?.kind === 'combine' ? t('game.inventory.combine.confirmMsg', { items: confirm.combo.ingredients.map((ing) => `${itemLabel(t, ing.itemId, ing.itemId)} ×${ing.qty}`).join(' + ') })
          : ''
        }
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
