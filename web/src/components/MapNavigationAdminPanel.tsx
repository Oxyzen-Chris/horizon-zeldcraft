'use client';

import { useEffect, useState } from 'react';
import {
  getMapNavigationSettings, setMapNavigationSettings, DEFAULT_MAP_NAVIGATION_SETTINGS,
  type MapNavigationSettings,
} from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';

/**
 * Panneau admin — "Navigation de la Mapmonde" : active/désactive le glisser (clic droit + glisser
 * la souris) et le zoom molette du widget Mapmonde, et paramètre leurs bornes/sensibilité. Voir
 * lib/gameState.ts::MapNavigationSettings et WorldMapWidget.tsx (onMapMouseDown/onMapWheel).
 */
export function MapNavigationAdminPanel() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<MapNavigationSettings>(DEFAULT_MAP_NAVIGATION_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { getMapNavigationSettings().then(setSettings).catch(() => {}); }, []);

  const submit = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const { updatedAt: _updatedAt, ...rest } = settings;
      await setMapNavigationSettings(rest);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <h2 className="text-xl font-semibold mb-3">🖱️ {t('admin.mapNav.title')}</h2>
      <p className="text-xs text-slate-400 mb-3">{t('admin.mapNav.description')}</p>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSettings((s) => ({ ...s, rightClickPanEnabled: !s.rightClickPanEnabled }))}
          className={`text-sm px-2 py-1 rounded border ${
            settings.rightClickPanEnabled ? 'bg-emerald-800/70 border-emerald-500 text-emerald-100' : 'bg-slate-800/60 border-slate-600 text-slate-400 opacity-60'
          }`}
        >🖱️ {t('admin.mapNav.rightClickPan')}</button>
        <button
          onClick={() => setSettings((s) => ({ ...s, wheelZoomEnabled: !s.wheelZoomEnabled }))}
          className={`text-sm px-2 py-1 rounded border ${
            settings.wheelZoomEnabled ? 'bg-emerald-800/70 border-emerald-500 text-emerald-100' : 'bg-slate-800/60 border-slate-600 text-slate-400 opacity-60'
          }`}
        >🖲️ {t('admin.mapNav.wheelZoom')}</button>
      </div>

      <div className="grid md:grid-cols-4 gap-2 mt-3">
        <label className="text-xs text-slate-400 flex flex-col gap-1">
          {t('admin.mapNav.zoomMin')}
          <input className="input" type="number" step="0.1" min="0.1" value={settings.zoomMin}
            onChange={(e) => setSettings((s) => ({ ...s, zoomMin: Number(e.target.value) || s.zoomMin }))} />
        </label>
        <label className="text-xs text-slate-400 flex flex-col gap-1">
          {t('admin.mapNav.zoomMax')}
          <input className="input" type="number" step="0.1" min="0.1" value={settings.zoomMax}
            onChange={(e) => setSettings((s) => ({ ...s, zoomMax: Number(e.target.value) || s.zoomMax }))} />
        </label>
        <label className="text-xs text-slate-400 flex flex-col gap-1">
          {t('admin.mapNav.zoomStep')}
          <input className="input" type="number" step="0.01" min="0.01" value={settings.zoomStep}
            onChange={(e) => setSettings((s) => ({ ...s, zoomStep: Number(e.target.value) || s.zoomStep }))} />
        </label>
        <label className="text-xs text-slate-400 flex flex-col gap-1">
          {t('admin.mapNav.panSpeed')}
          <input className="input" type="number" step="0.1" min="0.1" value={settings.panSpeed}
            onChange={(e) => setSettings((s) => ({ ...s, panSpeed: Number(e.target.value) || s.panSpeed }))} />
        </label>
      </div>

      <div className="flex gap-2 mt-3">
        <button className="btn-primary" disabled={saving} onClick={submit}>
          {saving ? '⏳' : t('admin.mapNav.submit')}
        </button>
        <button className="btn-secondary" disabled={saving} onClick={() => setSettings({ ...DEFAULT_MAP_NAVIGATION_SETTINGS })}>
          {t('admin.mapNav.reset')}
        </button>
      </div>
      {saved && <p className="text-xs text-emerald-400 mt-2">✅ {t('admin.mapNav.saved')}</p>}
      <p className="text-xs text-slate-500 mt-2">{t('admin.mapNav.hint')}</p>
    </section>
  );
}
