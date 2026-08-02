/**
 * Route API serveur — "Assistant IA" du menu Administration → « Intelligence IA GamePlay ».
 *
 * Reçoit un instantané anonymisé des statistiques de gameplay agrégées (déjà calculées côté
 * client par `AiGameplayIntelligencePanel.tsx` à partir des fonctions `gameState.ts` — jamais de
 * donnée nominative, uniquement des compteurs) et interroge un LLM 100% GRATUIT pour produire une
 * analyse + des recommandations. La clé d'API n'est JAMAIS exposée côté client : elle est lue
 * depuis une variable d'environnement SERVEUR (`GEMINI_API_KEY`, SANS préfixe `NEXT_PUBLIC_`,
 * contrairement à toutes les autres clés du projet qui sont publiques par nature) et cette route
 * s'exécute uniquement côté serveur (Next.js Route Handler).
 *
 * Fournisseur par défaut : Google Gemini (offre gratuite généreuse, voir
 * https://ai.google.dev/gemini-api/docs/pricing — aucune carte bancaire requise). Si
 * `GEMINI_API_KEY` n'est pas configurée, répond explicitement plutôt que de planter, afin que le
 * panneau admin affiche un message clair au lieu d'une erreur 500 opaque.
 *
 * Voir docs/DEPLOYMENT.md pour la procédure d'obtention de la clé (gratuite, aistudio.google.com).
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const GEMINI_ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// Anti-abus minimal (best-effort, mémoire du process serveur — suffisant pour un jeu à échelle
// modeste ; l'essentiel de la protection contre le dépassement de quota gratuit reste le contrôle
// côté client via `AiAnalyticsSettings.aiAutoRefreshHours` + `AiInsightsCache.generatedAt`).
let lastCallAt = 0;
const MIN_INTERVAL_MS = 20_000;

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'not-configured', message: "Clé GEMINI_API_KEY absente côté serveur — voir docs/DEPLOYMENT.md pour l'obtenir gratuitement sur aistudio.google.com." },
      { status: 501 },
    );
  }

  const now = Date.now();
  if (now - lastCallAt < MIN_INTERVAL_MS) {
    return NextResponse.json(
      { error: 'rate-limited', message: 'Merci de patienter quelques secondes avant une nouvelle génération.' },
      { status: 429 },
    );
  }

  let body: { stats?: unknown; locale?: string; model?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad-request', message: 'Corps JSON invalide.' }, { status: 400 });
  }
  if (!body.stats || typeof body.stats !== 'object') {
    return NextResponse.json({ error: 'bad-request', message: 'Champ "stats" manquant.' }, { status: 400 });
  }

  const model = typeof body.model === 'string' && body.model ? body.model : 'gemini-2.0-flash';
  const locale = body.locale === 'en' || body.locale === 'es' || body.locale === 'pt' ? body.locale : 'fr';

  const langInstruction: Record<string, string> = {
    fr: 'Réponds en français.',
    en: 'Answer in English.',
    es: 'Responde en español.',
    pt: 'Responde em português.',
  };

  const prompt = [
    'Tu es un analyste gameplay/UX senior pour un jeu web3 de type Tamagotchi/dungeon-crawler (Horizon ZeldCraft).',
    "On te fournit des statistiques AGRÉGÉES et ANONYMISÉES (aucune donnée nominative) sur le comportement des joueurs : joueurs actifs par jour, temps passé par widget, entonnoir de quêtes (bloquées/échouées/réussies), zones de la carte les plus fréquentées et où les joueurs s'évanouissent le plus, signaux de monétisation, score moyen de risque de décrochage.",
    "Analyse ces données et produis, en 5 sections concises (Markdown, avec des titres '###') :",
    '1. Points forts observés',
    '2. Frictions / risques de décrochage identifiés',
    '3. Recommandations concrètes de game design (priorisées)',
    '4. Idées de nouveaux services/monétisation à envisager',
    '5. Une phrase de synthèse',
    langInstruction[locale],
    '',
    'Statistiques :',
    JSON.stringify(body.stats, null, 2),
  ].join('\n');

  try {
    const res = await fetch(`${GEMINI_ENDPOINT(model)}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
      }),
    });
    lastCallAt = now;
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return NextResponse.json(
        { error: 'provider-error', message: `Erreur fournisseur IA (${res.status}) : ${errText.slice(0, 300)}` },
        { status: 502 },
      );
    }
    const data = await res.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
    if (!text) {
      return NextResponse.json({ error: 'empty-response', message: 'Réponse vide du fournisseur IA.' }, { status: 502 });
    }
    return NextResponse.json({ text, model, generatedAt: Date.now() });
  } catch (err) {
    return NextResponse.json(
      { error: 'network-error', message: err instanceof Error ? err.message : 'Erreur réseau inconnue.' },
      { status: 502 },
    );
  }
}
