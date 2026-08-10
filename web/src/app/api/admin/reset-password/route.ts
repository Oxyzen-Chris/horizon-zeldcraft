/**
 * Route API serveur : réinitialisation forcée du mot de passe d'un compte "Jouer sans
 * portefeuille" (e-mail/mot de passe) par l'administrateur — bouton "🔑 Reset mot de passe" dans
 * Administration §"Statistiques par joueur" (zone de danger), voir docs/EMAIL_NOTIFICATIONS.md.
 *
 * Génère un nouveau mot de passe fort (12 caractères, voir lib/firebaseAdmin.ts::generateStrongPassword),
 * l'applique via le SDK Firebase Admin (seul capable de changer le mot de passe d'un AUTRE
 * utilisateur — le SDK client ne peut modifier que le mot de passe de l'utilisateur courant, voir
 * `selfUpdatePassword` dans lib/firebase.ts pour le changement volontaire en jeu) puis le renvoie
 * en clair dans la réponse : à afficher UNE FOIS côté admin et à transmettre par e-mail (voir
 * PlayerStats.tsx, qui appelle ensuite `incrementPasswordResetCount()` et
 * `POST /api/email/send { kind: 'password-reset' }`).
 *
 * Comme les autres routes `/api/email/*` et `/api/ai/insights`, aucune vérification serveur de
 * rôle admin n'est effectuée ici (le menu Administration est déjà protégé côté client par
 * `isOwner`, voir app/admin/page.tsx) — seule une validation basique de l'entrée est faite.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isFirebaseAdminConfigured, adminSetUserPassword, generateStrongPassword } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!isFirebaseAdminConfigured()) {
    return NextResponse.json(
      { error: 'not-configured', message: 'FIREBASE_ADMIN_CLIENT_EMAIL/FIREBASE_ADMIN_PRIVATE_KEY absents côté serveur — voir docs/EMAIL_NOTIFICATIONS.md.' },
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

  const newPassword = generateStrongPassword(12);
  const result = await adminSetUserPassword(uid, newPassword);
  if (!result.ok) {
    return NextResponse.json({ error: 'reset-failed', message: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, newPassword });
}
