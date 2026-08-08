'use client';

/**
 * Bloc de boutons "Paiement fiat" (CB/PayPal/Apple Pay/Google Pay) — réutilisé par
 * WalletTopupWidget.tsx (fenêtre flottante) et WalletPanel.tsx (section fixe "Portefeuille").
 * Voir useFiatTopup.ts pour la logique de crédit (mode simulation tant qu'aucune clé Stripe/
 * PayPal réelle n'est fournie).
 */
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useFiatTopup, type FiatProvider } from '@/lib/useFiatTopup';

const PROVIDER_ICON: Record<FiatProvider, string> = {
  card: '💳', paypal: '🅿️', apple_pay: '🍎', google_pay: '🇬',
};

export function FiatTopupPanel({ address }: { address: string | undefined }) {
  const { t } = useI18n();
  const { presets, enabledProviders, isBuying, feedback, buy } = useFiatTopup(address);
  const [provider, setProvider] = useState<FiatProvider>('card');

  const providers = (['card', 'paypal', 'apple_pay', 'google_pay'] as FiatProvider[])
    .filter((p) => enabledProviders[p]);

  if (providers.length === 0 || !address) return null;

  return (
    <div className="mt-3 pt-3 border-t border-slate-700/60">
      <p className="text-[11px] text-slate-400 mb-2">💳 {t('game.walletTopup.fiatTitle')}</p>
      <div className="flex gap-1.5 mb-2 flex-wrap">
        {providers.map((p) => (
          <button
            key={p}
            className={`text-[11px] px-2 py-1 rounded border transition ${
              provider === p
                ? 'bg-emerald-700/40 border-emerald-500 text-emerald-200'
                : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'
            }`}
            onClick={() => setProvider(p)}
          >
            {PROVIDER_ICON[p]} {t(`game.walletTopup.provider.${p}`)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {presets.map((p) => (
          <button
            key={p.priceLabel}
            className="bg-slate-800 hover:bg-slate-700 border border-emerald-500/40 rounded p-2 text-center transition disabled:opacity-50"
            disabled={isBuying}
            onClick={() => buy(p, provider)}
          >
            <p className="text-sm font-bold text-emerald-400">{p.priceLabel}</p>
            <p className="text-[10px] text-emerald-300 mt-0.5">+ {p.coins.toLocaleString()} 💰</p>
          </button>
        ))}
      </div>
      {isBuying && <p className="text-xs text-cyan-400 mt-2 text-center">⏳ {t('game.walletTopup.processing')}</p>}
      {feedback && <p className="text-xs text-emerald-400 mt-2 text-center">{feedback}</p>}
    </div>
  );
}
