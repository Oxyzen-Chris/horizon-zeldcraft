'use client';

import { useAccount, useChainId, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatEther } from 'viem';
import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { CONTRACT_ADDRESSES } from '@/lib/wagmi';
import { HORIZON_ABI, FEED_TYPES, STAGE_NAMES } from '@/lib/contract';
import { VoxlynSkin } from '@/components/VoxlynSkin';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { NetworkSwitcher } from '@/components/NetworkSwitcher';
import { useI18n } from '@/lib/i18n';

export default function GamePage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const contract = CONTRACT_ADDRESSES[chainId];
  const { t } = useI18n();
  const [name, setName] = useState('');
  const queryClient = useQueryClient();

  const { data: tokenId, queryKey: tokenIdKey } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'voxlynOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!contract },
  });

  const hasVoxlyn = !!tokenId && (tokenId as bigint) > 0n;

  const { data: voxlyn, queryKey: voxlynKey } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'voxlyns',
    args: hasVoxlyn ? [tokenId as bigint] : undefined,
    query: { enabled: hasVoxlyn },
  });

  const { writeContract, data: txHash, isPending, reset } = useWriteContract();
  const { isLoading: isMining, isSuccess: isMined } = useWaitForTransactionReceipt({ hash: txHash });

  // Auto-refetch après confirmation de la transaction (fix bug de refresh)
  useEffect(() => {
    if (isMined && txHash) {
      queryClient.invalidateQueries({ queryKey: tokenIdKey });
      queryClient.invalidateQueries({ queryKey: voxlynKey });
      const timer = setTimeout(() => reset(), 1500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMined, txHash]);

  const feedPrices = FEED_TYPES.map((_, idx) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useReadContract({
      address: contract, abi: HORIZON_ABI, functionName: 'feedPrice',
      args: [idx], query: { enabled: !!contract },
    }).data as bigint | undefined;
  });

  if (!isConnected) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="card text-center">
          <p className="mb-4">{t('connect.description')}</p>
          <ConnectButton />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 max-w-5xl mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <Link href="/" className="text-2xl font-bold text-voxlyn-crystal">🐉 {t('app.title')}</Link>
        <div className="flex flex-wrap gap-3">
          <LanguageSwitcher />
          <NetworkSwitcher />
          <ConnectButton />
        </div>
      </header>

      {!hasVoxlyn ? (
        <section className="card max-w-md mx-auto text-center">
          <VoxlynSkin stage={0} size={180} />
          <h2 className="text-xl font-bold mt-4 mb-3">{t('game.mint.title')}</h2>
          <input
            value={name} onChange={(e) => setName(e.target.value)}
            placeholder={t('game.mint.name')} maxLength={32}
            className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 mb-3"
          />
          <button
            className="btn-primary w-full"
            disabled={!name || isPending || isMining}
            onClick={() => writeContract({
              address: contract, abi: HORIZON_ABI, functionName: 'mintVoxlyn', args: [name],
            })}
          >
            {isPending || isMining ? t('common.loading') : t('game.mint.button')}
          </button>
          {txHash && (
            <p className="text-xs text-slate-400 mt-3">
              Tx : <code className="text-cyan-300">{txHash.slice(0, 10)}…</code>
              {isMining && ' ⏳'}
              {isMined && ' ✅'}
            </p>
          )}
        </section>
      ) : voxlyn ? (
        <VoxlynDashboard
          tokenId={tokenId as bigint}
          v={voxlyn as any}
          contract={contract}
          feedPrices={feedPrices}
          voxlynKey={voxlynKey}
        />
      ) : (
        <p>{t('common.loading')}</p>
      )}
    </main>
  );
}

function VoxlynDashboard({ tokenId, v, contract, feedPrices, voxlynKey }: any) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { writeContract, data: txHash, isPending, reset } = useWriteContract();
  const { isLoading: isMining, isSuccess: isMined } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (isMined && txHash) {
      queryClient.invalidateQueries({ queryKey: voxlynKey });
      const timer = setTimeout(() => reset(), 1500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMined, txHash]);

  const [name, , , xp, hp, happiness, hunger, level, stage] = v;

  const feed = (feedType: number) => {
    const price = feedPrices[feedType];
    if (!price) return;
    writeContract({
      address: contract, abi: HORIZON_ABI, functionName: 'feed',
      args: [tokenId, feedType], value: price,
    });
  };

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <section className="card text-center">
        <VoxlynSkin stage={Number(stage)} size={220} />
        <h2 className="text-2xl font-bold mt-3">{name}</h2>
        <p className="text-sm text-slate-400">
          {t(`stage.${STAGE_NAMES[Number(stage)]}`)} · {t('game.stats.level')} {Number(level)}
        </p>
      </section>

      <section className="card">
        <h3 className="text-lg font-semibold mb-3">{t('game.stats.title')}</h3>
        <Stat label={t('game.stats.xp')}        value={Number(xp)} max={10000} color="bg-purple-500" />
        <Stat label={t('game.stats.hp')}        value={Number(hp)} max={100}   color="bg-rose-500" />
        <Stat label={t('game.stats.hunger')}    value={Number(hunger)} max={100} color="bg-orange-500" />
        <Stat label={t('game.stats.happiness')} value={Number(happiness)} max={100} color="bg-yellow-400" />
      </section>

      <section className="card md:col-span-2">
        <h3 className="text-lg font-semibold mb-4">{t('game.feed.title')}</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {FEED_TYPES.map((f, idx) => (
            <button
              key={f}
              className="btn-primary flex flex-col items-center py-3"
              disabled={isPending || isMining || !feedPrices[idx]}
              onClick={() => feed(idx)}
            >
              <span className="font-bold text-sm">{t(`game.feed.${f}`)}</span>
              <span className="text-xs opacity-70 mt-1">
                {feedPrices[idx] ? `${formatEther(feedPrices[idx]!)} ETH` : '—'}
              </span>
            </button>
          ))}
        </div>
        {txHash && (
          <p className="text-sm text-slate-400 mt-3">
            Tx : <code className="text-cyan-300">{txHash.slice(0, 10)}…</code>
            {isMining && ' ⏳ En attente de confirmation…'}
            {isMined && ' ✅ Confirmé — stats mises à jour'}
          </p>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="mb-3">
      <div className="flex justify-between text-sm mb-1">
        <span>{label}</span>
        <span className="text-slate-400">{value} / {max}</span>
      </div>
      <div className="h-2 bg-slate-800 rounded overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
