/**
 * Route API en LECTURE SEULE exposant l'état de la configuration Resend (SANS jamais révéler la
 * clé API elle-même) — utilisée par RepRulesPanel.tsx (section ✉️) pour avertir l'admin quand
 * `RESEND_FROM_EMAIL` est toujours l'adresse "bac à sable" par défaut (`onboarding@resend.dev`),
 * auquel cas Resend refuse (403) tout envoi vers un destinataire autre que le propriétaire du
 * compte Resend — voir docs/EMAIL_NOTIFICATIONS.md. C'est la cause la plus fréquente d'e-mails de
 * bienvenue/rapport non reçus par les joueurs, d'où ce contrôle proactif côté Administration.
 */
import { NextResponse } from 'next/server';
import { isEmailConfigured } from '@/lib/email/resend';

export const runtime = 'nodejs';

export async function GET() {
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  return NextResponse.json({
    configured: isEmailConfigured(),
    fromEmail,
    isSandbox: fromEmail.trim().toLowerCase() === 'onboarding@resend.dev',
  });
}
