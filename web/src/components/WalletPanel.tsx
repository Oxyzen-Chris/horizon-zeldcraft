'use client';

import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useSendTransaction, useWaitForTransactionReceipt, useChainId } from 'wagmi';
import { parseEther } from 'viem';
import { HORIZON_ABI } from '@/lib/contract';
import { applyEffect, logTx } from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';

/**
 * Rubrique Portefeuille : solde monnaie du jeu + bouton "Recharger" qui ouvre
 * une popup permettant d'acheter de la monnaie du jeu en payant en ETH sur
 * Sepolia (test) ou Mainnet (prod). Les ETH sont envoyés à la treasury du contrat.
 */
type Preset = { eur: number; eth: string; coins: number };

// Presets calibrés autour de ~2500€/ETH — mis à jour ici si besoin (paramétrable admin plus tard)
const PRESETS: Preset[] = [
  { eur: 10,  eth: '0.004', coins: 1000  },
  { eur: 20,  eth: '0.008', coins: 2000  },
  { eur: 50,  eth: '0.020', coins: 5000  },
  { eur: 100, eth: '0.040', coins: 10000 },
];

export function WalletPanel({ contract, wallet }: { contract: `0x${string}`; wallet: number }) {
  const { t } = useI18n();
  const { address } = useAccount();
  const chainId = useChainId();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Preset | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const { data: treasury } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'treasury',
    query: { enabled: !!contract },
  });

  const { sendTransaction, data: hash, isPending, reset } = useSendTransaction();
  const { isSuccess, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });

  // Crédite le portefeuille de jeu une fois la tx confirmée (guard via ref)
  const [credited, setCredited] = useState<string | null>(null);
  useEffect(() => {
    if (!isSuccess || !selected || !address || !hash) return;
    if (credited === hash) return;
    setCredited(hash);
    (async () => {
      try {
        await applyEffect(address, { wallet: selected.coins });
        await logTx(address, {
          hash, type: 'buy',
          label: `Top-up wallet +${selected.coins} coins (${selected.eur}€)`,
          valueEth: selected.eth, timestamp: Date.now(),
          chainId, status: 'confirmed',
        });
        setFeedback('✅ +' + selected.coins + ' 💰');
        setSelected(null);
        setOpen(false);
        reset();
        setTimeout(() => setFeedback(null), 3000);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [isSuccess, selected, address, hash, credited, chainId, reset]);

  const buy = (p: Preset) => {
    if (!treasury || !address) return;
    setSelected(p);
    sendTransaction({
      to: treasury as `0x${string}`,
      value: parseEther(p.eth),
    });
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">💰 {t('game.wallet.title')}</h3>
        <button className="btn-primary text-sm" onClick={() => setOpen(true)} disabled={!treasury}>
          + {t('game.wallet.topUp')}
        </button>
      </div>
      <p className="text-sm text-slate-400">{t('game.wallet.balance')} :</p>
      <p className="text-4xl font-bold text-amber-400 mt-1">{wallet.toLocaleString()} 💰</p>
      {feedback && <p className="text-sm text-emerald-400 mt-2">{feedback}</p>}

      {open && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => !isPending && !isConfirming && setOpen(false)}>
          <div className="bg-slate-900 border-2 border-amber-500 rounded-xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-bold mb-2">💰 {t('game.wallet.topUp')}</h3>
            <p className="text-sm text-slate-400 mb-4">
              {t('game.wallet.topUpHint')} · {chainId === 1 ? 'Ethereum Mainnet' : 'Sepolia Testnet'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map(p => (
                <button
                  key={p.eur}
                  className="bg-slate-800 hover:bg-slate-700 border border-amber-500/40 rounded p-3 text-center transition disabled:opacity-50"
                  disabled={isPending || isConfirming}
                  onClick={() => buy(p)}
                >
                  <p className="text-2xl font-bold text-amber-400">{p.eur} €</p>
                  <p className="text-xs text-slate-400">≈ {p.eth} ETH</p>
                  <p className="text-xs text-emerald-400 mt-1">+ {p.coins.toLocaleString()} 💰</p>
                </button>
              ))}
            </div>
            {(isPending || isConfirming) && (
              <p className="text-sm text-cyan-400 mt-4 text-center">
                {isPending ? '📝 ' + t('game.wallet.signing') : '⏳ ' + t('game.wallet.confirming')}
              </p>
            )}
            <div className="flex justify-end mt-4">
              <button className="btn-secondary text-sm" onClick={() => setOpen(false)} disabled={isPending || isConfirming}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
