/**
 * Firebase Admin SDK — accès serveur avec privilèges élevés à **Firebase Authentication**
 * (changer le mot de passe d'un AUTRE utilisateur), impossible avec le SDK client
 * (`lib/firebase.ts`) qui ne peut modifier que le mot de passe de l'utilisateur actuellement
 * connecté (`updatePassword`, voir `selfUpdatePassword` dans firebase.ts).
 *
 * Utilisé UNIQUEMENT par la route `api/admin/reset-password` (bouton "🔑 Reset mot de passe" dans
 * Administration §"Statistiques par joueur" — voir docs/EMAIL_NOTIFICATIONS.md).
 *
 * Variables d'environnement SERVEUR requises (jamais préfixées NEXT_PUBLIC_) :
 *   FIREBASE_ADMIN_CLIENT_EMAIL — e-mail du compte de service (ex: xxx@<projet>.iam.gserviceaccount.com)
 *   FIREBASE_ADMIN_PRIVATE_KEY  — clé privée du compte de service (bloc PEM, `\n` littéraux acceptés)
 * Obtenus via Firebase Console → ⚙️ Paramètres du projet → Comptes de service → onglet
 * "SDK Admin Firebase" → "Générer une nouvelle clé privée" (fichier JSON téléchargé — en extraire
 * `client_email` et `private_key`). Distinct du "secret de base de données (legacy)" utilisé par
 * `lib/email/firebaseAdminRest.ts` pour le cron (ce dernier n'a AUCUN privilège sur
 * Authentication). L'identifiant de projet réutilise `NEXT_PUBLIC_FIREBASE_PROJECT_ID` (déjà
 * public, aucune variable supplémentaire nécessaire pour ce champ).
 *
 * Si ces variables sont absentes, `isFirebaseAdminConfigured()` renvoie false et la route répond
 * explicitement (501) plutôt que de planter — même convention que RESEND_API_KEY/FIREBASE_DB_SECRET.
 */
import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { randomInt } from 'crypto';

let adminApp: App | null = null;

export function isFirebaseAdminConfigured(): boolean {
  return !!process.env.FIREBASE_ADMIN_CLIENT_EMAIL && !!process.env.FIREBASE_ADMIN_PRIVATE_KEY;
}

/**
 * Initialise l'app Admin de façon défensive : `cert()`/`initializeApp()` peuvent lever une
 * exception SYNCHRONE (pas une Promise rejetée) si `FIREBASE_ADMIN_CLIENT_EMAIL`/
 * `FIREBASE_ADMIN_PRIVATE_KEY` sont mal formées (ex: e-mail personnel au lieu de l'e-mail du
 * compte de service, ou secret de base de données "legacy" collé à la place de la clé privée PEM
 * — deux erreurs de configuration courantes, voir docs/DEPLOYMENT.md). Sans ce try/catch, cette
 * exception remontait non interceptée jusqu'à Next.js, qui renvoyait une page d'erreur 500 HTML
 * générique au lieu d'un message JSON exploitable (bug corrigé : les routes /api/admin/* dégradent
 * désormais proprement en 502 avec un message clair, au lieu de planter).
 */
function ensureAdminApp(): App | null {
  if (!isFirebaseAdminConfigured()) return null;
  if (adminApp) return adminApp;
  try {
    const existing = getApps().find((a) => a.name === 'zc-admin');
    if (existing) { adminApp = existing; return adminApp; }
    adminApp = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        // Les variables d'environnement Vercel ne conservent pas toujours les retours à la ligne
        // réels d'une clé PEM : on accepte donc aussi la forme avec des "\n" littéraux échappés.
        privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    }, 'zc-admin');
    return adminApp;
  } catch (err) {
    console.error(
      '[firebaseAdmin] Échec initialisation — vérifiez que FIREBASE_ADMIN_CLIENT_EMAIL est bien ' +
      'le "client_email" du fichier JSON de compte de service (PAS une adresse Gmail personnelle) ' +
      'et que FIREBASE_ADMIN_PRIVATE_KEY est bien le "private_key" PEM de ce même fichier ' +
      '(PAS le secret de base de données legacy) :', err,
    );
    return null;
  }
}

/** Message d'aide renvoyé quand `ensureAdminApp()` a échoué (config présente mais invalide) —
 * distinct du cas "absente" (501, voir routes) : ici les variables existent mais ne permettent pas
 * de s'authentifier auprès de Firebase. */
const INIT_FAILED_MSG =
  'Configuration Firebase Admin invalide : vérifiez que FIREBASE_ADMIN_CLIENT_EMAIL/' +
  'FIREBASE_ADMIN_PRIVATE_KEY proviennent bien du fichier JSON "Compte de service" ' +
  '(Firebase Console → Paramètres du projet → Comptes de service → Générer une nouvelle clé ' +
  'privée), et non d\'une adresse e-mail personnelle ou du secret de base de données legacy.';

/** Longueur fixée à 12 (voir demande utilisateur) — mélange garanti d'au moins un caractère de
 * chaque catégorie (majuscule/minuscule/chiffre/spécial) puis mélange aléatoire de l'ensemble,
 * via `crypto.randomInt` (cryptographiquement sûr, pas `Math.random`). */
export function generateStrongPassword(length = 12): string {
  const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const LOWER = 'abcdefghijkmnpqrstuvwxyz';
  const DIGITS = '23456789';
  const SPECIAL = '!@#$%^&*-_=+?';
  const ALL = UPPER + LOWER + DIGITS + SPECIAL;
  const pick = (set: string) => set[randomInt(set.length)];
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SPECIAL)];
  while (chars.length < length) chars.push(pick(ALL));
  // Mélange Fisher-Yates pour ne pas laisser les 4 premiers caractères toujours dans le même ordre
  // de catégorie (UPPER/LOWER/DIGIT/SPECIAL), qui serait un motif prévisible.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** Force un nouveau mot de passe pour l'utilisateur Firebase Auth `uid` (reset admin, sans
 * connaître l'ancien mot de passe) — jamais possible via le SDK client. Retourne le nouveau mot de
 * passe en clair (à afficher UNE FOIS dans l'UI admin et à transmettre par e-mail, voir
 * PlayerStats.tsx et api/admin/reset-password/route.ts) — jamais persisté en clair côté Firebase. */
export async function adminSetUserPassword(uid: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const app = ensureAdminApp();
  if (!app) return { ok: false, error: INIT_FAILED_MSG };
  try {
    await getAuth(app).updateUser(uid, { password: newPassword });
    return { ok: true };
  } catch (err) {
    console.error('[firebaseAdmin] adminSetUserPassword failed:', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Erreur inconnue.' };
  }
}

/**
 * Supprime définitivement le compte Firebase Authentication `uid` (e-mail/mot de passe OU Google).
 * Indispensable en complément de `deletePlayerAccount()` (gameState.ts, qui ne supprime QUE les
 * données RTDB) : sans ceci, l'utilisateur Firebase Auth d'origine continue d'exister après
 * suppression du joueur côté admin, ce qui bloque toute recréation du compte avec la même adresse
 * e-mail (`auth/email-already-in-use`) — bug corrigé (voir api/admin/delete-account/route.ts).
 * `auth/user-not-found` est traité comme un succès (idempotent : le compte est déjà absent).
 */
export async function adminDeleteUser(uid: string): Promise<{ ok: boolean; error?: string }> {
  const app = ensureAdminApp();
  if (!app) return { ok: false, error: INIT_FAILED_MSG };
  try {
    await getAuth(app).deleteUser(uid);
    return { ok: true };
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'auth/user-not-found') return { ok: true };
    console.error('[firebaseAdmin] adminDeleteUser failed:', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Erreur inconnue.' };
  }
}
