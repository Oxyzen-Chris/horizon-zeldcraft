'use client';

/**
 * Boutons "Accès Démo" et "Jouer sans portefeuille" affichés sur l'écran d'accueil, à côté du
 * <ConnectButton /> RainbowKit — voir docs/DEMO_FIAT.md. Permet de jouer SANS Metamask/Rainbow/
 * WalletConnect/Ledger/etc., via une identité Firebase (Google/e-mail/anonyme) transformée en
 * adresse virtuelle (voir deriveVirtualAddress côté gameState.ts) et portée par
 * `EffectiveAccountProvider` (voir lib/effectiveAccount.tsx) : le reste du jeu (tous les widgets)
 * fonctionne alors exactement comme pour un vrai portefeuille, sans aucune modification.
 *
 * Deux entrées indépendantes, chacune activable/désactivable dans le menu Administration :
 *  - 🎟️ Accès Démo : gratuit, en avant-première, approuvé par l'admin (Google/e-mail) OU
 *    totalement anonyme (aucune authentification) — toutes deux plafonnées en connexions
 *    simultanées (RepRules.demoMaxConcurrentSessions / demoAnonymousMaxConcurrentSessions).
 *  - 💳 Jouer sans portefeuille : paiement fiat (CB/PayPal/Apple Pay/Google Pay, mode simulation
 *    tant qu'aucune clé Stripe réelle n'est configurée) — accès immédiat, sans plafond ni
 *    validation admin, l'achat de monnaie de jeu se fait ensuite normalement dans le jeu (voir
 *    FiatTopupPanel.tsx).
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { useEffectiveSessionControls } from '@/lib/effectiveAccount';
import {
  getRepRules, deriveVirtualAddress, requestDemoAccess, getDemoAccessRequest,
  countActiveDemoSessions, registerDemoSession, type RepRules,
} from '@/lib/gameState';
import { getFirebaseAuth, ensureAnonSignIn, signInWithGoogle, signInWithEmail } from '@/lib/firebase';

type ModalKind = null | 'demo' | 'fiat';

export function NoWalletAccessPanel() {
  const { t } = useI18n();
  const router = useRouter();
  const { setSession } = useEffectiveSessionControls();
  const [rules, setRules] = useState<RepRules | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => { getRepRules().then(setRules).catch(() => {}); }, []);

  const closeModal = () => { setModal(null); setMessage(null); setBusy(false); setEmail(''); setPassword(''); };

  // ─── Accès Démo anonyme (aucune authentification, plafond bas) ───
  const startAnonymousDemo = async () => {
    setBusy(true); setMessage(null);
    try {
      // ⚠️ L'authentification anonyme DOIT précéder la lecture de `demoSessions` : les règles
      // RTDB exigent `auth != null` sur ce chemin (voir docs/FIREBASE_CHAT.md § 4). Sur un
      // navigateur neuf (aucune session Firebase persistée), lire le compteur AVANT de
      // s'authentifier levait un "Permission denied" et bloquait tout accès Démo anonyme.
      const user = await ensureAnonSignIn();
      if (!user) { setMessage(t('home.demo.authError')); setBusy(false); return; }
      const count = await countActiveDemoSessions('anon');
      const cap = rules?.demoAnonymousMaxConcurrentSessions ?? 40;
      if (count >= cap) { setMessage(t('home.demo.fullAnonymous')); setBusy(false); return; }
      const address = deriveVirtualAddress(user.uid) as `0x${string}`;
      await registerDemoSession('anon', user.uid);
      setSession({ kind: 'demo', uid: user.uid, address, demoMode: 'anonymous' });
      router.push('/game');
    } catch (e) {
      console.error('[NoWalletAccessPanel] startAnonymousDemo failed:', e);
      setMessage(t('home.demo.authError'));
      setBusy(false);
    }
  };

  // ─── Accès Démo approuvé (Google) — demande à valider par l'admin si pas déjà fait ───
  const startApprovedDemo = async () => {
    setBusy(true); setMessage(null);
    try {
      const user = await signInWithGoogle();
      if (!user) { setMessage(t('home.demo.authError')); setBusy(false); return; }
      const address = deriveVirtualAddress(user.uid) as `0x${string}`;
      const existing = await getDemoAccessRequest(user.uid);
      if (existing?.status === 'rejected') { setMessage(t('home.demo.rejected')); setBusy(false); return; }
      if (existing?.status !== 'approved') {
        await requestDemoAccess({
          uid: user.uid, address, displayName: user.displayName || undefined,
          email: user.email || undefined, method: 'google',
        });
        setMessage(t('home.demo.pendingApproval'));
        setBusy(false);
        return;
      }
      const count = await countActiveDemoSessions('demo');
      const cap = rules?.demoMaxConcurrentSessions ?? 90;
      if (count >= cap) { setMessage(t('home.demo.fullApproved')); setBusy(false); return; }
      await registerDemoSession('demo', user.uid);
      setSession({ kind: 'demo', uid: user.uid, address, demoMode: 'approved', displayName: user.displayName || undefined });
      router.push('/game');
    } catch (e) {
      console.error('[NoWalletAccessPanel] startApprovedDemo failed:', e);
      setMessage(t('home.demo.authError'));
      setBusy(false);
    }
  };

  // ─── Paiement fiat sans portefeuille (Google ou e-mail) — accès immédiat, sans plafond ───
  const startFiatWithGoogle = async () => {
    setBusy(true); setMessage(null);
    try {
      const user = await signInWithGoogle();
      if (!user) { setMessage(t('home.demo.authError')); setBusy(false); return; }
      const address = deriveVirtualAddress(user.uid) as `0x${string}`;
      setSession({ kind: 'fiat', uid: user.uid, address, displayName: user.displayName || undefined });
      router.push('/game');
    } catch (e) {
      console.error('[NoWalletAccessPanel] startFiatWithGoogle failed:', e);
      setMessage(t('home.demo.authError'));
      setBusy(false);
    }
  };

  const startFiatWithEmail = async () => {
    if (!email || !password) return;
    setBusy(true); setMessage(null);
    try {
      const user = await signInWithEmail(email, password);
      if (!user) { setMessage(t('home.demo.authError')); setBusy(false); return; }
      const address = deriveVirtualAddress(user.uid) as `0x${string}`;
      setSession({ kind: 'fiat', uid: user.uid, address, displayName: user.email || undefined });
      router.push('/game');
    } catch (e) {
      console.error('[NoWalletAccessPanel] startFiatWithEmail failed:', e);
      setMessage(t('home.demo.authError'));
      setBusy(false);
    }
  };

  if (!getFirebaseAuth()) return null; // Firebase non configuré — mêmes conditions que le reste du jeu
  if (!rules) return null;
  if (!rules.demoAccessEnabled && !rules.fiatPaymentEnabled) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2 justify-center mt-4">
        {rules.demoAccessEnabled && (
          <button className="btn-secondary text-sm" onClick={() => setModal('demo')}>
            🎟️ {t('home.demo.button')}
          </button>
        )}
        {rules.fiatPaymentEnabled && (
          <button className="btn-secondary text-sm" onClick={() => setModal('fiat')}>
            💳 {t('home.fiat.button')}
          </button>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4" style={{ zIndex: 9999 }}
             onClick={() => !busy && closeModal()}>
          <div className="bg-slate-900 border-2 border-purple-500 rounded-xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            {modal === 'demo' ? (
              <>
                <h3 className="text-xl font-bold mb-2">🎟️ {t('home.demo.title')}</h3>
                <p className="text-sm text-slate-400 mb-4">{t('home.demo.description')}</p>
                <div className="flex flex-col gap-2">
                  {rules.demoAnonymousEnabled && (
                    <button className="btn-secondary text-sm" disabled={busy} onClick={startAnonymousDemo}>
                      👤 {t('home.demo.anonymousButton')}
                    </button>
                  )}
                  <button className="btn-primary text-sm" disabled={busy} onClick={startApprovedDemo}>
                    🔵 {t('home.demo.googleButton')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-xl font-bold mb-2">💳 {t('home.fiat.title')}</h3>
                <p className="text-sm text-slate-400 mb-4">{t('home.fiat.description')}</p>
                <div className="flex flex-col gap-2 mb-3">
                  <button className="btn-primary text-sm" disabled={busy} onClick={startFiatWithGoogle}>
                    🔵 {t('home.demo.googleButton')}
                  </button>
                </div>
                <p className="text-xs text-slate-500 mb-2 text-center">— {t('common.or')} —</p>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email"
                  placeholder={t('home.fiat.emailPlaceholder')}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 mb-2 text-sm" />
                <input value={password} onChange={(e) => setPassword(e.target.value)} type="password"
                  placeholder={t('home.fiat.passwordPlaceholder')}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 mb-3 text-sm" />
                <button className="btn-secondary text-sm w-full" disabled={busy || !email || !password} onClick={startFiatWithEmail}>
                  ✉️ {t('home.fiat.emailButton')}
                </button>
              </>
            )}
            {message && <p className="text-sm text-amber-300 mt-3 text-center">{message}</p>}
            <div className="flex justify-end mt-4">
              <button className="btn-secondary text-sm" disabled={busy} onClick={closeModal}>{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
