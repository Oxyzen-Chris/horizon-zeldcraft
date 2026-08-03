'use client';

import { useEffect, useState } from 'react';
import { useAccount, useReadContract, useSendTransaction, useWaitForTransactionReceipt, useChainId } from 'wagmi';
import { parseEther } from 'viem';
import { HORIZON_ABI } from '@/lib/contract';
import { applyEffect, logTx, getTopupPresets, DEFAULT_TOPUP_PRESETS, subscribePlayer, type TopupPreset, type PlayerState } from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';
import { useWindowZIndex } from '@/lib/windowZOrder';
import { useDraggableWidget } from '@/lib/useDraggableWidget';
import { WidgetContextMenu } from './WidgetContextMenu';

const POS_KEY = 'zc.walletTopupWidgetPos';
const COLLAPSED_KEY = 'zc.walletTopupWidgetCollapsed';

/**
 * Fenêtre flottante et déplaçable "Rechargement du portefeuille" — duplique WalletPanel.tsx
 * (section fixe "Portefeuille" de la page) dans une fenêtre repositionnable, même esprit que
 * StatsWidget/InventoryWidget/ShopWidget qui dupliquent chacun leur section fixe respective.
 * Reprend exactement le même mécanisme d'achat de monnaie de jeu contre ETH (presets configurés
 * par l'admin dans `admin.topup` / TopupPresetsPanel, `treasury` on-chain, `applyEffect` +
 * `logTx` hors-chaîne) : purement additif, WalletPanel.tsx n'est ni retiré ni modifié, aucune
 * régression sur son fonctionnement existant.
 */
export function WalletTopupWidget({ contract, enabled = true }: { contract: `0x${string}`; enabled?: boolean }) {
  const { t, currency } = useI18n();
  const { address } = useAccount();
  const chainId = useChainId();
  const { z, bringToFront } = useWindowZIndex();
  const {
    collapsed, pos, onPointerDown, onPointerMove, onPointerUp, onToggleClick, toggleCollapsed,
    containerRef, menuPos, onContextMenu, closeContextMenu, resetPosition,
  } = useDraggableWidget({
    posKey: POS_KEY, collapsedKey: COLLAPSED_KEY,
    defaultPos: () => ({ x: window.innerWidth - 300, y: 400 }),
    onExpand: bringToFront,
  });

  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [presets, setPresets] = useState<TopupPreset[]>(DEFAULT_TOPUP_PRESETS);
  const [selected, setSelected] = useState<TopupPreset | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => { getTopupPresets().then(setPresets).catch(() => {}); }, []);
  useEffect(() => {
    if (!address) return;
    return subscribePlayer(address, setPlayer);
  }, [address]);

  const { data: treasury } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'treasury',
    query: { enabled: !!contract },
  });

  const { sendTransaction, data: hash, isPending, reset } = useSendTransaction();
  const { isSuccess, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });

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
          label: `Top-up wallet +${selected.coins} coins (${selected.fiat}${currency})`,
          valueEth: selected.eth, timestamp: Date.now(),
          chainId, status: 'confirmed',
        });
        setFeedback('✅ +' + selected.coins + ' 💰');
        setSelected(null);
        reset();
        setTimeout(() => setFeedback(null), 3000);
      } catch (e) {
        console.error('[walletTopupWidget] credit failed:', e);
      }
    })();
  }, [isSuccess, selected, address, hash, credited, chainId, reset, currency]);

  const buy = (p: TopupPreset) => {
    if (!treasury || !address) return;
    setSelected(p);
    sendTransaction({ to: treasury as `0x${string}`, value: parseEther(p.eth) });
  };

  if (!enabled || !address || !pos) return null;

  if (collapsed) {
    return (
      <>
        <button
          ref={containerRef}
          className="fixed z-40 w-14 h-14 rounded-full bg-slate-900 border-2 border-amber-500 text-2xl shadow-lg flex items-center justify-center"
          style={{ left: pos.x, top: pos.y, zIndex: z }}
          onPointerDownCapture={bringToFront}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onClick={onToggleClick}
          onContextMenu={onContextMenu}
          title={t('game.walletTopup.widgetTitle')}
        >💰</button>
        <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      </>
    );
  }

  return (
    <div
      ref={containerRef}
      className="fixed z-40 w-80 bg-slate-900 border-2 border-amber-500 rounded-xl shadow-xl select-none"
      style={{ left: pos.x, top: pos.y, zIndex: z }}
      onPointerDownCapture={bringToFront}
      onContextMenu={onContextMenu}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-amber-900/30 rounded-t-xl cursor-move"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      >
        <span className="text-sm font-semibold truncate">💰 {t('game.walletTopup.widgetTitle')}</span>
        <button className="text-xs opacity-70 hover:opacity-100 shrink-0 ml-2" onClick={toggleCollapsed}>✕</button>
      </div>
      <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      <div className="p-3">
        <p className="text-xs text-slate-400">{t('game.wallet.balance')} :</p>
        <p className="text-2xl font-bold text-amber-400 mt-1 mb-2">{(player?.wallet ?? 0).toLocaleString()} 💰</p>
        <p className="text-[10px] text-slate-400 mb-2">
          {t('game.wallet.topUpHint')} · {chainId === 1 ? 'Ethereum Mainnet' : 'Sepolia Testnet'}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {presets.map((p) => (
            <button
              key={p.fiat}
              className="bg-slate-800 hover:bg-slate-700 border border-amber-500/40 rounded p-2 text-center transition disabled:opacity-50"
              disabled={isPending || isConfirming || !treasury}
              onClick={() => buy(p)}
            >
              <p className="text-base font-bold text-amber-400">{p.fiat} {currency}</p>
              <p className="text-[10px] text-slate-400">≈ {p.eth} ETH</p>
              <p className="text-[10px] text-emerald-400 mt-0.5">+ {p.coins.toLocaleString()} 💰</p>
            </button>
          ))}
        </div>
        {(isPending || isConfirming) && (
          <p className="text-xs text-cyan-400 mt-3 text-center">
            {isPending ? '📝 ' + t('game.wallet.signing') : '⏳ ' + t('game.wallet.confirming')}
          </p>
        )}
        {feedback && <p className="text-xs text-emerald-400 mt-2 text-center">{feedback}</p>}
      </div>
    </div>
  );
}
