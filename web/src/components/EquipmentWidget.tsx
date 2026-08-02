'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import {
  subscribeEquipment, subscribeInventory, equipItem, unequipSlot, equipFamiliar, consumeInventoryItem,
  getRepRules, subscribeFamiliars, getFamiliarDefs, familiarKeyOf, FAMILIAR_DRAG_PREFIX,
  EQUIP_SLOTS, type EquipSlot, type EquippedItem, type InventoryItem, type RepRules, type FamiliarDef,
} from '@/lib/gameState';
import { useI18n, itemLabel, localizeName, type Translate } from '@/lib/i18n';
import { SynkSkin } from './SynkSkin';
import { ConfirmDialog } from './ConfirmDialog';
import { DragonSkin, dragonKindFromId } from './DragonSkin';
import { useWindowZIndex } from '@/lib/windowZOrder';
import { useDraggableWidget } from '@/lib/useDraggableWidget';
import { WidgetContextMenu } from './WidgetContextMenu';

const POS_KEY = 'zc.equipWidgetPos';
const COLLAPSED_KEY = 'zc.equipWidgetCollapsed';

interface Pos { x: number; y: number }

const SLOT_ICON: Record<EquipSlot, string> = {
  weapon: '⚔️', offhand: '🛡️', head: '⛑️', body: '🥋', legs: '🦵', feet: '👢', belt: '🎗️', arrows: '➶',
  amulet: '📿', vehicle: '🎈', familiar: '🐲', saddle: '🐎', hands: '🧤',
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
const IMMEDIATE_SLOTS = new Set<EquipSlot>(['weapon', 'offhand', 'head', 'body', 'legs', 'feet', 'belt', 'arrows', 'amulet', 'hands']);
/** Catégories consommables via la "bouche" de Synk (glisser-déposer) — équivalent du bouton
 * "Utiliser" de InventoryPanel.tsx, mêmes deux méthodes proposées à l'utilisateur. */
const MOUTH_CATEGORIES = new Set<InventoryItem['category']>(['food', 'potion', 'super_potion', 'spell']);

type PendingAction =
  | { kind: 'equip'; slot: EquipSlot; item: InventoryItem }
  | { kind: 'equipFamiliar'; def: FamiliarDef }
  | { kind: 'consume'; item: InventoryItem };

function slotLabel(t: Translate, slot: EquipSlot, it: EquippedItem): string {
  if (slot === 'familiar') return localizeName(t, it.i18nKey, it.name).slice(0, 10);
  if (slot === 'arrows') return `×${it.qty ?? 0}`;
  return itemLabel(t, it.itemId, it.name).slice(0, 10);
}

/** Nom complet (non tronqué) de l'objet équipé, utilisé pour la bulle d'info (`title`) du
 * compartiment — le texte affiché DANS le compartiment reste, lui, tronqué/réduit pour ne jamais
 * déborder de son cadre (voir SlotBody), quelle que soit la longueur du nom (ex. "Thunderfury" ou
 * "Épée de maître (Zelda)" qui débordaient auparavant en police trop grande). */
function fullEquippedName(t: Translate, slot: EquipSlot, it: EquippedItem): string {
  return slot === 'familiar' ? localizeName(t, it.i18nKey, it.name) : itemLabel(t, it.itemId, it.name);
}

/** Props partagées par `Slot`/`InlineSlot` — définies en dehors de `EquipmentWidget` (portée
 * module) pour garantir une identité de composant STABLE d'un rendu à l'autre. Déclarer ces
 * composants À L'INTÉRIEUR du corps de `EquipmentWidget` (comme c'était le cas auparavant) crée à
 * chaque rendu une NOUVELLE référence de fonction : React compare le `type` des éléments React
 * pour décider de réutiliser ou de démonter/remonter un sous-arbre, donc un `type` qui change à
 * chaque rendu démonte et remonte entièrement `Slot`/`SlotBody` (et le bouton ✕ qu'il contient) à
 * CHAQUE rendu du parent. Or `onPointerDownCapture={bringToFront}` (posé sur le conteneur de la
 * fenêtre) déclenche un `setZ` dès le `pointerdown` — donc AVANT que le `click` ne soit émis par le
 * navigateur — ce qui provoquait un rendu (et donc un démontage/remontage du bouton ✕) entre le
 * moment où le joueur enfonçait le bouton et celui où le clic aurait dû se déclencher : le bouton
 * sur lequel l'utilisateur clique disparaît du DOM avant que l'événement `click` n'atteigne son
 * gestionnaire, qui ne s'exécute donc jamais (bug signalé : « je ne peux pas retirer un
 * équipement, rien ne se passe » — ni le message de succès ni celui d'échec ne s'affichaient
 * jamais, preuve que `onClick` n'était tout simplement jamais invoqué). */
interface SlotBodyProps {
  slot: EquipSlot;
  equipped?: EquippedItem;
  t: Translate;
  onUnequip: (slot: EquipSlot) => void;
}

function SlotBody({ slot, equipped: it, t, onUnequip }: SlotBodyProps) {
  const kind = it && slot === 'familiar' ? dragonKindFromId(it.itemId) : null;
  const pct = it ? (slot === 'arrows' || slot === 'familiar' ? 100 : Math.round((it.durability / Math.max(1, it.durabilityMax)) * 100)) : 0;
  return it ? (
    <>
      {/* Nom (ou 1er mot) de l'objet — `truncate` + largeur bornée (`w-full`) empêchent tout
          débordement du cadre 56×56px quel que soit le nom (ex. "Thunderfury", "Épée de maître
          (Zelda)") : le texte est coupé avec "…" plutôt que de déborder visuellement, le nom
          complet restant consultable via la bulle d'info du compartiment (voir Slot/InlineSlot). */}
      {kind ? <DragonSkin kind={kind} size={22} /> : (
        <span className="text-sm font-semibold leading-none w-full px-0.5 truncate">{it.name.split(' ')[0]}</span>
      )}
      <span className="text-[8px] text-slate-300 truncate w-full px-0.5">{slotLabel(t, slot, it)}</span>
      {slot !== 'arrows' && slot !== 'familiar' && (
        <div className="w-10 h-1 bg-rose-700 rounded overflow-hidden mt-0.5">
          <div className="h-full bg-emerald-400" style={{ width: `${pct}%` }} />
        </div>
      )}
      {/* Croix de déséquipement — seul point d'interaction pour retirer un objet équipé (préférence
          utilisateur confirmée). Agrandie (20×20px, avec stopPropagation) par rapport à l'original
          (16×16px) pour rester une cible fiable au clic malgré son emplacement dans un coin d'une
          silhouette compacte. */}
      <button
        type="button"
        className="absolute -top-1.5 -right-1.5 z-10 w-5 h-5 text-[10px] bg-rose-600 hover:bg-rose-500 rounded-full shadow"
        onClick={(e) => { e.stopPropagation(); onUnequip(slot); }}
        title={t('equip.unequipHint')}
      >✕</button>
    </>
  ) : (
    <span className="text-xl opacity-40">{SLOT_ICON[slot]}</span>
  );
}

interface SlotProps extends SlotBodyProps {
  className: string;
  dragOverSlot: EquipSlot | null;
  onDragOverSlot: (slot: EquipSlot) => void;
  onDragLeaveSlot: (slot: EquipSlot) => void;
  onDropSlot: (slot: EquipSlot, e: React.DragEvent) => void;
}

function Slot({ slot, className, equipped, t, onUnequip, dragOverSlot, onDragOverSlot, onDragLeaveSlot, onDropSlot }: SlotProps) {
  const slotCls = dragOverSlot === slot ? 'border-cyan-300 bg-cyan-900/40' : equipped ? 'border-emerald-500 bg-slate-800/80' : 'border-dashed border-slate-600 bg-slate-800/40';
  // Bulle d'info : nom complet de l'objet équipé (jamais tronqué, contrairement au texte affiché
  // dans le compartiment) en plus du nom de l'emplacement, sinon juste le nom de l'emplacement.
  const title = equipped ? `${t(`equip.slot.${slot}`)} — ${fullEquippedName(t, slot, equipped)}` : t(`equip.slot.${slot}`);
  return (
    <div
      className={`absolute w-14 h-14 rounded-lg border-2 flex flex-col items-center justify-center text-center ${className} ${slotCls}`}
      onDragOver={(e) => { e.preventDefault(); onDragOverSlot(slot); }}
      onDragLeave={() => onDragLeaveSlot(slot)}
      onDrop={(e) => onDropSlot(slot, e)}
      title={title}
    >
      <SlotBody slot={slot} equipped={equipped} t={t} onUnequip={onUnequip} />
    </div>
  );
}

/** Emplacements "Voyage & Compagnons" hors silhouette — même mécanique de dépose, disposés en
 * ligne sous le personnage plutôt que collés au corps (pas de zone anatomique adaptée). */
function InlineSlot({ slot, equipped, t, onUnequip, dragOverSlot, onDragOverSlot, onDragLeaveSlot, onDropSlot }: Omit<SlotProps, 'className'>) {
  const slotCls = dragOverSlot === slot ? 'border-cyan-300 bg-cyan-900/40' : equipped ? 'border-emerald-500 bg-slate-800/80' : 'border-dashed border-slate-600 bg-slate-800/40';
  const title = equipped ? `${t(`equip.slot.${slot}`)} — ${fullEquippedName(t, slot, equipped)}` : t(`equip.slot.${slot}`);
  return (
    <div
      className={`relative w-14 h-14 rounded-lg border-2 flex flex-col items-center justify-center text-center ${slotCls}`}
      onDragOver={(e) => { e.preventDefault(); onDragOverSlot(slot); }}
      onDragLeave={() => onDragLeaveSlot(slot)}
      onDrop={(e) => onDropSlot(slot, e)}
      title={title}
    >
      <SlotBody slot={slot} equipped={equipped} t={t} onUnequip={onUnequip} />
    </div>
  );
}

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
  const { z, bringToFront } = useWindowZIndex();
  const {
    collapsed, pos, onPointerDown, onPointerMove, onPointerUp, onToggleClick, toggleCollapsed,
    containerRef, menuPos, onContextMenu, closeContextMenu, resetPosition,
  } = useDraggableWidget({
    posKey: POS_KEY, collapsedKey: COLLAPSED_KEY,
    defaultPos: () => ({ x: window.innerWidth - 300, y: 90 }),
  });

  const [equipment, setEquipment] = useState<Partial<Record<EquipSlot, EquippedItem>>>({});
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [familiars, setFamiliars] = useState<FamiliarDef[]>([]);
  const [rules, setRules] = useState<RepRules | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<EquipSlot | null>(null);
  const [mouthOver, setMouthOver] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);

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

  const flash = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(null), 2500); };

  const onDrop = async (slot: EquipSlot, e: React.DragEvent) => {
    e.preventDefault();
    setDragOverSlot(null);
    if (!address) return;
    try {
      const raw = e.dataTransfer.getData('text/plain');
      if (slot === 'familiar') {
        if (!raw.startsWith(FAMILIAR_DRAG_PREFIX)) { flash('❌ ' + t('equip.wrongSlot')); return; }
        const def = familiars.find((f) => f.id === raw.slice(FAMILIAR_DRAG_PREFIX.length));
        if (!def) { flash('❌ ' + t('equip.itemNotFound')); return; }
        setPending({ kind: 'equipFamiliar', def });
        return;
      }
      const item = inventory.find((i) => i.itemId === raw);
      if (!item) { flash('❌ ' + t('equip.itemNotFound')); return; }
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
    } catch (err) {
      // Un glisser-déposer qui échoue silencieusement (promesse rejetée non affichée par le
      // navigateur, l'événement natif `drop` n'attendant pas ce handler async) est indiscernable
      // d'un simple "ça ne marche pas" pour le joueur — on affiche donc systématiquement l'erreur.
      console.error('[equip] onDrop failed:', err);
      flash('❌ ' + t('equip.failed'));
    }
  };

  const onMouthDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setMouthOver(false);
    try {
      const itemId = e.dataTransfer.getData('text/plain');
      const item = inventory.find((i) => i.itemId === itemId);
      if (!item) { flash('❌ ' + t('equip.itemNotFound')); return; }
      if (!MOUTH_CATEGORIES.has(item.category)) { flash('❌ ' + t('equip.wrongSlot')); return; }
      setPending({ kind: 'consume', item });
    } catch (err) {
      console.error('[equip] onMouthDrop failed:', err);
      flash('❌ ' + t('equip.failed'));
    }
  };

  const runPending = async () => {
    const action = pending;
    setPending(null);
    if (!action || !address) return;
    try {
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
    } catch (err) {
      console.error('[equip] runPending failed:', err);
      flash('❌ ' + t('equip.failed'));
    }
  };

  const doUnequip = async (slot: EquipSlot) => {
    if (!address) return;
    const it = equipment[slot];
    try {
      await unequipSlot(address, slot);
      // Retour visuel systématique (succès) : sans ce `flash`, un éventuel échec silencieux
      // (permissions Firebase, coupure réseau...) était rigoureusement indiscernable d'un succès
      // pour le joueur — les deux ne produisaient AUCUN retour visible (bug signalé : "je ne peux
      // pas retirer un équipement"). Même logique de retour systématique que onDrop/runPending
      // ci-dessus, qui affichaient déjà un message de succès ET d'échec.
      if (it) flash('✅ ' + t('equip.unequipped', { name: slot === 'familiar' ? localizeName(t, it.i18nKey, it.name) : itemLabel(t, it.itemId, it.name) }));
    } catch (err) {
      console.error('[equip] doUnequip failed:', err);
      flash('❌ ' + t('equip.unequipFailed'));
    }
  };

  if (!address || !pos) return null;

  if (collapsed) {
    return (
      <>
        <button
          ref={containerRef}
          className="fixed z-40 w-14 h-14 rounded-full bg-slate-900 border-2 border-indigo-500 text-2xl shadow-lg flex items-center justify-center"
          style={{ left: pos.x, top: pos.y, zIndex: z }}
          onPointerDownCapture={bringToFront}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onClick={onToggleClick}
          onContextMenu={onContextMenu}
          title={t('equip.title')}
        >🧝</button>
        <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      </>
    );
  }

  const onDragOverSlot = (slot: EquipSlot) => setDragOverSlot(slot);
  const onDragLeaveSlot = (slot: EquipSlot) => setDragOverSlot((prev) => (prev === slot ? null : prev));

  /** Props communes à tous les `Slot`/`InlineSlot` de ce rendu — regroupées ici pour éviter de les
   * répéter sur chacun des 12 emplacements ci-dessous (silhouette + gants + voyage/compagnons). */
  const slotCommon = { t, onUnequip: doUnequip, dragOverSlot, onDragOverSlot, onDragLeaveSlot, onDropSlot: onDrop };

  const confirmTitle = pending?.kind === 'consume' ? t('game.inventory.confirmUseTitle') : t('game.inventory.confirmEquipTitle');
  const confirmMsg = pending
    ? pending.kind === 'consume' ? t('game.inventory.confirmUseMsg', { name: itemLabel(t, pending.item.itemId, pending.item.name) })
      : pending.kind === 'equipFamiliar' ? t('game.inventory.confirmEquipFamiliarMsg', { name: localizeName(t, pending.def.i18nKey, pending.def.label) })
      : t('game.inventory.confirmEquipMsg', { name: itemLabel(t, pending.item.itemId, pending.item.name) })
    : '';

  return (
    <div
      ref={containerRef}
      className="fixed z-40 w-72 bg-slate-900 border-2 border-indigo-500 rounded-xl shadow-xl select-none"
      style={{ left: pos.x, top: pos.y, zIndex: z }}
      onPointerDownCapture={bringToFront}
      onContextMenu={onContextMenu}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-indigo-900/30 rounded-t-xl cursor-move"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      >
        <span className="text-sm font-semibold">🧝 {t('equip.title')}</span>
        <button className="text-xs opacity-70 hover:opacity-100" onClick={toggleCollapsed}>✕</button>
      </div>
      <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      <div className="p-3">
        <div className="relative mx-auto" style={{ width: 220, height: 220 }}>
          {/* Silhouette "homme de Vitruve" — bras/jambes écartés pour accueillir l'équipement */}
          {/* pointer-events-none : cette silhouette purement décorative couvre tout le carré
              220×220 (inset-0) et se trouvait donc superposée aux emplacements Slot ci-dessous
              (arme/tête/corps/jambes/pieds/ceinture/amulette), interceptant parfois le
              glisser-déposer natif HTML5 malgré son ordre de rendu antérieur dans le DOM. */}
          <div className="absolute inset-0 flex items-center justify-center opacity-90 pointer-events-none">
            <SynkSkin stage={stage} size={110} />
          </div>
          <Slot slot="head"    className="top-0 left-1/2 -translate-x-1/2" equipped={equipment.head} {...slotCommon} />
          <Slot slot="amulet"  className="top-8 left-1/2 translate-x-6" equipped={equipment.amulet} {...slotCommon} />
          <Slot slot="weapon"  className="top-14 left-0" equipped={equipment.weapon} {...slotCommon} />
          <Slot slot="offhand" className="top-14 right-0" equipped={equipment.offhand} {...slotCommon} />
          <Slot slot="body"    className="top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" equipped={equipment.body} {...slotCommon} />
          <Slot slot="arrows"  className="bottom-14 left-0" equipped={equipment.arrows} {...slotCommon} />
          <Slot slot="belt"    className="bottom-14 right-0" equipped={equipment.belt} {...slotCommon} />
          <Slot slot="legs"    className="bottom-0 left-1/2 -translate-x-1/2 -translate-y-1/2" equipped={equipment.legs} {...slotCommon} />
          <Slot slot="feet"    className="bottom-0 left-1/2 translate-x-1/2 translate-y-1/2" equipped={equipment.feet} {...slotCommon} />
        </div>

        {/* Emplacement "Gants" (slot 'hands') — ajouté en ligne sous la silhouette plutôt que dans
            le carré 220×220 déjà entièrement occupé, pour ne prendre aucun risque de régression sur
            le positionnement absolu finement calé des autres emplacements (tête/torse/jambes/etc.). */}
        <div className="flex flex-col items-center mt-1">
          <p className="text-[10px] text-slate-500">{t('equip.slot.hands')}</p>
          <InlineSlot slot="hands" equipped={equipment.hands} {...slotCommon} />
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
          <InlineSlot slot="vehicle" equipped={equipment.vehicle} {...slotCommon} />
          <InlineSlot slot="familiar" equipped={equipment.familiar} {...slotCommon} />
          <InlineSlot slot="saddle" equipped={equipment.saddle} {...slotCommon} />
        </div>

        {feedback && <p className="text-xs text-cyan-400 mt-2 text-center">{feedback}</p>}
        <p className="text-[10px] text-slate-500 mt-2 text-center">{t('equip.hint')}</p>
      </div>

      <ConfirmDialog open={!!pending} title={confirmTitle} message={confirmMsg} onConfirm={runPending} onCancel={() => setPending(null)} />
    </div>
  );
}

export { EQUIP_SLOTS };

