'use client';

import { useEffect, useState } from 'react';
import { useChainId, useReadContract, useReadContracts } from 'wagmi';
import { formatEther, isAddress } from 'viem';
import jsPDF from 'jspdf';
import { HORIZON_ABI, STAGE_NAMES } from '@/lib/contract';
import { useI18n } from '@/lib/i18n';
import { useIdsList } from './useIdsList';
import { listPlayers, getPlayer, getTxs, type PlayerState, type TxRecord } from '@/lib/gameState';

const ETHERSCAN_TX: Record<number, string> = {
  1: 'https://etherscan.io/tx/',
  11155111: 'https://sepolia.etherscan.io/tx/',
};
const ETHERSCAN_ADDR: Record<number, string> = {
  1: 'https://etherscan.io/address/',
  11155111: 'https://sepolia.etherscan.io/address/',
};

/**
 * Récupère l'historique complet des transactions wallet → contrat via l'API Etherscan V2.
 * Fonctionne même pour les joueurs créés avant l'ajout de `logTx` en Firebase.
 * Requiert NEXT_PUBLIC_ETHERSCAN_KEY (gratuit sur etherscan.io/apis).
 * Docs V2 : https://docs.etherscan.io/v2-migration
 */
async function fetchEtherscanTxs(chainId: number, wallet: string, contract: string): Promise<TxRecord[]> {
  const key = process.env.NEXT_PUBLIC_ETHERSCAN_KEY;
  if (!key) return [];
  const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=account&action=txlist&address=${wallet}&startblock=0&endblock=99999999&sort=desc&apikey=${key}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== '1' || !Array.isArray(data.result)) return [];
    const c = contract.toLowerCase();
    return (data.result as any[])
      .filter(t => t.to && t.to.toLowerCase() === c)
      .map<TxRecord>(t => {
        // Décode le sélecteur de fonction pour nommer la ligne (4 premiers octets = signature)
        const sel = (t.input || '').slice(0, 10);
        const label = FUNCTION_SELECTORS[sel] || sel || 'call';
        const type: TxRecord['type'] =
          label.startsWith('mint') ? 'mint' :
          label.startsWith('feed') ? 'feed' :
          label.startsWith('buy')  ? 'buy'  :
          label.includes('Quest')  ? 'quest' : 'other';
        // Frais réseau = gasUsed * gasPrice (tous deux en wei stringifié)
        let gasEth = '0';
        try {
          const gasWei = BigInt(t.gasUsed || '0') * BigInt(t.gasPrice || '0');
          gasEth = (Number(gasWei) / 1e18).toFixed(8);
        } catch {}
        return {
          hash: t.hash,
          type, label,
          valueEth: (parseInt(t.value, 10) / 1e18).toFixed(6),
          gasEth,
          timestamp: parseInt(t.timeStamp, 10) * 1000,
          chainId,
          status: t.txreceipt_status === '1' ? 'confirmed' : 'failed',
        };
      });
  } catch (e) {
    console.error('[etherscan] fetch failed:', e);
    return [];
  }
}

// Sélecteurs des fonctions les plus fréquentes (4 premiers octets de keccak256(signature))
// Sert à donner un libellé lisible à chaque tx récupérée sur Etherscan.
const FUNCTION_SELECTORS: Record<string, string> = {
  '0x2c481252': 'mintVoxlyn',
  '0x53a04b05': 'feed',
  '0xa39aca7d': 'buyCatalogItem',
  '0x1e5f9c7f': 'submitQuestAnswer',
  '0x0e39c2a1': 'meetNpc',
  '0x0a29f6c9': 'discoverWorld',
  '0x9c9b4d18': 'createTeam',
  '0x685c2f5b': 'joinTeam',
  '0xd66d9e19': 'leaveTeam',
};

export function PlayerStats({ contract }: { contract: `0x${string}` }) {
  const { t } = useI18n();
  const chainId = useChainId();
  const [addr, setAddr] = useState('');
  const [target, setTarget] = useState<`0x${string}` | null>(null);
  const [players, setPlayers] = useState<string[]>([]);
  const [dbPlayer, setDbPlayer] = useState<PlayerState | null>(null);
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const [loadingTxs, setLoadingTxs] = useState(false);

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
    setLoadingTxs(true);
    // Charge parallèlement DB player, Firebase txs et Etherscan history
    const [p, dbTxs, chainTxs] = await Promise.all([
      getPlayer(val),
      getTxs(val),
      fetchEtherscanTxs(chainId, val, contract),
    ]);
    setDbPlayer(p);
    // Merge dédupliqué par hash (préférence DB pour le label riche)
    const map = new Map<string, TxRecord>();
    chainTxs.forEach(t => map.set(t.hash.toLowerCase(), t));
    dbTxs.forEach(t => map.set(t.hash.toLowerCase(), t));
    const merged = Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
    setTxs(merged);
    setLoadingTxs(false);
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
    doc.text(`Transactions on-chain (${txs.length})`, 14, 60);
    doc.setFontSize(9);
    let y = 68;
    let total = 0;
    let totalGas = 0;
    if (txs.length === 0) {
      doc.text('Aucune transaction on-chain enregistrée.', 14, y);
      y += 10;
    } else {
      // En-tête colonnes
      doc.setFont('helvetica', 'bold');
      doc.text('#', 14, y);
      doc.text('Date / Action', 20, y);
      doc.text('Valeur', 130, y);
      doc.text('Frais gas', 160, y);
      doc.setFont('helvetica', 'normal');
      y += 5;
      doc.line(14, y, 196, y);
      y += 4;
      txs.forEach((tx, i) => {
        if (y > 270) { doc.addPage(); y = 20; }
        const val = parseFloat(tx.valueEth || '0');
        const gas = parseFloat(tx.gasEth || '0');
        total += val;
        totalGas += gas;
        doc.text(`${i + 1}`, 14, y);
        doc.text(`${new Date(tx.timestamp).toLocaleString()}  [${tx.type}]`, 20, y);
        doc.text(`${tx.label.slice(0, 45)}`, 20, y + 4);
        doc.text(`${val.toFixed(6)} ETH`, 130, y);
        doc.text(`${gas.toFixed(8)} ETH`, 160, y);
        doc.setFontSize(7);
        doc.text(tx.hash, 20, y + 8);
        doc.setFontSize(9);
        y += 14;
      });
    }
    doc.line(14, y, 196, y);
    doc.setFontSize(11);
    doc.text(`Total valeur : ${total.toFixed(6)} ETH`, 110, y + 8);
    doc.text(`Total frais gas : ${totalGas.toFixed(8)} ETH`, 110, y + 14);
    doc.setFont('helvetica', 'bold');
    doc.text(`Total général : ${(total + totalGas).toFixed(8)} ETH`, 110, y + 22);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Cette facture atteste des transactions on-chain payées par le joueur. Vérifiable via etherscan.', 14, y + 32);
    doc.save(`invoice_${target.slice(0, 8)}_${Date.now()}.pdf`);
  };

  const txBase   = ETHERSCAN_TX[chainId]   || ETHERSCAN_TX[11155111];
  const addrBase = ETHERSCAN_ADDR[chainId] || ETHERSCAN_ADDR[11155111];
  const hasEtherscanKey = !!process.env.NEXT_PUBLIC_ETHERSCAN_KEY;

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
          {dbPlayer && (
            <>
              <StatRow label={t('game.stats.force')}      value={`${dbPlayer.force} / ${dbPlayer.forceMax ?? 100}`}      color="text-rose-400" />
              <StatRow label={t('game.stats.spells')}     value={`${dbPlayer.spells} / ${dbPlayer.spellsMax ?? 100}`}     color="text-indigo-400" />
              <StatRow label={t('game.stats.reputation')} value={String(dbPlayer.reputation)} color="text-amber-400" />
              <StatRow label={t('game.stats.wallet')}     value={String(dbPlayer.wallet)}     color="text-amber-400" />
            </>
          )}
        </div>
      )}

      {/* Section transactions — TOUJOURS visible dès qu'un joueur est sélectionné */}
      {target && (
        <div className="mt-6 border-t border-slate-700 pt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">
              {t('admin.stats.txHistory')} <span className="text-slate-400">({txs.length})</span>
              {loadingTxs && <span className="ml-2 text-xs text-slate-400">⏳</span>}
            </h3>
            <button className="btn-primary text-xs" onClick={generateInvoice}>📄 {t('admin.stats.invoiceBtn')}</button>
          </div>

          {!hasEtherscanKey && (
            <p className="text-xs text-amber-400 mb-3">⚠ {t('admin.stats.etherscanKeyMissing')}</p>
          )}

          <p className="text-xs text-slate-400 mb-3">
            🔗 <a href={addrBase + target} target="_blank" rel="noopener" className="text-cyan-300 hover:underline">
              {t('admin.stats.viewWalletEtherscan')}
            </a>
          </p>

          {txs.length === 0 ? (
            <div className="bg-slate-800/40 rounded p-4 text-center">
              <p className="text-sm text-slate-400">{t('admin.stats.noTxs')}</p>
              <p className="text-xs text-slate-500 mt-1">{t('admin.stats.noTxsHint')}</p>
            </div>
          ) : (
            /* Timeline chaînée : chaque tx reliée à la suivante par un fil vertical */
            <div className="relative max-h-96 overflow-y-auto pr-2">
              <div className="absolute left-3 top-2 bottom-2 w-px bg-slate-700" aria-hidden />
              <ul className="space-y-3">
                {txs.map((tx, i) => (
                  <li key={tx.hash} className="relative pl-8">
                    <span className={`absolute left-1.5 top-1 w-3 h-3 rounded-full border-2 ${
                      tx.status === 'failed' ? 'bg-rose-500 border-rose-300' :
                      tx.type === 'mint'     ? 'bg-emerald-500 border-emerald-300' :
                      tx.type === 'feed'     ? 'bg-orange-500 border-orange-300' :
                      tx.type === 'buy'      ? 'bg-amber-500 border-amber-300' :
                      tx.type === 'quest'    ? 'bg-cyan-500 border-cyan-300' :
                                               'bg-slate-500 border-slate-300'
                    }`} />
                    <div className="bg-slate-800/60 rounded-lg p-3 hover:bg-slate-800 transition">
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded bg-slate-700 text-slate-200">{tx.type}</span>
                            <span className="text-sm font-semibold text-slate-100 truncate">{tx.label}</span>
                            {tx.status === 'failed' && <span className="text-[10px] text-rose-400">FAILED</span>}
                          </div>
                          <p className="text-xs text-slate-400 mt-1">
                            📅 {new Date(tx.timestamp).toLocaleString()}
                            <span className="mx-2">•</span>
                            💰 <b className="text-amber-300">{tx.valueEth} ETH</b>
                            {tx.gasEth && parseFloat(tx.gasEth) > 0 && (
                              <>
                                <span className="mx-2">•</span>
                                ⛽ <b className="text-slate-300">{tx.gasEth} ETH</b>
                              </>
                            )}
                          </p>
                          <p className="text-[10px] text-slate-500 mt-1 font-mono truncate">
                            {tx.hash}
                          </p>
                        </div>
                        <a className="btn-secondary text-[10px] px-2 py-1 shrink-0"
                          target="_blank" rel="noopener" href={txBase + tx.hash}>
                          {t('admin.stats.viewEtherscan')} ↗
                        </a>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
