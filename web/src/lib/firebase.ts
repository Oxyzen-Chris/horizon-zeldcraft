/**
 * Firebase client — configuration Realtime Database pour le chat multi-joueurs.
 *
 * Variables d'environnement requises (dans web/.env.local et Vercel) :
 *   NEXT_PUBLIC_FIREBASE_API_KEY
 *   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
 *   NEXT_PUBLIC_FIREBASE_DATABASE_URL
 *   NEXT_PUBLIC_FIREBASE_PROJECT_ID
 *   NEXT_PUBLIC_FIREBASE_APP_ID
 *
 * Si NEXT_PUBLIC_FIREBASE_API_KEY n'est pas défini, le module retourne null et
 * l'UI de chat affiche un message explicatif au lieu de crasher.
 */
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getDatabase, Database } from 'firebase/database';
import {
  getAuth, signInAnonymously, onAuthStateChanged, Auth, User,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} from 'firebase/auth';

let app: FirebaseApp | null = null;
let db: Database | null = null;
let auth: Auth | null = null;
let signInPromise: Promise<User | null> | null = null;

export function isFirebaseConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY
      && !!process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
}

function ensureApp(): FirebaseApp | null {
  if (!isFirebaseConfigured()) return null;
  if (app) return app;
  if (getApps().length === 0) {
    app = initializeApp({
      apiKey:      process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
      authDomain:  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL!,
      projectId:   process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      appId:       process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
  } else {
    app = getApps()[0];
  }
  return app;
}

export function getFirebaseDb(): Database | null {
  const a = ensureApp();
  if (!a) return null;
  if (!db) db = getDatabase(a);
  return db;
}

export function getFirebaseAuth(): Auth | null {
  const a = ensureApp();
  if (!a) return null;
  if (!auth) auth = getAuth(a);
  return auth;
}

/**
 * Connecte l'utilisateur anonymement (idempotent).
 * Résout avec le User Firebase (contient uid) ou null si Firebase pas configuré.
 * Les règles de sécurité exigent auth != null pour lire/écrire les messages.
 */
export function ensureAnonSignIn(): Promise<User | null> {
  if (signInPromise) return signInPromise;
  const a = getFirebaseAuth();
  if (!a) return Promise.resolve(null);
  signInPromise = new Promise((resolve) => {
    // Si déjà connecté (localStorage), on récupère l'utilisateur direct
    const unsub = onAuthStateChanged(a, (user) => {
      if (user) { unsub(); resolve(user); return; }
      signInAnonymously(a)
        .then((cred) => { unsub(); resolve(cred.user); })
        .catch((err) => {
          console.error('[firebase] signInAnonymously failed:', err);
          unsub();
          signInPromise = null; // permet un retry
          resolve(null);
        });
    });
  });
  return signInPromise;
}

// ─────────────────────── Accès Démo & fiat sans portefeuille crypto (voir docs/DEMO_FIAT.md) ───────────────────────
// Ces fonctions authentifient un compte Firebase RÉEL (Google ou email), distinct de l'anonyme
// ci-dessus (utilisé UNIQUEMENT pour satisfaire les règles RTDB `auth != null`) — nécessaire pour
// que l'admin puisse identifier/auditer un compte Démo/fiat (voir logAccountAccess côté
// gameState.ts) ou pour qu'un paiement fiat soit rattaché à une vraie adresse e-mail.

/**
 * Connexion via un compte Google — tente d'abord une popup (`signInWithPopup`, rapide, sans
 * navigation complète). En cas d'échec, bascule automatiquement sur `signInWithRedirect`
 * (navigation complète vers accounts.google.com puis retour sur la page) : la popup Google échoue
 * régulièrement dans Chrome récent à cause d'une politique Cross-Origin-Opener-Policy qui empêche
 * le SDK Firebase de vérifier si la popup est encore ouverte (le SDK croit alors, à tort, que
 * l'utilisateur a fermé la popup — voir https://github.com/firebase/firebase-js-sdk/issues/6716).
 * La redirection est aussi beaucoup plus fiable dans les WebViews mobiles/Expo Go, où les popups
 * sont souvent bloquées d'office.
 *
 * Retourne `{ user, usedRedirect: false }` si la popup a réussi immédiatement, ou
 * `{ user: null, usedRedirect: true }` si on bascule en redirection (la page va naviguer : plus
 * rien à faire ici, le résultat sera récupéré via `consumeGoogleRedirectResult()` au retour sur la
 * page — l'appelant doit alors avoir mémorisé son intention, ex. dans `sessionStorage`). Si les
 * DEUX tentatives échouent, `errorCode` porte le code Firebase de la dernière erreur (ex.
 * `auth/unauthorized-domain`, `auth/operation-not-allowed`) pour affichage d'un message précis
 * côté UI — voir `describeGoogleAuthErrorKey()` ci-dessous.
 *
 * `prompt: 'select_account'` force Google à TOUJOURS afficher la mire de sélection de compte,
 * même si une seule session Google est déjà active dans le navigateur (comportement par défaut de
 * Firebase sans ce paramètre : reconnexion silencieuse au dernier compte utilisé, sans possibilité
 * de choisir un autre compte Gmail) — indispensable pour un joueur possédant plusieurs comptes
 * Google (voir demande utilisateur).
 */
function newGoogleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

export async function signInWithGoogle(): Promise<{ user: User | null; usedRedirect: boolean; errorCode?: string }> {
  const a = getFirebaseAuth();
  if (!a) return { user: null, usedRedirect: false };
  try {
    const cred = await signInWithPopup(a, newGoogleProvider());
    return { user: cred.user, usedRedirect: false };
  } catch (err) {
    console.error('[firebase] signInWithGoogle (popup) failed, falling back to redirect:', err);
    // Un domaine non autorisé (auth/unauthorized-domain) ou un provider Google désactivé
    // (auth/operation-not-allowed) sont des erreurs de CONFIGURATION Firebase : re-tenter en
    // redirection échouera exactement pareil (le blocage est au niveau du projet/domaine, pas du
    // mécanisme popup/redirect). On l'affiche quand même explicitement dans l'UI via errorCode
    // plutôt que de masquer la vraie cause derrière un message générique.
    const code = (err as { code?: string } | null)?.code;
    try {
      await signInWithRedirect(a, newGoogleProvider());
      return { user: null, usedRedirect: true };
    } catch (err2) {
      console.error('[firebase] signInWithGoogle (redirect) failed:', err2);
      const code2 = (err2 as { code?: string } | null)?.code;
      return { user: null, usedRedirect: false, errorCode: code2 || code };
    }
  }
}

/** Traduit un code d'erreur Firebase Auth (voir `errorCode` de `signInWithGoogle()`) en suffixe de
 * clé i18n (`home.demo.authError<Suffix>`), pour afficher un message actionnable plutôt qu'un
 * message générique — utile pour diagnostiquer rapidement un problème de configuration Firebase
 * (domaine non autorisé, provider désactivé) sans avoir à consulter les logs serveur. */
export function describeGoogleAuthErrorKey(errorCode?: string): string {
  switch (errorCode) {
    case 'auth/unauthorized-domain': return 'home.demo.authErrorUnauthorizedDomain';
    case 'auth/operation-not-allowed': return 'home.demo.authErrorOperationNotAllowed';
    case 'auth/popup-blocked': return 'home.demo.authErrorPopupBlocked';
    default: return 'home.demo.authError';
  }
}

/** À appeler au chargement de la page d'accueil pour récupérer le résultat d'une connexion Google
 * amorcée via la bascule `signInWithRedirect` de `signInWithGoogle()` ci-dessus, après le retour de
 * navigation depuis accounts.google.com. Retourne `null` si aucune redirection n'était en cours (ou
 * si elle a été annulée/a échoué) — dans ce cas, l'écran de choix normal doit simplement rester
 * affiché, sans message d'erreur bruyant. */
export async function consumeGoogleRedirectResult(): Promise<User | null> {
  const a = getFirebaseAuth();
  if (!a) return null;
  try {
    const cred = await getRedirectResult(a);
    return cred?.user ?? null;
  } catch (err) {
    console.error('[firebase] consumeGoogleRedirectResult failed:', err);
    return null;
  }
}

/** Format d'e-mail valide et suffisamment strict (local@domaine.suffixe) — utilisé côté client
 * avant toute tentative Firebase (message d'erreur immédiat, sans aller-retour réseau) ET côté
 * serveur (route `/api/email/*`, où l'input n'est jamais fiable). Volontairement simple : Firebase
 * Auth revalide de toute façon le format côté serveur (erreur `auth/invalid-email` sinon). */
export function isValidEmailFormat(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Connexion via e-mail + mot de passe — pour un compte "Jouer sans portefeuille" DÉJÀ créé (voir
 * `createAccountWithEmail` ci-dessous pour la création). Distinguer explicitement connexion et
 * création (au lieu de l'ancien fallback silencieux login→create) permet : (1) d'afficher un
 * message d'erreur clair si le mot de passe est faux plutôt que de créer par erreur un second
 * compte, (2) de ne déclencher l'e-mail de bienvenue QUE lors d'une création réelle (voir
 * `createAccountWithEmail`), jamais lors d'une reconnexion.
 */
export async function signInWithEmailLogin(email: string, password: string): Promise<{ user: User | null; errorCode?: string }> {
  const a = getFirebaseAuth();
  if (!a) return { user: null };
  try {
    const cred = await signInWithEmailAndPassword(a, email, password);
    return { user: cred.user };
  } catch (err) {
    console.error('[firebase] signInWithEmailLogin failed:', err);
    return { user: null, errorCode: (err as { code?: string } | null)?.code };
  }
}

/**
 * Création d'un nouveau compte "Jouer sans portefeuille" (e-mail + mot de passe choisi par le
 * joueur). L'appelant (NoWalletAccessPanel.tsx) est responsable d'avoir déjà vérifié le format de
 * l'e-mail (`isValidEmailFormat`) et la correspondance des deux champs mot de passe/confirmation
 * AVANT d'appeler cette fonction. En cas de succès, l'appelant doit déclencher l'envoi de l'e-mail
 * de bienvenue via `POST /api/email/send` (voir web/src/lib/email/templates.ts) — jamais fait ici,
 * pour garder ce module Firebase indépendant de l'infrastructure e-mail (Resend).
 */
export async function createAccountWithEmail(email: string, password: string): Promise<{ user: User | null; errorCode?: string }> {
  const a = getFirebaseAuth();
  if (!a) return { user: null };
  try {
    const cred = await createUserWithEmailAndPassword(a, email, password);
    return { user: cred.user };
  } catch (err) {
    console.error('[firebase] createAccountWithEmail failed:', err);
    return { user: null, errorCode: (err as { code?: string } | null)?.code };
  }
}

/** Traduit un code d'erreur Firebase Auth email/mot de passe en suffixe de clé i18n
 * (`home.fiat.emailError<Suffix>`), même logique que `describeGoogleAuthErrorKey` ci-dessus. */
export function describeEmailAuthErrorKey(errorCode?: string): string {
  switch (errorCode) {
    case 'auth/email-already-in-use': return 'home.fiat.emailErrorAlreadyInUse';
    case 'auth/invalid-email': return 'home.fiat.emailErrorInvalid';
    case 'auth/weak-password': return 'home.fiat.emailErrorWeakPassword';
    case 'auth/wrong-password':
    case 'auth/invalid-credential': return 'home.fiat.emailErrorWrongPassword';
    case 'auth/user-not-found': return 'home.fiat.emailErrorNotFound';
    default: return 'home.demo.authError';
  }
}

/**
 * Changement VOLONTAIRE du mot de passe par le joueur lui-même, depuis le jeu (voir
 * EffectiveAccountBadge.tsx, bouton "🔑 Reset mot de passe" à côté de l'adresse — uniquement pour
 * un compte "Jouer sans portefeuille" par e-mail/mot de passe, `PlayerState.authMethod === 'email'`).
 * Utilise `updatePassword()` du SDK client (ne peut modifier QUE le mot de passe de l'utilisateur
 * actuellement connecté — voir lib/firebaseAdmin.ts::adminSetUserPassword pour le reset forcé par
 * l'admin sur un AUTRE utilisateur, impossible ici).
 *
 * Gère `auth/requires-recent-login` : Firebase exige une connexion "récente" pour ce type
 * d'opération sensible ; si la session est trop ancienne, on demande le mot de passe ACTUEL
 * (`currentPassword`) pour ré-authentifier (`reauthenticateWithCredential`) puis on retente. Si
 * `currentPassword` n'est pas fourni la première fois et que cette erreur survient, on renvoie
 * `errorCode: 'auth/requires-recent-login'` pour que l'appelant affiche le champ supplémentaire.
 */
export async function selfUpdatePassword(newPassword: string, currentPassword?: string): Promise<{ ok: boolean; errorCode?: string }> {
  const a = getFirebaseAuth();
  const user = a?.currentUser;
  if (!a || !user) return { ok: false, errorCode: 'auth/no-current-user' };
  try {
    await updatePassword(user, newPassword);
    return { ok: true };
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'auth/requires-recent-login' && currentPassword && user.email) {
      try {
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
        await updatePassword(user, newPassword);
        return { ok: true };
      } catch (err2) {
        console.error('[firebase] selfUpdatePassword (reauth) failed:', err2);
        return { ok: false, errorCode: (err2 as { code?: string } | null)?.code };
      }
    }
    console.error('[firebase] selfUpdatePassword failed:', err);
    return { ok: false, errorCode: code };
  }
}

/**
 * Déconnexion explicite d'une session Démo/Fiat (bouton "Se déconnecter" — voir
 * EffectiveAccountBadge.tsx / effectiveAccount.tsx::disconnectSession). Réinitialise aussi le cache
 * interne `signInPromise` d'`ensureAnonSignIn()` : sans cela, un futur appel à `ensureAnonSignIn()`
 * (ex. relance immédiate d'un accès Démo anonyme) renverrait l'ancien utilisateur déjà déconnecté
 * au lieu de ré-authentifier — c'est ce qui empêchait de rebasculer vers Google après un essai en
 * mode anonyme (bug corrigé).
 */
export async function signOutFirebase(): Promise<void> {
  const a = getFirebaseAuth();
  if (!a) return;
  try {
    await signOut(a);
  } catch (err) {
    console.error('[firebase] signOut failed:', err);
  } finally {
    signInPromise = null;
  }
}

