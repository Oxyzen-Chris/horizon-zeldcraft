'use client';

import { useEffect, useState } from 'react';
import {
  getShopCatalog, setShopItem, removeShopItem,
  EQUIP_SLOTS, type ShopItem, type EquipSlot, type ItemRarity,
} from '@/lib/gameState';
import { useI18n, itemLabel } from '@/lib/i18n';

const RARITIES: ItemRarity[] = ['common', 'rare', 'legendary', 'epic'];
const CATEGORIES: ShopItem['category'][] = ['weapon', 'armor', 'shield', 'arrow', 'potion', 'food', 'spell', 'treasure', 'super_potion', 'vehicle', 'saddle'];
const EQUIP_CATEGORIES = new Set<ShopItem['category']>(['weapon', 'armor', 'shield', 'arrow', 'vehicle', 'saddle']);

/**
 * Panneau admin — catalogue des armes/protections/flèches (équipement) : création et édition
 * de tout objet de `catalog/shop` avec ses champs de combat (emplacement, rareté, dégâts,
 * défense, durabilité, nécessite-flèche). 100% hors-chaîne (Firebase), même logique que
 * FamiliarsAdminPanel/QuestsAdminPanel. La rareté détermine à quel palier d'XP joueur (voir
 * RepRulesPanel → equipRarityXp*) l'objet peut apparaître en butin aléatoire de combat.
 */
export function EquipmentAdminPanel() {
  const { t } = useI18n();
  const [items, setItems] = useState<ShopItem[]>([]);
  const [itemId, setItemId] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ShopItem['category']>('weapon');
  const [priceGame, setPriceGame] = useState('200000');
  const [slot, setSlot] = useState<EquipSlot | ''>('weapon');
  const [rarity, setRarity] = useState<ItemRarity>('common');
  const [damage, setDamage] = useState('0');
  const [defense, setDefense] = useState('0');
  const [durabilityMax, setDurabilityMax] = useState('20');
  const [requiresArrow, setRequiresArrow] = useState(false);
  const [requiresFamiliarId, setRequiresFamiliarId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<ShopItem | null>(null);

  const reload = () => getShopCatalog().then((all) => setItems(all.filter((i) => EQUIP_CATEGORIES.has(i.category)))).catch(() => {});
  useEffect(() => { reload(); }, []);

  const resetForm = () => {
    setItemId(''); setName(''); setCategory('weapon'); setPriceGame('200000');
    setSlot('weapon'); setRarity('common'); setDamage('0'); setDefense('0');
    setDurabilityMax('20'); setRequiresArrow(false); setRequiresFamiliarId(''); setEditing(null);
  };

  const startEdit = (it: ShopItem) => {
    setEditing(it);
    setItemId(it.itemId);
    setName(it.name);
    setCategory(it.category);
    setPriceGame(String(it.priceGame ?? 0));
    setSlot(it.slot ?? '');
    setRarity(it.rarity ?? 'common');
    setDamage(String(it.damage ?? 0));
    setDefense(String(it.defense ?? 0));
    setDurabilityMax(String(it.durabilityMax ?? 20));
    setRequiresArrow(!!it.requiresArrow);
    setRequiresFamiliarId(it.requiresFamiliarId ?? '');
  };

  const submit = async () => {
    if (!itemId || !name) return;
    setSaving(true);
    setSaved(false);
    try {
      const isArrow = category === 'arrow';
      const trimmedFamiliarId = requiresFamiliarId.trim();
      const item: ShopItem = {
        itemId, name, category,
        priceGame: Number(priceGame) || 0,
        active: editing?.active ?? true,
        effect: editing?.effect ?? {},
        ...(slot ? { slot } : {}),
        ...(rarity ? { rarity } : {}),
        ...(Number(damage) > 0 ? { damage: Number(damage) } : {}),
        ...(Number(defense) > 0 ? { defense: Number(defense) } : {}),
        // Les flèches sont consommables (qty), pas de durabilité par unité.
        ...(!isArrow && Number(durabilityMax) > 0 ? { durabilityMax: Number(durabilityMax) } : {}),
        ...(requiresArrow ? { requiresArrow: true } : {}),
        // Selle (slot 'saddle') liée à un dragon précis — Firebase refuse toute valeur undefined,
        // on n'ajoute donc la clé que si un id de familier est réellement saisi.
        ...(category === 'saddle' && trimmedFamiliarId ? { requiresFamiliarId: trimmedFamiliarId } : {}),
      };
      await setShopItem(item);
      resetForm();
      setSaved(true);
      await reload();
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    await removeShopItem(id);
    if (editing?.itemId === id) resetForm();
    await reload();
  };

  return (
    <section className="card">
      <h2 className="text-xl font-semibold mb-3">⚔️ {t('admin.equipment.title')}</h2>
      <p className="text-xs text-slate-400 mb-3">{t('admin.equipment.description')}</p>
      {editing && (
        <p className="text-xs text-amber-400 mb-2">✏️ {t('admin.equipment.editing', { name: editing.name })}</p>
      )}
      <div className="grid md:grid-cols-3 gap-2">
        <input className="input" placeholder={t('admin.equipment.itemId')} value={itemId} disabled={!!editing} onChange={(e) => setItemId(e.target.value)} />
        <input className="input" placeholder={t('admin.equipment.name')} value={name} onChange={(e) => setName(e.target.value)} />
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value as ShopItem['category'])}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="input" value={slot} onChange={(e) => setSlot(e.target.value as EquipSlot | '')}>
          <option value="">—</option>
          {EQUIP_SLOTS.map((s) => <option key={s} value={s}>{t(`equip.slot.${s}`)}</option>)}
        </select>
        <select className="input" value={rarity} onChange={(e) => setRarity(e.target.value as ItemRarity)}>
          {RARITIES.map((r) => <option key={r} value={r}>{t(`equip.rarity.${r}`)}</option>)}
        </select>
        <input className="input" type="number" placeholder={t('admin.equipment.priceGame')} value={priceGame} onChange={(e) => setPriceGame(e.target.value)} />
        <input className="input" type="number" placeholder={t('admin.equipment.damage')} value={damage} onChange={(e) => setDamage(e.target.value)} />
        <input className="input" type="number" placeholder={t('admin.equipment.defense')} value={defense} onChange={(e) => setDefense(e.target.value)} />
        <input className="input" type="number" placeholder={t('admin.equipment.durabilityMax')} value={durabilityMax} onChange={(e) => setDurabilityMax(e.target.value)} />
        <label className="text-sm flex items-center gap-2">
          <input type="checkbox" checked={requiresArrow} onChange={(e) => setRequiresArrow(e.target.checked)} />
          <span className="text-slate-300">{t('admin.equipment.requiresArrow')}</span>
        </label>
        {category === 'saddle' && (
          <input className="input" placeholder={t('admin.equipment.requiresFamiliarId')} value={requiresFamiliarId} onChange={(e) => setRequiresFamiliarId(e.target.value)} />
        )}
      </div>
      <div className="flex gap-2 mt-3">
        <button className="btn-primary" disabled={saving || !itemId || !name} onClick={submit}>
          {saving ? '⏳' : editing ? t('admin.equipment.submitEdit') : t('admin.equipment.submit')}
        </button>
        {editing && (
          <button className="btn-secondary" onClick={resetForm}>{t('admin.equipment.cancelEdit')}</button>
        )}
      </div>
      {saved && <p className="text-xs text-emerald-400 mt-2">✅ {t('admin.equipment.saved')}</p>}
      <p className="text-xs text-slate-500 mt-2">{t('admin.equipment.hint')}</p>

      {items.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-semibold mb-2">{t('admin.equipment.list')} ({items.length})</p>
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {items.map((it) => (
              <div key={it.itemId} className="flex items-center justify-between bg-slate-800/60 rounded px-3 py-2 text-sm">
                <span>
                  <b>{itemLabel(t, it.itemId, it.name)}</b> · {it.category}
                  {it.slot && <> · {t(`equip.slot.${it.slot}`)}</>}
                  {it.rarity && <> · {t(`equip.rarity.${it.rarity}`)}</>}
                  {!!it.damage && <> · ⚔️{it.damage}</>}
                  {!!it.defense && <> · 🛡️{it.defense}</>}
                  {!!it.durabilityMax && <> · 🔧{it.durabilityMax}</>}
                  {it.requiresFamiliarId && <> · 🐲{it.requiresFamiliarId}</>}
                  {it.priceGame ? <> · 💰{it.priceGame}</> : null}
                </span>
                <span className="flex gap-2">
                  <button className="btn-secondary text-xs" onClick={() => startEdit(it)}>✏️ {t('admin.equipment.edit')}</button>
                  <button className="btn-secondary text-xs" onClick={() => remove(it.itemId)}>✕</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
