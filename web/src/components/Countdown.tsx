'use client';

import { useEffect, useState } from 'react';

/**
 * Formate un nombre de secondes en compte à rebours lisible.
 * Ex: 3725 → "1h 02m 05s" ; 45 → "45s" ; 0 → "prêt"
 */
function formatCountdown(seconds: number): string {
  if (seconds <= 0) return '';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}j ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/**
 * Affiche un compte à rebours qui se met à jour toutes les secondes.
 * readyLabel s'affiche quand le timer atteint 0.
 */
export function Countdown({
  targetTimestamp,
  readyLabel = '✅ Prêt',
}: {
  targetTimestamp: number; // unix seconds
  readyLabel?: string;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, targetTimestamp - now);
  if (remaining <= 0) {
    return <span className="text-emerald-400 font-semibold">{readyLabel}</span>;
  }
  return <span className="text-amber-300 font-mono text-xs">⏳ {formatCountdown(remaining)}</span>;
}
