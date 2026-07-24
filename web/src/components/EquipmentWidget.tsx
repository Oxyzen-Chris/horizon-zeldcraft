'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import {
  subscribeEquipment, subscribeInventory, equipItem, unequipSlot, equipFamiliar, consumeInventoryItem,
  getRepRules, subscribeFamiliars, getFamiliarDefs, familiarKeyOf, FAMILIAR_DRAG_PREFIX,
  EQUIP_SLOTS, type EquipSlot, type EquippedItem, type InventoryItem, type RepRules, type FamiliarDef,
} from '@/lib/gameState';
import { useI18n, itemLabel, localizeName } from '@/lib/i18n';
import { SynkSkin } from './SynkSkin';
import { ConfirmDialog } from './ConfirmDialog';
import { DragonSkin, dragonKindFromId } from './DragonSkin';

const POS_KEY = 'zc.equipWidgetPos';
const COLLAPSED_KEY = 'zc.equipWidgetCollapsed';

interface Pos { x: number; y: number }

const SLOT_ICON: Record<EquipSlot, string> = {
  weapon: '⚔️', offhand: '🛡️', head: '⛑️', body: '🥋', legs: '🦵', feet: '👢', belt: '🎗️', arrows: '➶',
  amulet: '📿', vehicle: '🎈', familiar: '🐲', saddle: '🐎',
};

/** Emplacement où l'objet équipé peut être posé — un objet ne peut être glissé QUE dans le
 * compartiment correspondant à son `slot` déclaré (une arme uniquement dans 'weapon', etc.). */
function slotAcceptsItem(slot: EquipSlot, item: InventoryItem): boolean {
  if (slot === 'arrows') return item.category === 'arrow';
  return item.slot === slot;
}

/** Emplacements équipés immédiatement au dépose (comportement historique, sans pop-up) : armes/
 * protections/flèches/amulettes. Engins/selles déclenchent une confirmation (voir demande
 * utilisateur) car ce sont des choix plus engageants (véhicule actif, appairage dragon+selle). */
const IMMEDIATE_SLOTS = new Set<EquipSlot>(['weapon', 'offhand', 'head', 'body', 'legs', 'feet', 'belt', 'arrows', 'amulet']);
/** Catégories consommables via la "bouche" de Synk (glisser-déposer) — équivalent du bouton
 * "Utiliser" de InventoryPanel.tsx, mêmes deux méthodes proposées à l'utilisateur. */
const MOUTH_CATEGORIES = new Set<InventoryItem['category']>(['food', 'potion', 'super_potion', 'spell']);

type PendingAction =
  | { kind: 'equip'; slot: EquipSlot; item: InventoryItem }
  | { kind: 'equipFamiliar'; def: FamiliarDef }
  | { kind: 'consume'; item: InventoryItem };

/**
 * Fenêtre flottante et déplaçable présentant Synk en pose "homme de Vitruve" (bras/jambes
 * écartés) pour équiper armes/protections/flèches/amulettes/engins/familiers/selles par
 * glisser-déposer depuis la besace (InventoryPanel.tsx, onglet correspondant — items marqués
 * `draggable`), plus une zone "bouche" pour nourrir Synk (nourriture/potions/sortilèges).
 * Même infrastructure de fenêtre persistante que DiceRollWidget.tsx/TeamChatWidget.tsx (position
 * + repli mémorisés). Engins/familiers/selles passent par une pop-up de confirmation (Oui/Non) ;
 * armes/protections/amulettes/flèches s'équipent immédiatement au dépose (comportement historique).
 */
export function EquipmentWidget({ stage = 0 }: { stage?: number }) {
  const { t } = useI18n();
  const { address } = useAccount();
  const [collapsed, setCollapsed] = useState(true);
  const [pos, setPos] = useState<Pos | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef<Pos>({ x: 0, y: 0 });

  const [equipment, setEquipment] = useState<Partial<Record<EquipSlot, EquippedItem>>>({});
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [familiars, setFamiliars] = useState<FamiliarDef[]>([]);
  const [rules, setRules] = useState<RepRules | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<EquipSlot | null>(null);
  const [mouthOver, setMouthOver] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);

  useEffect(() => {
    setCollapsed((localStorage.getItem(COLLAPSED_KEY) ?? '1') === '1');
    const saved = localStorage.getItem(POS_KEY);
    if (saved) { try { setPos(JSON.parse(saved)); } catch { /* ignore */ } }
    else if (typeof window !== 'undefined') setPos({ x: window.innerWidth - 300, y: 90 });
  }, []);

  useEffect(() => {
    if (!address) return;
    const u1 = subscribeEquipment(address, setEquipment);
    const u2 = subscribeInventory(address, setInventory);
    return () => { u1(); u2(); };
  }, [address]);
  useEffect(() => { getRepRules().then(setRules).catch(() => {}); }, []);
  useEffect(() => { getFamiliarDefs().then(setFamiliars).catch(() => {}); }, []);
  // Sert uniquement à forcer un re-fetch des familiers possédés si besoin ailleurs — pas de state local requis ici.
  useEffect(() => { if (address) subscribeFamiliars(address, () => {}); }, [address]);

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
    setCollapsed(prev => {
      localStorage.setItem(COLLAPSED_KEY, prev ? '0' : '1');
      return !prev;
    });
  };

  const flash = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(null), 2500); };

  const onDrop = async (slot: EquipSlot, e: React.DragEvent) => {
    e.preventDefault();
    setDragOverSlot(null);
    if (!address) return;
    const raw = e.dataTransfer.getData('text/plain');
    if (slot === 'familiar') {
      if (!raw.startsWith(FAMILIAR_DRAG_PREFIX)) { flash('❌ ' + t('equip.wrongSlot')); return; }
      const def = familiars.find((f) => f.id === raw.slice(FAMILIAR_DRAG_PREFIX.length));
      if (!def) return;
      setPending({ kind: 'equipFamiliar', def });
      return;
    }
    const item = inventory.find((i) => i.itemId === raw);
    if (!item) return;
    if (!slotAcceptsItem(slot, item)) {
      flash('❌ ' + t('equip.wrongSlot'));
      return;
    }
    if (IMMEDIATE_SLOTS.has(slot)) {
      const result = await equipItem(address, item, slot);
      flash(result === 'ok' ? '✅ ' + t('equip.equipped', { name: itemLabel(t, item.itemId, item.name) })
        : result === 'needFamiliar' ? '❌ ' + t('equip.needFamiliar') : '❌ ' + t('equip.failed'));
      return;
    }
    setPending({ kind: 'equip', slot, item }); // vehicle / saddle → confirmation avant d'équiper
  };

  const onMouthDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setMouthOver(false);
    const itemId = e.dataTransfer.getData('text/plain');
    const item = inventory.find((i) => i.itemId === itemId);
    if (!item) return;
    if (!MOUTH_CATEGORIES.has(item.category)) { flash('❌ ' + t('equip.wrongSlot')); return; }
    setPending({ kind: 'consume', item });
  };

  const runPending = async () => {
    const action = pending;
    setPending(null);
    if (!action || !address) return;
    if (action.kind === 'equip') {
      const result = await equipItem(address, action.item, action.slot);
      flash(result === 'ok' ? '✅ ' + t('equip.equipped', { name: itemLabel(t, action.item.itemId, action.item.name) })
        : result === 'needFamiliar' ? '❌ ' + t('equip.needFamiliar') : '❌ ' + t('equip.failed'));
    } else if (action.kind === 'equipFamiliar') {
      const result = await equipFamiliar(address, action.def);
      flash(result === 'ok' ? '✅ ' + t('equip.equipped', { name: localizeName(t, action.def.i18nKey, action.def.label) }) : '❌ ' + t('equip.failed'));
    } else if (action.kind === 'consume') {
      if (!rules) return;
      await consumeInventoryItem(address, action.item, rules);
      flash('✅ ' + t('equip.consumed', { name: itemLabel(t, action.item.itemId, action.item.name) }));
    }
  };

  const doUnequip = async (slot: EquipSlot) => {
    if (!address) return;
    await unequipSlot(address, slot);
  };

  if (!address || !pos) return null;

  if (collapsed) {
    return (
      <button
        className="fixed z-40 w-14 h-14 rounded-full bg-slate-900 border-2 border-indigo-500 text-2xl shadow-lg flex items-center justify-center"
        style={{ left: pos.x, top: pos.y }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onClick={() => !dragging && toggleCollapsed()}
        title={t('equip.title')}
      >🧝</button>
    );
  }

  const slotLabel = (slot: EquipSlot, it: EquippedItem) => {
    if (slot === 'familiar') return localizeName(t, it.i18nKey, it.name).slice(0, 10);
    if (slot === 'arrows') return `×${it.qty ?? 0}`;
    return itemLabel(t, it.itemId, it.name).slice(0, 10);
  };

  const SlotBody = ({ slot }: { slot: EquipSlot }) => {
    const it = equipment[slot];
    const kind = it && slot === 'familiar' ? dragonKindFromId(it.itemId) : null;
    const pct = it ? (slot === 'arrows' || slot === 'familiar' ? 100 : Math.round((it.durability / Math.max(1, it.durabilityMax)) * 100)) : 0;
    return it ? (
      <>
        {kind ? <DragonSkin kind={kind} size={22} /> : <span className="text-lg leading-none">{it.name.split(' ')[0]}</span>}
        <span className="text-[8px] text-slate-300 truncate w-full px-0.5">{slotLabel(slot, it)}</span>
        {slot !== 'arrows' && slot !== 'familiar' && (
          <div className="w-10 h-1 bg-rose-700 rounded overflow-hidden mt-0.5">
            <div className="h-full bg-emerald-400" style={{ width: `${pct}%` }} />
          </div>
        )}
        <button className="absolute -top-1 -right-1 w-4 h-4 text-[9px] bg-rose-600 rounded-full" onClick={() => doUnequip(slot)}>✕</button>
      </>
    ) : (
      <span className="text-xl opacity-40">{SLOT_ICON[slot]}</span>
    );
  };

  const slotClass = (slot: EquipSlot) => {
    const it = equipment[slot];
    return dragOverSlot === slot ? 'border-cyan-300 bg-cyan-900/40' : it ? 'border-emerald-500 bg-slate-800/80' : 'border-dashed border-slate-600 bg-slate-800/40';
  };

  const Slot = ({ slot, className }: { slot: EquipSlot; className: string }) => (
    <div
      className={`absolute w-14 h-14 rounded-lg border-2 flex flex-col items-center justify-center text-center ${className} ${slotClass(slot)}`}
      onDragOver={(e) => { e.preventDefault(); setDragOverSlot(slot); }}
      onDragLeave={() => setDragOverSlot((prev) => (prev === slot ? null : prev))}
      onDrop={(e) => onDrop(slot, e)}
      title={t(`equip.slot.${slot}`)}
    >
      <SlotBody slot={slot} />
    </div>
  );

  /** Emplacements "Voyage & Compagnons" hors silhouette — même mécanique de dépose, disposés en
   * ligne sous le personnage plutôt que collés au corps (pas de zone anatomique adaptée). */
  const InlineSlot = ({ slot }: { slot: EquipSlot }) => (
    <div
      className={`relative w-14 h-14 rounded-lg border-2 flex flex-col items-center justify-center text-center ${slotClass(slot)}`}
      onDragOver={(e) => { e.preventDefault(); setDragOverSlot(slot); }}
      onDragLeave={() => setDragOverSlot((prev) => (prev === slot ? null : prev))}
      onDrop={(e) => onDrop(slot, e)}
      title={t(`equip.slot.${slot}`)}
    >
      <SlotBody slot={slot} />
    </div>
  );

  const confirmTitle = pending?.kind === 'consume' ? t('game.inventory.confirmUseTitle') : t('game.inventory.confirmEquipTitle');
  const confirmMsg = pending
    ? pending.kind === 'consume' ? t('game.inventory.confirmUseMsg', { name: itemLabel(t, pending.item.itemId, pending.item.name) })
      : pending.kind === 'equipFamiliar' ? t('game.inventory.confirmEquipFamiliarMsg', { name: localizeName(t, pending.def.i18nKey, pending.def.label) })
      : t('game.inventory.confirmEquipMsg', { name: itemLabel(t, pending.item.itemId, pending.item.name) })
    : '';

  return (
    <div
      className="fixed z-40 w-72 bg-slate-900 border-2 border-indigo-500 rounded-xl shadow-xl select-none"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-indigo-900/30 rounded-t-xl cursor-move"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      >
        <span className="text-sm font-semibold">🧝 {t('equip.title')}</span>
        <button className="text-xs opacity-70 hover:opacity-100" onClick={toggleCollapsed}>✕</button>
      </div>
      <div className="p-3">
        <div className="relative mx-auto" style={{ width: 220, height: 220 }}>
          {/* Silhouette "homme de Vitruve" — bras/jambes écartés pour accueillir l'équipement */}
          <div className="absolute inset-0 flex items-center justify-center opacity-90">
            <SynkSkin stage={stage} size={110} />
          </div>
          <Slot slot="head"    className="top-0 left-1/2 -translate-x-1/2" />
          <Slot slot="amulet"  className="top-8 left-1/2 translate-x-6" />
          <Slot slot="weapon"  className="top-14 left-0" />
          <Slot slot="offhand" className="top-14 right-0" />
          <Slot slot="body"    className="top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          <Slot slot="arrows"  className="bottom-14 left-0" />
          <Slot slot="belt"    className="bottom-14 right-0" />
          <Slot slot="legs"    className="bottom-0 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          <Slot slot="feet"    className="bottom-0 left-1/2 translate-x-1/2 translate-y-1/2" />
        </div>

        {/* Zone "bouche" — glisser-déposer nourriture/potions/sortilèges pour nourrir Synk,
            alternative au bouton "Utiliser" de InventoryPanel.tsx (même logique consumeInventoryItem). */}
        <div
          className={`mt-2 rounded-lg border-2 border-dashed py-2 text-center text-xs ${mouthOver ? 'border-amber-300 bg-amber-900/30' : 'border-amber-700/60 bg-slate-800/40'}`}
          onDragOver={(e) => { e.preventDefault(); setMouthOver(true); }}
          onDragLeave={() => setMouthOver(false)}
          onDrop={onMouthDrop}
          title={t('equip.mouthHint')}
        >
          👄 {t('equip.mouthLabel')}
        </div>

        <p className="text-[10px] text-slate-500 mt-2 text-center">{t('equip.travelCompanions')}</p>
        <div className="flex justify-center gap-2 mt-1">
          <InlineSlot slot="vehicle" />
          <InlineSlot slot="familiar" />
          <InlineSlot slot="saddle" />
        </div>

        {feedback && <p className="text-xs text-cyan-400 mt-2 text-center">{feedback}</p>}
        <p className="text-[10px] text-slate-500 mt-2 text-center">{t('equip.hint')}</p>
      </div>

      <ConfirmDialog open={!!pending} title={confirmTitle} message={confirmMsg} onConfirm={runPending} onCancel={() => setPending(null)} />
    </div>
  );
}

export { EQUIP_SLOTS };

