'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { NetworkSwitcher } from '@/components/NetworkSwitcher';
import { SynkSkin } from '@/components/SynkSkin';
import { NoWalletAccessPanel } from '@/components/NoWalletAccessPanel';
import { EffectiveAccountBadge } from '@/components/EffectiveAccountBadge';
import { useI18n } from '@/lib/i18n';
import { useEffectiveAccount } from '@/lib/effectiveAccount';
import { getRepRules } from '@/lib/gameState';
import { consumeDemoExpiredFlag } from '@/components/DemoSessionTimerWidget';

export default function Home() {
  const { isConnected, accountType } = useEffectiveAccount();
  // Vrai portefeuille crypto (wagmi brut, PAS useEffectiveAccount() qui renvoie aussi
  // accountType==='wallet' quand rien n'est connecté du tout — voir commentaire gameState.ts).
  const { isConnected: walletConnected } = useAccount();
  const { t } = useI18n();
  const [walletConnectEnabled, setWalletConnectEnabled] = useState(true);
  const [demoExpiredMessage, setDemoExpiredMessage] = useState(false);

  useEffect(() => { getRepRules().then((r) => setWalletConnectEnabled(r.walletConnectEnabled !== false)).catch(() => {}); }, []);
  useEffect(() => {
    // ⚠️ Ne JAMAIS écraser avec `false` : en développement, React 18 StrictMode invoque cet effet
    // deux fois au montage — `consumeDemoExpiredFlag()` retire le flag dès la 1ère lecture, donc
    // la 2e lecture renverrait toujours `false` et effacerait silencieusement le message (bug
    // constaté via Playwright). On ne met à jour l'état QUE si le flag était bien présent.
    if (consumeDemoExpiredFlag()) setDemoExpiredMessage(true);
  }, []);

  // Le bouton "Connecter le portefeuille" reste TOUJOURS visible pour un joueur déjà connecté
  // avec un vrai portefeuille (ne le déconnecte jamais) — seule la connexion d'un NOUVEAU
  // portefeuille peut être désactivée par l'admin (menu Administration § Écran d'accueil).
  const showConnectButton = walletConnected || walletConnectEnabled;

  return (
    <main className="min-h-screen p-6 max-w-5xl mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-4 mb-12">
        <h1 className="text-3xl md:text-4xl font-bold text-voxlyn-crystal">
          🐉 {t('app.title')}
        </h1>
        <div className="flex flex-wrap gap-3 items-center">
          <LanguageSwitcher />
          <NetworkSwitcher />
          {accountType !== 'wallet' && isConnected ? <EffectiveAccountBadge /> : (showConnectButton && <ConnectButton />)}
        </div>
      </header>

      <section className="card text-center">
        <div className="flex justify-center mb-6">
          <SynkSkin stage={3} size={220} />
        </div>
        <h2 className="text-2xl font-bold mb-3">{t('connect.title')}</h2>
        <p className="text-slate-300 mb-6 max-w-xl mx-auto">{t('app.subtitle')}</p>
        <p className="text-slate-400 mb-6">{t('connect.description')}</p>

        {isConnected ? (
          <Link href="/game" className="btn-primary inline-block">
            → {t('nav.game')}
          </Link>
        ) : (
          <>
            {showConnectButton && <div className="flex justify-center"><ConnectButton /></div>}
            {demoExpiredMessage && (
              <p className="text-sm text-amber-300 bg-amber-950/40 border border-amber-700/50 rounded p-2 mt-4 max-w-xl mx-auto">
                ⏳ {t('home.demo.sessionExpired')}
              </p>
            )}
            <NoWalletAccessPanel />
          </>
        )}
      </section>

      <section className="mt-8 grid md:grid-cols-3 gap-4">
        {[0, 2, 4].map((s) => (
          <div key={s} className="card text-center">
            <SynkSkin stage={s} size={120} />
            <p className="mt-2 text-sm text-slate-400">
              {t(`stage.${['egg','hatched','juvenile','adult','ancient'][s]}`)}
            </p>
          </div>
        ))}
      </section>

      <footer className="mt-12 text-center text-sm text-slate-500">
        <Link href="/admin" className="hover:text-slate-300">{t('nav.admin')}</Link>
        {' • '}
        <a href="https://github.com" className="hover:text-slate-300">{t('nav.docs')}</a>
      </footer>
    </main>
  );
}
