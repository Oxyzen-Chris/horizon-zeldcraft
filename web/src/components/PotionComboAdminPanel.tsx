'use client';

import { useEffect, useState } from 'react';
import {
  getAllPotionCombos, setPotionCombo, removePotionCombo,
  type PotionCombo, type PotionComboEffectKind, type InventoryItem, type EquipSlot, type ItemRarity,
} from '@/lib/gameState';
import { useI18n, itemLabel } from '@/lib/i18n';

const EFFECT_KINDS: PotionComboEffectKind[] = ['invulnerability', 'forceX2', 'oxygenFull', 'fatigueFull', 'hungerFull', 'grantItem'];
const GRANT_ITEM_CATEGORIES: InventoryItem['category'][] = ['weapon', 'armor', 'shield', 'treasure', 'vehicle', 'saddle'];
const RARITIES: ItemRarity[] = ['common', 'rare', 'legendary', 'epic'];

type IngredientRow = { itemId: string; qty: string };

/**
 * Panneau admin — "Combinaisons de Potions (Élixirs)" : création/édition des recettes de
 * combinaison de potions/sortilèges de la besace (voir InventoryWidget.tsx "🧪 Combiner des
 * potions" et gameState.ts::combinePotions/PotionCombo). Même mécanisme 100% hors-chaîne
 * (Firebase `catalog/potionCombos`) que PotionsSpellsAdminPanel/EquipmentAdminPanel — aucune
 * transaction blockchain requise pour ajouter/modifier une recette.
 */
export function PotionComboAdminPanel() {
  const { t } = useI18n();
  const [combos, setCombos] = useState<PotionCombo[]>([]);
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const [icon, setIcon] = useState('✨');
  const [effectKind, setEffectKind] = useState<PotionComboEffectKind>('invulnerability');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [forceMultiplier, setForceMultiplier] = useState('2');
  const [ingredients, setIngredients] = useState<IngredientRow[]>([{ itemId: '', qty: '1' }]);
  const [grantItemId, setGrantItemId] = useState('');
  const [grantItemName, setGrantItemName] = useState('');
  const [grantItemCategory, setGrantItemCategory] = useState<InventoryItem['category']>('weapon');
  const [grantItemSlot, setGrantItemSlot] = useState<EquipSlot | ''>('weapon');
  const [grantItemRarity, setGrantItemRarity] = useState<ItemRarity>('legendary');
  const [grantItemDamage, setGrantItemDamage] = useState('0');
  const [grantItemDefense, setGrantItemDefense] = useState('0');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<PotionCombo | null>(null);

  const reload = () => getAllPotionCombos().then(setCombos).catch(() => {});
  useEffect(() => { reload(); }, []);

  const resetForm = () => {
    setId(''); setLabel(''); setIcon('✨'); setEffectKind('invulnerability');
    setDurationMinutes('30'); setForceMultiplier('2'); setIngredients([{ itemId: '', qty: '1' }]);
    setGrantItemId(''); setGrantItemName(''); setGrantItemCategory('weapon'); setGrantItemSlot('weapon');
    setGrantItemRarity('legendary'); setGrantItemDamage('0'); setGrantItemDefense('0');
    setEditing(null);
  };

  const startEdit = (c: PotionCombo) => {
    setEditing(c);
    setId(c.id); setLabel(c.label); setIcon(c.icon); setEffectKind(c.effectKind);
    setDurationMinutes(String(c.durationMinutes ?? 30));
    setForceMultiplier(String(c.forceMultiplier ?? 2));
    setIngredients(c.ingredients.length ? c.ingredients.map((i) => ({ itemId: i.itemId, qty: String(i.qty) })) : [{ itemId: '', qty: '1' }]);
    setGrantItemId(c.grantItem?.itemId ?? '');
    setGrantItemName(c.grantItem?.name ?? '');
    setGrantItemCategory(c.grantItem?.category ?? 'weapon');
    setGrantItemSlot(c.grantItem?.slot ?? '');
    setGrantItemRarity(c.grantItem?.rarity ?? 'legendary');
    setGrantItemDamage(String(c.grantItem?.damage ?? 0));
    setGrantItemDefense(String(c.grantItem?.defense ?? 0));
  };

  const addIngredientRow = () => setIngredients((prev) => [...prev, { itemId: '', qty: '1' }]);
  const removeIngredientRow = (i: number) => setIngredients((prev) => prev.filter((_, idx) => idx !== i));
  const updIngredient = (i: number, k: keyof IngredientRow, v: string) => setIngredients((prev) => {
    const next = [...prev];
    next[i] = { ...next[i], [k]: v };
    return next;
  });

  const submit = async () => {
    if (!id || !label) return;
    const cleanIngredients = ingredients
      .filter((r) => r.itemId.trim())
      .map((r) => ({ itemId: r.itemId.trim(), qty: Math.max(1, Number(r.qty) || 1) }));
    if (cleanIngredients.length < 2) return; // combiner suppose au moins 2 potions/sortilèges
    setSaving(true);
    setSaved(false);
    try {
      const combo: PotionCombo = {
        id, label, icon, ingredients: cleanIngredients, effectKind,
        active: editing?.active ?? true,
        ...(effectKind !== 'hungerFull' && effectKind !== 'grantItem' ? { durationMinutes: Math.max(1, Number(durationMinutes) || 30) } : {}),
        ...(effectKind === 'forceX2' ? { forceMultiplier: Math.max(1, Number(forceMultiplier) || 2) } : {}),
        ...(effectKind === 'grantItem' && grantItemId && grantItemName ? {
          grantItem: {
            itemId: grantItemId, name: grantItemName, category: grantItemCategory,
            ...(grantItemSlot ? { slot: grantItemSlot } : {}),
            rarity: grantItemRarity,
            ...(Number(grantItemDamage) > 0 ? { damage: Number(grantItemDamage) } : {}),
            ...(Number(grantItemDefense) > 0 ? { defense: Number(grantItemDefense) } : {}),
          },
        } : {}),
      };
      await setPotionCombo(combo);
      resetForm();
      setSaved(true);
      await reload();
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (comboId: string) => {
    await removePotionCombo(comboId);
    if (editing?.id === comboId) resetForm();
    await reload();
  };

  return (
    <section className="card">
      <h2 className="text-xl font-semibold mb-3">🧪⚗️ {t('admin.potionCombos.title')}</h2>
      <p className="text-xs text-slate-400 mb-3">{t('admin.potionCombos.description')}</p>
      {editing && (
        <p className="text-xs text-amber-400 mb-2">✏️ {t('admin.potionCombos.editing', { name: editing.label })}</p>
      )}
      <div className="grid md:grid-cols-3 gap-2">
        <input className="input" placeholder={t('admin.potionCombos.id')} value={id} disabled={!!editing} onChange={(e) => setId(e.target.value)} />
        <input className="input" placeholder={t('admin.potionCombos.label')} value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className="input" placeholder={t('admin.potionCombos.icon')} value={icon} onChange={(e) => setIcon(e.target.value)} />
        <select className="input" value={effectKind} onChange={(e) => setEffectKind(e.target.value as PotionComboEffectKind)}>
          {EFFECT_KINDS.map((k) => <option key={k} value={k}>{t(`admin.potionCombos.effectKind.${k}`)}</option>)}
        </select>
        {effectKind !== 'hungerFull' && effectKind !== 'grantItem' && (
          <input className="input" type="number" placeholder={t('admin.potionCombos.durationMinutes')} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} />
        )}
        {effectKind === 'forceX2' && (
          <input className="input" type="number" placeholder={t('admin.potionCombos.forceMultiplier')} value={forceMultiplier} onChange={(e) => setForceMultiplier(e.target.value)} />
        )}
      </div>

      <div className="mt-3">
        <p className="text-xs text-slate-400 mb-1">{t('admin.potionCombos.ingredients')}</p>
        <div className="space-y-2">
          {ingredients.map((ing, i) => (
            <div key={i} className="grid grid-cols-[1fr,80px,auto] gap-2 items-center">
              <input className="input" placeholder={t('admin.potionCombos.ingredientItemId')} value={ing.itemId} onChange={(e) => updIngredient(i, 'itemId', e.target.value)} />
              <input className="input" type="number" min={1} placeholder={t('admin.potionCombos.ingredientQty')} value={ing.qty} onChange={(e) => updIngredient(i, 'qty', e.target.value)} />
              <button className="btn-secondary text-xs" onClick={() => removeIngredientRow(i)}>✕</button>
            </div>
          ))}
        </div>
        <button className="btn-secondary text-xs mt-2" onClick={addIngredientRow}>{t('admin.potionCombos.addIngredient')}</button>
      </div>

      {effectKind === 'grantItem' && (
        <div className="mt-3 border-t border-slate-700 pt-3">
          <p className="text-xs text-slate-400 mb-2">{t('admin.potionCombos.grantItemTitle')}</p>
          <div className="grid md:grid-cols-3 gap-2">
            <input className="input" placeholder={t('admin.potionCombos.grantItemId')} value={grantItemId} onChange={(e) => setGrantItemId(e.target.value)} />
            <input className="input" placeholder={t('admin.potionCombos.grantItemName')} value={grantItemName} onChange={(e) => setGrantItemName(e.target.value)} />
            <select className="input" value={grantItemCategory} onChange={(e) => setGrantItemCategory(e.target.value as InventoryItem['category'])}>
              {GRANT_ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="input" value={grantItemRarity} onChange={(e) => setGrantItemRarity(e.target.value as ItemRarity)}>
              {RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input className="input" type="number" placeholder={t('admin.potionCombos.grantItemDamage')} value={grantItemDamage} onChange={(e) => setGrantItemDamage(e.target.value)} />
            <input className="input" type="number" placeholder={t('admin.potionCombos.grantItemDefense')} value={grantItemDefense} onChange={(e) => setGrantItemDefense(e.target.value)} />
          </div>
        </div>
      )}

      <div className="flex gap-2 mt-3">
        <button className="btn-primary" disabled={saving || !id || !label} onClick={submit}>
          {saving ? '⏳' : editing ? t('admin.potionCombos.submitEdit') : t('admin.potionCombos.submit')}
        </button>
        {editing && (
          <button className="btn-secondary" onClick={resetForm}>{t('admin.potionCombos.cancelEdit')}</button>
        )}
      </div>
      {saved && <p className="text-xs text-emerald-400 mt-2">✅ {t('admin.potionCombos.saved')}</p>}
      <p className="text-xs text-slate-500 mt-2">{t('admin.potionCombos.hint')}</p>

      {combos.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-semibold mb-2">{t('admin.potionCombos.list')} ({combos.length})</p>
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {combos.map((c) => (
              <div key={c.id} className="flex items-center justify-between bg-slate-800/60 rounded px-3 py-2 text-sm">
                <span>
                  <b>{c.icon} {c.label}</b> · {t(`admin.potionCombos.effectKind.${c.effectKind}`)}
                  {' · '}{c.ingredients.map((ing) => `${itemLabel(t, ing.itemId, ing.itemId)}×${ing.qty}`).join(' + ')}
                  {c.durationMinutes ? <> · ⏱️{c.durationMinutes}min</> : null}
                  {!c.active && <span className="text-rose-400"> · désactivé</span>}
                </span>
                <span className="flex gap-2">
                  <button className="btn-secondary text-xs" onClick={() => startEdit(c)}>✏️ {t('admin.potionCombos.edit')}</button>
                  <button className="btn-secondary text-xs" onClick={() => remove(c.id)}>✕</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
