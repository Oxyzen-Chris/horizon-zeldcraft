'use client';

import { useChainId, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatEther } from 'viem';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { CONTRACT_ADDRESSES } from '@/lib/wagmi';
import { HORIZON_ABI, FEED_TYPES, STAGE_NAMES, WEATHER, WEATHER_KEYS } from '@/lib/contract';
import { useEffectiveAccount, useEffectiveSession } from '@/lib/effectiveAccount';
import { SynkSkin } from '@/components/SynkSkin';
import { Countdown } from '@/components/Countdown';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { NetworkSwitcher } from '@/components/NetworkSwitcher';
import { EffectiveAccountBadge } from '@/components/EffectiveAccountBadge';
import { WeatherWidget } from '@/components/WeatherWidget';
import { SeasonWidget } from '@/components/SeasonWidget';
import { MoonWidget } from '@/components/MoonWidget';
import { Scoreboard } from '@/components/Scoreboard';
import { QuestList } from '@/components/QuestList';
import { NpcList } from '@/components/NpcList';
import { TreasureList } from '@/components/TreasureList';
import { WorldList } from '@/components/WorldList';
import { TeamsPanel } from '@/components/TeamsPanel';
import { FamiliarsList } from '@/components/FamiliarsList';
import { NpcEncounterPopup, type EncounterMarkerInfo } from '@/components/NpcEncounterPopup';
import { DiceRollWidget, type DiceEventKind, type DiceEventOutcome } from '@/components/DiceRollWidget';
import { TeamChatWidget } from '@/components/TeamChatWidget';
import { CustomWidgetsRenderer } from '@/components/CustomWidgetsRenderer';
import { EquipmentWidget } from '@/components/EquipmentWidget';
import { InventoryWidget } from '@/components/InventoryWidget';
import { ShopWidget } from '@/components/ShopWidget';
import { WorldMapWidget } from '@/components/WorldMapWidget';
import { GameCanvas2D } from '@/components/GameCanvas2D';
import { Platform3DWidget } from '@/components/Platform3DWidget';
import { StatsWidget } from '@/components/StatsWidget';
import { KingdomQuestsWidget } from '@/components/KingdomQuestsWidget';
import { QuestsZeldaCraftWidget } from '@/components/QuestsZeldaCraftWidget';
import { EncountersLog } from '@/components/EncountersLog';
import { ShopPanel } from '@/components/ShopPanel';
import { InventoryPanel } from '@/components/InventoryPanel';
import { WalletPanel } from '@/components/WalletPanel';
import { WalletTopupWidget } from '@/components/WalletTopupWidget';
import { SleepModal } from '@/components/SleepModal';
import { OnboardingWizard } from '@/components/OnboardingWizard';
import { HelpWidget } from '@/components/HelpWidget';
import { ProgressWidget } from '@/components/ProgressWidget';
import { AnnouncementBanner } from '@/components/AnnouncementBanner';
import { useI18n } from '@/lib/i18n';
import {
  getOrCreatePlayer, subscribePlayer, logTx, applyEffect, getRepRules, getPlayerActivityStats,
  computeMoodHappiness, getCurrentSeason, seasonalWeatherIndex, trackPlaytimeHeartbeat,
  computeOffchainStageLevel,
  type PlayerState, type RepRules, type PlayerActivityStats, type Season,
} from '@/lib/gameState';

/** Construit un tuple `v` équivalent à `voxlyns(tokenId)` on-chain, à partir du PlayerState
 * Firebase d'un compte Démo/Fiat (sans portefeuille crypto — voir docs/DEMO_FIAT.md). Alimente
 * VoxlynDashboard EXACTEMENT comme un vrai Voxlyn miné, sans aucune modification de ce composant :
 * `xp` on-chain est forcé à 0 ici car TOUTE la progression de ces comptes est déjà portée par
 * `player.xpBonus` (voir `Math.max(0, Number(xp) + (player?.xpBonus ?? 0))` plus bas, qui donne
 * alors exactement `xpBonus`) ; `level`/`stage` sont recalculés en conséquence côté client. */
function synthesizeOffchainVoxlyn(p: PlayerState): [string, string, string, bigint, bigint, bigint, bigint, bigint, bigint] {
  const { level, stageIndex } = computeOffchainStageLevel(p.xpBonus ?? 0);
  return [
    p.displayName || 'Synk', '', '',
    0n, BigInt(Math.round(p.hp ?? 100)), BigInt(Math.round(p.happiness ?? 60)), BigInt(Math.round(p.hunger ?? 80)),
    BigInt(level), BigInt(stageIndex),
  ];
}

export default function GamePage() {
  const { address, isConnected, accountType } = useEffectiveAccount();
  const session = useEffectiveSession();
  const chainId = useChainId();
  const contract = CONTRACT_ADDRESSES[chainId];
  const { t, locale } = useI18n();
  const [name, setName] = useState('');
  const queryClient = useQueryClient();
  const isVirtual = accountType !== 'wallet'; // compte Démo/Fiat, sans portefeuille crypto connecté

  // Détection propriétaire du contrat (pour afficher le bouton admin) — jamais un compte
  // Démo/Fiat (isVirtual), qui n'a par définition aucune clé privée réelle.
  const { data: ownerAddr } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'owner',
    query: { enabled: !!contract },
  });
  const isOwner = !isVirtual && !!(isConnected && ownerAddr && address &&
    (ownerAddr as string).toLowerCase() === address.toLowerCase());

  const { data: tokenId, queryKey: tokenIdKey } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'voxlynOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!contract && !isVirtual },
  });

  const hasVoxlynChain = !!tokenId && (tokenId as bigint) > 0n;

  const { data: voxlyn, queryKey: voxlynKey } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'voxlyns',
    args: hasVoxlynChain ? [tokenId as bigint] : undefined,
    query: { enabled: hasVoxlynChain },
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

  // ─── Comptes Démo/Fiat (sans portefeuille crypto) — voir docs/DEMO_FIAT.md ───
  // Remplace le mint on-chain : crée/retrouve directement le PlayerState Firebase (idempotent —
  // `getOrCreatePlayer` ne réinitialise jamais un compte existant). Les pièces `demoInitialCoins`
  // ne sont créditées qu'à la toute première création (voir gameState.ts::getOrCreatePlayer).
  // `uid`/`email` (session.uid/session.email) sont aussi enregistrés à la création, pour que
  // l'admin puisse identifier ce joueur et libérer sa session lors d'une suppression (voir menu
  // Administration §"Statistiques par joueur" / §"Demandes d'accès Démo").
  const [virtualPlayer, setVirtualPlayer] = useState<PlayerState | null>(null);
  useEffect(() => {
    if (!isVirtual || !address) return;
    let cancelled = false;
    (async () => {
      const rules = await getRepRules().catch(() => null);
      const p = await getOrCreatePlayer(address, session?.displayName || undefined, {
        accountType: accountType as 'demo' | 'fiat',
        initialWallet: accountType === 'demo' ? (rules?.demoInitialCoins ?? 4000) : 0,
        uid: session?.uid, email: session?.email, authMethod: session?.authMethod, lang: locale,
      }).catch(() => null);
      if (!cancelled && p) setVirtualPlayer(p);
    })();
    return () => { cancelled = true; };
  }, [isVirtual, address, accountType, session?.displayName, session?.uid, session?.email, session?.authMethod, locale]);
  // Synchronisation temps réel du joueur virtuel une fois créé (mêmes mises à jour que
  // VoxlynDashboard, nécessaire ICI pour recalculer le tuple `v` synthétique à chaque évolution).
  useEffect(() => {
    if (!isVirtual || !address) return;
    return subscribePlayer(address, setVirtualPlayer);
  }, [isVirtual, address]);

  const hasVoxlyn = isVirtual ? !!virtualPlayer : hasVoxlynChain;

  if (!isConnected) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="card text-center">
          <p className="mb-4">{t('connect.description')}</p>
          <ConnectButton />
          <p className="text-xs text-slate-400 mt-4">
            {t('connect.noWalletHint')} <Link href="/" className="text-cyan-400 underline">{t('connect.noWalletLink')}</Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 max-w-5xl mx-auto">
      <AnnouncementBanner address={address} />
      <header className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <Link href="/" className="text-2xl font-bold text-voxlyn-crystal">🐉 {t('app.title')}</Link>
        <div className="flex flex-wrap gap-3 items-center">
          {contract && <WeatherWidget contract={contract} />}
          <SeasonWidget />
          <MoonWidget />
          <LanguageSwitcher />
          {!isVirtual && <NetworkSwitcher />}
          {isOwner && <Link href="/admin" className="btn-secondary text-sm">⚙️ {t('admin.title')}</Link>}
          {isVirtual ? <EffectiveAccountBadge /> : <ConnectButton />}
        </div>
      </header>

      {!hasVoxlyn ? (
        isVirtual ? (
          <section className="card max-w-md mx-auto text-center">
            <SynkSkin stage={0} size={180} />
            <p className="mt-4">{t('common.loading')}</p>
          </section>
        ) : (
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
        )
      ) : (isVirtual ? !!virtualPlayer : !!voxlyn) ? (
        <VoxlynDashboard
          tokenId={isVirtual ? 0n : (tokenId as bigint)}
          v={isVirtual ? synthesizeOffchainVoxlyn(virtualPlayer!) : (voxlyn as any)}
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
  const { address, accountType } = useEffectiveAccount();
  const chainId = useChainId();
  const queryClient = useQueryClient();
  const { writeContract, data: txHash, isPending, reset } = useWriteContract();
  const { isLoading: isMining, isSuccess: isMined } = useWaitForTransactionReceipt({ hash: txHash });
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [xpCap, setXpCap] = useState(100000);
  const [repRules, setRepRules] = useState<RepRules | null>(null);
  const [activity, setActivity] = useState<PlayerActivityStats | null>(null);
  // Visite guidée "Aides" (voir OnboardingWizard.tsx/HelpWidget.tsx) — affichée une seule fois par
  // navigateur (drapeau localStorage) à la première entrée en jeu, tant que l'admin ne l'a pas
  // désactivée (repRules.onboardingEnabled). Rejouable à tout moment depuis le widget "Aides".
  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    if (!repRules) return;
    const seen = localStorage.getItem('zc.onboardingSeen.v1') === '1';
    if (!seen && repRules.onboardingEnabled !== false) setShowOnboarding(true);
  }, [repRules]);
  const closeOnboarding = useCallback(() => {
    setShowOnboarding(false);
    localStorage.setItem('zc.onboardingSeen.v1', '1');
  }, []);
  // PNJ actuellement "en approche" (pop-up de rencontre ouvert) — remonté par NpcEncounterPopup
  // pour être matérialisé à côté de Synk dans WorldMapWidget et GameCanvas2D (voir EncounterMarkerInfo).
  const [encounterNpc, setEncounterNpc] = useState<EncounterMarkerInfo>(null);
  const handleEncounterChange = useCallback((info: EncounterMarkerInfo) => setEncounterNpc(info), []);

  // ─── Pont "lancer de dés obligatoire" entre NpcEncounterPopup (combat PNJ) et DiceRollWidget ───
  // Un combat PNJ réclame désormais un jet du widget "Lancer de dès" (bouton "Lancer...") avant de
  // se résoudre : `pendingDiceEvent` active ce bouton, `combatDiceActive` grise "Test rapide"/
  // "Destin quotidien" pendant toute la durée du combat. `requestDiceRoll` renvoie une promesse
  // résolue par `handleDiceEventResolved` dès que le joueur clique sur "Lancer...".
  const [pendingDiceEvent, setPendingDiceEvent] = useState<DiceEventKind | null>(null);
  const [combatDiceActive, setCombatDiceActive] = useState(false);
  const diceResolverRef = useRef<((outcome: DiceEventOutcome) => void) | null>(null);
  const requestDiceRoll = useCallback((kind: DiceEventKind): Promise<DiceEventOutcome> => {
    return new Promise<DiceEventOutcome>((resolve) => {
      diceResolverRef.current = resolve;
      setPendingDiceEvent(kind);
    });
  }, []);
  const handleDiceEventResolved = useCallback((outcome: DiceEventOutcome) => {
    setPendingDiceEvent(null);
    diceResolverRef.current?.(outcome);
    diceResolverRef.current = null;
  }, []);

  // Charge le plafond XP + le barème complet (mood, etc.) paramétrable (admin) — voir RepRulesPanel
  useEffect(() => {
    getRepRules().then((r) => { setXpCap(r.xpCap); setRepRules(r); }).catch(() => {});
  }, []);
  // ⚠️ Ne PAS dépendre de `v` (le tuple entier) ici : pour les comptes Démo/Fiat, `v` est
  // recalculé (nouvelle référence) à CHAQUE rendu de GamePage — y compris à chaque écho du
  // `subscribePlayer` ci-dessous. Dépendre de `v` provoquait donc une boucle infinie
  // getOrCreatePlayer → markPlayerActiveToday (écrit `lastSeenAt`) → onValue → nouveau rendu →
  // nouveau `v` → nouvel appel… qui gelait le jeu en mode démo (bug de lenteur/freeze). Seul le nom
  // (primitif stable, comparé par valeur) doit redéclencher un resync explicite du displayName.
  const voxlynName = v?.[0] as string | undefined;
  useEffect(() => {
    if (!address) return;
    getOrCreatePlayer(address, voxlynName).catch(console.error);
    const unsub = subscribePlayer(address, (p) => setPlayer(p));
    return unsub;
  }, [address, voxlynName]);

  // Statistiques d'activité (rencontres du jour, familiers, combats gagnés) pour pondérer l'humeur
  useEffect(() => {
    if (!address) return;
    getPlayerActivityStats(address).then(setActivity).catch(() => {});
  }, [address]);

  // Temps de jeu (voir RepRules.playtimeTrackingEnabled/playtimeHeartbeatSec, trackPlaytimeHeartbeat
  // et rubrique "Statistiques par joueur" du menu Administration) : "battement" régulier tant que la
  // page reste ouverte ET l'onglet visible (`document.visibilityState`), afin de ne PAS compter le
  // temps passé sur un autre onglet/une autre fenêtre. Le temps masqué n'est jamais rattrapé au
  // retour (pas de delta artificiel) — seul le temps réellement passé "au premier plan" est cumulé.
  useEffect(() => {
    if (!address || repRules?.playtimeTrackingEnabled === false) return;
    let lastTickAt = Date.now();
    const heartbeatMs = Math.max(5, repRules?.playtimeHeartbeatSec ?? 30) * 1000;
    const tick = () => {
      const now = Date.now();
      if (document.visibilityState === 'visible') {
        const delta = now - lastTickAt;
        if (delta > 0) trackPlaytimeHeartbeat(address, delta).catch(() => {});
      }
      lastTickAt = now;
    };
    const id = setInterval(tick, heartbeatMs);
    // Compte aussi le temps écoulé juste avant que l'onglet ne soit masqué/l'utilisateur ne quitte
    // la page, sans attendre le prochain intervalle complet.
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') tick(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [address, repRules?.playtimeTrackingEnabled, repRules?.playtimeHeartbeatSec]);

  // Météo courante (même source que le WeatherWidget de l'en-tête)
  const { data: weatherRaw } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'currentWeather',
    query: { enabled: !!contract, refetchInterval: 30000 },
  });
  // Saison courante utilisée uniquement pour corriger l'incohérence "Neigeux" hors hiver — voir
  // seasonalWeatherIndex() dans gameState.ts (la valeur brute on-chain n'est jamais modifiée, et le
  // calcul d'humeur ci-dessous reste cohérent avec la météo réellement affichée au joueur).
  const [weatherSeason, setWeatherSeason] = useState<Season | null>(null);
  useEffect(() => {
    const refresh = () => getCurrentSeason().then(setWeatherSeason).catch(() => {});
    refresh();
    const id = setInterval(refresh, 5 * 60_000);
    return () => clearInterval(id);
  }, []);
  const weatherIdx = seasonalWeatherIndex(Number(weatherRaw ?? 0), weatherSeason ?? 'summer');
  const weatherKey = WEATHER_KEYS[weatherIdx] ?? 'sunny';
  const weatherEmoji = WEATHER[weatherIdx]?.emoji ?? '☀️';

  // Récupère les cooldowns configurés on-chain pour chaque type de repas
  const cooldowns = FEED_TYPES.map((_, idx) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useReadContract({
      address: contract, abi: HORIZON_ABI, functionName: 'feedCooldown',
      args: [idx], query: { enabled: !!contract },
    }).data as bigint | undefined;
  });

  // Horodatage du DERNIER repas pris PAR TYPE (journalier/hebdomadaire/mensuel/annuel) — chaque
  // type de repas a son propre minuteur indépendant : nourrir Synk avec un repas journalier ne
  // doit jamais bloquer/retarder l'accès au festin hebdomadaire (ou au banquet mensuel / rituel
  // annuel), et inversement. Corrige un bug où les 4 boutons partageaient à tort le même
  // horodatage `voxlyns(tokenId).lastFedAt` (utilisé désormais uniquement pour la faim, plus bas).
  const lastFedByType = FEED_TYPES.map((_, idx) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { data, queryKey } = useReadContract({
      address: contract, abi: HORIZON_ABI, functionName: 'lastFedAtByType',
      args: [tokenId, idx], query: { enabled: !!contract && !!tokenId },
    });
    return { value: data as bigint | undefined, queryKey };
  });

  useEffect(() => {
    if (isMined && txHash) {
      queryClient.invalidateQueries({ queryKey: voxlynKey });
      // Invalide aussi les 4 horodatages par type de repas, pour que le bouton qui vient d'être
      // utilisé passe immédiatement en cooldown SANS affecter les 3 autres boutons.
      lastFedByType.forEach(({ queryKey }) => queryClient.invalidateQueries({ queryKey }));
      // Recharge faim/bonheur en DB après un repas
      if (address) applyEffect(address, { hunger: 25, happiness: 10 }).catch(() => {});
      const timer = setTimeout(() => reset(), 1500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMined, txHash]);

  const [name, , , xp, hp, happiness, hunger, level, stage] = v;

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
    seed: address,
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
    // Défense en profondeur : même si l'UI masque la section (voir plus bas), on bloque aussi
    // l'appel côté handler tant que l'admin n'a pas explicitement réactivé le nourrissage on-chain
    // (bug de cooldown partagé, voir RepRules.onchainFeedButtonsEnabled dans gameState.ts).
    if (repRules?.onchainFeedButtonsEnabled !== true) return;
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
        <Stat label={t('game.stats.oxygen')}    value={player?.oxygen ?? 100} max={player?.oxygenMax  ?? 100} color="bg-sky-500" />
        <Stat label={t('game.stats.fatigue')}   value={player?.fatigue ?? 100} max={player?.fatigueMax ?? 100} color="bg-amber-500" />
        <div className="flex justify-between text-sm mt-3 pt-3 border-t border-slate-700">
          <span>💰 {t('game.stats.wallet')} : <b className="text-amber-400">{player?.wallet ?? 0}</b></span>
          <span>⭐ {t('game.stats.reputation')} : <b className={((player?.reputation ?? 0) >= 0) ? 'text-emerald-400' : 'text-rose-400'}>{player?.reputation ?? 0}</b></span>
        </div>
      </section>

      {repRules?.feedSectionEnabled !== false && (
      <section className="card md:col-span-2">
        <h3 className="text-lg font-semibold mb-4">{t('game.feed.title')}</h3>
        {accountType !== 'wallet' ? (
          // Comptes Démo/Fiat (sans portefeuille crypto) : aucun appel on-chain possible (pas de
          // signataire réel derrière l'adresse virtuelle) — le nourrissage passe exclusivement par
          // la Boutique hors-chaîne (voir ShopPanel.tsx/ShopWidget.tsx), quel que soit l'état du
          // réglage `onchainFeedButtonsEnabled` (voir docs/DEMO_FIAT.md § Limites connues).
          <div className="bg-purple-950/20 border border-purple-700/40 rounded p-3 text-center">
            <p className="text-sm font-semibold text-purple-300">🎟️ {t('game.feed.demoAccountTitle')}</p>
            <p className="text-xs text-slate-400 mt-1">{t('game.feed.demoAccountMessage')}</p>
          </div>
        ) : repRules?.onchainFeedButtonsEnabled !== true ? (
          // Section masquée par défaut : bug connu de cooldown partagé sur le contrat Sepolia
          // déployé (voir RepRules.onchainFeedButtonsEnabled). Réactivable depuis Administration
          // > Widgets personnalisés une fois le correctif redéployé (ou volontairement plus tôt).
          <div className="bg-amber-950/20 border border-amber-700/40 rounded p-3 text-center">
            <p className="text-sm font-semibold text-amber-300">{t('game.feed.onchainDisabledTitle')}</p>
            <p className="text-xs text-slate-400 mt-1">{t('game.feed.onchainDisabledMessage')}</p>
          </div>
        ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {FEED_TYPES.map((f, idx) => {
            const cooldown = cooldowns[idx];
            // Horodatage propre à CE type de repas (voir `lastFedByType` ci-dessus) — un repas
            // journalier n'affecte plus jamais la disponibilité du festin hebdomadaire/mensuel/annuel.
            const lastFedThisType = Number(lastFedByType[idx]?.value ?? 0n);
            const nextAvailable = cooldown !== undefined ? lastFedThisType + Number(cooldown) : 0;
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
        )}
        {txHash && (
          <p className="text-sm text-slate-400 mt-3">
            Tx : <code className="text-cyan-300">{txHash.slice(0, 10)}…</code>
            {isMining && ' ⏳ En attente de confirmation…'}
            {isMined && ' ✅ Confirmé — stats mises à jour'}
          </p>
        )}
      </section>
      )}

      <div className="md:col-span-2">
        <Scoreboard contract={contract} tokenId={tokenId} level={Number(level)} xp={Math.max(0, Number(xp) + (player?.xpBonus ?? 0))} offchainScore={player?.score ?? 0} />
      </div>

      <div className="md:col-span-2">
        <QuestList playerXp={Math.max(0, Number(xp) + (player?.xpBonus ?? 0))} />
      </div>

      <div className="md:col-span-2">
        <NpcList />
      </div>

      <div className="md:col-span-2">
        <EncountersLog />
      </div>

      <div className="md:col-span-2">
        <TreasureList playerXp={Math.max(0, Number(xp) + (player?.xpBonus ?? 0))} />
      </div>

      <div className="md:col-span-2">
        <WorldList playerXp={Math.max(0, Number(xp) + (player?.xpBonus ?? 0))} />
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
      <NpcEncounterPopup contract={contract} tokenId={tokenId} onEncounterChange={handleEncounterChange}
        onRequestDiceRoll={requestDiceRoll} onCombatActiveChange={setCombatDiceActive} />
      {/* Fenêtre flottante et déplaçable de lancer de dés (infra générique + destin quotidien +
          "Lancer..." obligatoire pour les combats PNJ, voir le pont ci-dessus) */}
      <DiceRollWidget pendingEvent={pendingDiceEvent} onEventResolved={handleDiceEventResolved} otherRollsLocked={combatDiceActive} enabled={repRules?.diceRollWidgetEnabled !== false} />
      {/* Fenêtre flottante et déplaçable du chat d'équipe multi-joueurs */}
      <TeamChatWidget contract={contract} defaultName={name} enabled={repRules?.teamChatWidgetEnabled !== false} />
      {/* Fenêtre flottante "homme de Vitruve" pour équiper armes/protections par drag-and-drop */}
      <EquipmentWidget stage={Number(stage)} enabled={repRules?.equipmentWidgetEnabled !== false} />
      {/* Fenêtre flottante et déplaçable "Sac / Besace" — duplique InventoryPanel.tsx ci-dessus,
          permet le glisser-déposer direct vers EquipmentWidget sans défiler la page */}
      <InventoryWidget enabled={repRules?.inventoryWidgetEnabled !== false} />
      {/* Fenêtre flottante et déplaçable "Boutique des terres de ZeldCraft" — duplique ShopPanel.tsx
          ci-dessus dans une fenêtre repositionnable */}
      <ShopWidget enabled={repRules?.shopWidgetEnabled !== false} />
      {/* Fenêtre flottante et déplaçable "Rechargement du portefeuille" — duplique WalletPanel.tsx
          ci-dessus (achat de monnaie de jeu contre ETH, mêmes presets/treasury/applyEffect) */}
      <WalletTopupWidget contract={contract} enabled={repRules?.walletTopupWidgetEnabled !== false} />
      {/* Mapmonde du territoire de Synk — carte parchemin zoomable, POI, mondes, voyage libre */}
      <WorldMapWidget playerXp={Math.max(0, Number(xp) + (player?.xpBonus ?? 0))} encounterNpc={encounterNpc} enabled={repRules?.worldMapWidgetEnabled !== false} />
      {/* Socle évolutif de plateforme de jeu 2D isométrique (déplacements, PNJ, dragon, décor) */}
      <GameCanvas2D stage={Number(stage)} playerXp={Math.max(0, Number(xp) + (player?.xpBonus ?? 0))} encounterNpc={encounterNpc} />
      {/* Fenêtre flottante et déplaçable "Plateforme 3D" (Phase 3 Roadmap — Moteur de jeu) — rendu
          3D façon Minecraft de Synk et de son univers, synchronisé avec la Plateforme 2D
          isométrique et la Mapmonde (même position/décor/marqueurs, voir Platform3DWidget.tsx) */}
      <Platform3DWidget stage={Number(stage)} playerXp={Math.max(0, Number(xp) + (player?.xpBonus ?? 0))} enabled={repRules?.platform3dWidgetEnabled !== false} />
      {/* Fenêtre flottante et déplaçable "Statistiques" — duplique le tableau fixe ci-dessus */}
      <StatsWidget
        xp={Math.max(0, Number(xp) + (player?.xpBonus ?? 0))} xpCap={xpCap}
        hp={dispHp} hpMax={player?.hpMax ?? 100}
        hunger={dispHunger} hungerMax={player?.hungerMax ?? 100}
        happiness={dispHappiness} happinessMax={happinessMax} moodHint={moodHint}
        force={player?.force ?? 10} forceMax={player?.forceMax ?? 100}
        spells={player?.spells ?? 5} spellsMax={player?.spellsMax ?? 100}
        oxygen={player?.oxygen ?? 100} oxygenMax={player?.oxygenMax ?? 100}
        fatigue={player?.fatigue ?? 100} fatigueMax={player?.fatigueMax ?? 100}
        wallet={player?.wallet ?? 0} reputation={player?.reputation ?? 0}
        enabled={repRules?.statsWidgetEnabled !== false}
      />
      {/* Fenêtre flottante et déplaçable "Quêtes du Royaume" — 400 énigmes, 40 chapitres, fil
          narratif principal (libérer PocaPoka et El Pipo de Zorghon) — voir gameState.ts */}
      <KingdomQuestsWidget enabled={repRules?.kingdomQuestsWidgetEnabled !== false} />
      {/* Fenêtre flottante et déplaçable "Quêtes de ZeldaCraft" — récapitulatif repliable par
          thème de TOUTES les quêtes (PNJ rencontrés, classiques, PNJ, archipel, îles sauvages,
          Royaume) en un seul widget, voir demande utilisateur */}
      <QuestsZeldaCraftWidget enabled={repRules?.questsZeldaCraftWidgetEnabled !== false} />
      {/* Widgets flottants personnalisés définis par l'admin (menu Administration) */}
      <CustomWidgetsRenderer playerXp={Math.max(0, Number(xp) + (player?.xpBonus ?? 0))} />
      {/* Sommeil forcé si HP ≤ 20 (récupère à 75 après 50s) */}
      <SleepModal player={player} rules={repRules} />
      {/* Visite guidée (contexte, quêtes, mécaniques, widgets) — 1ère visite ou "Revoir" (widget Aides) */}
      <OnboardingWizard open={showOnboarding} onClose={closeOnboarding} />
      {/* Fenêtre flottante et déplaçable "Aides" — toujours disponible, reprend le même contenu */}
      <HelpWidget enabled={repRules?.helpWidgetEnabled !== false} onReplayTour={() => setShowOnboarding(true)} />
      {/* Fenêtre flottante et déplaçable "État d'avancement / inventaire" — voir demande utilisateur :
          liste repliable par thème (armes, protections, nourriture, potions & sortilèges, engins,
          trésors, selles, familiers, quêtes classiques/PNJ/archipel/îles sauvages/Royaume, mondes,
          PNJ rencontrés) avec icône ✅/❌ par élément selon possession/réussite passée ou présente */}
      <ProgressWidget enabled={repRules?.progressWidgetEnabled !== false} />
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
