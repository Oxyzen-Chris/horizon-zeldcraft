'use client';

import { useEffect, useState } from 'react';
import {
  AUDIO_SOURCE_KEYS, DEFAULT_AUDIO_SETTINGS, subscribeAudioSettings, upsertAudioSetting,
  type AudioSourceKey, type AudioSourceSetting,
} from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';

const SOURCE_ICON: Record<AudioSourceKey, string> = {
  owl: '🦉', werewolf: '🐺', bat: '🦇', raptor: '🦅', bird: '🐦', boar: '🐗', witch: '🧙‍♀️',
};
const SOURCE_LABEL: Record<AudioSourceKey, string> = {
  owl: 'Hibou (hululement, nuit)', werewolf: 'Loup-garou (cri, nuit)', bat: 'Chauve-souris (nuit)',
  raptor: 'Rapaces — aigles/vautours/faucons (cri, jour)', bird: 'Oiseaux & hirondelles (pépiement, jour)',
  boar: 'Sangliers & marcassins (grognement, jour)', witch: 'Sorcière volante (sifflotement, jour)',
};

/**
 * Panneau admin — "Module Audio (créatures 3D)" — voir demande utilisateur « Tu rendras
 * paramétrable ce module audio dans le menu Administration en permettant de charger de nouveaux
 * sons pour chaques objets ». Pour chaque créature d'ambiance de la Plateforme 3D
 * (Platform3DAmbientScene.tsx) : activation par défaut, volume par défaut (0-100), et une URL
 * audio personnalisée optionnelle (mp3/ogg hébergé par l'admin) qui remplace alors le son
 * synthétisé par défaut (voir lib/audio.ts — aucun fichier audio tiers n'est embarqué par défaut,
 * pour éviter tout lien mort ou droit d'auteur incertain ; un son léger est généré en Web Audio
 * API si aucune URL n'est fournie). Ces réglages sont des valeurs PAR DÉFAUT : chaque joueur peut
 * encore couper/ajuster individuellement une créature via le widget "Audio" (AudioWidget.tsx),
 * mais ne peut jamais réactiver un son désactivé ici par l'admin.
 */
export function AudioAdminPanel() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<Record<AudioSourceKey, AudioSourceSetting>>(DEFAULT_AUDIO_SETTINGS);
  const [draftUrl, setDraftUrl] = useState<Record<AudioSourceKey, string>>({} as Record<AudioSourceKey, string>);
  const [savingKey, setSavingKey] = useState<AudioSourceKey | null>(null);
  const [savedKey, setSavedKey] = useState<AudioSourceKey | null>(null);

  useEffect(() => subscribeAudioSettings(setSettings), []);

  const save = async (key: AudioSourceKey, patch: Partial<AudioSourceSetting>) => {
    setSavingKey(key);
    const next: AudioSourceSetting = { ...settings[key], ...patch };
    await upsertAudioSetting(key, next);
    setSettings(prev => ({ ...prev, [key]: next }));
    setSavingKey(null);
    setSavedKey(key);
    setTimeout(() => setSavedKey(k => (k === key ? null : k)), 1500);
  };

  return (
    <section className="card">
      <h2 className="text-xl font-semibold mb-1">{t('admin.audio.title')}</h2>
      <p className="text-sm text-slate-400 mb-3">
        {t('admin.audio.hint')}
      </p>
      <div className="space-y-3">
      {AUDIO_SOURCE_KEYS.map((key) => {
        const s = settings[key] ?? DEFAULT_AUDIO_SETTINGS[key];
        return (
          <div key={key} className="bg-slate-800/60 border border-slate-700 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{SOURCE_ICON[key]} {SOURCE_LABEL[key]}</span>
              <button
                className={`text-xs px-2 py-1 rounded ${s.enabled ? 'bg-emerald-700/60 text-emerald-100' : 'bg-slate-700 text-slate-400'}`}
                onClick={() => save(key, { enabled: !s.enabled })}
              >{s.enabled ? t('admin.audio.enabled') : t('admin.audio.disabled')}</button>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              {t('admin.audio.defaultVolume')}
              <input
                type="range" min={0} max={100} value={s.volume}
                onChange={(e) => save(key, { volume: Number(e.target.value) })}
                className="flex-1 accent-fuchsia-500"
              />
              <span className="w-8 text-right">{s.volume}</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder={t('admin.audio.urlPlaceholder')}
                className="input flex-1 text-xs"
                value={draftUrl[key] ?? s.url ?? ''}
                onChange={(e) => setDraftUrl(prev => ({ ...prev, [key]: e.target.value }))}
              />
              <button
                className="btn-secondary text-xs px-2 py-1"
                disabled={savingKey === key}
                onClick={() => save(key, { url: (draftUrl[key] ?? s.url ?? '').trim() || undefined })}
              >{savedKey === key ? '✅' : t('admin.actions.save')}</button>
              {s.url && (
                <button
                  className="text-xs px-2 py-1 rounded bg-red-900/50 text-red-200"
                  onClick={() => { setDraftUrl(prev => ({ ...prev, [key]: '' })); save(key, { url: undefined }); }}
                >{t('admin.audio.resetToSynth')}</button>
              )}
            </div>
            <p className="text-[10px] text-slate-500">
              {s.url ? t('admin.audio.usingCustomUrl') : t('admin.audio.usingSynth')}
            </p>
          </div>
        );
      })}
      </div>
    </section>
  );
}
