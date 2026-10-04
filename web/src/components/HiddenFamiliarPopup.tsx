'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/lib/i18n';
import { claimHiddenDragonFamiliar } from '@/lib/gameState';

/** Pop-up de la "surprise" cachée dans la table de chevet d'une chambre de crypte (voir
 * CryptTunnelScene.tsx::HIDDEN_DRAGON_CRYPT_ID et demande utilisateur « ajoutes une surprise dans
 * la table de chevet d'une chambre en y cachant un familier de type Dragon vert [...] toujours
 * selon le principe d'un pop-up invitant à mettre le familier dans sa besace [...] ne donne aucune
 * indication sur ce familier caché, cela sera la surprise ! »). Même structure que
 * ParchmentPopup.tsx (portail plein écran, clic extérieur = fermer sans ramasser) mais SANS lecture
 * vocale (non demandée ici) et SANS aucune vérification XP/objet — `claimHiddenDragonFamiliar` est
 * un octroi direct et inconditionnel. */
export function HiddenFamiliarPopup({ address, onClose }: { address?: string; onClose: (taken: boolean) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  if (typeof document === 'undefined') return null;

  const take = async () => {
    if (!address || busy) { onClose(false); return; }
    setBusy(true);
    try {
      await claimHiddenDragonFamiliar(address);
      onClose(true);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[95] p-4" onClick={() => onClose(false)}>
      <div
        className="relative bg-emerald-950 text-emerald-50 border-4 border-emerald-700 rounded-lg p-6 max-w-sm w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold mb-3 text-center">🐉 {t('crypt.hiddenFamiliar.title')}</h3>
        <p className="text-sm leading-relaxed mb-4 whitespace-pre-line">{t('crypt.hiddenFamiliar.body')}</p>
        <div className="flex gap-2">
          <button className="flex-1 text-xs rounded px-2 py-1.5 bg-emerald-700 text-emerald-50 hover:bg-emerald-600 disabled:opacity-50" onClick={take} disabled={busy}>
            ✋ {t('crypt.hiddenFamiliar.take')}
          </button>
          <button className="flex-1 text-xs rounded px-2 py-1.5 bg-stone-600 text-stone-50 hover:bg-stone-500" onClick={() => onClose(false)}>
            {t('crypt.hiddenFamiliar.leave')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
