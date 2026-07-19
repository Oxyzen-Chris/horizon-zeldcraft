'use client';

import Link from 'next/link';
import { useReadContract } from 'wagmi';
import { HORIZON_ABI } from '@/lib/contract';
import { useI18n } from '@/lib/i18n';

export function Scoreboard({ contract, tokenId, level, xp }: {
  contract: `0x${string}`; tokenId: bigint; level: number; xp: number;
}) {
  const { t } = useI18n();
  const { data: score } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'playerScore',
    args: [tokenId], query: { enabled: !!contract, refetchInterval: 10000 },
  });
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">{t('game.scoreboard.title')}</h3>
        <Link href="/scoreboard" className="btn-secondary text-xs">
          🏆 {t('game.scoreboard.viewRanking')}
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label={t('game.scoreboard.score')} value={Number(score ?? 0)} color="text-yellow-400" />
        <Stat label={t('game.scoreboard.level')} value={level}              color="text-emerald-400" />
        <Stat label={t('game.scoreboard.xp')}    value={xp}                 color="text-purple-400" />
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-slate-800/60 rounded-lg p-3 text-center">
      <p className="text-xs text-slate-400 uppercase">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value.toLocaleString()}</p>
    </div>
  );
}
