'use client';

import { useAccount, useChainId, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatEther } from 'viem';
import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { CONTRACT_ADDRESSES } from '@/lib/wagmi';
import { HORIZON_ABI, FEED_TYPES, STAGE_NAMES, WEATHER, WEATHER_KEYS } from '@/lib/contract';
import { SynkSkin } from '@/components/SynkSkin';
import { Countdown } from '@/components/Countdown';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { NetworkSwitcher } from '@/components/NetworkSwitcher';
import { WeatherWidget } from '@/components/WeatherWidget';
import { Scoreboard } from '@/components/Scoreboard';
import { QuestList } from '@/components/QuestList';
import { NpcList } from '@/components/NpcList';
import { TreasureList } from '@/components/TreasureList';
import { WorldList } from '@/components/WorldList';
import { TeamsPanel } from '@/components/TeamsPanel';
import { FamiliarsList } from '@/components/FamiliarsList';
import { NpcEncounterPopup } from '@/components/NpcEncounterPopup';
import { DiceRollWidget } from '@/components/DiceRollWidget';
import { TeamChatWidget } from '@/components/TeamChatWidget';
import { CustomWidgetsRenderer } from '@/components/CustomWidgetsRenderer';
import { EncountersLog } from '@/components/EncountersLog';
import { ShopPanel } from '@/components/ShopPanel';
import { InventoryPanel } from '@/components/InventoryPanel';
import { WalletPanel } from '@/components/WalletPanel';
import { SleepModal } from '@/components/SleepModal';
import { useI18n } from '@/lib/i18n';
import {
  getOrCreatePlayer, subscribePlayer, logTx, applyEffect, getRepRules, getPlayerActivityStats,
  computeMoodHappiness, type PlayerState, type RepRules, type PlayerActivityStats,
} from '@/lib/gameState';

export default function GamePage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const contract = CONTRACT_ADDRESSES[chainId];
  const { t } = useI18n();
  const [name, setName] = useState('');
  const queryClient = useQueryClient();

  // Détection propriétaire du contrat (pour afficher le bouton admin)
  const { data: ownerAddr } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'owner',
    query: { enabled: !!contract },
  });
  const isOwner = !!(isConnected && ownerAddr && address &&
    (ownerAddr as string).toLowerCase() === address.toLowerCase());

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
      // Log en base pour facturation + création du player si mint
      if (address) {
        logTx(address, {
          hash: txHash, type: 'mint', label: 'Mint Voxlyn ' + name,
          valueEth: '0.005', timestamp: Date.now(), chainId, status: 'confirmed',
        });
        getOrCreatePlayer(address, name).catch(() => {});
      }
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
        <div className="flex flex-wrap gap-3 items-center">
          {contract && <WeatherWidget contract={contract} />}
          <LanguageSwitcher />
          <NetworkSwitcher />
          {isOwner && <Link href="/admin" className="btn-secondary text-sm">⚙️ {t('admin.title')}</Link>}
          <ConnectButton />
        </div>
      </header>

      {!hasVoxlyn ? (
        <section className="card max-w-md mx-auto text-center">
          <SynkSkin stage={0} size={180} />
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
          contract={contract as `0x${string}`}
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
  const { address } = useAccount();
  const chainId = useChainId();
  const queryClient = useQueryClient();
  const { writeContract, data: txHash, isPending, reset } = useWriteContract();
  const { isLoading: isMining, isSuccess: isMined } = useWaitForTransactionReceipt({ hash: txHash });
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [xpCap, setXpCap] = useState(100000);
  const [repRules, setRepRules] = useState<RepRules | null>(null);
  const [activity, setActivity] = useState<PlayerActivityStats | null>(null);

  // Charge le plafond XP + le barème complet (mood, etc.) paramétrable (admin) — voir RepRulesPanel
  useEffect(() => {
    getRepRules().then((r) => { setXpCap(r.xpCap); setRepRules(r); }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!address) return;
    getOrCreatePlayer(address, v?.[0]).catch(console.error);
    const unsub = subscribePlayer(address, (p) => setPlayer(p));
    return unsub;
  }, [address, v]);

  // Statistiques d'activité (rencontres du jour, familiers, combats gagnés) pour pondérer l'humeur
  useEffect(() => {
    if (!address) return;
    getPlayerActivityStats(address).then(setActivity).catch(() => {});
  }, [address]);

  // Météo courante (même source que le WeatherWidget de l'en-tête)
  const { data: weatherRaw } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'currentWeather',
    query: { enabled: !!contract, refetchInterval: 30000 },
  });
  const weatherKey = WEATHER_KEYS[Number(weatherRaw ?? 0)] ?? 'sunny';
  const weatherEmoji = WEATHER[Number(weatherRaw ?? 0)]?.emoji ?? '☀️';

  // Récupère les cooldowns configurés on-chain pour chaque type de repas
  const cooldowns = FEED_TYPES.map((_, idx) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useReadContract({
      address: contract, abi: HORIZON_ABI, functionName: 'feedCooldown',
      args: [idx], query: { enabled: !!contract },
    }).data as bigint | undefined;
  });

  useEffect(() => {
    if (isMined && txHash) {
      queryClient.invalidateQueries({ queryKey: voxlynKey });
      // Recharge faim/bonheur en DB après un repas
      if (address) applyEffect(address, { hunger: 25, happiness: 10 }).catch(() => {});
      const timer = setTimeout(() => reset(), 1500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMined, txHash]);

  const [name, , lastFedAt, xp, hp, happiness, hunger, level, stage] = v;
  const lastFed = Number(lastFedAt);

  // Priorité aux valeurs DB (temps réel) si dispo, sinon fallback on-chain
  const dispHp        = player?.hp        ?? Number(hp);
  const dispHunger    = player?.hunger    ?? Number(hunger);
  const rawHappiness  = player?.happiness ?? Number(happiness);
  const happinessMax  = player?.happinessMax ?? 100;

  // Bonheur pondéré (affichage) par météo / rencontres du jour / familier / portefeuille / combats
  // gagnés / nourrissage régulier — voir `computeMoodHappiness` (paramétrable via RepRulesPanel →
  // "Pondération de l'humeur").
  const mood = repRules ? computeMoodHappiness({
    baseHappiness: rawHappiness,
    happinessMax,
    weatherKey,
    encountersToday: activity?.encountersToday ?? 0,
    hasFamiliar: (activity?.familiarsOwned ?? 0) > 0,
    wallet: player?.wallet ?? 0,
    fightsWon: activity?.fightsWon ?? 0,
    feedsToday: activity?.feedsToday ?? 0,
    rules: repRules,
  }) : null;
  const dispHappiness = mood?.value ?? rawHappiness;
  const moodGoal = repRules?.moodEncounterGoalPerDay ?? 5;
  const feedGoal = repRules?.moodFeedGoalPerDay ?? 4;
  // Petit résumé des modificateurs actifs, affiché sous la barre "Bonheur" pour la transparence.
  const moodHint = mood ? [
    `${weatherEmoji} ${t(`weather.${weatherKey}`)} (${mood.breakdown.weather >= 0 ? '+' : ''}${mood.breakdown.weather})`,
    `👥 ${activity?.encountersToday ?? 0}/${moodGoal} (${mood.breakdown.encounters >= 0 ? '+' : ''}${mood.breakdown.encounters})`,
    `🐉 ${mood.breakdown.familiar > 0 ? `+${mood.breakdown.familiar}` : '0'}`,
    `💰 +${mood.breakdown.wallet}`,
    `⚔️ +${mood.breakdown.fights}`,
    `🍖 ${activity?.feedsToday ?? 0}/${feedGoal} (${mood.breakdown.feed > 0 ? `+${mood.breakdown.feed}` : '0'})`,
  ].join(' · ') : undefined;

  const feed = (feedType: number) => {
    const price = feedPrices[feedType];
    if (!price) return;
    writeContract({
      address: contract, abi: HORIZON_ABI, functionName: 'feed',
      args: [tokenId, feedType], value: price,
    }, {
      onSuccess: (hash) => {
        if (address) logTx(address, {
          hash, type: 'feed', label: `Feed ${FEED_TYPES[feedType]}`,
          valueEth: (Number(price) / 1e18).toFixed(6),
          timestamp: Date.now(), chainId, status: 'pending',
        }).catch(() => {});
      }
    });
  };

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <section className="card text-center">
        <SynkSkin stage={Number(stage)} size={220} />
        <h2 className="text-2xl font-bold mt-3">{name}</h2>
        <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-cyan-600/40 to-purple-600/40 border border-cyan-400/40">
          <span className="text-xs uppercase tracking-wider text-cyan-300">{t('game.stats.stage')}</span>
          <span className="text-sm font-bold text-white">{t(`stage.${STAGE_NAMES[Number(stage)]}`)}</span>
          <span className="text-xs text-slate-300">· {t('game.stats.level')} {Number(level)}</span>
        </div>
        <p className="text-[11px] text-slate-500 mt-1">
          {Number(stage) < STAGE_NAMES.length - 1
            ? `→ ${t(`stage.${STAGE_NAMES[Number(stage) + 1]}`)}`
            : '✨ ' + t(`stage.${STAGE_NAMES[STAGE_NAMES.length - 1]}`)}
        </p>
      </section>

      <section className="card">
        <h3 className="text-lg font-semibold mb-3">{t('game.stats.title')}</h3>
        <Stat label={t('game.stats.xp')}        value={Math.max(0, Number(xp) + (player?.xpBonus ?? 0))}          max={xpCap}                     color="bg-purple-500" />
        <Stat label={t('game.stats.hp')}        value={dispHp}              max={player?.hpMax        ?? 100} color="bg-rose-500" />
        <Stat label={t('game.stats.hunger')}    value={dispHunger}          max={player?.hungerMax    ?? 100} color="bg-orange-500" />
        <Stat label={t('game.stats.happiness')} value={dispHappiness}       max={happinessMax} color="bg-yellow-400" hint={moodHint} />
        <Stat label={t('game.stats.force')}     value={player?.force  ?? 10} max={player?.forceMax    ?? 100} color="bg-red-500" />
        <Stat label={t('game.stats.spells')}    value={player?.spells ?? 5}  max={player?.spellsMax   ?? 100} color="bg-indigo-500" />
        <div className="flex justify-between text-sm mt-3 pt-3 border-t border-slate-700">
          <span>💰 {t('game.stats.wallet')} : <b className="text-amber-400">{player?.wallet ?? 0}</b></span>
          <span>⭐ {t('game.stats.reputation')} : <b className={((player?.reputation ?? 0) >= 0) ? 'text-emerald-400' : 'text-rose-400'}>{player?.reputation ?? 0}</b></span>
        </div>
      </section>

      <section className="card md:col-span-2">
        <h3 className="text-lg font-semibold mb-4">{t('game.feed.title')}</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {FEED_TYPES.map((f, idx) => {
            const cooldown = cooldowns[idx];
            const nextAvailable = cooldown !== undefined ? lastFed + Number(cooldown) : 0;
            const now = Math.floor(Date.now() / 1000);
            const isReady = nextAvailable <= now;
            return (
              <button
                key={f}
                className="btn-primary flex flex-col items-center py-3 disabled:opacity-50"
                disabled={isPending || isMining || !feedPrices[idx] || !isReady}
                onClick={() => feed(idx)}
              >
                <span className="font-bold text-sm">{t(`game.feed.${f}`)}</span>
                <span className="text-xs opacity-70 mt-1">
                  {feedPrices[idx] ? `${formatEther(feedPrices[idx]!)} ETH` : '—'}
                </span>
                <div className="mt-1">
                  <Countdown targetTimestamp={nextAvailable} />
                </div>
              </button>
            );
          })}
        </div>
        {txHash && (
          <p className="text-sm text-slate-400 mt-3">
            Tx : <code className="text-cyan-300">{txHash.slice(0, 10)}…</code>
            {isMining && ' ⏳ En attente de confirmation…'}
            {isMined && ' ✅ Confirmé — stats mises à jour'}
          </p>
        )}
      </section>

      <div className="md:col-span-2">
        <Scoreboard contract={contract} tokenId={tokenId} level={Number(level)} xp={Math.max(0, Number(xp) + (player?.xpBonus ?? 0))} offchainScore={player?.score ?? 0} />
      </div>

      <div className="md:col-span-2">
        <QuestList playerXp={Math.max(0, Number(xp) + (player?.xpBonus ?? 0))} />
      </div>

      <div className="md:col-span-2">
        <NpcList contract={contract} tokenId={tokenId} />
      </div>

      <div className="md:col-span-2">
        <EncountersLog />
      </div>

      <div className="md:col-span-2">
        <TreasureList contract={contract} tokenId={tokenId} />
      </div>

      <div className="md:col-span-2">
        <WorldList contract={contract} tokenId={tokenId} playerXp={Math.max(0, Number(xp) + (player?.xpBonus ?? 0))} />
      </div>

      <div className="md:col-span-2">
        <FamiliarsList playerXp={Math.max(0, Number(xp) + (player?.xpBonus ?? 0))} />
      </div>

      <div className="md:col-span-2">
        <TeamsPanel contract={contract} />
      </div>

      <div className="md:col-span-2">
        <WalletPanel contract={contract} wallet={player?.wallet ?? 0} />
      </div>

      <div className="md:col-span-2">
        <InventoryPanel />
      </div>

      <div className="md:col-span-2">
        <ShopPanel />
      </div>

      {/* Popup de rencontres PNJ aléatoires (3-5×/jour, réglable) */}
      <NpcEncounterPopup contract={contract} tokenId={tokenId} />
      {/* Fenêtre flottante et déplaçable de lancer de dés (infra générique + destin quotidien) */}
      <DiceRollWidget />
      {/* Fenêtre flottante et déplaçable du chat d'équipe multi-joueurs */}
      <TeamChatWidget contract={contract} defaultName={name} />
      {/* Widgets flottants personnalisés définis par l'admin (menu Administration) */}
      <CustomWidgetsRenderer playerXp={Math.max(0, Number(xp) + (player?.xpBonus ?? 0))} />
      {/* Sommeil forcé si HP ≤ 20 (récupère à 75 après 50s) */}
      <SleepModal player={player} />
    </div>
  );
}

function Stat({ label, value, max, color, hint }: { label: string; value: number; max: number; color: string; hint?: string }) {
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
      {hint && <p className="text-[10px] text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}
