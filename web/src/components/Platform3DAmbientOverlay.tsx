'use client';

import { useEffect, useMemo, useState } from 'react';
import type { WorldThemeDef, MoonPhaseInfo } from '@/lib/gameState';

/**
 * Calque décoratif purement DOM/CSS (aucun mesh Three.js, aucun impact sur la scène 3D existante
 * — voir demande utilisateur "cycle jour/nuit [...] paramétrable dans le menu Administration" et
 * le choix technique documenté dans gameState.ts § thèmes) superposé au-dessus du `<canvas>` de
 * Platform3DWidget.tsx : soleil/lune (+ phase), étoiles, étoile filante occasionnelle, nuages,
 * pluie passagère, rapaces, sorcière volante, chauve-souris — chaque élément paramétrable par
 * thème (voir WorldThemeElements). Volontairement `pointer-events-none` pour ne jamais intercepter
 * les interactions de la Plateforme 3D (déplacement, ramassage d'objets, clic sur PNJ, etc.).
 */
export function Platform3DAmbientOverlay({ isNight, theme, moonPhase }: {
  isNight: boolean; theme: WorldThemeDef | null; moonPhase: MoonPhaseInfo | null;
}) {
  const el = theme?.elements;
  const [shootingStar, setShootingStar] = useState(false);
  const [raining, setRaining] = useState(false);
  const [ambientToast, setAmbientToast] = useState<string | null>(null);

  const intervalMs = Math.max(5, el?.ambientEventIntervalSec ?? 45) * 1000;

  // Étoile filante occasionnelle (nuit uniquement) — brève traînée CSS.
  useEffect(() => {
    if (!el?.shootingStarsEnabled) return;
    const id = setInterval(() => {
      if (Math.random() < 0.5) { setShootingStar(true); setTimeout(() => setShootingStar(false), 1200); }
    }, intervalMs);
    return () => clearInterval(id);
  }, [el?.shootingStarsEnabled, intervalMs]);

  // Pluie passagère (probabilité par thème, indépendante de la météo on-chain) — courte averse.
  useEffect(() => {
    const chance = el?.rainChancePct ?? 0;
    if (chance <= 0) return;
    const id = setInterval(() => {
      if (Math.random() * 100 < chance) { setRaining(true); setTimeout(() => setRaining(false), 15_000); }
    }, intervalMs);
    return () => clearInterval(id);
  }, [el?.rainChancePct, intervalMs]);

  // Hululement de hibou / cri de loup-garou / sifflotement de la sorcière — bulle de texte
  // éphémère (le jeu n'a pas de système audio, voir gameState.ts § scope décoratif).
  useEffect(() => {
    const events: string[] = [];
    if (el?.owlHootEnabled) events.push('🦉 Hou hou…');
    if (el?.werewolfHowlEnabled) events.push('🐺 Awoooo !');
    if (el?.witchEnabled) events.push('🧙‍♀️ *sifflote*');
    if (!events.length) return;
    const id = setInterval(() => {
      if (Math.random() < 0.4) {
        setAmbientToast(events[Math.floor(Math.random() * events.length)]);
        setTimeout(() => setAmbientToast(null), 3000);
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, [el?.owlHootEnabled, el?.werewolfHowlEnabled, el?.witchEnabled, intervalMs]);

  // Positions pseudo-aléatoires mais stables des étoiles (recalculées seulement si le thème change).
  const stars = useMemo(() => Array.from({ length: 28 }, (_, i) => ({
    left: (i * 37.3) % 100, top: (i * 53.7) % 60, delay: (i * 0.37) % 3, size: 1 + (i % 3),
  })), [theme?.id]);

  if (!el) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-b-xl z-[5]">
      {/* Ciel étoilé (nuit) */}
      {el.stars && stars.map((s, i) => (
        <div key={i} className="absolute rounded-full bg-white/80 animate-pulse"
          style={{ left: `${s.left}%`, top: `${s.top}%`, width: s.size, height: s.size, animationDelay: `${s.delay}s` }} />
      ))}
      {/* Étoile filante */}
      {shootingStar && (
        <div className="absolute top-[8%] left-[10%] w-16 h-0.5 bg-gradient-to-r from-transparent via-white to-transparent"
          style={{ transform: 'rotate(20deg)', animation: 'zc-shooting-star 1.2s linear' }} />
      )}
      {/* Soleil / Lune (+ phase) */}
      {el.sun && !isNight && <div className="absolute top-2 right-3 text-2xl drop-shadow" title="☀️">☀️</div>}
      {el.moon && isNight && (
        <div className="absolute top-2 right-3 text-2xl drop-shadow" title={moonPhase?.key ?? 'moon'}>
          {moonPhase?.emoji ?? '🌙'}
        </div>
      )}
      {/* Nuages dérivants (jour ou nuit selon thème) */}
      {el.clouds && (
        <>
          <div className="absolute top-3 text-xl opacity-70" style={{ animation: 'zc-drift-cloud 38s linear infinite' }}>☁️</div>
          <div className="absolute top-10 text-lg opacity-50" style={{ animation: 'zc-drift-cloud 55s linear infinite', animationDelay: '-20s' }}>☁️</div>
        </>
      )}
      {/* Pluie passagère */}
      {raining && (
        <div className="absolute inset-0 text-sm opacity-60" style={{ animation: 'zc-rain-fade 15s ease-in-out' }}>
          <span className="absolute top-0 left-[20%]" style={{ animation: 'zc-rain-drop 0.8s linear infinite' }}>🌧️</span>
          <span className="absolute top-0 left-[55%]" style={{ animation: 'zc-rain-drop 0.9s linear infinite', animationDelay: '0.3s' }}>🌧️</span>
          <span className="absolute top-0 left-[80%]" style={{ animation: 'zc-rain-drop 0.7s linear infinite', animationDelay: '0.5s' }}>🌧️</span>
        </div>
      )}
      {/* Rapaces qui tournoient (jour) */}
      {el.raptorsEnabled && !isNight && (
        <div className="absolute top-6 left-1/2 text-lg" style={{ animation: 'zc-circle-fly 20s linear infinite' }}>🦅</div>
      )}
      {/* Chauve-souris (nuit) */}
      {el.batsEnabled && isNight && (
        <>
          <div className="absolute top-8 text-base" style={{ animation: 'zc-drift-cloud 9s linear infinite' }}>🦇</div>
          <div className="absolute top-16 text-base" style={{ animation: 'zc-drift-cloud 12s linear infinite', animationDelay: '-4s' }}>🦇</div>
        </>
      )}
      {/* Sorcière volante */}
      {el.witchEnabled && (
        <div className="absolute top-12 text-lg" style={{ animation: 'zc-drift-cloud 26s linear infinite', animationDelay: '-10s' }}>🧙‍♀️</div>
      )}
      {/* Bulle d'ambiance éphémère (hibou/loup-garou/sorcière) */}
      {ambientToast && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-slate-950/80 border border-slate-600 rounded-full px-3 py-1 text-xs text-slate-200 animate-fade-in">
          {ambientToast}
        </div>
      )}
      <style jsx>{`
        @keyframes zc-drift-cloud { from { left: -10%; } to { left: 110%; } }
        @keyframes zc-shooting-star { 0% { opacity: 0; transform: translate(0,0) rotate(20deg); } 15% { opacity: 1; } 100% { opacity: 0; transform: translate(140px, 70px) rotate(20deg); } }
        @keyframes zc-rain-fade { 0% { opacity: 0; } 10% { opacity: 0.6; } 90% { opacity: 0.6; } 100% { opacity: 0; } }
        @keyframes zc-rain-drop { from { top: -5%; } to { top: 105%; } }
        @keyframes zc-circle-fly { from { transform: rotate(0deg) translateX(60px) rotate(0deg); } to { transform: rotate(360deg) translateX(60px) rotate(-360deg); } }
      `}</style>
    </div>
  );
}
