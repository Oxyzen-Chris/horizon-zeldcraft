'use client';

/**
 * Pop-up permanent EN HAUT DE L'ÉCRAN (⏳ sablier animé + décompte, clignotant) affiché tant qu'un
 * ou plusieurs "Élixirs combinés" temporisés sont actifs (voir InventoryWidget.tsx "🧪 Combiner des
 * potions" et gameState.ts::combinePotions/PlayerState.hpInvulnerableUntil/forceBoostUntil/
 * oxygenShieldUntil/fatigueShieldUntil). Même principe de rendu que DemoSessionTimerWidget.tsx
 * (fixed top, sablier ⏳, `subscribePlayer` en temps réel) : aucune donnée dupliquée, tout est lu
 * directement depuis les horodatages `*Until` du PlayerState — un nouvel Élixir du même type
 * (ex. combiner une seconde fois une recette "Invulnérabilité") prolonge/rafraîchit simplement le
 * même horodatage, sans jamais faire apparaître deux pop-up pour le même buff.
 *
 * Purement additif : ne lit/écrit rien qui n'existe pas déjà (les 4 champs `*Until` sont optionnels
 * sur PlayerState, `undefined` par défaut = aucun impact sur un joueur qui n'a jamais combiné de
 * potion) — zéro régression sur le reste du jeu.
 */
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { subscribePlayer, type PlayerState } from '@/lib/gameState';

type ElixirKind = 'invulnerability' | 'forceX2' | 'oxygenFull' | 'fatigueFull';

const ELIXIR_ICONS: Record<ElixirKind, string> = {
  invulnerability: '🛡️✨',
  forceX2: '💪⚡',
  oxygenFull: '🫧♾️',
  fatigueFull: '🥱🔋',
};

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}h ${pad(m)}m ${pad(s)}s` : `${m}m ${pad(s)}s`;
}

export function ActiveElixirsBanner({ address }: { address?: string | null }) {
  const { t } = useI18n();
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!address) { setPlayer(null); return; }
    return subscribePlayer(address, setPlayer);
  }, [address]);

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  if (!player) return null;

  const active: { kind: ElixirKind; until: number; mult?: number }[] = [];
  if (player.hpInvulnerableUntil && player.hpInvulnerableUntil > now) {
    active.push({ kind: 'invulnerability', until: player.hpInvulnerableUntil });
  }
  if (player.forceBoostUntil && player.forceBoostUntil > now) {
    active.push({ kind: 'forceX2', until: player.forceBoostUntil, mult: player.forceBoostMultiplier ?? 2 });
  }
  if (player.oxygenShieldUntil && player.oxygenShieldUntil > now) {
    active.push({ kind: 'oxygenFull', until: player.oxygenShieldUntil });
  }
  if (player.fatigueShieldUntil && player.fatigueShieldUntil > now) {
    active.push({ kind: 'fatigueFull', until: player.fatigueShieldUntil });
  }

  if (!active.length) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 items-center pointer-events-none" data-testid="active-elixirs-banner">
      {active.map((e) => (
        <div
          key={e.kind}
          data-elixir-kind={e.kind}
          className="animate-pulse pointer-events-auto bg-gradient-to-r from-fuchsia-900/90 via-slate-900/90 to-fuchsia-900/90 border-2 border-fuchsia-400 rounded-xl shadow-lg shadow-fuchsia-500/40 px-4 py-2 flex items-center gap-3 max-w-sm"
        >
          <span className="text-3xl animate-bounce" aria-hidden>⏳</span>
          <div className="text-xs text-left">
            <p className="text-fuchsia-200 font-bold text-sm">{ELIXIR_ICONS[e.kind]} {t(`elixir.kind.${e.kind}`, e.mult ? { mult: e.mult } : undefined)}</p>
            <p className="text-slate-200 mt-0.5">{t(`elixir.desc.${e.kind}`, e.mult ? { mult: e.mult } : undefined)}</p>
            <p className="text-fuchsia-300 font-mono mt-1" data-elixir-remaining>{t('elixir.remaining', { time: formatRemaining(e.until - now) })}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
