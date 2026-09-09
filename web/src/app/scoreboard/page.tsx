'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useChainId, useReadContracts } from 'wagmi';
import { CONTRACT_ADDRESSES } from '@/lib/wagmi';
import { HORIZON_ABI, STAGE_NAMES } from '@/lib/contract';
import {
  listPlayers, getPlayer, getPlayerActivityStats, getUnlockedWorldIds, getWorldDefs,
  computeOffchainStageLevel, type PlayerState, type PlayerActivityStats,
} from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

type Row = {
  address: string;
  displayName?: string;
  onChainXp: number;
  xpBonus: number;
  totalXp: number;
  level: number;
  score: number;
  reputation: number;
  stage: number;
  worldsDiscovered: number;
  questsSolved: number;
  encounters: number;
  fightsWon: number;
  familiarsOwned: number;
};

const emptyActivity: PlayerActivityStats = { questsSolved: 0, encounters: 0, encountersToday: 0, fightsWon: 0, familiarsOwned: 0, feedsToday: 0 };

export default function ScoreboardPage() {
  const { t } = useI18n();
  const chainId = useChainId();
  const contract = CONTRACT_ADDRESSES[chainId];
  const [addresses, setAddresses] = useState<string[]>([]);
  const [dbData, setDbData] = useState<Record<string, PlayerState>>({});
  const [activityData, setActivityData] = useState<Record<string, PlayerActivityStats>>({});
  // Mondes découverts par joueur : lus hors-chaîne (`players/{addr}/worldsUnlocked`, écrit par
  // `discoverWorldOffchain` quel que soit le type de compte — voir PoiInteractionModal.tsx). Ne
  // dépend donc PAS d'un tokenId on-chain, contrairement à l'ancien mapping `worldUnlocked` du
  // smart contract : c'est ce qui permet aux comptes Démo/Fiat (sans Voxlyn miné) d'afficher un
  // décompte de mondes cohérent au même titre qu'un joueur avec portefeuille.
  const [worldsUnlockedData, setWorldsUnlockedData] = useState<Record<string, number>>({});
  const [worldCatalogSize, setWorldCatalogSize] = useState(0);

  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    listPlayers().then(async (addrs) => {
      setAddresses(addrs);
      if (addrs.length === 0) {
        setLoadError('playerIndex vide — vérifie que les règles Firebase autorisent la lecture de /playerIndex (voir docs/FIREBASE_CHAT.md).');
        return;
      }
      const entries = await Promise.all(addrs.map(async a => [a, await getPlayer(a)] as const));
      const map: Record<string, PlayerState> = {};
      entries.forEach(([a, p]) => { if (p) map[a] = p; });
      setDbData(map);
      const activityEntries = await Promise.all(addrs.map(async a => [a, await getPlayerActivityStats(a)] as const));
      const activityMap: Record<string, PlayerActivityStats> = {};
      activityEntries.forEach(([a, s]) => { activityMap[a] = s; });
      setActivityData(activityMap);
      const worldsEntries = await Promise.all(addrs.map(async a => [a, await getUnlockedWorldIds(a)] as const));
      const worldsMap: Record<string, number> = {};
      worldsEntries.forEach(([a, ids]) => { worldsMap[a] = ids.size; });
      setWorldsUnlockedData(worldsMap);
      const worldDefs = await getWorldDefs();
      setWorldCatalogSize(worldDefs.length);
    }).catch((e) => {
      setLoadError('Firebase read error: ' + (e?.message ?? String(e)));
    });
  }, []);

  const { data: tokenIds } = useReadContracts({
    contracts: addresses.map(a => ({
      address: contract, abi: HORIZON_ABI, functionName: 'voxlynOf', args: [a as `0x${string}`],
    })) as any,
    query: { enabled: !!contract && addresses.length > 0 },
  });

  // Adresses ayant un vrai Voxlyn miné on-chain (portefeuille connecté ET mint effectué) — pour
  // celles-ci seulement on lit les données de progression on-chain (`voxlyns`/`playerScore`).
  const validTokenIds = useMemo(() => {
    if (!tokenIds) return [] as { addr: string; id: bigint }[];
    return tokenIds
      .map((r, i) => ({ addr: addresses[i], id: (r.result as bigint | undefined) ?? 0n }))
      .filter(x => x.id > 0n);
  }, [tokenIds, addresses]);

  const { data: voxlynsData } = useReadContracts({
    contracts: validTokenIds.flatMap(x => [
      { address: contract, abi: HORIZON_ABI, functionName: 'voxlyns',     args: [x.id] },
      { address: contract, abi: HORIZON_ABI, functionName: 'playerScore', args: [x.id] },
    ]) as any,
    query: { enabled: validTokenIds.length > 0 },
  });

  // Index adresse -> position dans `validTokenIds`/`voxlynsData`, pour retrouver rapidement les
  // données on-chain d'un joueur donné lors de la construction des lignes ci-dessous.
  const onChainIndexByAddr = useMemo(() => {
    const m = new Map<string, number>();
    validTokenIds.forEach((x, i) => m.set(x.addr, i));
    return m;
  }, [validTokenIds]);

  // ⚠️ Correctif régression « seul Pouic apparaît dans le classement » : le classement doit lister
  // TOUS les joueurs (portefeuille connecté ET mint effectué, portefeuille sans mint, Démo, Fiat),
  // pas seulement ceux ayant un Voxlyn miné on-chain — voir demande utilisateur. On construit donc
  // désormais une ligne pour CHAQUE adresse de `playerIndex` (`addresses`), en ne lisant les champs
  // on-chain (xp/niveau/stade/score/nom) que pour celles qui ont réellement un tokenId, et en
  // synthétisant les mêmes champs hors-chaîne pour les autres via `computeOffchainStageLevel`
  // (même formule que `synthesizeOffchainVoxlyn` dans game/page.tsx, qui alimente déjà le dashboard
  // d'un compte Démo/Fiat à l'identique d'un vrai Voxlyn miné).
  const rows: Row[] = useMemo(() => {
    return addresses.map((addr) => {
      const db = dbData[addr];
      const activity = activityData[addr] ?? emptyActivity;
      const xpBonus = db?.xpBonus ?? 0;
      const onChainIdx = onChainIndexByAddr.get(addr);
      let onChainXp = 0, level = 0, stage = 0, onChainScore = 0;
      let displayName: string | undefined = db?.displayName;
      if (onChainIdx !== undefined && voxlynsData) {
        const vox = voxlynsData[onChainIdx * 2]?.result as any;
        const sc  = voxlynsData[onChainIdx * 2 + 1]?.result as bigint | undefined;
        if (vox) {
          onChainXp = Number(vox[3]);
          level     = Number(vox[7]);
          stage     = Number(vox[8]);
          displayName = String(vox[0]) || displayName;
        }
        onChainScore = Number(sc ?? 0);
      } else {
        // Aucun Voxlyn on-chain (Démo/Fiat, ou portefeuille pas encore minté) : toute la
        // progression est portée par `xpBonus` hors-chaîne, exactement comme dans le jeu lui-même.
        const synth = computeOffchainStageLevel(xpBonus);
        level = synth.level;
        stage = synth.stageIndex;
      }
      return {
        address: addr,
        displayName,
        onChainXp, xpBonus,
        totalXp: Math.max(0, onChainXp + xpBonus),
        level,
        score: onChainScore + (db?.score ?? 0),
        reputation: db?.reputation ?? 0,
        stage,
        worldsDiscovered: worldsUnlockedData[addr] ?? 0,
        questsSolved: activity.questsSolved,
        encounters: activity.encounters,
        fightsWon: activity.fightsWon,
        familiarsOwned: activity.familiarsOwned,
      };
    }).sort((a, b) => b.totalXp - a.totalXp);
  }, [addresses, dbData, activityData, onChainIndexByAddr, voxlynsData, worldsUnlockedData]);

  return (
    <main className="container mx-auto p-6 max-w-4xl">
      <div className="flex justify-between items-center mb-6">
        <Link href="/game" className="btn-secondary text-sm">← {t('scoreboard.backToGame')}</Link>
        <LanguageSwitcher />
      </div>

      <h1 className="text-3xl font-bold mb-2">🏆 {t('scoreboard.title')}</h1>
      <p className="text-sm text-slate-400 mb-6">{t('scoreboard.description')}</p>

      {loadError && (
        <div className="card mb-4 border border-rose-500/40">
          <p className="text-sm text-rose-300">⚠ {loadError}</p>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-slate-400 italic">{t('scoreboard.empty')}</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-slate-700">
                <th className="p-2">#</th>
                <th className="p-2">{t('scoreboard.player')}</th>
                <th className="p-2 text-right">{t('scoreboard.xp')}</th>
                <th className="p-2 text-right">{t('scoreboard.level')}</th>
                <th className="p-2 text-right">{t('scoreboard.score')}</th>
                <th className="p-2 text-right">⭐</th>
                <th className="p-2 text-right">{t('scoreboard.stage')}</th>
                <th className="p-2 text-right">{t('scoreboard.worlds')}</th>
                <th className="p-2 text-right">{t('scoreboard.quests')}</th>
                <th className="p-2 text-right">{t('scoreboard.encounters')}</th>
                <th className="p-2 text-right">{t('scoreboard.fights')}</th>
                <th className="p-2 text-right">{t('scoreboard.familiars')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.address} className="border-b border-slate-800 hover:bg-slate-800/40">
                  <td className="p-2 font-bold">
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                  </td>
                  <td className="p-2">
                    <div className="text-slate-100 font-semibold">{r.displayName || '—'}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{r.address.slice(0, 10)}…{r.address.slice(-6)}</div>
                  </td>
                  <td className="p-2 text-right text-purple-400 font-bold">
                    {r.totalXp.toLocaleString()}
                    {r.xpBonus !== 0 && (
                      <div className="text-[9px] text-slate-500">
                        ({r.onChainXp}{r.xpBonus >= 0 ? '+' : ''}{r.xpBonus})
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-right text-emerald-400">{r.level}</td>
                  <td className="p-2 text-right text-yellow-400">{r.score.toLocaleString()}</td>
                  <td className={`p-2 text-right ${r.reputation >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {r.reputation}
                  </td>
                  <td className="p-2 text-right text-cyan-300">{t(`stage.${STAGE_NAMES[r.stage] ?? STAGE_NAMES[0]}`)}</td>
                  <td className="p-2 text-right text-cyan-400">{r.worldsDiscovered}/{worldCatalogSize}</td>
                  <td className="p-2 text-right text-amber-300">{r.questsSolved}</td>
                  <td className="p-2 text-right text-slate-300">{r.encounters}</td>
                  <td className="p-2 text-right text-rose-300">{r.fightsWon}</td>
                  <td className="p-2 text-right text-fuchsia-300">{r.familiarsOwned}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 text-center">
        <Link href="/game" className="btn-primary">← {t('scoreboard.backToGame')}</Link>
      </div>
    </main>
  );
}
