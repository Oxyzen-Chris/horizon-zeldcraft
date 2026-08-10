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

function ensureAdminApp(): App | null {
  if (!isFirebaseAdminConfigured()) return null;
  if (adminApp) return adminApp;
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
}

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
  if (!app) return { ok: false, error: 'Firebase Admin non configuré côté serveur.' };
  try {
    await getAuth(app).updateUser(uid, { password: newPassword });
    return { ok: true };
  } catch (err) {
    console.error('[firebaseAdmin] adminSetUserPassword failed:', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Erreur inconnue.' };
  }
}
