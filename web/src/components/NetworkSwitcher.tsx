'use client';

import { useAccount, useSwitchChain, useChainId } from 'wagmi';
import { sepolia, mainnet } from 'wagmi/chains';
import { useI18n } from '@/lib/i18n';

export function NetworkSwitcher() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { t } = useI18n();

  if (!isConnected) return null;

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-slate-400">{t('connect.network')} :</label>
      <select
        value={chainId}
        onChange={(e) => switchChain({ chainId: Number(e.target.value) as any })}
        className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm"
      >
        <option value={sepolia.id}>{t('network.sepolia')}</option>
        <option value={mainnet.id}>{t('network.mainnet')}</option>
      </select>
    </div>
  );
}
