'use client';

import { useAccount, useChainId, useReadContract, useWriteContract, useBalance } from 'wagmi';
import { keccak256, toBytes, parseEther, formatEther } from 'viem';
import { useState } from 'react';
import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { CONTRACT_ADDRESSES } from '@/lib/wagmi';
import { HORIZON_ABI, FEED_TYPES, WEATHER } from '@/lib/contract';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { NetworkSwitcher } from '@/components/NetworkSwitcher';
import { useI18n } from '@/lib/i18n';

export default function AdminPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const contract = CONTRACT_ADDRESSES[chainId];
  const { t } = useI18n();

  const { data: ownerAddr } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'owner',
    query: { enabled: !!contract },
  });

  const { data: treasuryAddr } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'treasury',
    query: { enabled: !!contract },
  });

  const { data: treasuryBalance } = useBalance({
    address: treasuryAddr as `0x${string}` | undefined,
    query: { enabled: !!treasuryAddr, refetchInterval: 15000 },
  });

  const { data: contractBalance } = useBalance({
    address: contract,
    query: { enabled: !!contract, refetchInterval: 15000 },
  });

  const isOwner = isConnected && ownerAddr && address &&
    (ownerAddr as string).toLowerCase() === address.toLowerCase();

  const { writeContract, isPending } = useWriteContract();

  const [itemKey, setItemKey] = useState('');
  const [itemLabel, setItemLabel] = useState('');
  const [itemPrice, setItemPrice] = useState('0.0001');

  const [questKey, setQuestKey] = useState('');
  const [questLabel, setQuestLabel] = useState('');
  const [questReq, setQuestReq] = useState('0');
  const [questRew, setQuestRew] = useState('100');
  const [questScore, setQuestScore] = useState('50');
  const [questAnswer, setQuestAnswer] = useState('');
  const [questTreasure, setQuestTreasure] = useState('');
  const [questMinDiff, setQuestMinDiff] = useState('0');

  const [npcKey, setNpcKey] = useState('');
  const [npcName, setNpcName] = useState('');
  const [npcDialog, setNpcDialog] = useState('');
  const [npcXp, setNpcXp] = useState('30');
  const [npcQuest, setNpcQuest] = useState('');

  const [trsKey, setTrsKey] = useState('');
  const [trsName, setTrsName] = useState('');
  const [trsXp, setTrsXp] = useState('75');

  const [wldKey, setWldKey] = useState('');
  const [wldName, setWldName] = useState('');
  const [wldXp, setWldXp] = useState('500');

  const [difficulty, setDifficulty] = useState('50');
  const [weather, setWeather] = useState('0');

  const [feedIdx, setFeedIdx] = useState(0);
  const [feedNewPrice, setFeedNewPrice] = useState('0.0001');
  const [cooldownIdx, setCooldownIdx] = useState(0);
  const [cooldownSec, setCooldownSec] = useState('0');

  return (
    <main className="min-h-screen p-6 max-w-4xl mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <Link href="/" className="text-2xl font-bold text-voxlyn-crystal">🐉 {t('app.title')}</Link>
        <div className="flex flex-wrap gap-3">
          <LanguageSwitcher />
          <NetworkSwitcher />
          <ConnectButton />
        </div>
      </header>

      <h1 className="text-3xl font-bold mb-6">⚙️ {t('admin.title')}</h1>

      {!isOwner ? (
        <div className="card"><p>{t('admin.notOwner')}</p></div>
      ) : (
        <div className="space-y-6">
          <section className="card">
            <h2 className="text-xl font-semibold mb-3">💎 Revenus du contrat</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-slate-800/60 rounded-lg p-4">
                <p className="text-xs text-slate-400 uppercase tracking-wide">Solde trésorerie</p>
                <p className="text-2xl font-bold text-emerald-400 mt-1">
                  {treasuryBalance ? `${Number(formatEther(treasuryBalance.value)).toFixed(6)} ${treasuryBalance.symbol}` : '—'}
                </p>
                <p className="text-xs text-slate-500 mt-2 break-all">
                  {treasuryAddr as string}
                </p>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-4">
                <p className="text-xs text-slate-400 uppercase tracking-wide">Solde du contrat</p>
                <p className="text-2xl font-bold text-cyan-400 mt-1">
                  {contractBalance ? `${Number(formatEther(contractBalance.value)).toFixed(6)} ${contractBalance.symbol}` : '—'}
                </p>
                <p className="text-xs text-slate-500 mt-2 break-all">
                  {contract}
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              💡 Les feeds sont transférés directement à la trésorerie. Le solde du contrat n'est utilisé que pour les fonds accidentels (bouton "Retirer les fonds" ci-dessous).
            </p>
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">🛒 {t('admin.addItem')}</h2>
            <div className="grid md:grid-cols-3 gap-3 mb-3">
              <input className="input" placeholder="ID (ex: potion.life)" value={itemKey} onChange={e => setItemKey(e.target.value)} />
              <input className="input" placeholder="Label" value={itemLabel} onChange={e => setItemLabel(e.target.value)} />
              <input className="input" placeholder="Prix ETH" value={itemPrice} onChange={e => setItemPrice(e.target.value)} />
            </div>
            <button className="btn-primary" disabled={isPending || !itemKey || !itemLabel}
              onClick={() => writeContract({
                address: contract, abi: HORIZON_ABI, functionName: 'addCatalogItem',
                args: [keccak256(toBytes(itemKey)), itemLabel, parseEther(itemPrice)],
              })}
            >Ajouter</button>
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">🗡️ Ajouter une quête à énigme</h2>
            <div className="grid md:grid-cols-4 gap-3 mb-3">
              <input className="input" placeholder="ID (ex: riddle.ice)" value={questKey} onChange={e => setQuestKey(e.target.value)} />
              <input className="input" placeholder="Énoncé / question" value={questLabel} onChange={e => setQuestLabel(e.target.value)} />
              <input className="input" placeholder="Réponse (minuscules)" value={questAnswer} onChange={e => setQuestAnswer(e.target.value)} />
              <input className="input" placeholder="ID trésor lié (option.)" value={questTreasure} onChange={e => setQuestTreasure(e.target.value)} />
              <input className="input" placeholder="XP requis" value={questReq} onChange={e => setQuestReq(e.target.value)} />
              <input className="input" placeholder="XP récompense" value={questRew} onChange={e => setQuestRew(e.target.value)} />
              <input className="input" placeholder="Score récompense" value={questScore} onChange={e => setQuestScore(e.target.value)} />
              <input className="input" placeholder="Difficulté min (0-100)" value={questMinDiff} onChange={e => setQuestMinDiff(e.target.value)} />
            </div>
            <button className="btn-primary" disabled={isPending || !questKey || !questLabel || !questAnswer}
              onClick={() => writeContract({
                address: contract, abi: HORIZON_ABI, functionName: 'addQuest',
                args: [
                  keccak256(toBytes(questKey)),
                  questLabel,
                  Number(questReq),
                  Number(questRew),
                  Number(questScore),
                  keccak256(toBytes(questAnswer.toLowerCase().trim())),
                  questTreasure ? keccak256(toBytes(questTreasure)) : ('0x' + '00'.repeat(32)) as `0x${string}`,
                  Number(questMinDiff),
                ],
              })}
            >Ajouter la quête</button>
            <p className="text-xs text-slate-500 mt-2">💡 La réponse est hashée côté client, seul le hash est stocké on-chain.</p>
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">🧙 Ajouter un PNJ</h2>
            <div className="grid md:grid-cols-3 gap-3 mb-3">
              <input className="input" placeholder="ID (ex: npc.zora)" value={npcKey} onChange={e => setNpcKey(e.target.value)} />
              <input className="input" placeholder="Nom" value={npcName} onChange={e => setNpcName(e.target.value)} />
              <input className="input" placeholder="XP donné" value={npcXp} onChange={e => setNpcXp(e.target.value)} />
              <input className="input md:col-span-2" placeholder="Dialogue" value={npcDialog} onChange={e => setNpcDialog(e.target.value)} />
              <input className="input" placeholder="ID quête liée (optionnel)" value={npcQuest} onChange={e => setNpcQuest(e.target.value)} />
            </div>
            <button className="btn-primary" disabled={isPending || !npcKey || !npcName}
              onClick={() => writeContract({
                address: contract, abi: HORIZON_ABI, functionName: 'addNpc',
                args: [
                  keccak256(toBytes(npcKey)), npcName, npcDialog, Number(npcXp),
                  npcQuest ? keccak256(toBytes(npcQuest)) : ('0x' + '00'.repeat(32)) as `0x${string}`,
                ],
              })}
            >Ajouter le PNJ</button>
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">💎 Ajouter un trésor</h2>
            <div className="grid md:grid-cols-3 gap-3 mb-3">
              <input className="input" placeholder="ID (ex: chest.ruby)" value={trsKey} onChange={e => setTrsKey(e.target.value)} />
              <input className="input" placeholder="Nom" value={trsName} onChange={e => setTrsName(e.target.value)} />
              <input className="input" placeholder="XP bonus" value={trsXp} onChange={e => setTrsXp(e.target.value)} />
            </div>
            <button className="btn-primary" disabled={isPending || !trsKey || !trsName}
              onClick={() => writeContract({
                address: contract, abi: HORIZON_ABI, functionName: 'addTreasure',
                args: [keccak256(toBytes(trsKey)), trsName, Number(trsXp)],
              })}
            >Ajouter</button>
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">🗺️ Ajouter un monde</h2>
            <div className="grid md:grid-cols-3 gap-3 mb-3">
              <input className="input" placeholder="ID (ex: world.stargate)" value={wldKey} onChange={e => setWldKey(e.target.value)} />
              <input className="input" placeholder="Nom" value={wldName} onChange={e => setWldName(e.target.value)} />
              <input className="input" placeholder="XP requis" value={wldXp} onChange={e => setWldXp(e.target.value)} />
            </div>
            <button className="btn-primary" disabled={isPending || !wldKey || !wldName}
              onClick={() => writeContract({
                address: contract, abi: HORIZON_ABI, functionName: 'addWorld',
                args: [keccak256(toBytes(wldKey)), wldName, Number(wldXp)],
              })}
            >Ajouter</button>
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">⚔️ Difficulté globale du jeu</h2>
            <div className="flex gap-3 items-center mb-3">
              <input type="range" min="0" max="100" value={difficulty}
                onChange={e => setDifficulty(e.target.value)} className="flex-1" />
              <span className="w-16 text-center font-bold text-amber-400">{difficulty}/100</span>
              <button className="btn-primary" disabled={isPending}
                onClick={() => writeContract({
                  address: contract, abi: HORIZON_ABI, functionName: 'setDifficulty',
                  args: [Number(difficulty)],
                })}
              >Appliquer</button>
            </div>
            <p className="text-xs text-slate-500">Les quêtes avec <code>minDifficulty</code> supérieur seront bloquées.</p>
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">🌤️ Conditions météo</h2>
            <div className="flex gap-3 items-center">
              <select className="input flex-1" value={weather} onChange={e => setWeather(e.target.value)}>
                {WEATHER.map((w, i) => <option key={i} value={i}>{w.emoji} {w.label}</option>)}
              </select>
              <button className="btn-primary" disabled={isPending}
                onClick={() => writeContract({
                  address: contract, abi: HORIZON_ABI, functionName: 'setWeather',
                  args: [Number(weather)],
                })}
              >Changer la météo</button>
            </div>
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">💰 {t('admin.setPrice')}</h2>
            <div className="grid md:grid-cols-3 gap-3 mb-3">
              <select className="input" value={feedIdx} onChange={e => setFeedIdx(Number(e.target.value))}>
                {FEED_TYPES.map((f, i) => <option key={f} value={i}>{f}</option>)}
              </select>
              <input className="input" placeholder="Nouveau prix ETH" value={feedNewPrice} onChange={e => setFeedNewPrice(e.target.value)} />
              <button className="btn-primary" disabled={isPending}
                onClick={() => writeContract({
                  address: contract, abi: HORIZON_ABI, functionName: 'setFeedPrice',
                  args: [feedIdx, parseEther(feedNewPrice)],
                })}
              >Appliquer</button>
            </div>
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">⏱️ Cooldowns de nourrissage (secondes)</h2>
            <p className="text-sm text-slate-400 mb-3">Astuce : mets <code>0</code> pour désactiver un cooldown (tests). Défauts prod : Daily=72000, Weekly=518400, Monthly=2419200, Yearly=30240000.</p>
            <div className="grid md:grid-cols-3 gap-3 mb-3">
              <select className="input" value={cooldownIdx} onChange={e => setCooldownIdx(Number(e.target.value))}>
                {FEED_TYPES.map((f, i) => <option key={f} value={i}>{f}</option>)}
              </select>
              <input className="input" placeholder="Cooldown en secondes" value={cooldownSec} onChange={e => setCooldownSec(e.target.value)} />
              <button className="btn-primary" disabled={isPending}
                onClick={() => writeContract({
                  address: contract, abi: HORIZON_ABI, functionName: 'setFeedCooldown',
                  args: [cooldownIdx, BigInt(cooldownSec)],
                })}
              >Appliquer</button>
            </div>
          </section>

          <section className="card flex flex-wrap gap-3">
            <button className="btn-secondary" onClick={() => writeContract({
              address: contract, abi: HORIZON_ABI, functionName: 'withdraw', args: [],
            })}>💸 {t('admin.withdraw')}</button>
            <button className="btn-danger" onClick={() => writeContract({
              address: contract, abi: HORIZON_ABI, functionName: 'pause', args: [],
            })}>⏸ {t('admin.pause')}</button>
            <button className="btn-secondary" onClick={() => writeContract({
              address: contract, abi: HORIZON_ABI, functionName: 'unpause', args: [],
            })}>▶ {t('admin.unpause')}</button>
          </section>
        </div>
      )}

      <style jsx>{`
        .input { background: #1e293b; border: 1px solid #475569; border-radius: 0.375rem; padding: 0.5rem 0.75rem; color: #e2e8f0; }
      `}</style>
    </main>
  );
}
