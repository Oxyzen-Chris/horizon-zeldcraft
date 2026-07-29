'use client';

import { useEffect, useState } from 'react';
import {
  getMapFilterDefaults, setMapFilterDefaults, DEFAULT_MAP_FILTER_DEFAULTS,
  type MapFilterDefaults,
} from '@/lib/gameState';
import { MAP_FILTER_CATEGORIES } from '@/lib/mapFilters';
import { useI18n } from '@/lib/i18n';

/**
 * Panneau admin — "Filtres de la Mapmonde" : valeurs PAR DÉFAUT proposées à un nouveau joueur
 * pour les boutons d'affichage/masquage par catégorie de la Mapmonde et de la Plateforme 2D
 * isométrique (voir lib/mapFilters.ts). Ne modifie JAMAIS un choix déjà personnalisé par un
 * joueur dans son navigateur — voir applyAdminMapFilterDefaults() côté client.
 */
export function MapFiltersAdminPanel() {
  const { t } = useI18n();
  const [defaults, setDefaults] = useState<MapFilterDefaults>(DEFAULT_MAP_FILTER_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { getMapFilterDefaults().then(setDefaults).catch(() => {}); }, []);

  const toggle = (key: keyof MapFilterDefaults) => {
    setDefaults((d) => ({ ...d, [key]: !d[key] }));
  };

  const submit = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const { updatedAt: _updatedAt, ...rest } = defaults;
      await setMapFilterDefaults(rest);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <h2 className="text-xl font-semibold mb-3">🔧 {t('admin.mapFilters.title')}</h2>
      <p className="text-xs text-slate-400 mb-3">{t('admin.mapFilters.description')}</p>

      <div className="flex flex-wrap gap-2">
        {MAP_FILTER_CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => toggle(cat.key as keyof MapFilterDefaults)}
            className={`text-sm px-2 py-1 rounded border ${
              defaults[cat.key as keyof MapFilterDefaults]
                ? 'bg-emerald-800/70 border-emerald-500 text-emerald-100'
                : 'bg-slate-800/60 border-slate-600 text-slate-400 opacity-60'
            }`}
          >
            {cat.icon} {t(cat.i18nKey)}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-3">
        <span className="text-xs text-slate-400">{t('map.filters.kingdomFullMoon')}:</span>
        {(['all', 'onlyFullMoon', 'onlyNormal'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setDefaults((d) => ({ ...d, kingdomFullMoonMode: mode }))}
            className={`text-xs px-2 py-1 rounded border ${
              defaults.kingdomFullMoonMode === mode
                ? 'bg-fuchsia-800/70 border-fuchsia-500 text-fuchsia-100'
                : 'bg-slate-800/60 border-slate-600 text-slate-400'
            }`}
          >
            {t(mode === 'all' ? 'map.filters.kingdomFullMoonAll' : mode === 'onlyFullMoon' ? 'map.filters.kingdomFullMoonOnly' : 'map.filters.kingdomFullMoonNormal')}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mt-3">
        <button className="btn-primary" disabled={saving} onClick={submit}>
          {saving ? '⏳' : t('admin.mapFilters.submit')}
        </button>
        <button className="btn-secondary" disabled={saving} onClick={() => setDefaults({ ...DEFAULT_MAP_FILTER_DEFAULTS })}>
          {t('map.filters.all')}
        </button>
      </div>
      {saved && <p className="text-xs text-emerald-400 mt-2">✅ {t('admin.mapFilters.saved')}</p>}
      <p className="text-xs text-slate-500 mt-2">{t('admin.mapFilters.hint')}</p>
    </section>
  );
}
