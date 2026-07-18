'use client';

import { useReadContract } from 'wagmi';
import { HORIZON_ABI, WEATHER, WEATHER_KEYS } from '@/lib/contract';
import { useI18n } from '@/lib/i18n';

export function WeatherWidget({ contract }: { contract: `0x${string}` }) {
  const { t } = useI18n();
  const { data: w } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'currentWeather',
    query: { enabled: !!contract, refetchInterval: 30000 },
  });
  const { data: d } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'difficulty',
    query: { enabled: !!contract, refetchInterval: 30000 },
  });
  const idx = Number(w ?? 0);
  const emoji = WEATHER[idx]?.emoji ?? '☀️';
  const key = WEATHER_KEYS[idx] ?? 'sunny';
  return (
    <div className="flex items-center gap-3 bg-slate-800/60 rounded-lg px-4 py-2 text-sm">
      <span className="text-3xl">{emoji}</span>
      <div>
        <p className="text-slate-200 font-semibold">{t(`weather.${key}`)}</p>
        <p className="text-xs text-slate-400">{t('weather.difficulty', { v: Number(d ?? 0) })}</p>
      </div>
    </div>
  );
}
