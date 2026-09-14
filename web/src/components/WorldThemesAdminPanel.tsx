'use client';

import { useEffect, useState } from 'react';
import {
  getTimeState, setTimeState, subscribeWorldThemes, upsertWorldThemeDef,
  deleteWorldThemeDef, updateRepRulesFields, getRepRules, BUILTIN_THEME_IDS,
  type TimeState, type WorldThemeDef, type WorldThemeElements, type ThemeScheduleType,
} from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';

const ELEMENT_KEYS: { key: keyof WorldThemeElements; icon: string; label: string }[] = [
  { key: 'sun', icon: '☀️', label: 'Soleil' },
  { key: 'moon', icon: '🌙', label: 'Lune (+ phases)' },
  { key: 'stars', icon: '✨', label: 'Ciel étoilé' },
  { key: 'shootingStarsEnabled', icon: '🌠', label: 'Étoiles filantes' },
  { key: 'clouds', icon: '☁️', label: 'Nuages' },
  { key: 'birds', icon: '🐦', label: 'Oiseaux' },
  { key: 'swallows', icon: '🐦‍⬛', label: 'Hirondelles' },
  { key: 'raptorsEnabled', icon: '🦅', label: 'Rapaces (aigles/vautours/faucons)' },
  { key: 'boarHerdEnabled', icon: '🐗', label: 'Troupeau de sangliers + marcassins' },
  { key: 'witchEnabled', icon: '🧙‍♀️', label: 'Sorcière volante' },
  { key: 'batsEnabled', icon: '🦇', label: 'Chauve-souris' },
  { key: 'owlHootEnabled', icon: '🦉', label: 'Hululement de hibou' },
  { key: 'werewolfHowlEnabled', icon: '🐺', label: 'Cri de loup-garou' },
];

function blankCustomTheme(): WorldThemeDef {
  const now = Date.now();
  return {
    id: `theme.custom.${now}`, name: 'Nouveau thème', kind: 'custom', active: true, order: 1,
    schedule: { type: 'always' },
    elements: {
      sun: false, moon: false, stars: false, shootingStarsEnabled: false, clouds: true, rainChancePct: 5,
      birds: false, swallows: false, raptorsEnabled: false, boarHerdEnabled: false, witchEnabled: false,
      witchFlybyIntervalSec: 600,
      batsEnabled: false, owlHootEnabled: false, werewolfHowlEnabled: false, ambientEventIntervalSec: 45,
    },
    createdAt: now, updatedAt: now,
  };
}

/**
 * Panneau admin — "Thèmes Jour/Nuit & cycle temporel" (voir gameState.ts § "Cycle jour/nuit +
 * phases de lune + thèmes") : réglage des heures de bascule jour/nuit (`RepRules.dayStartHour`/
 * `nightStartHour`), forçage manuel jour/nuit (pour prévisualiser sans attendre la vraie nuit) et
 * CRUD complet des thèmes d'ambiance (les 2 thèmes intégrés "Jour"/"Nuit" toujours reconfigurables
 * mais non supprimables, + thèmes personnalisés programmés par plage horaire/jour de semaine/
 * période MM-JJ récurrente — ex. semaine d'Halloween, vacances de Noël). Alimente le widget
 * flottant "Weather" (WeatherPanel.tsx) et le décor de la Plateforme 3D/2D isométrique/Mapmonde.
 */
export function WorldThemesAdminPanel() {
  const { t } = useI18n();
  const [dayStartHour, setDayStartHour] = useState(7);
  const [nightStartHour, setNightStartHour] = useState(20);
  const [hoursSaving, setHoursSaving] = useState(false);
  const [hoursSaved, setHoursSaved] = useState(false);

  const [timeState, setTimeStateLocal] = useState<TimeState | null>(null);
  const [timeSaving, setTimeSaving] = useState(false);

  const [themes, setThemes] = useState<WorldThemeDef[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    getRepRules().then(r => { setDayStartHour(r.dayStartHour); setNightStartHour(r.nightStartHour); }).catch(() => {});
    getTimeState().then(setTimeStateLocal).catch(() => {});
  }, []);
  useEffect(() => subscribeWorldThemes(setThemes), []);

  const saveHours = async () => {
    setHoursSaving(true);
    setHoursSaved(false);
    try {
      await updateRepRulesFields({ dayStartHour: Number(dayStartHour), nightStartHour: Number(nightStartHour) });
      setHoursSaved(true);
      setTimeout(() => setHoursSaved(false), 3000);
    } finally {
      setHoursSaving(false);
    }
  };

  const applyTimeMode = async (mode: 'auto' | 'manual', manualIsNight?: boolean) => {
    setTimeSaving(true);
    try {
      await setTimeState(mode, manualIsNight);
      setTimeStateLocal(await getTimeState());
    } finally {
      setTimeSaving(false);
    }
  };

  const saveTheme = async (def: WorldThemeDef) => {
    setSavingId(def.id);
    try {
      await upsertWorldThemeDef(def);
    } finally {
      setSavingId(null);
    }
  };

  const removeTheme = async (id: string) => {
    if (BUILTIN_THEME_IDS.has(id)) return;
    if (!confirm(t('admin.worldThemes.confirmDelete'))) return;
    await deleteWorldThemeDef(id);
  };

  const patchTheme = (id: string, patch: Partial<WorldThemeDef>) => {
    setThemes(list => list.map(th => th.id === id ? { ...th, ...patch } : th));
  };
  const patchElements = (id: string, patch: Partial<WorldThemeElements>) => {
    setThemes(list => list.map(th => th.id === id ? { ...th, elements: { ...th.elements, ...patch } } : th));
  };
  const patchSchedule = (id: string, patch: Partial<WorldThemeDef['schedule']>) => {
    setThemes(list => list.map(th => th.id === id ? { ...th, schedule: { ...th.schedule, ...patch } } : th));
  };

  return (
    <section className="card">
      <h2 className="text-xl font-semibold mb-3">🌗 {t('admin.worldThemes.title')}</h2>
      <p className="text-xs text-slate-400 mb-4">{t('admin.worldThemes.hint')}</p>

      <div className="bg-slate-800/60 rounded-lg p-3 mb-4">
        <h3 className="text-sm font-semibold mb-2">🕰️ {t('admin.worldThemes.hoursTitle')}</h3>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs text-slate-400">{t('admin.worldThemes.dayStart')}
            <input type="number" min={0} max={23} className="input w-20 ml-2" value={dayStartHour}
              onChange={e => setDayStartHour(Number(e.target.value))} />
          </label>
          <label className="text-xs text-slate-400">{t('admin.worldThemes.nightStart')}
            <input type="number" min={0} max={23} className="input w-20 ml-2" value={nightStartHour}
              onChange={e => setNightStartHour(Number(e.target.value))} />
          </label>
          <button className="btn-primary" disabled={hoursSaving} onClick={saveHours}>
            {hoursSaving ? '⏳' : hoursSaved ? '✅' : t('admin.actions.apply')}
          </button>
        </div>
      </div>

      <div className="bg-slate-800/60 rounded-lg p-3 mb-4">
        <h3 className="text-sm font-semibold mb-2">🎛️ {t('admin.worldThemes.overrideTitle')}</h3>
        <p className="text-xs text-slate-400 mb-2">{t('admin.worldThemes.overrideHint')}</p>
        <div className="flex flex-wrap gap-2">
          <button
            className={`text-xs px-2 py-1 rounded border ${timeState?.mode === 'auto' ? 'bg-emerald-800/70 border-emerald-500 text-emerald-100' : 'bg-slate-900/60 border-slate-600 text-slate-400'}`}
            disabled={timeSaving} onClick={() => applyTimeMode('auto')}
          >🔄 {t('admin.season.auto')}</button>
          <button
            className={`text-xs px-2 py-1 rounded border ${timeState?.mode === 'manual' && timeState.manualIsNight === false ? 'bg-amber-800/70 border-amber-500 text-amber-100' : 'bg-slate-900/60 border-slate-600 text-slate-400'}`}
            disabled={timeSaving} onClick={() => applyTimeMode('manual', false)}
          >☀️ {t('weather.widget.day')}</button>
          <button
            className={`text-xs px-2 py-1 rounded border ${timeState?.mode === 'manual' && timeState.manualIsNight === true ? 'bg-indigo-800/70 border-indigo-500 text-indigo-100' : 'bg-slate-900/60 border-slate-600 text-slate-400'}`}
            disabled={timeSaving} onClick={() => applyTimeMode('manual', true)}
          >🌙 {t('weather.widget.night')}</button>
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">🎭 {t('admin.worldThemes.themesTitle')}</h3>
        <button className="btn-secondary text-xs" onClick={() => setThemes(list => [...list, blankCustomTheme()])}>
          ➕ {t('admin.worldThemes.addTheme')}
        </button>
      </div>

      <div className="space-y-3">
        {themes.map(th => {
          const builtin = BUILTIN_THEME_IDS.has(th.id);
          return (
            <div key={th.id} className="bg-slate-900/60 border border-slate-700 rounded-lg p-3">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                {builtin ? (
                  <span className="text-sm font-semibold">{th.name}</span>
                ) : (
                  <input className="input flex-1 min-w-[10rem]" value={th.name}
                    onChange={e => patchTheme(th.id, { name: e.target.value })} />
                )}
                <label className="text-xs text-slate-400 flex items-center gap-1">
                  <input type="checkbox" checked={th.active} onChange={e => patchTheme(th.id, { active: e.target.checked })} />
                  {t('admin.worldThemes.active')}
                </label>
                {!builtin && (
                  <label className="text-xs text-slate-400 flex items-center gap-1">
                    {t('admin.worldThemes.order')}
                    <input type="number" className="input w-16" value={th.order ?? 1}
                      onChange={e => patchTheme(th.id, { order: Number(e.target.value) })} />
                  </label>
                )}
                <div className="flex-1" />
                <button className="btn-secondary text-xs" disabled={savingId === th.id} onClick={() => saveTheme(th)}>
                  {savingId === th.id ? '⏳' : `💾 ${t('admin.actions.save')}`}
                </button>
                {!builtin && (
                  <button className="text-xs text-rose-400 hover:text-rose-300" onClick={() => removeTheme(th.id)}>
                    🗑️ {t('admin.actions.delete')}
                  </button>
                )}
              </div>

              {!builtin && (
                <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
                  <span className="text-slate-400">{t('admin.worldThemes.scheduleType')}</span>
                  <select className="input" value={th.schedule.type}
                    onChange={e => patchSchedule(th.id, { type: e.target.value as ThemeScheduleType })}>
                    <option value="always">{t('admin.worldThemes.scheduleAlways')}</option>
                    <option value="hourRange">{t('admin.worldThemes.scheduleHourRange')}</option>
                    <option value="weekday">{t('admin.worldThemes.scheduleWeekday')}</option>
                    <option value="dateRange">{t('admin.worldThemes.scheduleDateRange')}</option>
                  </select>
                  {th.schedule.type === 'hourRange' && (
                    <>
                      <input type="number" min={0} max={23} className="input w-16" value={th.schedule.startHour ?? 0}
                        onChange={e => patchSchedule(th.id, { startHour: Number(e.target.value) })} />
                      –
                      <input type="number" min={0} max={23} className="input w-16" value={th.schedule.endHour ?? 24}
                        onChange={e => patchSchedule(th.id, { endHour: Number(e.target.value) })} />
                    </>
                  )}
                  {th.schedule.type === 'weekday' && (
                    <div className="flex gap-1">
                      {['D', 'L', 'M', 'M', 'J', 'V', 'S'].map((d, i) => {
                        const on = (th.schedule.weekdays ?? []).includes(i);
                        return (
                          <button key={i} type="button"
                            className={`w-6 h-6 rounded text-[10px] border ${on ? 'bg-fuchsia-800/70 border-fuchsia-500' : 'bg-slate-800 border-slate-600'}`}
                            onClick={() => {
                              const cur = new Set(th.schedule.weekdays ?? []);
                              cur.has(i) ? cur.delete(i) : cur.add(i);
                              patchSchedule(th.id, { weekdays: Array.from(cur) });
                            }}
                          >{d}</button>
                        );
                      })}
                    </div>
                  )}
                  {th.schedule.type === 'dateRange' && (
                    <>
                      <input placeholder="MM-JJ" className="input w-20" value={th.schedule.startDate ?? ''}
                        onChange={e => patchSchedule(th.id, { startDate: e.target.value })} />
                      –
                      <input placeholder="MM-JJ" className="input w-20" value={th.schedule.endDate ?? ''}
                        onChange={e => patchSchedule(th.id, { endDate: e.target.value })} />
                    </>
                  )}
                  <span className="text-slate-400 ml-2">{t('admin.worldThemes.forcedTod')}</span>
                  <select className="input" value={th.forcedTimeOfDay ?? ''}
                    onChange={e => patchTheme(th.id, { forcedTimeOfDay: (e.target.value || undefined) as 'day' | 'night' | undefined })}>
                    <option value="">{t('admin.worldThemes.forcedTodNone')}</option>
                    <option value="day">☀️ {t('theme.day')}</option>
                    <option value="night">🌙 {t('theme.night')}</option>
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                {ELEMENT_KEYS.map(({ key, icon, label }) => (
                  <label key={key} className="text-[11px] flex items-center gap-1.5 bg-slate-800/50 rounded px-2 py-1">
                    <input type="checkbox" checked={!!th.elements[key]}
                      onChange={e => patchElements(th.id, { [key]: e.target.checked } as Partial<WorldThemeElements>)} />
                    {icon} {label}
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-slate-400">
                <label>🌧️ {t('admin.worldThemes.rainChance')}
                  <input type="number" min={0} max={100} className="input w-16 ml-1" value={th.elements.rainChancePct}
                    onChange={e => patchElements(th.id, { rainChancePct: Number(e.target.value) })} />
                </label>
                <label>⏱️ {t('admin.worldThemes.ambientInterval')}
                  <input type="number" min={5} className="input w-20 ml-1" value={th.elements.ambientEventIntervalSec}
                    onChange={e => patchElements(th.id, { ambientEventIntervalSec: Number(e.target.value) })} />
                </label>
                <label>🧙‍♀️ {t('admin.worldThemes.witchInterval')}
                  <input type="number" min={30} className="input w-20 ml-1" value={th.elements.witchFlybyIntervalSec ?? 600}
                    onChange={e => patchElements(th.id, { witchFlybyIntervalSec: Number(e.target.value) })} />
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
