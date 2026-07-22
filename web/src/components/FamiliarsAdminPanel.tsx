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

  const reload = () => getFamiliarDefs().then(setFamiliars).catch(() => {});
  useEffect(() => { reload(); }, []);

  const submit = async () => {
    if (!id || !label) return;
    setSaving(true);
    setSaved(false);
    try {
      const existing = await getFamiliarDefs();
      const nextOrder = existing.length ? Math.max(...existing.map((f) => f.order ?? 0)) + 1 : 0;
      await addFamiliarDef({
        id, label,
        xpRequired: Number(xpRequired) || 0,
        requiredItemId: itemId.trim() || undefined,
        active: true,
        createdAt: Date.now(),
        order: nextOrder,
      });
      setId(''); setLabel(''); setItemId(''); setXpRequired('5000');
      setSaved(true);
      await reload();
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (fid: string) => {
    await removeFamiliarDef(fid);
    await reload();
  };

  return (
    <section className="card">
      <h2 className="text-xl font-semibold mb-3">{t('admin.familiars.title')}</h2>
      <div className="grid md:grid-cols-2 gap-2">
        <input className="input" placeholder={t('admin.familiars.id')} value={id} onChange={(e) => setId(e.target.value)} />
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
      <button className="btn-primary mt-3" disabled={saving || !id || !label} onClick={submit}>
        {saving ? '⏳' : t('admin.familiars.submit')}
      </button>
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
                <button className="btn-secondary text-xs" onClick={() => remove(f.id)}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
