'use client';

import { useEffect, useState } from 'react';
import {
  addFamiliarDef, getFamiliarDefs, removeFamiliarDef, type FamiliarDef,
} from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';
import { DragonSkin, dragonKindFromId } from './DragonSkin';

/**
 * Panneau admin — catalogue des Familiers (dragons, elfes, etc.). 100% hors-chaîne (Firebase),
 * aucun gas requis. `order` est auto-assigné (prochain index) — même logique que le panneau
 * admin des quêtes, pour garantir un affichage stable et ordonné côté joueur.
 *
 * Supporte aussi bien la création que l'édition d'un familier existant (XP requis et objet rare
 * requis modifiables à tout moment) : cliquer sur "✏️ Modifier" charge le familier dans le
 * formulaire (id verrouillé, c'est la clé RTDB) et préserve son `order`/`createdAt` d'origine.
 */
export function FamiliarsAdminPanel() {
  const { t } = useI18n();
  const [familiars, setFamiliars] = useState<FamiliarDef[]>([]);
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const [xpRequired, setXpRequired] = useState('5000');
  const [itemId, setItemId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<FamiliarDef | null>(null);

  const reload = () => getFamiliarDefs().then(setFamiliars).catch(() => {});
  useEffect(() => { reload(); }, []);

  const resetForm = () => {
    setId(''); setLabel(''); setItemId(''); setXpRequired('5000'); setEditing(null);
  };

  const startEdit = (f: FamiliarDef) => {
    setEditing(f);
    setId(f.id);
    setLabel(f.label);
    setXpRequired(String(f.xpRequired));
    setItemId(f.requiredItemId ?? '');
  };

  const submit = async () => {
    if (!id || !label) return;
    setSaving(true);
    setSaved(false);
    try {
      const trimmedItemId = itemId.trim();
      // Firebase RTDB refuse toute valeur `undefined` explicite (bug déjà rencontré côté quêtes/
      // encounters) : on ne construit la clé requiredItemId que si un objet rare est réellement saisi.
      const base = {
        id,
        label,
        xpRequired: Number(xpRequired) || 0,
        active: editing?.active ?? true,
        createdAt: editing?.createdAt ?? Date.now(),
        order: editing?.order ?? (familiars.length ? Math.max(...familiars.map((f) => f.order ?? 0)) + 1 : 0),
        ...(editing?.i18nKey ? { i18nKey: editing.i18nKey } : {}),
      };
      await addFamiliarDef(trimmedItemId ? { ...base, requiredItemId: trimmedItemId } : base);
      resetForm();
      setSaved(true);
      await reload();
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (fid: string) => {
    await removeFamiliarDef(fid);
    if (editing?.id === fid) resetForm();
    await reload();
  };

  return (
    <section className="card">
      <h2 className="text-xl font-semibold mb-3">{t('admin.familiars.title')}</h2>
      {editing && (
        <p className="text-xs text-amber-400 mb-2">✏️ {t('admin.familiars.editing', { name: editing.label })}</p>
      )}
      <div className="grid md:grid-cols-2 gap-2">
        <input className="input" placeholder={t('admin.familiars.id')} value={id} disabled={!!editing} onChange={(e) => setId(e.target.value)} />
        <input className="input" placeholder={t('admin.familiars.label')} value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className="input" type="number" placeholder={t('admin.familiars.xpRequired')} value={xpRequired} onChange={(e) => setXpRequired(e.target.value)} />
        <input className="input" placeholder={t('admin.familiars.itemId')} value={itemId} onChange={(e) => setItemId(e.target.value)} />
      </div>
      {dragonKindFromId(id) && (
        <div className="flex items-center gap-2 mt-2">
          <DragonSkin kind={dragonKindFromId(id)!} size={40} />
          <span className="text-xs text-slate-400">{t('admin.familiars.pixelPreview')}</span>
        </div>
      )}
      <div className="flex gap-2 mt-3">
        <button className="btn-primary" disabled={saving || !id || !label} onClick={submit}>
          {saving ? '⏳' : editing ? t('admin.familiars.submitEdit') : t('admin.familiars.submit')}
        </button>
        {editing && (
          <button className="btn-secondary" onClick={resetForm}>{t('admin.familiars.cancelEdit')}</button>
        )}
      </div>
      {saved && <p className="text-xs text-emerald-400 mt-2">✅ {t('admin.familiars.saved')}</p>}
      <p className="text-xs text-slate-500 mt-2">{t('admin.familiars.hint')}</p>

      {familiars.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-semibold mb-2">{t('admin.familiars.list')}</p>
          <div className="space-y-2">
            {familiars.map((f) => (
              <div key={f.id} className="flex items-center justify-between bg-slate-800/60 rounded px-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  {dragonKindFromId(f.id) && <DragonSkin kind={dragonKindFromId(f.id)!} size={28} />}
                  <span><b>{f.label}</b> — {f.xpRequired} XP
                  {f.requiredItemId && <> · 🎒 {f.requiredItemId}</>}</span>
                </span>
                <span className="flex gap-2">
                  <button className="btn-secondary text-xs" onClick={() => startEdit(f)}>✏️ {t('admin.familiars.edit')}</button>
                  <button className="btn-secondary text-xs" onClick={() => remove(f.id)}>✕</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
