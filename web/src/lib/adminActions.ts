'use client';

/**
 * Petits appels client → routes API `/api/admin/*` partagés entre plusieurs panneaux
 * d'Administration (PlayerStats.tsx §"Statistiques par joueur", DemoAccessRequestsPanel.tsx
 * §"Demandes d'accès Démo") — évite de dupliquer le même `fetch()` dans chaque composant.
 */

/**
 * Supprime le compte Firebase Authentication (e-mail/mot de passe OU Google) d'un joueur, en
 * complément de `deletePlayerAccount()`/`deleteAllPlayers()` (gameState.ts) qui ne suppriment QUE
 * les données RTDB. Sans cet appel, un joueur "Jouer sans portefeuille" par e-mail/mot de passe ne
 * peut plus recréer de compte avec la même adresse e-mail après suppression de ses statistiques
 * (`auth/email-already-in-use`) — bug corrigé.
 *
 * Best-effort : si le SDK Admin Firebase n'est pas configuré côté serveur (501), renvoie
 * `{ ok: false, notConfigured: true }` SANS lever d'exception — les appelants doivent alors
 * continuer la suppression RTDB quand même (comportement inchangé) mais peuvent avertir l'admin
 * que le compte Firebase Auth reste actif (voir docs/DEPLOYMENT.md).
 */
export async function deleteFirebaseAuthUser(uid: string): Promise<{ ok: boolean; notConfigured?: boolean }> {
  try {
    const res = await fetch('/api/admin/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid }),
    });
    if (res.status === 501) return { ok: false, notConfigured: true };
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && !!data.ok };
  } catch (e) {
    console.error('[adminActions] deleteFirebaseAuthUser failed:', e);
    return { ok: false };
  }
}
