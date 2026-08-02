/**
 * Route API serveur — "Assistant IA" du menu Administration → « Intelligence IA GamePlay ».
 *
 * Reçoit un instantané anonymisé des statistiques de gameplay agrégées (déjà calculées côté
 * client par `AiGameplayIntelligencePanel.tsx` à partir des fonctions `gameState.ts` — jamais de
 * donnée nominative, uniquement des compteurs) et interroge un LLM 100% GRATUIT pour produire une
 * analyse + des recommandations. Les clés d'API ne sont JAMAIS exposées côté client : elles sont
 * lues depuis des variables d'environnement SERVEUR (`GEMINI_API_KEY` / `GROQ_API_KEY`, SANS
 * préfixe `NEXT_PUBLIC_`, contrairement à toutes les autres clés du projet qui sont publiques par
 * nature) et cette route s'exécute uniquement côté serveur (Next.js Route Handler).
 *
 * Deux fournisseurs 100% GRATUITS sont supportés (voir `AiAnalyticsSettings.aiProvider`) :
 *  - Google Gemini (offre gratuite généreuse, voir https://ai.google.dev/gemini-api/docs/pricing).
 *  - Groq (offre gratuite très généreuse, endpoint compatible OpenAI, voir https://console.groq.com).
 *
 * Repli automatique : si le fournisseur choisi par l'admin échoue (notamment 429 — quota gratuit
 * dépassé, cas fréquent chez Gemini) ET que la clé de l'AUTRE fournisseur est configurée, la route
 * retente automatiquement avec l'autre fournisseur avant de renvoyer une erreur au client — le
 * joueur/admin obtient donc une analyse même quand un des deux quotas gratuits est épuisé.
 *
 * Si AUCUNE des deux clés n'est configurée, répond explicitement plutôt que de planter, afin que
 * le panneau admin affiche un message clair au lieu d'une erreur 500 opaque.
 *
 * Voir docs/DEPLOYMENT.md pour la procédure d'obtention des clés (gratuites, sans CB).
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

type Provider = 'gemini' | 'groq';

const GEMINI_ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

const DEFAULT_MODEL: Record<Provider, string> = {
  gemini: 'gemini-2.0-flash',
  groq: 'llama-3.3-70b-versatile',
};

// Anti-abus minimal (best-effort, mémoire du process serveur — suffisant pour un jeu à échelle
// modeste ; l'essentiel de la protection contre le dépassement de quota gratuit reste le contrôle
// côté client via `AiAnalyticsSettings.aiAutoRefreshHours` + `AiInsightsCache.generatedAt`).
let lastCallAt = 0;
const MIN_INTERVAL_MS = 20_000;

async function callGemini(model: string, prompt: string): Promise<{ text: string } | { error: string; status: number }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { error: 'Clé GEMINI_API_KEY absente côté serveur.', status: 501 };
  const res = await fetch(`${GEMINI_ENDPOINT(model)}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return { error: `Erreur Gemini (${res.status}) : ${errText.slice(0, 300)}`, status: res.status };
  }
  const data = await res.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
  return { text };
}

async function callGroq(model: string, prompt: string): Promise<{ text: string } | { error: string; status: number }> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { error: 'Clé GROQ_API_KEY absente côté serveur.', status: 501 };
  const res = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 1024,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return { error: `Erreur Groq (${res.status}) : ${errText.slice(0, 300)}`, status: res.status };
  }
  const data = await res.json();
  const text: string = data?.choices?.[0]?.message?.content ?? '';
  return { text };
}

async function callProvider(provider: Provider, model: string, prompt: string) {
  return provider === 'groq' ? callGroq(model, prompt) : callGemini(model, prompt);
}

export async function POST(req: NextRequest) {
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasGroq = !!process.env.GROQ_API_KEY;
  if (!hasGemini && !hasGroq) {
    return NextResponse.json(
      {
        error: 'not-configured',
        message:
          "Aucune clé IA configurée côté serveur (GEMINI_API_KEY ou GROQ_API_KEY) — voir docs/DEPLOYMENT.md pour en obtenir une gratuitement sur aistudio.google.com ou console.groq.com.",
      },
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

  let body: { stats?: unknown; locale?: string; model?: string; provider?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad-request', message: 'Corps JSON invalide.' }, { status: 400 });
  }
  if (!body.stats || typeof body.stats !== 'object') {
    return NextResponse.json({ error: 'bad-request', message: 'Champ "stats" manquant.' }, { status: 400 });
  }

  let provider: Provider = body.provider === 'groq' ? 'groq' : 'gemini';
  // Si le fournisseur demandé n'a pas de clé configurée mais que l'autre en a une, on bascule
  // directement dessus (ce n'est pas une erreur — juste une configuration serveur incomplète).
  if (provider === 'gemini' && !hasGemini && hasGroq) provider = 'groq';
  if (provider === 'groq' && !hasGroq && hasGemini) provider = 'gemini';

  const requestedModel = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : '';
  // Un modèle Gemini ("gemini-*") saisi alors que le fournisseur effectif est Groq (ou l'inverse)
  // proviendrait d'un ancien réglage — on ignore le modèle incompatible et on retombe sur le défaut.
  const looksGemini = /^gemini-/i.test(requestedModel);
  const looksGroqLike = requestedModel && !looksGemini;
  const model =
    provider === 'gemini' ? (looksGemini ? requestedModel : DEFAULT_MODEL.gemini) : looksGroqLike ? requestedModel : DEFAULT_MODEL.groq;
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
    lastCallAt = now;
    let effectiveProvider = provider;
    let effectiveModel = model;
    let result = await callProvider(effectiveProvider, effectiveModel, prompt);
    let fallbackUsed = false;

    // Repli automatique : le fournisseur choisi échoue (souvent 429 = quota gratuit dépassé chez
    // Gemini) et l'AUTRE fournisseur a bien une clé configurée → on retente immédiatement dessus
    // au lieu de renvoyer une erreur au joueur/admin.
    if ('error' in result) {
      const fallbackProvider: Provider = effectiveProvider === 'gemini' ? 'groq' : 'gemini';
      const fallbackHasKey = fallbackProvider === 'gemini' ? hasGemini : hasGroq;
      if (fallbackHasKey) {
        const fallbackModel = DEFAULT_MODEL[fallbackProvider];
        const fallbackResult = await callProvider(fallbackProvider, fallbackModel, prompt);
        if (!('error' in fallbackResult)) {
          result = fallbackResult;
          effectiveProvider = fallbackProvider;
          effectiveModel = fallbackModel;
          fallbackUsed = true;
        }
      }
    }

    if ('error' in result) {
      return NextResponse.json(
        { error: 'provider-error', message: result.error },
        { status: result.status && result.status >= 400 && result.status < 600 ? result.status : 502 },
      );
    }
    if (!result.text) {
      return NextResponse.json({ error: 'empty-response', message: 'Réponse vide du fournisseur IA.' }, { status: 502 });
    }
    const text = fallbackUsed
      ? `_⚠️ Fournisseur « ${provider} » indisponible (quota dépassé ou clé absente) — analyse générée automatiquement via « ${effectiveProvider} » en secours._\n\n${result.text}`
      : result.text;
    return NextResponse.json({ text, model: effectiveModel, provider: effectiveProvider, generatedAt: Date.now() });
  } catch (err) {
    return NextResponse.json(
      { error: 'network-error', message: err instanceof Error ? err.message : 'Erreur réseau inconnue.' },
      { status: 502 },
    );
  }
}
