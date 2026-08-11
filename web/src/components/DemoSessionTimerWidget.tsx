'use client';

/**
 * Petit pop-up permanent (sablier ⏳ animé + compte à rebours) affiché en jeu UNIQUEMENT pour une
 * session "Accès Démo" (Google approuvé OU anonyme — jamais pour "Jouer sans portefeuille" qui
 * n'a pas de limite de durée, ni pour un vrai portefeuille crypto) — voir
 * RepRules.demoSessionMaxDurationMin (2h par défaut) et gameState.ts::ensureDemoAccountTimer/
 * ensureDemoAnonTimer/getDemoTimerStartedAt/resetDemoAccountTimer.
 *
 * Le chrono est PERSISTANT côté serveur (RTDB) — voir commentaire dans gameState.ts : une simple
 * déconnexion/reconnexion ne le réinitialise jamais, seul l'admin peut le relancer pour un compte
 * Démo Google identifié (bouton "🔄 Réactiver le chrono Démo", DemoAccessRequestsPanel.tsx).
 *
 * Revérifie l'échéance côté serveur toutes les 30s (en plus du tick visuel local à la seconde) —
 * pour qu'une réactivation admin en cours de partie soit prise en compte SANS que le joueur ait à
 * se reconnecter. À échéance zéro : déconnexion forcée (`disconnectSession()`) puis retour à
 * l'accueil avec un message explicite (voir page.tsx / i18n `home.demo.sessionExpired`).
 */
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useEffectiveSession, useEffectiveSessionControls } from '@/lib/effectiveAccount';
import { getRepRules, getDemoTimerStartedAt } from '@/lib/gameState';

const EXPIRED_FLAG_KEY = 'zc.demoSessionExpired';

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
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const expiredHandled = useRef(false);

  const isDemo = session?.kind === 'demo';

  // Récupère (et revérifie périodiquement) l'échéance du chrono côté serveur.
  useEffect(() => {
    if (!isDemo || !session) { setDeadline(null); return; }
    let cancelled = false;
    const refresh = async () => {
      const [rules, startedAt] = await Promise.all([
        getRepRules(),
        getDemoTimerStartedAt(session.uid, session.demoMode === 'anonymous' ? 'anonymous' : 'approved'),
      ]);
      if (cancelled) return;
      const maxMin = rules.demoSessionMaxDurationMin ?? 120;
      setDeadline(startedAt ? startedAt + maxMin * 60_000 : null);
    };
    refresh();
    const iv = setInterval(refresh, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [isDemo, session]);

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
    <div className="fixed bottom-4 right-4 z-[9997] bg-slate-900/90 border border-amber-600/60 rounded-lg shadow-lg px-3 py-2 flex items-center gap-2">
      <span className="text-xl animate-bounce" aria-hidden>⏳</span>
      <div className="text-xs">
        <p className="text-amber-300 font-semibold">{t('game.demoTimer.label')}</p>
        <p className="text-slate-200 font-mono">{formatRemaining(remaining)}</p>
      </div>
    </div>
  );
}

/** À appeler sur la page d'accueil pour afficher (une seule fois) le message de fin d'accès Démo
 * après une déconnexion forcée par ce widget — voir page.tsx. */
export function consumeDemoExpiredFlag(): boolean {
  if (typeof window === 'undefined') return false;
  const v = window.sessionStorage.getItem(EXPIRED_FLAG_KEY);
  if (v) window.sessionStorage.removeItem(EXPIRED_FLAG_KEY);
  return !!v;
}
