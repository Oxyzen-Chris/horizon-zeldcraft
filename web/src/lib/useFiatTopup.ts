'use client';

/**
 * Paiement fiat (CB/PayPal/Apple Pay/Google Pay) sans portefeuille crypto — alternative à l'achat
 * de monnaie de jeu contre ETH (voir WalletTopupWidget.tsx/WalletPanel.tsx, docs/DEMO_FIAT.md).
 *
 * Mode simulation (RepRules.fiatSimulationMode, `true` par défaut tant qu'aucune clé Stripe/PayPal
 * réelle n'est fournie — voir ROADMAP.md) : crédite directement le portefeuille de jeu hors-chaîne,
 * sans appel à une API de paiement externe. Une fois de vraies clés Stripe configurées côté
 * serveur, il suffira de remplacer `simulateFiatPayment` par un appel à
 * `web/src/app/api/payments/checkout/route.ts` (Stripe Checkout Session — carte + PayPal + Apple
 * Pay + Google Pay en une seule intégration) sans changer l'UI qui consomme ce hook.
 */
import { useEffect, useState } from 'react';
import { useChainId } from 'wagmi';
import { useEffectiveAccount } from './effectiveAccount';
import {
  applyEffect, logTx, getFiatTopupPresets, DEFAULT_FIAT_TOPUP_PRESETS, getRepRules,
  type FiatTopupPreset, type RepRules,
} from './gameState';

export type FiatProvider = 'card' | 'paypal' | 'apple_pay' | 'google_pay';

export function useFiatTopup(address: string | undefined) {
  const chainId = useChainId();
  const { accountType } = useEffectiveAccount();
  const [presets, setPresets] = useState<FiatTopupPreset[]>(DEFAULT_FIAT_TOPUP_PRESETS);
  const [rules, setRules] = useState<RepRules | null>(null);
  const [isBuying, setIsBuying] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => { getFiatTopupPresets().then(setPresets).catch(() => {}); }, []);
  useEffect(() => { getRepRules().then(setRules).catch(() => {}); }, []);

  const enabledProviders = rules ? {
    card: rules.fiatMethodCardEnabled,
    paypal: rules.fiatMethodPaypalEnabled,
    apple_pay: rules.fiatMethodApplePayEnabled,
    google_pay: rules.fiatMethodGooglePayEnabled,
  } : { card: true, paypal: true, apple_pay: true, google_pay: true };

  /** Bug corrigé : un compte Démo/Fiat (sans vrai portefeuille crypto) pouvait créditer son
   * portefeuille de jeu à volonté via ces boutons (`fiatSimulationMode` créditait toujours, sans
   * jamais être réellement vérifié ci-dessous) — voir RepRules.fiatTopupDemoModeEnabled. Bloqué par
   * défaut (`false`) tant que l'admin n'a pas explicitement activé ce réglage, une fois le vrai
   * mécanisme de paiement (Stripe Checkout) mis en place. Un vrai portefeuille crypto connecté
   * (`accountType === 'wallet'`) n'est jamais concerné : comportement 100% inchangé pour lui. */
  const blockedForDemoAccount = accountType !== 'wallet' && rules != null && rules.fiatTopupDemoModeEnabled !== true;

  /** Simule (ou, plus tard, déclenche un vrai Stripe Checkout) un paiement fiat, puis crédite
   * immédiatement le portefeuille de jeu — jamais d'appel on-chain, aucun gas requis. */
  const buy = async (preset: FiatTopupPreset, provider: FiatProvider) => {
    if (!address || isBuying || blockedForDemoAccount) return;
    setIsBuying(true);
    try {
      // Mode simulation : "paiement" instantané, pas de round-trip réseau réel vers Stripe/PayPal.
      const fakeHash = `fiat-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8)}`;
      await applyEffect(address, { wallet: preset.coins });
      await logTx(address, {
        hash: fakeHash, type: 'fiat_topup',
        label: `Recharge fiat +${preset.coins} coins (${preset.priceLabel}, ${provider})`,
        valueEth: '0', timestamp: Date.now(), chainId, status: 'confirmed',
        offchain: true, provider, valueFiat: preset.priceLabel,
      });
      setFeedback('✅ +' + preset.coins.toLocaleString() + ' 💰');
      setTimeout(() => setFeedback(null), 3000);
    } catch (e) {
      console.error('[useFiatTopup] buy failed:', e);
      setFeedback('❌');
      setTimeout(() => setFeedback(null), 3000);
    } finally {
      setIsBuying(false);
    }
  };

  return { presets, rules, enabledProviders, isBuying, feedback, buy, blockedForDemoAccount };
}
