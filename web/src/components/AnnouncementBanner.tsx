'use client';

/**
 * Bandeau d'annonce en direct — affiché en haut de l'écran de jeu, clignotant, dès que l'admin
 * publie un message via Administration → "Statistiques par joueur" § "Annonce en direct" (voir
 * gameState.ts::setGlobalAnnouncement/setPlayerAnnouncement/subscribeAnnouncements et
 * docs/EMAIL_NOTIFICATIONS.md). Deux portées possibles, cumulables (la ciblée d'abord) :
 *  - annonce GLOBALE : vue par tous les joueurs actuellement connectés (ex. maintenance planifiée).
 *  - annonce CIBLÉE : vue uniquement par un joueur précis (son adresse — wallet ou virtuelle).
 *
 * Chaque annonce peut être fermée par le joueur (bouton ✕) — la fermeture est mémorisée par
 * `createdAt` dans `sessionStorage` (namespace par onglet) : rouvrir la page ou publier une
 * NOUVELLE annonce (nouveau `createdAt`) la réaffichera, mais fermer une annonce ne la fait pas
 * réapparaître en boucle à chaque re-render pendant la même session d'onglet.
 */
import { useEffect, useState } from 'react';
import { subscribeAnnouncements, type Announcement } from '@/lib/gameState';

const DISMISSED_KEY = 'zc.dismissedAnnouncements';

function readDismissed(): number[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(window.sessionStorage.getItem(DISMISSED_KEY) || '[]'); } catch { return []; }
}
function markDismissed(ts: number) {
  if (typeof window === 'undefined') return;
  const cur = readDismissed();
  window.sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...cur, ts].slice(-20)));
}

export function AnnouncementBanner({ address }: { address?: string | null }) {
  const [list, setList] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<number[]>([]);

  useEffect(() => { setDismissed(readDismissed()); }, []);
  useEffect(() => {
    const unsub = subscribeAnnouncements(address ?? null, setList);
    return unsub;
  }, [address]);

  const visible = list.filter((a) => !dismissed.includes(a.createdAt));
  if (visible.length === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9998] flex flex-col gap-1 p-2">
      {visible.map((a) => (
        <div
          key={a.createdAt}
          className="mx-auto max-w-3xl w-full bg-gradient-to-r from-amber-600 via-rose-600 to-purple-700 text-white rounded-lg shadow-lg px-4 py-2 flex items-center gap-3 animate-pulse"
        >
          {a.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.imageUrl} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
          )}
          <span className="text-lg shrink-0">📢</span>
          <p className="text-sm font-semibold flex-1">{a.message}</p>
          <button
            className="shrink-0 text-white/80 hover:text-white text-lg leading-none px-2"
            onClick={() => { markDismissed(a.createdAt); setDismissed((d) => [...d, a.createdAt]); }}
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
