'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import {
  subscribeEquipment, subscribeInventory, equipItem, unequipSlot,
  EQUIP_SLOTS, type EquipSlot, type EquippedItem, type InventoryItem,
} from '@/lib/gameState';
import { useI18n, itemLabel } from '@/lib/i18n';
import { SynkSkin } from './SynkSkin';

const POS_KEY = 'zc.equipWidgetPos';
const COLLAPSED_KEY = 'zc.equipWidgetCollapsed';

interface Pos { x: number; y: number }

const SLOT_ICON: Record<EquipSlot, string> = {
  weapon: '⚔️', offhand: '🛡️', head: '⛑️', body: '🥋', legs: '🦵', feet: '👢', belt: '🎗️', arrows: '➶',
};

/** Emplacement où l'objet équipé peut être posé — un objet ne peut être glissé QUE dans le
 * compartiment correspondant à son `slot` déclaré (une arme uniquement dans 'weapon', etc.). */
function slotAcceptsItem(slot: EquipSlot, item: InventoryItem): boolean {
  if (slot === 'arrows') return item.category === 'arrow';
  return item.slot === slot;
}

/**
 * Fenêtre flottante et déplaçable présentant Synk en pose "homme de Vitruve" (bras/jambes
 * écartés) pour équiper armes/protections/flèches par glisser-déposer depuis la besace
 * (InventoryPanel.tsx, onglet correspondant — items marqués `draggable`). Même infrastructure
 * de fenêtre persistante que DiceRollWidget.tsx/TeamChatWidget.tsx (position + repli mémorisés).
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
  const [dragOverSlot, setDragOverSlot] = useState<EquipSlot | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

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
    const itemId = e.dataTransfer.getData('text/plain');
    const item = inventory.find(i => i.itemId === itemId);
    if (!item) return;
    if (!slotAcceptsItem(slot, item)) {
      flash('❌ ' + t('equip.wrongSlot'));
      return;
    }
    const ok = await equipItem(address, item, slot);
    flash(ok ? '✅ ' + t('equip.equipped', { name: itemLabel(t, item.itemId, item.name) }) : '❌ ' + t('equip.failed'));
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

  const Slot = ({ slot, className }: { slot: EquipSlot; className: string }) => {
    const it = equipment[slot];
    const pct = it ? (slot === 'arrows' ? 100 : Math.round((it.durability / Math.max(1, it.durabilityMax)) * 100)) : 0;
    return (
      <div
        className={`absolute w-14 h-14 rounded-lg border-2 flex flex-col items-center justify-center text-center ${className} ${
          dragOverSlot === slot ? 'border-cyan-300 bg-cyan-900/40' : it ? 'border-emerald-500 bg-slate-800/80' : 'border-dashed border-slate-600 bg-slate-800/40'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOverSlot(slot); }}
        onDragLeave={() => setDragOverSlot(prev => (prev === slot ? null : prev))}
        onDrop={(e) => onDrop(slot, e)}
        title={t(`equip.slot.${slot}`)}
      >
        {it ? (
          <>
            <span className="text-lg leading-none">{it.name.split(' ')[0]}</span>
            <span className="text-[8px] text-slate-300 truncate w-full px-0.5">
              {slot === 'arrows' ? `×${it.qty ?? 0}` : itemLabel(t, it.itemId, it.name).slice(0, 10)}
            </span>
            {slot !== 'arrows' && (
              <div className="w-10 h-1 bg-rose-700 rounded overflow-hidden mt-0.5">
                <div className="h-full bg-emerald-400" style={{ width: `${pct}%` }} />
              </div>
            )}
            <button className="absolute -top-1 -right-1 w-4 h-4 text-[9px] bg-rose-600 rounded-full" onClick={() => doUnequip(slot)}>✕</button>
          </>
        ) : (
          <span className="text-xl opacity-40">{SLOT_ICON[slot]}</span>
        )}
      </div>
    );
  };

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
          <Slot slot="weapon"  className="top-14 left-0" />
          <Slot slot="offhand" className="top-14 right-0" />
          <Slot slot="body"    className="top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          <Slot slot="arrows"  className="bottom-14 left-0" />
          <Slot slot="belt"    className="bottom-14 right-0" />
          <Slot slot="legs"    className="bottom-0 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          <Slot slot="feet"    className="bottom-0 left-1/2 translate-x-1/2 translate-y-1/2" />
        </div>
        {feedback && <p className="text-xs text-cyan-400 mt-2 text-center">{feedback}</p>}
        <p className="text-[10px] text-slate-500 mt-2 text-center">{t('equip.hint')}</p>
      </div>
    </div>
  );
}

export { EQUIP_SLOTS };
