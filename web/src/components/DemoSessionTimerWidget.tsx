'use client';

/**
 * Petit pop-up permanent (sablier ⏳ animé + compte à rebours) affiché en jeu UNIQUEMENT pour une
 * session "Accès Démo" (Google approuvé OU anonyme — jamais pour "Jouer sans portefeuille" qui
 * n'a pas de limite de durée, ni pour un vrai portefeuille crypto) — voir
 * RepRules.demoSessionMaxDurationMin (2h par défaut) et gameState.ts::ensureDemoAccountTimer/
 * ensureDemoAnonTimer/subscribeDemoTimerInfo/resetDemoAccountTimer.
 *
 * Le chrono est PERSISTANT côté serveur (RTDB) — voir commentaire dans gameState.ts : une simple
 * déconnexion/reconnexion ne le réinitialise jamais, seul l'admin peut le relancer pour un compte
 * Démo Google identifié (bouton "🔄 Réactiver le chrono Démo", DemoAccessRequestsPanel.tsx /
 * PlayerStats.tsx), ou modifier sa durée personnalisée ("Durée max de session Démo pour ce
 * joueur", Administration > Statistiques par joueur).
 *
 * ⚠️ Écoute désormais EN TEMPS RÉEL (`onValue` via `subscribeRepRules`/`subscribeDemoTimerInfo`,
 * plutôt qu'un sondage périodique) — corrige le bug où une modification admin (réactivation du
 * chrono, changement de la durée personnalisée) faite alors que le joueur est DÉJÀ connecté et en
 * train de jouer n'était prise en compte qu'au bout de 30s (ou jamais, si la session avait déjà
 * expiré avant l'écoulement de ce délai). À échéance zéro : déconnexion forcée
 * (`disconnectSession()`) puis retour à l'accueil avec un message explicite (voir page.tsx / i18n
 * `home.demo.sessionExpired`).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useEffectiveSession, useEffectiveSessionControls } from '@/lib/effectiveAccount';
import { subscribeRepRules, subscribeDemoTimerInfo, type RepRules } from '@/lib/gameState';

const EXPIRED_FLAG_KEY = 'zc.demoSessionExpired';
// Durée max effectivement appliquée au moment de l'expiration (voir commentaire plus bas) — lue
// une seule fois par `consumeDemoExpiredFlag()` pour afficher un message cohérent sur l'écran
// d'accueil, même si l'admin avait défini une surcharge personnelle pour ce joueur.
const EXPIRED_DURATION_KEY = 'zc.demoSessionExpiredDurationMin';

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}h ${pad(m)}m ${pad(s)}s` : `${m}m ${pad(s)}s`;
}

export function DemoSessionTimerWidget() {
  const { t } = useI18n();
  const session = useEffectiveSession();
  const { disconnectSession } = useEffectiveSessionControls();
  const [rules, setRules] = useState<RepRules | null>(null);
  const [timerInfo, setTimerInfo] = useState<{ startedAt: number | null; maxDurationMinOverride?: number }>({ startedAt: null });
  const [now, setNow] = useState(Date.now());
  const expiredHandled = useRef(false);

  const isDemo = session?.kind === 'demo';

  // Écoute EN TEMPS RÉEL (onValue) la durée globale (catalog/repRules) et le chrono/surcharge de
  // CE joueur (demoAccessRequests/{uid} ou demoSessions/anonTimer/{uid}) — toute modification
  // admin est reflétée quasi instantanément, sans sondage ni reconnexion nécessaire.
  useEffect(() => {
    if (!isDemo || !session) { setRules(null); setTimerInfo({ startedAt: null }); return; }
    const unsubRules = subscribeRepRules(setRules);
    const unsubTimer = subscribeDemoTimerInfo(session.uid, session.demoMode === 'anonymous' ? 'anonymous' : 'approved', setTimerInfo);
    return () => { unsubRules(); unsubTimer(); };
  }, [isDemo, session]);

  // Une surcharge par-joueur (Administration > Statistiques par joueur > "Compte Démo / sans
  // portefeuille") prévaut sur la durée globale — uniquement disponible en mode 'approved'.
  const maxMin = useMemo(
    () => timerInfo.maxDurationMinOverride ?? rules?.demoSessionMaxDurationMin ?? 120,
    [timerInfo, rules],
  );
  const deadline = useMemo(() => {
    if (!timerInfo.startedAt) return null;
    return timerInfo.startedAt + maxMin * 60_000;
  }, [timerInfo, maxMin]);

  // Tick visuel local à la seconde.
  useEffect(() => {
    if (!isDemo) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [isDemo]);

  // Déconnexion forcée à échéance.
  useEffect(() => {
    if (!isDemo || !deadline || expiredHandled.current) return;
    if (now < deadline) return;
    expiredHandled.current = true;
    (async () => {
      await disconnectSession();
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(EXPIRED_FLAG_KEY, '1');
        // Mémorise la durée max EFFECTIVEMENT appliquée à ce joueur (surcharge personnelle
        // incluse) pour que le message affiché sur l'écran d'accueil (page.tsx, clé i18n
        // `home.demo.sessionExpired`) reste cohérent avec elle, plutôt que d'afficher une durée
        // générique en dur — voir `formatDemoDurationLabel` côté gameState.ts.
        window.sessionStorage.setItem(EXPIRED_DURATION_KEY, String(maxMin));
        // Navigation complète (PAS router.push) : le cache client du App Router peut réutiliser
        // une instance déjà montée de la page d'accueil (visitée plus tôt dans la session) sans
        // relancer son effet de montage — le message de fin d'accès Démo ne s'afficherait alors
        // jamais (bug constaté et corrigé via test Playwright). Un rechargement complet garantit
        // aussi une réinitialisation propre de tous les hooks wagmi/Firebase.
        window.location.href = '/';
      }
    })();
  }, [isDemo, deadline, now, disconnectSession]);

  if (!isDemo || !deadline) return null;
  const remaining = deadline - now;
  if (remaining <= 0) return null;

  return (
    <div className="fixed top-20 right-4 z-[9997] bg-slate-900/90 border border-amber-600/60 rounded-lg shadow-lg px-3 py-2 flex items-center gap-2">
      <span className="text-xl animate-bounce" aria-hidden>⏳</span>
      <div className="text-xs">
        <p className="text-amber-300 font-semibold">{t('game.demoTimer.label')}</p>
        <p className="text-slate-200 font-mono">{formatRemaining(remaining)}</p>
      </div>
    </div>
  );
}

/** À appeler sur la page d'accueil pour afficher (une seule fois) le message de fin d'accès Démo
 * après une déconnexion forcée par ce widget — voir page.tsx. Renvoie aussi la durée max (en
 * minutes) effectivement appliquée à ce joueur au moment de l'expiration (surcharge personnelle
 * incluse), pour que le message reste cohérent avec elle (voir `formatDemoDurationLabel` côté
 * gameState.ts) plutôt que d'afficher une durée générique en dur. */
export function consumeDemoExpiredFlag(): { expired: boolean; durationMin: number } {
  if (typeof window === 'undefined') return { expired: false, durationMin: 120 };
  const v = window.sessionStorage.getItem(EXPIRED_FLAG_KEY);
  const d = window.sessionStorage.getItem(EXPIRED_DURATION_KEY);
  if (v) window.sessionStorage.removeItem(EXPIRED_FLAG_KEY);
  if (d) window.sessionStorage.removeItem(EXPIRED_DURATION_KEY);
  return { expired: !!v, durationMin: d ? Number(d) : 120 };
}
