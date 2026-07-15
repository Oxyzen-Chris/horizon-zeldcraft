'use client';

import { useI18n, Locale } from '@/lib/i18n';

const LABELS: Record<Locale, string> = { fr: '🇫🇷 FR', en: '🇬🇧 EN', es: '🇪🇸 ES', pt: '🇵🇹 PT' };

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-slate-400">{t('connect.language')} :</label>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm"
      >
        {(Object.keys(LABELS) as Locale[]).map((l) => (
          <option key={l} value={l}>{LABELS[l]}</option>
        ))}
      </select>
    </div>
  );
}
