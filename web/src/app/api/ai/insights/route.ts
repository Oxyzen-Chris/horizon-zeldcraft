/**
 * Route API serveur — "Assistant IA" du menu Administration → « Intelligence IA GamePlay ».
 *
 * Reçoit un instantané anonymisé des statistiques de gameplay agrégées (déjà calculées côté
 * client par `AiGameplayIntelligencePanel.tsx` à partir des fonctions `gameState.ts` — jamais de
 * donnée nominative, uniquement des compteurs) et interroge un LLM 100% GRATUIT pour produire une
 * analyse + des recommandations. Les clés d'API ne sont JAMAIS exposées côté client : elles sont
 * lues depuis des variables d'environnement SERVEUR (`GEMINI_API_KEY` / `GROQ_API_KEY` /
 * `CEREBRAS_API_KEY` / `OPENROUTER_API_KEY`, SANS préfixe `NEXT_PUBLIC_`, contrairement à toutes
 * les autres clés du projet qui sont publiques par nature) et cette route s'exécute uniquement
 * côté serveur (Next.js Route Handler).
 *
 * Quatre fournisseurs 100% GRATUITS sont supportés (voir `AiAnalyticsSettings.aiProvider`) :
 *  - Google Gemini (offre gratuite généreuse, voir https://ai.google.dev/gemini-api/docs/pricing).
 *  - Groq (offre gratuite très généreuse, endpoint compatible OpenAI, voir https://console.groq.com).
 *  - Cerebras (offre gratuite généreuse, endpoint compatible OpenAI, voir https://cloud.cerebras.ai).
 *  - OpenRouter (modèles au suffixe ":free" gratuits, endpoint compatible OpenAI, voir https://openrouter.ai/keys).
 *
 * Repli en chaîne automatique : si le fournisseur choisi par l'admin échoue (notamment 429 — quota
 * gratuit dépassé, cas fréquent chez Gemini), la route retente automatiquement, dans l'ordre, tous
 * les AUTRES fournisseurs dont la clé est configurée côté serveur, avant de renvoyer une erreur au
 * client — le joueur/admin obtient donc une analyse tant qu'au moins un des quotas gratuits
 * configurés est disponible.
 *
 * Si AUCUNE clé n'est configurée, répond explicitement plutôt que de planter, afin que le panneau
 * admin affiche un message clair au lieu d'une erreur 500 opaque.
 *
 * Voir docs/DEPLOYMENT.md pour la procédure d'obtention des clés (gratuites, sans CB).
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

type Provider = 'gemini' | 'groq' | 'cerebras' | 'openrouter';

// Ordre de priorité du repli en chaîne : on part du fournisseur demandé, puis on retente les
// autres dans cet ordre (seuls ceux dont la clé est configurée côté serveur sont réellement testés).
const PROVIDER_ORDER: Provider[] = ['gemini', 'groq', 'cerebras', 'openrouter'];

const PROVIDER_LABEL: Record<Provider, string> = {
  gemini: 'Google Gemini',
  groq: 'Groq',
  cerebras: 'Cerebras',
  openrouter: 'OpenRouter',
};

// Nom de la variable d'environnement serveur contenant la clé API de chaque fournisseur.
const API_KEY_ENV: Record<Provider, string> = {
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

const GEMINI_ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const CEREBRAS_ENDPOINT = 'https://api.cerebras.ai/v1/chat/completions';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

const DEFAULT_MODEL: Record<Provider, string> = {
  gemini: 'gemini-2.0-flash',
  groq: 'llama-3.3-70b-versatile',
  cerebras: 'llama-3.3-70b',
  openrouter: 'meta-llama/llama-3.3-70b-instruct:free',
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

// Groq, Cerebras et OpenRouter exposent tous les trois une API compatible OpenAI
// (`POST /chat/completions` avec `Authorization: Bearer <clé>`) — une seule fonction suffit.
async function callOpenAiCompatible(
  provider: Exclude<Provider, 'gemini'>,
  endpoint: string,
  model: string,
  prompt: string,
): Promise<{ text: string } | { error: string; status: number }> {
  const apiKey = process.env[API_KEY_ENV[provider]];
  if (!apiKey) return { error: `Clé ${API_KEY_ENV[provider]} absente côté serveur.`, status: 501 };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  // OpenRouter recommande (sans l'exiger) ces deux en-têtes pour identifier l'app appelante.
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://horizon-zeldcraft.vercel.app';
    headers['X-Title'] = 'Horizon ZeldCraft';
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 1024,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return { error: `Erreur ${PROVIDER_LABEL[provider]} (${res.status}) : ${errText.slice(0, 300)}`, status: res.status };
  }
  const data = await res.json();
  const text: string = data?.choices?.[0]?.message?.content ?? '';
  return { text };
}

async function callProvider(provider: Provider, model: string, prompt: string) {
  switch (provider) {
    case 'gemini':
      return callGemini(model, prompt);
    case 'groq':
      return callOpenAiCompatible('groq', GROQ_ENDPOINT, model, prompt);
    case 'cerebras':
      return callOpenAiCompatible('cerebras', CEREBRAS_ENDPOINT, model, prompt);
    case 'openrouter':
      return callOpenAiCompatible('openrouter', OPENROUTER_ENDPOINT, model, prompt);
  }
}

// Un modèle "gemini-*" n'a de sens que pour Gemini ; à l'inverse un modèle compatible OpenAI
// (Groq/Cerebras/OpenRouter) ne doit jamais être envoyé tel quel à Gemini. On ne réutilise donc le
// modèle personnalisé de l'admin QUE pour le fournisseur qu'il a explicitement demandé — chaque
// tentative de repli automatique utilise toujours le modèle par défaut du fournisseur concerné.
function isPlausibleModelFor(provider: Provider, model: string): boolean {
  const looksGemini = /^gemini-/i.test(model);
  return provider === 'gemini' ? looksGemini : !looksGemini;
}

export async function POST(req: NextRequest) {
  const hasKeyFor = Object.fromEntries(PROVIDER_ORDER.map((p) => [p, !!process.env[API_KEY_ENV[p]]])) as Record<
    Provider,
    boolean
  >;
  if (!PROVIDER_ORDER.some((p) => hasKeyFor[p])) {
    return NextResponse.json(
      {
        error: 'not-configured',
        message:
          'Aucune clé IA configurée côté serveur (GEMINI_API_KEY, GROQ_API_KEY, CEREBRAS_API_KEY ou OPENROUTER_API_KEY) — voir docs/DEPLOYMENT.md pour en obtenir une gratuitement sur aistudio.google.com, console.groq.com, cloud.cerebras.ai ou openrouter.ai/keys.',
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

  const requestedProvider: Provider = PROVIDER_ORDER.includes(body.provider as Provider) ? (body.provider as Provider) : 'gemini';
  // Ordre de tentatives : le fournisseur demandé en premier (s'il a une clé), puis les autres
  // fournisseurs configurés dans l'ordre de priorité — au moins une clé existe (vérifié plus haut).
  const tryOrder: Provider[] = [
    ...(hasKeyFor[requestedProvider] ? [requestedProvider] : []),
    ...PROVIDER_ORDER.filter((p) => p !== requestedProvider && hasKeyFor[p]),
  ];

  const requestedModel = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : '';
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
    let effectiveProvider: Provider = tryOrder[0];
    let effectiveModel =
      requestedModel && effectiveProvider === requestedProvider && isPlausibleModelFor(effectiveProvider, requestedModel)
        ? requestedModel
        : DEFAULT_MODEL[effectiveProvider];
    let result = await callProvider(effectiveProvider, effectiveModel, prompt);
    let fallbackUsed = false;
    let firstError: { error: string; status: number } | null = 'error' in result ? result : null;

    // Repli en chaîne : tant que le fournisseur essayé échoue (souvent 429 = quota gratuit
    // dépassé) on tente le suivant dans `tryOrder`, jusqu'à épuisement de la liste — le
    // joueur/admin obtient donc une analyse tant qu'au moins un des quotas gratuits configurés
    // est disponible.
    for (let i = 1; 'error' in result && i < tryOrder.length; i++) {
      const nextProvider = tryOrder[i];
      const nextModel = DEFAULT_MODEL[nextProvider];
      const nextResult = await callProvider(nextProvider, nextModel, prompt);
      if (!('error' in nextResult)) {
        result = nextResult;
        effectiveProvider = nextProvider;
        effectiveModel = nextModel;
        fallbackUsed = true;
      }
    }

    if ('error' in result) {
      const errorToReport = firstError ?? result;
      return NextResponse.json(
        { error: 'provider-error', message: errorToReport.error },
        { status: errorToReport.status && errorToReport.status >= 400 && errorToReport.status < 600 ? errorToReport.status : 502 },
      );
    }
    if (!result.text) {
      return NextResponse.json({ error: 'empty-response', message: 'Réponse vide du fournisseur IA.' }, { status: 502 });
    }
    const text = fallbackUsed
      ? `_⚠️ Fournisseur « ${PROVIDER_LABEL[requestedProvider]} » indisponible (quota dépassé ou clé absente) — analyse générée automatiquement via « ${PROVIDER_LABEL[effectiveProvider]} » en secours._\n\n${result.text}`
      : result.text;
    return NextResponse.json({ text, model: effectiveModel, provider: effectiveProvider, generatedAt: Date.now() });
  } catch (err) {
    return NextResponse.json(
      { error: 'network-error', message: err instanceof Error ? err.message : 'Erreur réseau inconnue.' },
      { status: 502 },
    );
  }
}
