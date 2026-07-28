'use client';

import { useEffect, useState } from 'react';
import { getShopCatalog, setShopItem, removeShopItem, type ShopItem } from '@/lib/gameState';
import { useI18n, itemLabel } from '@/lib/i18n';

type PotionCategory = 'potion' | 'super_potion' | 'spell';
const CATEGORIES: PotionCategory[] = ['potion', 'super_potion', 'spell'];
const CATEGORY_SET = new Set<ShopItem['category']>(CATEGORIES);

/**
 * Panneau admin — "Potions & Sortilèges" : création et édition de tout objet `category` in
 * ('potion' | 'super_potion' | 'spell') de `catalog/shop`. Même mécanisme 100% hors-chaîne
 * (Firebase) que EquipmentAdminPanel/FoodAdminPanel — `getShopCatalog`/`setShopItem`/
 * `removeShopItem` — donc aucune transaction blockchain requise pour ajouter/modifier une potion
 * ou un sortilège. Les super-fioles (`super_potion`) augmentent un plafond permanent (maxHp/
 * maxForce/maxSpells) en plus du gain immédiat — voir InventoryItem.effect dans gameState.ts.
 */
export function PotionsSpellsAdminPanel() {
  const { t } = useI18n();
  const [items, setItems] = useState<ShopItem[]>([]);
  const [itemId, setItemId] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<PotionCategory>('potion');
  const [priceGame, setPriceGame] = useState('30');
  const [hp, setHp] = useState('0');
  const [force, setForce] = useState('0');
  const [spells, setSpells] = useState('0');
  const [happiness, setHappiness] = useState('0');
  const [maxHp, setMaxHp] = useState('0');
  const [maxForce, setMaxForce] = useState('0');
  const [maxSpells, setMaxSpells] = useState('0');
  const [invisibleMinutes, setInvisibleMinutes] = useState('0');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<ShopItem | null>(null);

  const reload = () => getShopCatalog().then((all) => setItems(all.filter((i) => CATEGORY_SET.has(i.category)))).catch(() => {});
  useEffect(() => { reload(); }, []);

  const resetForm = () => {
    setItemId(''); setName(''); setCategory('potion'); setPriceGame('30');
    setHp('0'); setForce('0'); setSpells('0'); setHappiness('0');
    setMaxHp('0'); setMaxForce('0'); setMaxSpells('0'); setInvisibleMinutes('0');
    setEditing(null);
  };

  const startEdit = (it: ShopItem) => {
    setEditing(it);
    setItemId(it.itemId);
    setName(it.name);
    setCategory(it.category as PotionCategory);
    setPriceGame(String(it.priceGame ?? 0));
    setHp(String(it.effect?.hp ?? 0));
    setForce(String(it.effect?.force ?? 0));
    setSpells(String(it.effect?.spells ?? 0));
    setHappiness(String(it.effect?.happiness ?? 0));
    setMaxHp(String(it.effect?.maxHp ?? 0));
    setMaxForce(String(it.effect?.maxForce ?? 0));
    setMaxSpells(String(it.effect?.maxSpells ?? 0));
    setInvisibleMinutes(String(it.effect?.invisibleMinutes ?? 0));
  };

  const submit = async () => {
    if (!itemId || !name) return;
    setSaving(true);
    setSaved(false);
    try {
      const item: ShopItem = {
        itemId, name, category,
        priceGame: Number(priceGame) || 0,
        active: editing?.active ?? true,
        effect: {
          ...(Number(hp) > 0 ? { hp: Number(hp) } : {}),
          ...(Number(force) > 0 ? { force: Number(force) } : {}),
          ...(Number(spells) > 0 ? { spells: Number(spells) } : {}),
          ...(Number(happiness) > 0 ? { happiness: Number(happiness) } : {}),
          ...(Number(maxHp) > 0 ? { maxHp: Number(maxHp) } : {}),
          ...(Number(maxForce) > 0 ? { maxForce: Number(maxForce) } : {}),
          ...(Number(maxSpells) > 0 ? { maxSpells: Number(maxSpells) } : {}),
          ...(Number(invisibleMinutes) > 0 ? { invisibleMinutes: Number(invisibleMinutes) } : {}),
        },
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
      <h2 className="text-xl font-semibold mb-3">🧪 {t('admin.potions.title')}</h2>
      <p className="text-xs text-slate-400 mb-3">{t('admin.potions.description')}</p>
      {editing && (
        <p className="text-xs text-amber-400 mb-2">✏️ {t('admin.potions.editing', { name: editing.name })}</p>
      )}
      <div className="grid md:grid-cols-3 gap-2">
        <input className="input" placeholder={t('admin.potions.itemId')} value={itemId} disabled={!!editing} onChange={(e) => setItemId(e.target.value)} />
        <input className="input" placeholder={t('admin.potions.name')} value={name} onChange={(e) => setName(e.target.value)} />
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value as PotionCategory)}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{t(`admin.potions.category.${c}`)}</option>)}
        </select>
        <input className="input" type="number" placeholder={t('admin.potions.priceGame')} value={priceGame} onChange={(e) => setPriceGame(e.target.value)} />
        <input className="input" type="number" placeholder={t('admin.potions.hp')} value={hp} onChange={(e) => setHp(e.target.value)} />
        <input className="input" type="number" placeholder={t('admin.potions.force')} value={force} onChange={(e) => setForce(e.target.value)} />
        <input className="input" type="number" placeholder={t('admin.potions.spells')} value={spells} onChange={(e) => setSpells(e.target.value)} />
        <input className="input" type="number" placeholder={t('admin.potions.happiness')} value={happiness} onChange={(e) => setHappiness(e.target.value)} />
        <input className="input" type="number" placeholder={t('admin.potions.invisibleMinutes')} value={invisibleMinutes} onChange={(e) => setInvisibleMinutes(e.target.value)} />
        {category === 'super_potion' && (
          <>
            <input className="input" type="number" placeholder={t('admin.potions.maxHp')} value={maxHp} onChange={(e) => setMaxHp(e.target.value)} />
            <input className="input" type="number" placeholder={t('admin.potions.maxForce')} value={maxForce} onChange={(e) => setMaxForce(e.target.value)} />
            <input className="input" type="number" placeholder={t('admin.potions.maxSpells')} value={maxSpells} onChange={(e) => setMaxSpells(e.target.value)} />
          </>
        )}
      </div>
      <div className="flex gap-2 mt-3">
        <button className="btn-primary" disabled={saving || !itemId || !name} onClick={submit}>
          {saving ? '⏳' : editing ? t('admin.potions.submitEdit') : t('admin.potions.submit')}
        </button>
        {editing && (
          <button className="btn-secondary" onClick={resetForm}>{t('admin.potions.cancelEdit')}</button>
        )}
      </div>
      {saved && <p className="text-xs text-emerald-400 mt-2">✅ {t('admin.potions.saved')}</p>}
      <p className="text-xs text-slate-500 mt-2">{t('admin.potions.hint')}</p>

      {items.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-semibold mb-2">{t('admin.potions.list')} ({items.length})</p>
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {items.map((it) => (
              <div key={it.itemId} className="flex items-center justify-between bg-slate-800/60 rounded px-3 py-2 text-sm">
                <span>
                  <b>{itemLabel(t, it.itemId, it.name)}</b> · {t(`admin.potions.category.${it.category}`)}
                  {!!it.effect?.hp && <> · ❤️{it.effect.hp}</>}
                  {!!it.effect?.force && <> · 💪{it.effect.force}</>}
                  {!!it.effect?.spells && <> · 🔮{it.effect.spells}</>}
                  {!!it.effect?.happiness && <> · 😊{it.effect.happiness}</>}
                  {!!it.effect?.maxHp && <> · ❤️max+{it.effect.maxHp}</>}
                  {!!it.effect?.maxForce && <> · 💪max+{it.effect.maxForce}</>}
                  {!!it.effect?.maxSpells && <> · 🔮max+{it.effect.maxSpells}</>}
                  {!!it.effect?.invisibleMinutes && <> · 🫥{it.effect.invisibleMinutes}min</>}
                  {it.priceGame ? <> · 💰{it.priceGame}</> : null}
                </span>
                <span className="flex gap-2">
                  <button className="btn-secondary text-xs" onClick={() => startEdit(it)}>✏️ {t('admin.potions.edit')}</button>
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
