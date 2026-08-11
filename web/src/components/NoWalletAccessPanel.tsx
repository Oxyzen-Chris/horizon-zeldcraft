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
 *  - 🎟️ Accès Démo : gratuit, accès IMMÉDIAT (Google) sans validation admin, OU totalement
 *    anonyme (aucune authentification) — toutes deux plafonnées en connexions simultanées
 *    (RepRules.demoMaxConcurrentSessions / demoAnonymousMaxConcurrentSessions). Chaque connexion
 *    Google/e-mail est journalisée dans le registre admin "Demandes d'accès Démo" (e-mail, mode
 *    d'accès, dates), qui permet de mettre un compte en pause ou de le supprimer a posteriori.
 *  - 💳 Jouer sans portefeuille : paiement fiat (CB/PayPal/Apple Pay/Google Pay, mode simulation
 *    tant qu'aucune clé Stripe réelle n'est configurée) — accès immédiat, sans plafond, également
 *    journalisé dans le même registre admin. L'achat de monnaie de jeu se fait ensuite normalement
 *    dans le jeu (voir FiatTopupPanel.tsx).
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { User } from 'firebase/auth';
import { useI18n } from '@/lib/i18n';
import { useEffectiveSessionControls } from '@/lib/effectiveAccount';
import {
  getRepRules, deriveVirtualAddress, logAccountAccess,
  countActiveDemoSessions, registerDemoSession, ensureDemoAccountTimer, ensureDemoAnonTimer,
  setPlayerWelcomeEmailStatus, type RepRules,
} from '@/lib/gameState';
import {
  getFirebaseAuth, ensureAnonSignIn, signInWithGoogle,
  signInWithEmailLogin, createAccountWithEmail, isValidEmailFormat, describeEmailAuthErrorKey,
  consumeGoogleRedirectResult, describeGoogleAuthErrorKey,
} from '@/lib/firebase';

type ModalKind = null | 'demo' | 'fiat';

// Mémorise l'intention (Démo approuvée vs Fiat) lorsqu'on bascule sur `signInWithRedirect` (voir
// signInWithGoogle côté firebase.ts) — la page navigue entièrement vers accounts.google.com puis
// revient, donc tout état React est perdu ; seul `sessionStorage` survit à cet aller-retour.
const PENDING_GOOGLE_KEY = 'zc.pendingGoogleAction';

export function NoWalletAccessPanel() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { setSession } = useEffectiveSessionControls();
  const [rules, setRules] = useState<RepRules | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // 'login' (compte déjà créé) vs 'create' (nouveau compte + mot de passe à définir) — voir
  // demande utilisateur : distinguer explicitement les deux flux plutôt que l'ancien fallback
  // silencieux login→create (createAccountWithEmail/signInWithEmailLogin, voir firebase.ts).
  const [emailMode, setEmailMode] = useState<'login' | 'create'>('login');

  useEffect(() => { getRepRules().then(setRules).catch(() => {}); }, []);

  const closeModal = () => {
    setModal(null); setMessage(null); setBusy(false);
    setEmail(''); setPassword(''); setConfirmPassword(''); setEmailMode('login');
  };

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
      // Chrono de session Démo (2h par défaut, voir RepRules.demoSessionMaxDurationMin) : bloque
      // la reconnexion si la limite est déjà dépassée (ne redémarre jamais le chrono tout seul).
      const { expired } = await ensureDemoAnonTimer(user.uid, rules?.demoSessionMaxDurationMin ?? 120);
      if (expired) { setMessage(t('home.demo.sessionExpired')); setBusy(false); return; }
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

  // ─── Accès Démo (Google) — accès IMMÉDIAT, sans validation admin (voir logAccountAccess) ───
  // Extrait en fonction réutilisable : appelée aussi bien juste après une popup réussie que lors du
  // retour de redirection (voir l'effet `consumeGoogleRedirectResult` plus bas).
  const completeApprovedDemo = useCallback(async (user: User) => {
    setBusy(true); setMessage(null);
    try {
      const address = deriveVirtualAddress(user.uid) as `0x${string}`;
      // Journalise le compte dans le registre admin ("Demandes d'accès Démo") — l'accès est
      // accordé immédiatement, SAUF si l'admin a explicitement mis ce compte en pause.
      const { paused } = await logAccountAccess({
        uid: user.uid, address, displayName: user.displayName || undefined,
        email: user.email || undefined, method: 'google', accessMode: 'demo',
      });
      if (paused) { setMessage(t('home.demo.pausedByAdmin')); setBusy(false); return; }
      // Chrono de session Démo (2h par défaut) : bloque la reconnexion si déjà expiré, sauf
      // réactivation explicite par l'admin ("🔄 Réactiver le chrono Démo").
      const { expired } = await ensureDemoAccountTimer(user.uid, rules?.demoSessionMaxDurationMin ?? 120);
      if (expired) { setMessage(t('home.demo.sessionExpired')); setBusy(false); return; }
      const count = await countActiveDemoSessions('demo');
      const cap = rules?.demoMaxConcurrentSessions ?? 90;
      if (count >= cap) { setMessage(t('home.demo.fullApproved')); setBusy(false); return; }
      await registerDemoSession('demo', user.uid);
      setSession({
        kind: 'demo', uid: user.uid, address, demoMode: 'approved',
        displayName: user.displayName || undefined, email: user.email || undefined, authMethod: 'google',
      });
      router.push('/game');
    } catch (e) {
      console.error('[NoWalletAccessPanel] completeApprovedDemo failed:', e);
      setMessage(t('home.demo.authError'));
      setBusy(false);
    }
  }, [rules, router, setSession, t]);

  const startApprovedDemo = async () => {
    setBusy(true); setMessage(null);
    try {
      const { user, usedRedirect, errorCode } = await signInWithGoogle();
      // La popup a échoué (souvent une fausse alerte Cross-Origin-Opener-Policy — voir
      // firebase.ts) : on est déjà en train de naviguer vers accounts.google.com via
      // signInWithRedirect. On mémorise juste l'intention ; le résultat sera traité par l'effet
      // `consumeGoogleRedirectResult` ci-dessous, au retour sur cette page.
      if (usedRedirect) { sessionStorage.setItem(PENDING_GOOGLE_KEY, 'demo'); return; }
      if (!user) { setMessage(t(describeGoogleAuthErrorKey(errorCode))); setBusy(false); return; }
      await completeApprovedDemo(user);
    } catch (e) {
      console.error('[NoWalletAccessPanel] startApprovedDemo failed:', e);
      setMessage(t('home.demo.authError'));
      setBusy(false);
    }
  };

  // ─── Paiement fiat sans portefeuille (Google ou e-mail) — accès immédiat, sans plafond ───
  const completeFiatWithGoogle = useCallback(async (user: User) => {
    setBusy(true); setMessage(null);
    try {
      const address = deriveVirtualAddress(user.uid) as `0x${string}`;
      const { paused } = await logAccountAccess({
        uid: user.uid, address, displayName: user.displayName || undefined,
        email: user.email || undefined, method: 'google', accessMode: 'fiat',
      });
      if (paused) { setMessage(t('home.demo.pausedByAdmin')); setBusy(false); return; }
      setSession({
        kind: 'fiat', uid: user.uid, address,
        displayName: user.displayName || undefined, email: user.email || undefined, authMethod: 'google',
      });
      router.push('/game');
    } catch (e) {
      console.error('[NoWalletAccessPanel] completeFiatWithGoogle failed:', e);
      setMessage(t('home.demo.authError'));
      setBusy(false);
    }
  }, [router, setSession, t]);

  const startFiatWithGoogle = async () => {
    setBusy(true); setMessage(null);
    try {
      const { user, usedRedirect, errorCode } = await signInWithGoogle();
      if (usedRedirect) { sessionStorage.setItem(PENDING_GOOGLE_KEY, 'fiat'); return; }
      if (!user) { setMessage(t(describeGoogleAuthErrorKey(errorCode))); setBusy(false); return; }
      await completeFiatWithGoogle(user);
    } catch (e) {
      console.error('[NoWalletAccessPanel] startFiatWithGoogle failed:', e);
      setMessage(t('home.demo.authError'));
      setBusy(false);
    }
  };

  // Retour de navigation depuis accounts.google.com après une bascule signInWithRedirect (voir
  // startApprovedDemo/startFiatWithGoogle ci-dessus) — reprend automatiquement le flux interrompu.
  // Ne fait rien si aucune redirection Google n'était en cours (cas normal, immense majorité des
  // visites). L'utilisateur récupéré est mis en attente (`pendingGoogleUser`) le temps que
  // `rules` (RepRules, chargé en parallèle) soit disponible, pour respecter les plafonds
  // paramétrés par l'admin même dans ce cas de reprise après navigation complète.
  const [pendingGoogleUser, setPendingGoogleUser] = useState<{ user: User; kind: 'demo' | 'fiat' } | null>(null);
  useEffect(() => {
    const pending = sessionStorage.getItem(PENDING_GOOGLE_KEY) as 'demo' | 'fiat' | null;
    if (!pending) return;
    sessionStorage.removeItem(PENDING_GOOGLE_KEY);
    setBusy(true); setModal(pending);
    consumeGoogleRedirectResult().then((user) => {
      if (!user) { setBusy(false); return; } // redirection annulée/échouée : écran normal, pas d'erreur bruyante
      setPendingGoogleUser({ user, kind: pending });
    }).catch(() => setBusy(false));
  }, []);
  useEffect(() => {
    if (!pendingGoogleUser || !rules) return;
    const { user, kind } = pendingGoogleUser;
    setPendingGoogleUser(null);
    if (kind === 'demo') completeApprovedDemo(user);
    else completeFiatWithGoogle(user);
  }, [pendingGoogleUser, rules, completeApprovedDemo, completeFiatWithGoogle]);

  // ─── "Jouer sans portefeuille" par e-mail — connexion (compte déjà créé) ───
  const startFiatEmailLogin = async () => {
    if (!email || !password) return;
    setBusy(true); setMessage(null);
    try {
      const { user, errorCode } = await signInWithEmailLogin(email, password);
      if (!user) { setMessage(t(describeEmailAuthErrorKey(errorCode))); setBusy(false); return; }
      const address = deriveVirtualAddress(user.uid) as `0x${string}`;
      const userEmail = user.email || email;
      const { paused } = await logAccountAccess({
        uid: user.uid, address, email: userEmail, method: 'email', accessMode: 'fiat',
      });
      if (paused) { setMessage(t('home.demo.pausedByAdmin')); setBusy(false); return; }
      setSession({ kind: 'fiat', uid: user.uid, address, displayName: userEmail, email: userEmail, authMethod: 'email' });
      router.push('/game');
    } catch (e) {
      console.error('[NoWalletAccessPanel] startFiatEmailLogin failed:', e);
      setMessage(t('home.demo.authError'));
      setBusy(false);
    }
  };

  // ─── "Jouer sans portefeuille" par e-mail — création d'un NOUVEAU compte + mot de passe ───
  // Valide le format de l'e-mail ET la correspondance mot de passe/confirmation AVANT tout appel
  // Firebase (message d'erreur immédiat, sans aller-retour réseau) — voir demande utilisateur.
  // Déclenche l'e-mail de bienvenue (RepRules.welcomeEmailEnabled) exactement une fois, uniquement
  // lors d'une création réussie : confirme que l'adresse existe bien, sans jamais y faire figurer
  // le mot de passe en clair (voir templates.ts::buildWelcomeEmail).
  const startFiatEmailCreate = async () => {
    if (!email || !password) return;
    setMessage(null);
    if (!isValidEmailFormat(email)) { setMessage(t('home.fiat.emailErrorInvalid')); return; }
    if (password !== confirmPassword) { setMessage(t('home.fiat.passwordMismatch')); return; }
    setBusy(true);
    try {
      const { user, errorCode } = await createAccountWithEmail(email, password);
      if (!user) { setMessage(t(describeEmailAuthErrorKey(errorCode))); setBusy(false); return; }
      const address = deriveVirtualAddress(user.uid) as `0x${string}`;
      const userEmail = user.email || email;
      const { paused } = await logAccountAccess({
        uid: user.uid, address, email: userEmail, method: 'email', accessMode: 'fiat',
      });
      if (rules?.welcomeEmailEnabled !== false) {
        // Best-effort — ne bloque JAMAIS la création de compte si l'e-mail échoue (fire-and-forget),
        // mais on persiste désormais le résultat (succès/échec + raison) sur la fiche du joueur pour
        // que l'admin puisse le voir dans "Statistiques par joueur" et renvoyer l'e-mail au besoin
        // (voir PlayerEmailPanel.tsx) — auparavant l'erreur était totalement silencieuse.
        fetch('/api/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'welcome', to: userEmail, locale, bannerImageUrl: rules?.emailBannerImageUrl || undefined }),
        }).then(async (res) => {
          if (res.ok) { await setPlayerWelcomeEmailStatus(address, 'sent'); return; }
          const body = await res.json().catch(() => null);
          const reason = (body && (body.error || body.message)) || `HTTP ${res.status}`;
          console.error('[NoWalletAccessPanel] welcome e-mail failed:', reason);
          await setPlayerWelcomeEmailStatus(address, 'failed', String(reason));
        }).catch(async (err) => {
          console.error('[NoWalletAccessPanel] welcome e-mail request failed:', err);
          await setPlayerWelcomeEmailStatus(address, 'failed', err instanceof Error ? err.message : String(err));
        });
      }
      if (paused) { setMessage(t('home.demo.pausedByAdmin')); setBusy(false); return; }
      setSession({ kind: 'fiat', uid: user.uid, address, displayName: userEmail, email: userEmail, authMethod: 'email' });
      router.push('/game');
    } catch (e) {
      console.error('[NoWalletAccessPanel] startFiatEmailCreate failed:', e);
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
                <div className="flex gap-2 mb-2">
                  <button
                    className={`flex-1 text-xs rounded px-2 py-1 border ${emailMode === 'login' ? 'bg-purple-700 border-purple-500' : 'bg-slate-800 border-slate-600 text-slate-400'}`}
                    onClick={() => { setEmailMode('login'); setMessage(null); }}
                  >
                    {t('home.fiat.emailModeLogin')}
                  </button>
                  <button
                    className={`flex-1 text-xs rounded px-2 py-1 border ${emailMode === 'create' ? 'bg-purple-700 border-purple-500' : 'bg-slate-800 border-slate-600 text-slate-400'}`}
                    onClick={() => { setEmailMode('create'); setMessage(null); }}
                  >
                    {t('home.fiat.emailModeCreate')}
                  </button>
                </div>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email"
                  placeholder={t('home.fiat.emailPlaceholder')}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 mb-2 text-sm" />
                <input value={password} onChange={(e) => setPassword(e.target.value)} type="password"
                  placeholder={t('home.fiat.passwordPlaceholder')}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 mb-2 text-sm" />
                {emailMode === 'create' && (
                  <input value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} type="password"
                    placeholder={t('home.fiat.confirmPasswordPlaceholder')}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 mb-3 text-sm" />
                )}
                {emailMode === 'login' ? (
                  <button className="btn-secondary text-sm w-full" disabled={busy || !email || !password} onClick={startFiatEmailLogin}>
                    ✉️ {t('home.fiat.emailButton')}
                  </button>
                ) : (
                  <button className="btn-secondary text-sm w-full" disabled={busy || !email || !password || !confirmPassword} onClick={startFiatEmailCreate}>
                    ✉️ {t('home.fiat.emailCreateButton')}
                  </button>
                )}
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
