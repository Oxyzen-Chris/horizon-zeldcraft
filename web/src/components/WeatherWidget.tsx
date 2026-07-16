'use client';

import { useReadContract } from 'wagmi';
import { HORIZON_ABI, WEATHER } from '@/lib/contract';

export function WeatherWidget({ contract }: { contract: `0x${string}` }) {
  const { data: w } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'currentWeather',
    query: { enabled: !!contract, refetchInterval: 30000 },
  });
  const { data: d } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'difficulty',
    query: { enabled: !!contract, refetchInterval: 30000 },
  });
  const idx = Number(w ?? 0);
  const wx = WEATHER[idx] || WEATHER[0];
  return (
    <div className="flex items-center gap-3 bg-slate-800/60 rounded-lg px-4 py-2 text-sm">
      <span className="text-3xl">{wx.emoji}</span>
      <div>
        <p className="text-slate-200 font-semibold">{wx.label}</p>
        <p className="text-xs text-slate-400">Difficulté : {Number(d ?? 0)}/100</p>
      </div>
    </div>
  );
}
