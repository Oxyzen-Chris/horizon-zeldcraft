'use client';

import { useAccount, useChainId, useReadContract, useWriteContract } from 'wagmi';
import { keccak256, toBytes, parseEther } from 'viem';
import { useState } from 'react';
import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { CONTRACT_ADDRESSES } from '@/lib/wagmi';
import { HORIZON_ABI, FEED_TYPES } from '@/lib/contract';
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

  const [feedIdx, setFeedIdx] = useState(0);
  const [feedNewPrice, setFeedNewPrice] = useState('0.0001');

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
            <h2 className="text-xl font-semibold mb-3">🗡️ {t('admin.addQuest')}</h2>
            <div className="grid md:grid-cols-4 gap-3 mb-3">
              <input className="input" placeholder="ID" value={questKey} onChange={e => setQuestKey(e.target.value)} />
              <input className="input" placeholder="Label" value={questLabel} onChange={e => setQuestLabel(e.target.value)} />
              <input className="input" placeholder="XP requis" value={questReq} onChange={e => setQuestReq(e.target.value)} />
              <input className="input" placeholder="XP récompense" value={questRew} onChange={e => setQuestRew(e.target.value)} />
            </div>
            <button className="btn-primary" disabled={isPending || !questKey || !questLabel}
              onClick={() => writeContract({
                address: contract, abi: HORIZON_ABI, functionName: 'addQuest',
                args: [keccak256(toBytes(questKey)), questLabel, Number(questReq), Number(questRew)],
              })}
            >Ajouter</button>
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
