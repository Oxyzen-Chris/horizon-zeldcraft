'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import {
  subscribeInventory, applyEffect, removeFromInventory, activateInvisibility, getRepRules,
  subscribeFamiliars, getFamiliarDefs, familiarKeyOf, consumeInventoryItem, equipItem, equipFamiliar,
  FAMILIAR_DRAG_PREFIX, type InventoryItem, type RepRules, type FamiliarDef,
} from '@/lib/gameState';
import { ITEM_TAB_CATEGORIES as TAB_CATEGORIES, ITEM_TAB_ORDER as TAB_ORDER, ITEM_TAB_ICON as TAB_ICON, type ItemTab as Tab } from '@/lib/itemTabs';
import { useI18n, itemLabel, localizeName } from '@/lib/i18n';
import { ConfirmDialog } from './ConfirmDialog';
import { DragonSkin, dragonKindFromId } from './DragonSkin';

/** Catégories équipables via un simple bouton "Équiper" (en plus du glisser-déposer) — armes/
 * protections/flèches restent volontairement drag-only (comportement historique), tandis
 * qu'engins et selles bénéficient des deux méthodes (voir demande utilisateur). */
const EQUIP_BUTTON_CATEGORIES = new Set<InventoryItem['category']>(['vehicle', 'saddle']);

type ConfirmAction =
  | { kind: 'use'; item: InventoryItem }
  | { kind: 'equip'; item: InventoryItem }
  | { kind: 'equipFamiliar'; familiar: FamiliarDef };

/** Sac du joueur — inventaire off-chain (Firebase), pas de gas pour manipuler. Découpé en
 * onglets par type d'objet (voir TAB_CATEGORIES) — les armes/protections/flèches équipables
 * (avec un `slot`) sont glissables (drag & drop) vers la fenêtre flottante EquipmentWidget.tsx.
 * Engins/selles/familiers proposent en plus un bouton "Équiper" (avec pop-up de confirmation)
 * comme méthode alternative au glisser-déposer. */
export function InventoryPanel() {
  const { t } = useI18n();
  const { address } = useAccount();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('weapon');
  const [rules, setRules] = useState<RepRules | null>(null);
  const [familiars, setFamiliars] = useState<FamiliarDef[]>([]);
  const [owned, setOwned] = useState<Record<string, { obtainedAt: number }>>({});

  useEffect(() => {
    if (!address) return;
    return subscribeInventory(address, setItems);
  }, [address]);
  useEffect(() => { getRepRules().then(setRules).catch(() => {}); }, []);
  useEffect(() => { getFamiliarDefs().then(setFamiliars).catch(() => {}); }, []);
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
  const runConfirm = async () => {
    const action = confirm;
    setConfirm(null);
    if (!action) return;
    if (action.kind === 'use') await use(action.item);
    else if (action.kind === 'equip') await doEquip(action.item);
    else if (action.kind === 'equipFamiliar') await doEquipFamiliar(action.familiar);
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
    return parts.length ? <p className="text-[10px] text-cyan-300 mb-1">{parts.join(' · ')}</p> : null;
  };

  const renderCombatStats = (it: InventoryItem) => {
    if (!it.damage && !it.defense) return null;
    return (
      <p className="text-[10px] mb-1">
        {it.damage ? <span className="text-emerald-400">⚔️ {it.damage}</span> : null}
        {it.defense ? <span className="text-sky-400"> 🛡️ {it.defense}</span> : null}
        {it.rarity ? <span className="text-amber-400"> · {t(`equip.rarity.${it.rarity}`)}</span> : null}
      </p>
    );
  };

  const visibleItems = items.filter((it) => tab !== 'familiars' && TAB_CATEGORIES[tab].includes(it.category));
  const activeFamiliars = familiars.filter((f) => f.active && owned[familiarKeyOf(f.id)]);

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-3">🎒 {t('game.inventory.title')}</h3>
      <div className="flex flex-wrap gap-1 mb-3">
        {TAB_ORDER.map((tb) => (
          <button
            key={tb}
            className={`px-2 py-1 rounded text-xs ${tab === tb ? 'bg-emerald-600' : 'bg-slate-700'}`}
            onClick={() => setTab(tb)}
          >
            {TAB_ICON[tb]} {t(`game.inventory.tab.${tb}`)}
          </button>
        ))}
      </div>

      {tab === 'familiars' ? (
        activeFamiliars.length === 0 ? (
          <p className="text-sm text-slate-400">{t('game.inventory.tab.familiars.empty')}</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
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
                  {kind && <div className="flex justify-center mb-1"><DragonSkin kind={kind} size={40} /></div>}
                  <p className="text-xs font-semibold truncate">{localizeName(t, f.i18nKey, f.label)}</p>
                  {(!!f.combatDamage || !!f.combatDefense) && (
                    <p className="text-[10px] mb-1">
                      {f.combatDamage ? <span className="text-emerald-400">⚔️ {f.combatDamage}</span> : null}
                      {f.combatDefense ? <span className="text-sky-400"> 🛡️ {f.combatDefense}</span> : null}
                    </p>
                  )}
                  <button className="btn-secondary text-xs w-full mt-1" onClick={() => setConfirm({ kind: 'equipFamiliar', familiar: f })}>
                    🧝 {t('game.inventory.equip')}
                  </button>
                  <p className="text-[9px] text-indigo-300 mt-1">🧝 {t('game.inventory.equipHint')}</p>
                </div>
              );
            })}
          </div>
        )
      ) : visibleItems.length === 0 ? (
        <p className="text-sm text-slate-400">{t('game.inventory.empty')}</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {visibleItems.map((it) => (
            <div
              key={it.itemId}
              className={`bg-slate-800/60 rounded p-2 text-center ${it.slot || it.category === 'arrow' ? 'cursor-grab' : ''}`}
              draggable={!!it.slot || it.category === 'arrow'}
              onDragStart={(e) => e.dataTransfer.setData('text/plain', it.itemId)}
              title={it.slot || it.category === 'arrow' ? t('game.inventory.dragHint') : undefined}
            >
              <p className="text-sm font-semibold truncate">{itemLabel(t, it.itemId, it.name)}</p>
              <p className="text-xs text-slate-400 mb-1">×{it.qty}</p>
              {renderCombatStats(it)}
              {renderEffect(it.effect)}
              {it.effect && (
                <button className="btn-secondary text-xs w-full" onClick={() => setConfirm({ kind: 'use', item: it })}>
                  {t('game.inventory.use')}
                </button>
              )}
              {it.slot && EQUIP_BUTTON_CATEGORIES.has(it.category) && (
                <button className="btn-secondary text-xs w-full mt-1" onClick={() => setConfirm({ kind: 'equip', item: it })}>
                  🧝 {t('game.inventory.equip')}
                </button>
              )}
              {(it.slot || it.category === 'arrow') && (
                <p className="text-[9px] text-indigo-300 mt-1">🧝 {t('game.inventory.equipHint')}</p>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-500 mt-2">{t('game.inventory.hint')}</p>
      {feedback && <p className="text-sm mt-2 text-cyan-400">{feedback}</p>}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === 'use' ? t('game.inventory.confirmUseTitle') : t('game.inventory.confirmEquipTitle')}
        message={
          confirm?.kind === 'use' ? t('game.inventory.confirmUseMsg', { name: itemLabel(t, confirm.item.itemId, confirm.item.name) })
          : confirm?.kind === 'equip' ? t('game.inventory.confirmEquipMsg', { name: itemLabel(t, confirm.item.itemId, confirm.item.name) })
          : confirm?.kind === 'equipFamiliar' ? t('game.inventory.confirmEquipFamiliarMsg', { name: localizeName(t, confirm.familiar.i18nKey, confirm.familiar.label) })
          : ''
        }
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

