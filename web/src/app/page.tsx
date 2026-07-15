'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import Link from 'next/link';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { NetworkSwitcher } from '@/components/NetworkSwitcher';
import { VoxlynSkin } from '@/components/VoxlynSkin';
import { useI18n } from '@/lib/i18n';

export default function Home() {
  const { isConnected } = useAccount();
  const { t } = useI18n();

  return (
    <main className="min-h-screen p-6 max-w-5xl mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-4 mb-12">
        <h1 className="text-3xl md:text-4xl font-bold text-voxlyn-crystal">
          🐉 {t('app.title')}
        </h1>
        <div className="flex flex-wrap gap-3 items-center">
          <LanguageSwitcher />
          <NetworkSwitcher />
          <ConnectButton />
        </div>
      </header>

      <section className="card text-center">
        <div className="flex justify-center mb-6">
          <VoxlynSkin stage={3} size={220} />
        </div>
        <h2 className="text-2xl font-bold mb-3">{t('connect.title')}</h2>
        <p className="text-slate-300 mb-6 max-w-xl mx-auto">{t('app.subtitle')}</p>
        <p className="text-slate-400 mb-6">{t('connect.description')}</p>

        {isConnected ? (
          <Link href="/game" className="btn-primary inline-block">
            → {t('nav.game')}
          </Link>
        ) : (
          <div className="flex justify-center"><ConnectButton /></div>
        )}
      </section>

      <section className="mt-8 grid md:grid-cols-3 gap-4">
        {[0, 2, 4].map((s) => (
          <div key={s} className="card text-center">
            <VoxlynSkin stage={s} size={120} />
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
