'use client';

/**
 * Badge + menu déroulant "Se déconnecter" pour une session Démo/Fiat active (voir
 * lib/effectiveAccount.tsx, docs/DEMO_FIAT.md). Équivalent du <ConnectButton /> RainbowKit (qui
 * propose nativement la déconnexion pour un vrai portefeuille) mais pour les comptes sans
 * portefeuille crypto — n'existait pas jusqu'ici, obligeant à vider le localStorage manuellement
 * pour changer de méthode de connexion (bug corrigé).
 *
 * Rendu `null` si aucune session Démo/Fiat n'est active (rien à afficher pour un vrai portefeuille,
 * qui garde son propre <ConnectButton />).
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { useEffectiveAccount, useEffectiveSessionControls } from '@/lib/effectiveAccount';

export function EffectiveAccountBadge() {
  const { t } = useI18n();
  const router = useRouter();
  const { accountType, isConnected } = useEffectiveAccount();
  const { disconnectSession } = useEffectiveSessionControls();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Ferme le menu si clic en dehors (même comportement qu'un menu natif de portefeuille)
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!isConnected || accountType === 'wallet') return null;

  const handleDisconnect = async () => {
    if (!window.confirm(t('connect.disconnectConfirm'))) return;
    setBusy(true);
    await disconnectSession().catch(() => {});
    setBusy(false);
    setOpen(false);
    router.push('/');
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="text-xs px-3 py-1.5 rounded-full bg-purple-900/40 border border-purple-500/40 text-purple-200 hover:bg-purple-900/60"
        onClick={() => setOpen((o) => !o)}
      >
        🎟️ {t(accountType === 'demo' ? 'connect.demoBadge' : 'connect.fiatBadge')} ▾
      </button>
      {open && (
        <div className="absolute right-0 mt-1 bg-slate-900 border border-purple-500/40 rounded-lg shadow-xl min-w-[170px]" style={{ zIndex: 9999 }}>
          <button
            type="button"
            disabled={busy}
            className="w-full text-left text-sm px-3 py-2 hover:bg-slate-800 rounded-lg disabled:opacity-50"
            onClick={handleDisconnect}
          >
            🚪 {busy ? t('common.loading') : t('connect.disconnect')}
          </button>
        </div>
      )}
    </div>
  );
}
