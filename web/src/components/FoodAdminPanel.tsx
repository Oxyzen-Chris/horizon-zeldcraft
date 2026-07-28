'use client';

import { useEffect, useState } from 'react';
import { getShopCatalog, setShopItem, removeShopItem, type ShopItem } from '@/lib/gameState';
import { useI18n, itemLabel } from '@/lib/i18n';

/**
 * Panneau admin — "Catalogue de nourriture" : création et édition de tout objet `category: 'food'`
 * de `catalog/shop` (nourrissage journalier/hebdomadaire/mensuel/annuel de Synk). Même mécanisme
 * 100% hors-chaîne (Firebase) que EquipmentAdminPanel — `getShopCatalog`/`setShopItem`/
 * `removeShopItem` — donc aucune transaction blockchain requise pour ajouter/modifier un aliment.
 */
export function FoodAdminPanel() {
  const { t } = useI18n();
  const [items, setItems] = useState<ShopItem[]>([]);
  const [itemId, setItemId] = useState('');
  const [name, setName] = useState('');
  const [priceGame, setPriceGame] = useState('10');
  const [hunger, setHunger] = useState('20');
  const [happiness, setHappiness] = useState('0');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<ShopItem | null>(null);

  const reload = () => getShopCatalog().then((all) => setItems(all.filter((i) => i.category === 'food'))).catch(() => {});
  useEffect(() => { reload(); }, []);

  const resetForm = () => {
    setItemId(''); setName(''); setPriceGame('10'); setHunger('20'); setHappiness('0'); setEditing(null);
  };

  const startEdit = (it: ShopItem) => {
    setEditing(it);
    setItemId(it.itemId);
    setName(it.name);
    setPriceGame(String(it.priceGame ?? 0));
    setHunger(String(it.effect?.hunger ?? 0));
    setHappiness(String(it.effect?.happiness ?? 0));
  };

  const submit = async () => {
    if (!itemId || !name) return;
    setSaving(true);
    setSaved(false);
    try {
      const item: ShopItem = {
        itemId, name, category: 'food',
        priceGame: Number(priceGame) || 0,
        active: editing?.active ?? true,
        effect: {
          ...(Number(hunger) > 0 ? { hunger: Number(hunger) } : {}),
          ...(Number(happiness) > 0 ? { happiness: Number(happiness) } : {}),
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
      <h2 className="text-xl font-semibold mb-3">🍎 {t('admin.food.title')}</h2>
      <p className="text-xs text-slate-400 mb-3">{t('admin.food.description')}</p>
      {editing && (
        <p className="text-xs text-amber-400 mb-2">✏️ {t('admin.food.editing', { name: editing.name })}</p>
      )}
      <div className="grid md:grid-cols-3 gap-2">
        <input className="input" placeholder={t('admin.food.itemId')} value={itemId} disabled={!!editing} onChange={(e) => setItemId(e.target.value)} />
        <input className="input" placeholder={t('admin.food.name')} value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" type="number" placeholder={t('admin.food.priceGame')} value={priceGame} onChange={(e) => setPriceGame(e.target.value)} />
        <input className="input" type="number" placeholder={t('admin.food.hunger')} value={hunger} onChange={(e) => setHunger(e.target.value)} />
        <input className="input" type="number" placeholder={t('admin.food.happiness')} value={happiness} onChange={(e) => setHappiness(e.target.value)} />
      </div>
      <div className="flex gap-2 mt-3">
        <button className="btn-primary" disabled={saving || !itemId || !name} onClick={submit}>
          {saving ? '⏳' : editing ? t('admin.food.submitEdit') : t('admin.food.submit')}
        </button>
        {editing && (
          <button className="btn-secondary" onClick={resetForm}>{t('admin.food.cancelEdit')}</button>
        )}
      </div>
      {saved && <p className="text-xs text-emerald-400 mt-2">✅ {t('admin.food.saved')}</p>}
      <p className="text-xs text-slate-500 mt-2">{t('admin.food.hint')}</p>

      {items.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-semibold mb-2">{t('admin.food.list')} ({items.length})</p>
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {items.map((it) => (
              <div key={it.itemId} className="flex items-center justify-between bg-slate-800/60 rounded px-3 py-2 text-sm">
                <span>
                  <b>{itemLabel(t, it.itemId, it.name)}</b>
                  {!!it.effect?.hunger && <> · 🍗{it.effect.hunger}</>}
                  {!!it.effect?.happiness && <> · 😊{it.effect.happiness}</>}
                  {it.priceGame ? <> · 💰{it.priceGame}</> : null}
                </span>
                <span className="flex gap-2">
                  <button className="btn-secondary text-xs" onClick={() => startEdit(it)}>✏️ {t('admin.food.edit')}</button>
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
