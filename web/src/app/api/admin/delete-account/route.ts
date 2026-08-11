/**
 * Route API serveur : suppression définitive du compte Firebase Authentication d'un joueur
 * (e-mail/mot de passe OU Google), en complément de `deletePlayerAccount()` (gameState.ts) qui ne
 * supprime QUE les données RTDB (`players/{addr}`, `demoAccessRequests/{uid}`, …).
 *
 * Bug corrigé : sans cette route, supprimer un joueur depuis Administration §"Statistiques par
 * joueur" ne supprimait jamais l'utilisateur Firebase Auth sous-jacent — un joueur "Jouer sans
 * portefeuille" par e-mail/mot de passe ne pouvait alors plus recréer de compte avec la même
 * adresse e-mail (`auth/email-already-in-use`), même après suppression de ses statistiques.
 *
 * Appelée depuis PlayerStats.tsx (`deleteSelected`/`deleteAll`), AVANT la suppression RTDB, pour
 * tout joueur possédant un `uid` (comptes 'demo'/'fiat' uniquement — un compte 'wallet' classique
 * n'a pas d'UID Firebase et n'appelle jamais cette route). Best-effort : si le SDK Admin n'est pas
 * configuré (501), la suppression RTDB se poursuit quand même (comportement inchangé), mais le
 * panneau admin avertit alors que le compte Firebase Auth reste actif et bloquera une recréation
 * avec la même adresse e-mail tant que `FIREBASE_ADMIN_CLIENT_EMAIL`/`FIREBASE_ADMIN_PRIVATE_KEY`
 * ne sont pas configurés (voir docs/DEPLOYMENT.md).
 *
 * Même convention que les autres routes `/api/admin/*` et `/api/email/*` : aucune vérification
 * serveur de rôle admin (menu déjà protégé côté client par `isOwner`, voir app/admin/page.tsx).
 */
import { NextRequest, NextResponse } from 'next/server';
import { isFirebaseAdminConfigured, adminDeleteUser } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!isFirebaseAdminConfigured()) {
    return NextResponse.json(
      { error: 'not-configured', message: 'FIREBASE_ADMIN_CLIENT_EMAIL/FIREBASE_ADMIN_PRIVATE_KEY absents côté serveur — voir docs/DEPLOYMENT.md.' },
      { status: 501 },
    );
  }

  let body: { uid?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad-request', message: 'Corps JSON invalide.' }, { status: 400 });
  }

  const uid = body?.uid;
  if (!uid || typeof uid !== 'string') {
    return NextResponse.json({ error: 'bad-request', message: 'Champ "uid" manquant.' }, { status: 400 });
  }

  const result = await adminDeleteUser(uid);
  if (!result.ok) {
    return NextResponse.json({ error: 'delete-failed', message: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
