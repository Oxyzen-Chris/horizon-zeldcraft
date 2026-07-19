'use client';

import { useEffect, useState } from 'react';
import { useChainId, useReadContract, useReadContracts } from 'wagmi';
import { formatEther, isAddress } from 'viem';
import jsPDF from 'jspdf';
import { HORIZON_ABI, STAGE_NAMES } from '@/lib/contract';
import { useI18n } from '@/lib/i18n';
import { useIdsList } from './useIdsList';
import { listPlayers, getPlayer, getTxs, type PlayerState, type TxRecord } from '@/lib/gameState';

const ETHERSCAN: Record<number, string> = {
  1: 'https://etherscan.io/tx/',
  11155111: 'https://sepolia.etherscan.io/tx/',
};

export function PlayerStats({ contract }: { contract: `0x${string}` }) {
  const { t } = useI18n();
  const chainId = useChainId();
  const [addr, setAddr] = useState('');
  const [target, setTarget] = useState<`0x${string}` | null>(null);
  const [players, setPlayers] = useState<string[]>([]);
  const [dbPlayer, setDbPlayer] = useState<PlayerState | null>(null);
  const [txs, setTxs] = useState<TxRecord[]>([]);

  // Charge la liste de tous les joueurs (Firebase index)
  useEffect(() => {
    listPlayers().then(setPlayers).catch(() => {});
  }, []);

  const { data: tokenId } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'voxlynOf',
    args: target ? [target] : undefined, query: { enabled: !!target },
  });
  const hasVox = !!tokenId && (tokenId as bigint) > 0n;

  const { data: voxlyn } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'voxlyns',
    args: hasVox ? [tokenId as bigint] : undefined, query: { enabled: hasVox },
  });
  const { data: score } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'playerScore',
    args: hasVox ? [tokenId as bigint] : undefined, query: { enabled: hasVox },
  });

  const questIds     = useIdsList(contract, 'questsLength',     'questIds',     30);
  const npcIdsAll    = useIdsList(contract, 'npcsLength',       'npcIds',       30);
  const treasureIds  = useIdsList(contract, 'treasuresLength',  'treasureIds',  30);
  const worldIds     = useIdsList(contract, 'worldsLength',     'worldIds',     30);

  const questCalls = hasVox ? questIds.map((id) => ({
    address: contract, abi: HORIZON_ABI, functionName: 'questCompleted' as const, args: [tokenId as bigint, id] as const,
  })) : [];
  const npcCalls = hasVox ? npcIdsAll.map((id) => ({
    address: contract, abi: HORIZON_ABI, functionName: 'npcMet' as const, args: [tokenId as bigint, id] as const,
  })) : [];
  const trCalls = hasVox ? treasureIds.map((id) => ({
    address: contract, abi: HORIZON_ABI, functionName: 'treasureFound' as const, args: [tokenId as bigint, id] as const,
  })) : [];
  const wCalls = hasVox ? worldIds.map((id) => ({
    address: contract, abi: HORIZON_ABI, functionName: 'worldUnlocked' as const, args: [tokenId as bigint, id] as const,
  })) : [];

  const { data: qRes } = useReadContracts({ contracts: questCalls as any, query: { enabled: questCalls.length > 0 } });
  const { data: nRes } = useReadContracts({ contracts: npcCalls   as any, query: { enabled: npcCalls.length   > 0 } });
  const { data: tRes } = useReadContracts({ contracts: trCalls    as any, query: { enabled: trCalls.length    > 0 } });
  const { data: wRes } = useReadContracts({ contracts: wCalls     as any, query: { enabled: wCalls.length     > 0 } });

  const count = (arr?: readonly any[]) => (arr ?? []).filter((r) => r?.result === true).length;

  const load = async (a?: string) => {
    const val = (a ?? addr).trim();
    if (!isAddress(val)) { alert('Adresse invalide'); return; }
    setAddr(val);
    setTarget(val as `0x${string}`);
    // Charge les infos off-chain
    const p = await getPlayer(val);
    setDbPlayer(p);
    const tx = await getTxs(val);
    setTxs(tx);
  };

  const generateInvoice = () => {
    if (!target) return;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('Horizon ZeldCraft — Facture / Invoice', 14, 20);
    doc.setFontSize(10);
    doc.text(`Contrat : ${contract}`, 14, 30);
    doc.text(`Joueur : ${target}`, 14, 36);
    doc.text(`Réseau : ${chainId === 1 ? 'Ethereum Mainnet' : chainId === 11155111 ? 'Sepolia Testnet' : `chainId=${chainId}`}`, 14, 42);
    doc.text(`Date d'édition : ${new Date().toLocaleString()}`, 14, 48);
    doc.line(14, 52, 196, 52);
    doc.setFontSize(11);
    doc.text('Transactions on-chain', 14, 60);
    doc.setFontSize(9);
    let y = 68;
    let total = 0;
    txs.forEach((tx, i) => {
      if (y > 275) { doc.addPage(); y = 20; }
      const val = parseFloat(tx.valueEth || '0');
      total += val;
      doc.text(`${i + 1}. ${new Date(tx.timestamp).toLocaleString()}`, 14, y);
      doc.text(`${tx.type} — ${tx.label.slice(0, 40)}`, 14, y + 4);
      doc.text(`${val.toFixed(6)} ETH`, 150, y);
      doc.text(tx.hash.slice(0, 14) + '…', 14, y + 8);
      y += 14;
    });
    doc.line(14, y, 196, y);
    doc.setFontSize(11);
    doc.text(`Total : ${total.toFixed(6)} ETH`, 140, y + 8);
    doc.setFontSize(8);
    doc.text('Cette facture atteste des transactions on-chain payées par le joueur. Vérifiable via etherscan.', 14, y + 20);
    doc.save(`invoice_${target.slice(0, 8)}_${Date.now()}.pdf`);
  };

  const etherscanBase = ETHERSCAN[chainId] || ETHERSCAN[11155111];

  return (
    <section className="card">
      <h2 className="text-xl font-semibold mb-2">{t('admin.stats.title')}</h2>
      <p className="text-xs text-slate-400 mb-3">{t('admin.stats.description')}</p>

      {players.length > 0 && (
        <div className="flex gap-2 mb-3">
          <select className="input flex-1" value={target ?? ''} onChange={e => e.target.value && load(e.target.value)}>
            <option value="">{t('admin.stats.pick')}</option>
            {players.map(p => <option key={p} value={p}>{p.slice(0, 10)}…{p.slice(-6)}</option>)}
          </select>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <input className="input flex-1" placeholder={t('admin.stats.address')}
          value={addr} onChange={e => setAddr(e.target.value)} />
        <button className="btn-primary" onClick={() => load()}>{t('admin.stats.load')}</button>
      </div>

      {target && !hasVox && <p className="text-amber-400 text-sm">{t('admin.stats.noVoxlyn')}</p>}

      {target && hasVox && voxlyn && (
        <div className="grid md:grid-cols-3 gap-3 text-sm">
          <StatRow label={t('admin.stats.owner')} value={target.slice(0, 10) + '…' + target.slice(-6)} />
          <StatRow label={t('admin.stats.tokenId')} value={String(tokenId)} />
          <StatRow label={t('admin.stats.name')} value={(voxlyn as any)[0]} />
          <StatRow label={t('admin.stats.score')} value={String(Number(score ?? 0))} color="text-yellow-400" />
          <StatRow label={t('admin.stats.level')} value={String(Number((voxlyn as any)[7]))} color="text-emerald-400" />
          <StatRow label={t('admin.stats.xp')} value={String(Number((voxlyn as any)[3]))} color="text-purple-400" />
          <StatRow label={t('admin.stats.stage')} value={t(`stage.${STAGE_NAMES[Number((voxlyn as any)[8])]}`)} />
          <StatRow label={t('admin.stats.questsSolved')} value={`${count(qRes)} / ${questIds.length}`} color="text-cyan-400" />
          <StatRow label={t('admin.stats.npcsMet')} value={`${count(nRes)} / ${npcIdsAll.length}`} color="text-cyan-400" />
          <StatRow label={t('admin.stats.treasures')} value={`${count(tRes)} / ${treasureIds.length}`} color="text-cyan-400" />
          <StatRow label={t('admin.stats.worlds')} value={`${count(wRes)} / ${worldIds.length}`} color="text-cyan-400" />
          <StatRow label={t('admin.stats.lastFed')}
            value={Number((voxlyn as any)[2]) === 0 ? '—' : new Date(Number((voxlyn as any)[2]) * 1000).toLocaleString()} />
          {/* Stats off-chain (Firebase) */}
          {dbPlayer && (
            <>
              <StatRow label={t('game.stats.force')}      value={String(dbPlayer.force)}      color="text-rose-400" />
              <StatRow label={t('game.stats.spells')}     value={String(dbPlayer.spells)}     color="text-indigo-400" />
              <StatRow label={t('game.stats.reputation')} value={String(dbPlayer.reputation)} color="text-amber-400" />
              <StatRow label={t('game.stats.wallet')}     value={String(dbPlayer.wallet)}     color="text-amber-400" />
            </>
          )}
        </div>
      )}

      {target && txs.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">{t('admin.stats.txHistory')} ({txs.length})</h3>
            <button className="btn-primary text-xs" onClick={generateInvoice}>📄 {t('admin.stats.invoiceBtn')}</button>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1 text-xs">
            {txs.map(tx => (
              <div key={tx.hash} className="bg-slate-800/60 rounded p-2 flex justify-between items-center">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{tx.type} · {tx.label}</p>
                  <p className="text-slate-400">{new Date(tx.timestamp).toLocaleString()} — {tx.valueEth} ETH</p>
                </div>
                <a className="text-cyan-300 hover:underline text-[10px] ml-2" target="_blank" rel="noopener" href={etherscanBase + tx.hash}>Etherscan ↗</a>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function StatRow({ label, value, color = 'text-slate-100' }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-slate-800/60 rounded p-2">
      <p className="text-[10px] text-slate-400 uppercase">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}
