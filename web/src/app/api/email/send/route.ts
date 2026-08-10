/**
 * Route API serveur unique pour tous les envois d'e-mails transactionnels du jeu — voir
 * docs/EMAIL_NOTIFICATIONS.md, web/src/lib/email/resend.ts et templates.ts.
 *
 * Appelée depuis :
 *  - NoWalletAccessPanel.tsx (kind: 'welcome') — une seule fois, à la création d'un compte
 *    "Jouer sans portefeuille" par e-mail/mot de passe (voir RepRules.welcomeEmailEnabled).
 *  - PlayerStats.tsx (kind: 'report') — bouton "Envoyer un rapport" (immédiat) dans
 *    Administration → "Statistiques par joueur", pour UN joueur sélectionné.
 *  - PlayerStats.tsx (kind: 'broadcast') — message personnalisé ciblé (un joueur) ou envoi de
 *    masse (tous les joueurs ayant un e-mail), ex : annonce de maintenance/nouveauté.
 *  - api/email/cron-reports/route.ts (kind: 'report') — envois programmés (voir
 *    PlayerState.scheduledReport).
 *
 * Comme web/src/app/api/ai/insights/route.ts, cette route ne fait AUCUNE vérification serveur de
 * rôle admin (le menu Administration est déjà gardé côté client par `isOwner`, voir
 * app/admin/page.tsx) — seule une validation basique des entrées est effectuée ici. Si
 * `RESEND_API_KEY` est absent, répond explicitement (501) plutôt que de planter, pour que le
 * panneau Administration affiche un message clair (voir RepRules.emailNotificationsEnabled).
 */
import { NextRequest, NextResponse } from 'next/server';
import { isEmailConfigured, sendEmail, sendEmailBatch } from '@/lib/email/resend';
import { buildWelcomeEmail, buildPlayerReportEmail, buildBroadcastEmail, type EmailLocale, type PlayerReportData } from '@/lib/email/templates';

export const runtime = 'nodejs';

const VALID_LOCALES: EmailLocale[] = ['fr', 'en', 'es', 'pt'];
function safeLocale(l: unknown): EmailLocale {
  return VALID_LOCALES.includes(l as EmailLocale) ? (l as EmailLocale) : 'fr';
}
function isValidEmail(s: unknown): s is string {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

type Body =
  | { kind: 'welcome'; to: string; locale?: string; bannerImageUrl?: string }
  | { kind: 'report'; to: string; locale?: string; stats: PlayerReportData; customMessage?: string; customImageUrl?: string; bannerImageUrl?: string }
  | { kind: 'broadcast'; recipients: { to: string; locale?: string }[]; message: string; imageUrl?: string; bannerImageUrl?: string; subject?: string };

export async function POST(req: NextRequest) {
  if (!isEmailConfigured()) {
    return NextResponse.json(
      { error: 'not-configured', message: 'RESEND_API_KEY absente côté serveur — voir docs/EMAIL_NOTIFICATIONS.md pour la configuration Resend.' },
      { status: 501 },
    );
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad-request', message: 'Corps JSON invalide.' }, { status: 400 });
  }

  try {
    if (body.kind === 'welcome') {
      if (!isValidEmail(body.to)) return NextResponse.json({ error: 'bad-request', message: 'E-mail invalide.' }, { status: 400 });
      const { subject, html } = buildWelcomeEmail({ locale: safeLocale(body.locale), email: body.to, bannerImageUrl: body.bannerImageUrl });
      const result = await sendEmail({ to: body.to, subject, html });
      return NextResponse.json(result, { status: result.ok ? 200 : 502 });
    }

    if (body.kind === 'report') {
      if (!isValidEmail(body.to)) return NextResponse.json({ error: 'bad-request', message: 'E-mail invalide.' }, { status: 400 });
      if (!body.stats || typeof body.stats !== 'object') {
        return NextResponse.json({ error: 'bad-request', message: 'Champ "stats" manquant.' }, { status: 400 });
      }
      const { subject, html } = buildPlayerReportEmail({
        locale: safeLocale(body.locale), email: body.to, stats: body.stats,
        customMessage: body.customMessage, customImageUrl: body.customImageUrl, bannerImageUrl: body.bannerImageUrl,
      });
      const result = await sendEmail({ to: body.to, subject, html });
      return NextResponse.json(result, { status: result.ok ? 200 : 502 });
    }

    if (body.kind === 'broadcast') {
      const recipients = Array.isArray(body.recipients) ? body.recipients.filter((r) => isValidEmail(r?.to)) : [];
      if (recipients.length === 0) {
        return NextResponse.json({ error: 'bad-request', message: 'Aucun destinataire valide.' }, { status: 400 });
      }
      if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
        return NextResponse.json({ error: 'bad-request', message: 'Message vide.' }, { status: 400 });
      }
      const results = await sendEmailBatch(recipients.map((r) => r.to), (to) => {
        const locale = safeLocale(recipients.find((r) => r.to === to)?.locale);
        return buildBroadcastEmail({
          locale, message: body.message, imageUrl: body.imageUrl, bannerImageUrl: body.bannerImageUrl, subject: body.subject,
        });
      });
      const sent = results.filter((r) => r.result.ok).length;
      return NextResponse.json({ ok: sent > 0, sent, total: results.length, failed: results.filter((r) => !r.result.ok).map((r) => r.to) });
    }

    return NextResponse.json({ error: 'bad-request', message: 'Champ "kind" invalide.' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: 'network-error', message: err instanceof Error ? err.message : 'Erreur réseau inconnue.' },
      { status: 502 },
    );
  }
}
