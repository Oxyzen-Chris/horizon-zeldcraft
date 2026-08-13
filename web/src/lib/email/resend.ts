/**
 * Envoi d'e-mails transactionnels via l'API REST de Resend (https://resend.com) — voir
 * docs/EMAIL_NOTIFICATIONS.md. Utilisé pour : e-mail de bienvenue (création de compte "Jouer sans
 * portefeuille"), rapport de progression joueur (immédiat ou programmé), message personnalisé
 * admin, envoi de masse (maintenance/annonce).
 *
 * Appelé UNIQUEMENT côté serveur (routes `web/src/app/api/email/*`) — jamais depuis le navigateur.
 * Utilise `fetch` directement plutôt que le SDK npm `resend`, pour ne pas ajouter de dépendance à
 * un projet qui reste volontairement léger (même logique que web/src/app/api/ai/insights/route.ts
 * pour les fournisseurs IA).
 *
 * Variables d'environnement SERVEUR requises (jamais préfixées NEXT_PUBLIC_, jamais exposées au
 * client) :
 *   RESEND_API_KEY    — clé API (gratuite jusqu'à 3000 e-mails/mois, voir resend.com/api-keys)
 *   RESEND_FROM_EMAIL — adresse d'expédition vérifiée dans Resend (ex: "jeu@horizon-zeldcraft.fr"
 *                       ou l'adresse de test "onboarding@resend.dev" tant qu'aucun domaine n'est
 *                       vérifié — voir resend.com/domains)
 *
 * Si `RESEND_API_KEY` est absent, `isEmailConfigured()` renvoie false : les routes API répondent
 * alors explicitement (statut 501) plutôt que de planter, et le panneau Administration affiche un
 * avertissement — même convention que `NEXT_PUBLIC_ETHERSCAN_KEY`/`GEMINI_API_KEY` absents.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
}

export interface SendEmailResult {
  ok: boolean;
  error?: string;
  id?: string;
}

/** Envoie un e-mail unique. Ne lève jamais — retourne toujours `{ ok, error? }` pour que
 * l'appelant (routes API) puisse continuer un envoi de masse même si un destinataire échoue. */
export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY absente côté serveur.' };
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  const fromName = process.env.RESEND_FROM_NAME || 'Horizon ZeldCraft';
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      // ⚠️ Erreur Resend TRÈS fréquente tant qu'aucun domaine n'est vérifié (voir
      // resend.com/domains) : en mode test (expéditeur "onboarding@resend.dev"), Resend
      // n'autorise l'envoi QUE vers l'adresse e-mail du propriétaire du compte Resend lui-même —
      // toute autre adresse destinataire (ex. un joueur avec une adresse @orange.fr/@gmail.com
      // différente) échoue avec un 403 "You can only send testing emails to your own email
      // address". Ce n'est PAS un bug applicatif : on détecte ce cas précis pour renvoyer un
      // message actionnable et compréhensible plutôt que le JSON brut de Resend (voir
      // docs/EMAIL_NOTIFICATIONS.md §"Mode test Resend / domaine vérifié").
      if (res.status === 403 && /own email address|testing emails/i.test(errText)) {
        return {
          ok: false,
          error: `Resend est en MODE TEST (expéditeur "onboarding@resend.dev" ou domaine non vérifié) : ` +
            `il n'autorise l'envoi qu'à l'adresse e-mail du COMPTE Resend lui-même, pas à "${Array.isArray(to) ? to[0] : to}". ` +
            `Pour envoyer à n'importe quel joueur, vérifie un domaine sur resend.com/domains puis renseigne ` +
            `RESEND_FROM_EMAIL avec une adresse de ce domaine (ex : jeu@tondomaine.fr) dans les variables ` +
            `d'environnement Vercel. Voir docs/EMAIL_NOTIFICATIONS.md.`,
        };
      }
      return { ok: false, error: `Resend (${res.status}) : ${errText.slice(0, 300)}` };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, id: data?.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Erreur réseau inconnue.' };
  }
}

/** Envoi de masse séquentiel par petits lots (évite de saturer le quota/rate-limit Resend en
 * envoyant des centaines de requêtes simultanées — voir resend.com/docs/api-reference/errors,
 * limite par défaut ~2 req/s sur le plan gratuit). Retourne le détail par destinataire. */
export async function sendEmailBatch(
  recipients: string[],
  build: (to: string) => { subject: string; html: string },
): Promise<{ to: string; result: SendEmailResult }[]> {
  const results: { to: string; result: SendEmailResult }[] = [];
  const BATCH_SIZE = 5;
  const DELAY_MS = 600;
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (to) => ({ to, result: await sendEmail({ to, ...build(to) }) })),
    );
    results.push(...batchResults);
    if (i + BATCH_SIZE < recipients.length) await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  return results;
}
