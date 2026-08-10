/**
 * Gabarits HTML des e-mails transactionnels — voir docs/EMAIL_NOTIFICATIONS.md et resend.ts.
 *
 * Dictionnaire de chaînes minimal et AUTONOME (fr/en/es/pt), volontairement DÉCOUPLÉ du système
 * i18n client (`web/src/i18n/messages/*.json` + `lib/i18n.tsx`) : ces gabarits s'exécutent
 * côté SERVEUR (routes API), où `localStorage`/le contexte React `I18nProvider` n'existent pas —
 * la locale à utiliser est donc systématiquement passée explicitement en paramètre (déduite de
 * `PlayerState.lang`, capturé une fois à la création du compte — voir gameState.ts).
 *
 * Pas d'assets réels dans web/public/ pour l'instant (voir RepRules.emailBannerImageUrl,
 * configurable par l'admin) : tant qu'aucune image n'est définie, un bandeau décoratif à base
 * d'émojis (cohérent avec le reste de l'UI du jeu, très émoji-driven) sert de repli.
 */

export type EmailLocale = 'fr' | 'en' | 'es' | 'pt';

const STR: Record<EmailLocale, Record<string, string>> = {
  fr: {
    welcomeSubject: 'Bienvenue sur Horizon ZeldCraft, {name} ! 🗡️',
    welcomeHeading: 'Bienvenue, aventurier·ère !',
    welcomeBody: 'Ton compte a bien été créé. Synk, ton compagnon, t\'attend déjà dans les Terres de ZeldCraft — nourris-le, explore, combats, et fais grandir votre lien au fil des jours !',
    welcomeCta: 'Rejoindre le jeu',
    reportSubject: 'Ton rapport de progression Horizon ZeldCraft 📜',
    reportHeading: 'Ton rapport de progression',
    reportIntro: 'Voici où tu en es dans ton aventure :',
    reportLevel: 'Niveau', reportXp: 'XP', reportStage: 'Stade', reportWallet: 'Pièces',
    reportQuests: 'Quêtes résolues', reportNpcs: 'PNJ rencontrés', reportPlaytime: 'Temps de jeu total',
    reportCta: 'Reprendre l\'aventure',
    broadcastSubject: 'Message de l\'équipe Horizon ZeldCraft 📢',
    broadcastHeading: 'Un message de l\'équipe',
    footer: 'Horizon ZeldCraft — un compagnon magique à faire grandir chaque jour.',
    footerUnsub: 'Tu reçois cet e-mail car tu possèdes un compte sur Horizon ZeldCraft.',
  },
  en: {
    welcomeSubject: 'Welcome to Horizon ZeldCraft, {name}! 🗡️',
    welcomeHeading: 'Welcome, adventurer!',
    welcomeBody: 'Your account has been created. Synk, your companion, is already waiting for you in the Lands of ZeldCraft — feed it, explore, fight, and grow your bond day after day!',
    welcomeCta: 'Join the game',
    reportSubject: 'Your Horizon ZeldCraft progress report 📜',
    reportHeading: 'Your progress report',
    reportIntro: 'Here is where your adventure stands:',
    reportLevel: 'Level', reportXp: 'XP', reportStage: 'Stage', reportWallet: 'Coins',
    reportQuests: 'Quests solved', reportNpcs: 'NPCs met', reportPlaytime: 'Total playtime',
    reportCta: 'Resume the adventure',
    broadcastSubject: 'Message from the Horizon ZeldCraft team 📢',
    broadcastHeading: 'A message from the team',
    footer: 'Horizon ZeldCraft — a magical companion to grow every day.',
    footerUnsub: 'You are receiving this email because you have an account on Horizon ZeldCraft.',
  },
  es: {
    welcomeSubject: '¡Bienvenido a Horizon ZeldCraft, {name}! 🗡️',
    welcomeHeading: '¡Bienvenido, aventurero!',
    welcomeBody: 'Tu cuenta ha sido creada. Synk, tu compañero, ya te espera en las Tierras de ZeldCraft: ¡aliméntalo, explora, lucha y haced crecer vuestro vínculo día a día!',
    welcomeCta: 'Entrar al juego',
    reportSubject: 'Tu informe de progreso de Horizon ZeldCraft 📜',
    reportHeading: 'Tu informe de progreso',
    reportIntro: 'Así va tu aventura:',
    reportLevel: 'Nivel', reportXp: 'XP', reportStage: 'Etapa', reportWallet: 'Monedas',
    reportQuests: 'Misiones resueltas', reportNpcs: 'PNJ conocidos', reportPlaytime: 'Tiempo de juego total',
    reportCta: 'Retomar la aventura',
    broadcastSubject: 'Mensaje del equipo de Horizon ZeldCraft 📢',
    broadcastHeading: 'Un mensaje del equipo',
    footer: 'Horizon ZeldCraft — un compañero mágico que crece cada día.',
    footerUnsub: 'Recibes este correo porque tienes una cuenta en Horizon ZeldCraft.',
  },
  pt: {
    welcomeSubject: 'Bem-vindo ao Horizon ZeldCraft, {name}! 🗡️',
    welcomeHeading: 'Bem-vindo, aventureiro!',
    welcomeBody: 'A tua conta foi criada. O Synk, o teu companheiro, já te espera nas Terras de ZeldCraft — alimenta-o, explora, luta e faz crescer o vosso vínculo dia após dia!',
    welcomeCta: 'Entrar no jogo',
    reportSubject: 'O teu relatório de progresso Horizon ZeldCraft 📜',
    reportHeading: 'O teu relatório de progresso',
    reportIntro: 'Eis o ponto da tua aventura:',
    reportLevel: 'Nível', reportXp: 'XP', reportStage: 'Estágio', reportWallet: 'Moedas',
    reportQuests: 'Missões resolvidas', reportNpcs: 'PNJ encontrados', reportPlaytime: 'Tempo de jogo total',
    reportCta: 'Retomar a aventura',
    broadcastSubject: 'Mensagem da equipa Horizon ZeldCraft 📢',
    broadcastHeading: 'Uma mensagem da equipa',
    footer: 'Horizon ZeldCraft — um companheiro mágico para fazer crescer todos os dias.',
    footerUnsub: 'Recebes este e-mail porque tens uma conta no Horizon ZeldCraft.',
  },
};

function tr(locale: EmailLocale, key: string, vars?: Record<string, string>): string {
  let s = STR[locale]?.[key] ?? STR.fr[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

const GAME_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://horizon-zeldcraft.vercel.app';

/** Bandeau décoratif : image réelle si `bannerImageUrl` fourni (RepRules.emailBannerImageUrl),
 * sinon repli émoji cohérent avec l'UI du jeu (voir commentaire d'en-tête de fichier). */
function bannerHtml(bannerImageUrl?: string): string {
  if (bannerImageUrl) {
    return `<img src="${bannerImageUrl}" alt="Horizon ZeldCraft" style="width:100%;max-height:220px;object-fit:cover;border-radius:12px 12px 0 0;display:block;" />`;
  }
  return `<div style="background:linear-gradient(135deg,#4c1d95,#0f172a);padding:28px 24px;border-radius:12px 12px 0 0;text-align:center;">
    <div style="font-size:42px;line-height:1;">🐲✨🗡️🛡️🏰</div>
  </div>`;
}

function wrapHtml(opts: { locale: EmailLocale; bannerImageUrl?: string }, heading: string, bodyHtml: string): string {
  const { locale, bannerImageUrl } = opts;
  return `<!DOCTYPE html>
<html lang="${locale}">
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155;">
    ${bannerHtml(bannerImageUrl)}
    <div style="padding:28px 24px;color:#e2e8f0;">
      <h1 style="font-size:22px;margin:0 0 16px;color:#a78bfa;">${heading}</h1>
      ${bodyHtml}
    </div>
    <div style="padding:16px 24px;background:#0f172a;color:#64748b;font-size:11px;text-align:center;">
      <p style="margin:0 0 4px;">${tr(locale, 'footer')}</p>
      <p style="margin:0;">${tr(locale, 'footerUnsub')}</p>
    </div>
  </div>
</body>
</html>`;
}

function ctaButton(label: string, href: string): string {
  return `<div style="text-align:center;margin:24px 0 8px;">
    <a href="${href}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;font-weight:bold;padding:12px 28px;border-radius:8px;">${label}</a>
  </div>`;
}

/** E-mail de bienvenue — envoyé UNE SEULE FOIS, exactement à la création d'un compte "Jouer sans
 * portefeuille" par e-mail (voir RepRules.welcomeEmailEnabled, gameState.ts, NoWalletAccessPanel.tsx).
 * ⚠️ Ne contient JAMAIS le mot de passe en clair (bonne pratique de sécurité) : sert uniquement à
 * confirmer que l'adresse e-mail existe bien et à souhaiter la bienvenue. */
export function buildWelcomeEmail(opts: { locale: EmailLocale; email: string; bannerImageUrl?: string }): { subject: string; html: string } {
  const { locale, email, bannerImageUrl } = opts;
  const name = email.split('@')[0];
  const subject = tr(locale, 'welcomeSubject', { name });
  const html = wrapHtml({ locale, bannerImageUrl }, tr(locale, 'welcomeHeading'), `
    <p style="font-size:15px;line-height:1.6;">${tr(locale, 'welcomeBody')}</p>
    ${ctaButton(tr(locale, 'welcomeCta'), GAME_URL)}
  `);
  return { subject, html };
}

const STAGE_LABEL: Record<EmailLocale, Record<string, string>> = {
  fr: { egg: 'Œuf', hatched: 'Éclos', juvenile: 'Juvénile', adult: 'Adulte', ancient: 'Ancien' },
  en: { egg: 'Egg', hatched: 'Hatched', juvenile: 'Juvenile', adult: 'Adult', ancient: 'Ancient' },
  es: { egg: 'Huevo', hatched: 'Eclosionado', juvenile: 'Juvenil', adult: 'Adulto', ancient: 'Ancestral' },
  pt: { egg: 'Ovo', hatched: 'Eclodido', juvenile: 'Juvenil', adult: 'Adulto', ancient: 'Ancestral' },
};

/** Traduit une clé de stade brute (voir contract.ts::STAGE_NAMES, ex "juvenile") dans la langue de
 * l'e-mail — utilisé par PlayerStats.tsx (rapport immédiat) et cron-reports/route.ts (rapport
 * programmé), pour ne pas dupliquer ce mini-dictionnaire à deux endroits. */
export function translateStage(locale: EmailLocale, stageKey: string): string {
  return STAGE_LABEL[locale]?.[stageKey] ?? STAGE_LABEL.fr[stageKey] ?? stageKey;
}

export interface PlayerReportData {
  level: number;
  xp: number;
  stage: string;
  wallet: number;
  quests: string; // ex "12 / 30"
  npcs: string;    // ex "5 / 20"
  playtime: string; // déjà formaté (fmtDuration)
}

/** Rapport de progression joueur (bouton immédiat ou envoi programmé — voir
 * PlayerState.scheduledReport, PlayerStats.tsx, cron-reports/route.ts). `customMessage`/
 * `customImageUrl` : texte libre + image optionnels ajoutés par l'admin (ex: annonce d'une
 * nouvelle fonctionnalité), affichés avant les statistiques. */
export function buildPlayerReportEmail(opts: {
  locale: EmailLocale; email: string; stats: PlayerReportData;
  customMessage?: string; customImageUrl?: string; bannerImageUrl?: string;
}): { subject: string; html: string } {
  const { locale, stats, customMessage, customImageUrl, bannerImageUrl } = opts;
  const rows: [string, string][] = [
    [tr(locale, 'reportLevel'), String(stats.level)],
    [tr(locale, 'reportXp'), String(stats.xp)],
    [tr(locale, 'reportStage'), stats.stage],
    [tr(locale, 'reportWallet'), String(stats.wallet)],
    [tr(locale, 'reportQuests'), stats.quests],
    [tr(locale, 'reportNpcs'), stats.npcs],
    [tr(locale, 'reportPlaytime'), stats.playtime],
  ];
  const tableRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #334155;color:#94a3b8;font-size:13px;">${label}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #334155;font-weight:bold;text-align:right;">${value}</td>
    </tr>`).join('');
  const html = wrapHtml({ locale, bannerImageUrl }, tr(locale, 'reportHeading'), `
    ${customMessage ? `<p style="font-size:15px;line-height:1.6;background:#312e81;padding:12px 16px;border-radius:8px;">${escapeHtml(customMessage)}</p>` : ''}
    ${customImageUrl ? `<img src="${customImageUrl}" alt="" style="width:100%;border-radius:8px;margin:12px 0;" />` : ''}
    <p style="font-size:15px;line-height:1.6;">${tr(locale, 'reportIntro')}</p>
    <table style="width:100%;border-collapse:collapse;margin-top:8px;">${tableRows}</table>
    ${ctaButton(tr(locale, 'reportCta'), GAME_URL)}
  `);
  return { subject: tr(locale, 'reportSubject'), html };
}

/** Message libre — utilisé pour l'envoi ciblé (un joueur) ou l'envoi de masse (maintenance,
 * annonce à toute la communauté) depuis Administration → "Statistiques par joueur". */
export function buildBroadcastEmail(opts: {
  locale: EmailLocale; message: string; imageUrl?: string; bannerImageUrl?: string; subject?: string;
}): { subject: string; html: string } {
  const { locale, message, imageUrl, bannerImageUrl, subject } = opts;
  const html = wrapHtml({ locale, bannerImageUrl }, tr(locale, 'broadcastHeading'), `
    ${imageUrl ? `<img src="${imageUrl}" alt="" style="width:100%;border-radius:8px;margin-bottom:12px;" />` : ''}
    <p style="font-size:15px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(message)}</p>
    ${ctaButton(tr(locale, 'reportCta'), GAME_URL)}
  `);
  return { subject: subject?.trim() || tr(locale, 'broadcastSubject'), html };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
