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
// que l'admin puisse identifier/approuver une demande d'accès Démo (voir requestDemoAccess côté
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
 * page — l'appelant doit alors avoir mémorisé son intention, ex. dans `sessionStorage`).
 */
export async function signInWithGoogle(): Promise<{ user: User | null; usedRedirect: boolean }> {
  const a = getFirebaseAuth();
  if (!a) return { user: null, usedRedirect: false };
  try {
    const cred = await signInWithPopup(a, new GoogleAuthProvider());
    return { user: cred.user, usedRedirect: false };
  } catch (err) {
    console.error('[firebase] signInWithGoogle (popup) failed, falling back to redirect:', err);
    try {
      await signInWithRedirect(a, new GoogleAuthProvider());
      return { user: null, usedRedirect: true };
    } catch (err2) {
      console.error('[firebase] signInWithGoogle (redirect) failed:', err2);
      return { user: null, usedRedirect: false };
    }
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

/** Connexion/création de compte via e-mail + mot de passe — alternative à Google pour l'accès
 * Démo/fiat. Tente d'abord une connexion ; si le compte n'existe pas encore, le crée à la volée. */
export async function signInWithEmail(email: string, password: string): Promise<User | null> {
  const a = getFirebaseAuth();
  if (!a) return null;
  try {
    const cred = await signInWithEmailAndPassword(a, email, password);
    return cred.user;
  } catch {
    try {
      const cred = await createUserWithEmailAndPassword(a, email, password);
      return cred.user;
    } catch (err2) {
      console.error('[firebase] signInWithEmail failed:', err2);
      return null;
    }
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

