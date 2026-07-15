/**
 * Configuration wagmi + RainbowKit — supporte Sepolia et Ethereum Mainnet.
 * L'utilisateur choisit son réseau lors de la connexion via le composant NetworkSwitcher.
 */
'use client';

import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { mainnet, sepolia } from 'wagmi/chains';
import { http } from 'wagmi';

const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_KEY || '';
const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo';

export const wagmiConfig = getDefaultConfig({
  appName: 'Horizon ZeldCraft',
  projectId: WC_PROJECT_ID,
  chains: [sepolia, mainnet],
  transports: {
    [sepolia.id]: http(
      ALCHEMY_KEY ? `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}` : undefined
    ),
    [mainnet.id]: http(
      ALCHEMY_KEY ? `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}` : undefined
    ),
  },
  ssr: true,
});

export const CONTRACT_ADDRESSES: Record<number, `0x${string}`> = {
  [sepolia.id]: (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_SEPOLIA || '0x0') as `0x${string}`,
  [mainnet.id]: (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_MAINNET || '0x0') as `0x${string}`,
};
