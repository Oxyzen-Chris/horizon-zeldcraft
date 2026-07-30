'use client';

import { useEffect, useState } from 'react';
import { addContentPackDef, getContentPackDefs, removeContentPackDef, type ContentPackDef } from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';

/**
 * Panneau admin — "🧩 Extensions (DLC)" : crée/active/désactive des packs de contenu additionnel
 * (nouvelle histoire, quêtes, PNJ, décors, mondes, objets cosmétiques — voir demande utilisateur
 * « prévois cette évolution pour l'extensibilité du jeu »). Même mécanisme 100% hors-chaîne
 * (Firebase) que EquipmentAdminPanel/FoodAdminPanel. Un pack ne contient aucune donnée de jeu en
 * lui-même : c'est un simple interrupteur que les futures quêtes/PNJ/décors/mondes référenceront
 * via leur champ optionnel `contentPack` (voir ContentPackDef/isContentPackVisible dans
 * lib/gameState.ts) — désactiver un pack masque instantanément tout son contenu sans rien
 * supprimer. Le contenu existant (400 Quêtes du Royaume, PNJ, décors, mondes, trésors) ne référence
 * aucun pack (`contentPack: undefined`) et reste donc TOUJOURS visible : zéro régression.
 */
export function ContentPacksAdminPanel() {
  const { t } = useI18n();
  const [packs, setPacks] = useState<ContentPackDef[]>([]);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<ContentPackDef | null>(null);

  const reload = () => getContentPackDefs().then(setPacks).catch(() => {});
  useEffect(() => { reload(); }, []);

  const resetForm = () => { setId(''); setName(''); setDescription(''); setEditing(null); };

  const startEdit = (p: ContentPackDef) => {
    setEditing(p);
    setId(p.id);
    setName(p.name);
    setDescription(p.description ?? '');
  };

  const submit = async () => {
    if (!id || !name) return;
    setSaving(true);
    setSaved(false);
    try {
      const def: ContentPackDef = {
        id, name, description: description || undefined,
        active: editing?.active ?? true,
        createdAt: editing?.createdAt ?? Date.now(),
        order: editing?.order,
      };
      await addContentPackDef(def);
      resetForm();
      setSaved(true);
      await reload();
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (p: ContentPackDef) => {
    await addContentPackDef({ ...p, active: !p.active });
    await reload();
  };

  const remove = async (packId: string) => {
    await removeContentPackDef(packId);
    if (editing?.id === packId) resetForm();
    await reload();
  };

  return (
    <section className="card">
      <h2 className="text-xl font-semibold mb-3">🧩 {t('admin.contentPacks.title')}</h2>
      <p className="text-xs text-slate-400 mb-3">{t('admin.contentPacks.description')}</p>
      {editing && (
        <p className="text-xs text-amber-400 mb-2">✏️ {t('admin.contentPacks.editing', { name: editing.name })}</p>
      )}
      <div className="grid md:grid-cols-3 gap-2">
        <input className="input" placeholder={t('admin.contentPacks.id')} value={id} disabled={!!editing} onChange={(e) => setId(e.target.value)} />
        <input className="input" placeholder={t('admin.contentPacks.name')} value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input md:col-span-3" placeholder={t('admin.contentPacks.desc')} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="flex gap-2 mt-3">
        <button className="btn-primary" disabled={saving || !id || !name} onClick={submit}>
          {saving ? '⏳' : editing ? t('admin.contentPacks.submitEdit') : t('admin.contentPacks.submit')}
        </button>
        {editing && (
          <button className="btn-secondary" onClick={resetForm}>{t('admin.contentPacks.cancelEdit')}</button>
        )}
      </div>
      {saved && <p className="text-xs text-emerald-400 mt-2">✅ {t('admin.contentPacks.saved')}</p>}
      <p className="text-xs text-slate-500 mt-2">{t('admin.contentPacks.hint')}</p>

      {packs.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-semibold mb-2">{t('admin.contentPacks.list')} ({packs.length})</p>
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {packs.map((p) => (
              <div key={p.id} className="flex items-center justify-between bg-slate-800/60 rounded px-3 py-2 text-sm">
                <span>
                  <b>{p.name}</b> <span className="text-slate-500">({p.id})</span>
                  {p.description ? <> · <span className="text-slate-400">{p.description}</span></> : null}
                  {' · '}
                  <span className={p.active !== false ? 'text-emerald-400' : 'text-slate-500'}>
                    {p.active !== false ? t('admin.contentPacks.active') : t('admin.contentPacks.inactive')}
                  </span>
                </span>
                <span className="flex gap-2">
                  <button className="btn-secondary text-xs" onClick={() => toggleActive(p)}>
                    {p.active !== false ? t('admin.contentPacks.deactivate') : t('admin.contentPacks.activate')}
                  </button>
                  <button className="btn-secondary text-xs" onClick={() => startEdit(p)}>✏️ {t('admin.contentPacks.edit')}</button>
                  <button className="btn-secondary text-xs" onClick={() => remove(p.id)}>✕</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
