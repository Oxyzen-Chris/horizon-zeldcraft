'use client';

import { useMemo } from 'react';
import type { WorldThemeDef } from '@/lib/gameState';

/**
 * Calque décoratif purement DOM/CSS superposé à la Mapmonde (voir WorldMapWidget.tsx) : troupeau
 * de sangliers + marcassins, sorcière volante, rapaces qui tournoient — traversent l'INTÉGRALITÉ
 * de la carte (voir demande utilisateur), en boucle, sans jamais intercepter les clics/déplacements
 * du joueur (`pointer-events-none`). Chaque élément paramétrable par thème (voir
 * WorldThemeElements dans gameState.ts). Volontairement de simples sprites emoji dérivants (pas des
 * PNJ/familiers articulés comme lib/roamingActors.ts) : purement immersif, hors gameplay, pour
 * limiter le risque de régression sur les mécaniques de jeu déjà en place.
 */
export function WorldMapAmbientOverlay({ theme, isNight }: { theme: WorldThemeDef | null; isNight: boolean }) {
  const el = theme?.elements;
  const boars = useMemo(() => Array.from({ length: 4 }, (_, i) => ({
    top: 15 + (i * 19) % 65, duration: 70 + i * 14, delay: -(i * 17), emoji: i === 0 ? '🐗' : '🐽',
  })), [theme?.id]);

  if (!el) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-[6]">
      {/* Troupeau de sangliers + marcassins (jour, traverse toute la Mapmonde) */}
      {el.boarHerdEnabled && !isNight && boars.map((b, i) => (
        <div key={i} className="absolute text-xl" style={{
          top: `${b.top}%`, animation: `zc-map-drift-x ${b.duration}s linear infinite`, animationDelay: `${b.delay}s`,
        }}>{b.emoji}</div>
      ))}
      {/* Sorcière volante sur son balai (sifflote) */}
      {el.witchEnabled && (
        <div className="absolute text-2xl" style={{ top: '12%', animation: 'zc-map-drift-diag 90s linear infinite' }}>🧙‍♀️</div>
      )}
      {/* Rapaces qui tournoient (aigles/vautours/faucons — jour) */}
      {el.raptorsEnabled && !isNight && (
        <>
          <div className="absolute text-xl" style={{ top: '20%', left: '30%', animation: 'zc-map-circle 30s linear infinite' }}>🦅</div>
          <div className="absolute text-xl" style={{ top: '55%', left: '65%', animation: 'zc-map-circle 34s linear infinite reverse' }}>🦅</div>
        </>
      )}
      <style jsx>{`
        @keyframes zc-map-drift-x { from { left: -5%; } to { left: 105%; } }
        @keyframes zc-map-drift-diag { 0% { left: -5%; top: 5%; } 50% { top: 45%; } 100% { left: 105%; top: 10%; } }
        @keyframes zc-map-circle { from { transform: rotate(0deg) translateX(80px) rotate(0deg); } to { transform: rotate(360deg) translateX(80px) rotate(-360deg); } }
      `}</style>
    </div>
  );
}
