/**
 * Accès en lecture/écriture à Firebase Realtime Database DEPUIS LE SERVEUR (sans session
 * utilisateur authentifiée) — utilisé UNIQUEMENT par la tâche planifiée des rapports de
 * progression programmés (`web/src/app/api/email/cron-reports/route.ts`, voir
 * PlayerState.scheduledReport et docs/EMAIL_NOTIFICATIONS.md).
 *
 * Le reste du jeu (client + toutes les autres routes API) passe par le SDK client Firebase
 * (`lib/firebase.ts` + `lib/gameState.ts`), authentifié via `ensureAnonSignIn()`. Un job cron
 * Vercel n'a pas de session navigateur : on utilise donc l'API REST "legacy" de Realtime Database
 * avec un SECRET DE BASE DE DONNÉES (paramètre `?auth=`), qui contourne les règles de sécurité —
 * exactement l'usage prévu pour un accès serveur de confiance (voir
 * https://firebase.google.com/docs/database/rest/auth#legacy_database_secrets).
 *
 * Variable d'environnement SERVEUR requise : FIREBASE_DB_SECRET (Console Firebase → Paramètres du
 * projet → Comptes de service → Secrets de base de données, onglet "Legacy"). Si absente,
 * `isCronConfigured()` renvoie false et la route cron répond explicitement (501) plutôt que
 * d'échouer silencieusement — même convention que RESEND_API_KEY/NEXT_PUBLIC_ETHERSCAN_KEY.
 */

function dbUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
  return base ? base.replace(/\/$/, '') : null;
}

export function isCronConfigured(): boolean {
  return !!dbUrl() && !!process.env.FIREBASE_DB_SECRET;
}

/** Lecture brute d'un chemin RTDB (ex: "players") — renvoie `null` si non configuré ou en erreur. */
export async function fetchRtdbPath<T = unknown>(path: string): Promise<T | null> {
  const base = dbUrl();
  const secret = process.env.FIREBASE_DB_SECRET;
  if (!base || !secret) return null;
  try {
    const res = await fetch(`${base}/${path}.json?auth=${secret}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Écriture partielle (PATCH) d'un chemin RTDB — utilisé pour poser `scheduledReport.lastSentAt`
 * après chaque envoi programmé réussi (anti-doublon, voir cron-reports/route.ts). */
export async function patchRtdbPath(path: string, value: unknown): Promise<boolean> {
  const base = dbUrl();
  const secret = process.env.FIREBASE_DB_SECRET;
  if (!base || !secret) return false;
  try {
    const res = await fetch(`${base}/${path}.json?auth=${secret}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
    return res.ok;
  } catch {
    return false;
  }
}
