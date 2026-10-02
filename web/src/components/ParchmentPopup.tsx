'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n, type Locale } from '@/lib/i18n';
import { addToInventory, markParchmentTaken } from '@/lib/gameState';

/** Langue de synthèse vocale associée à chaque locale du jeu (voir window.speechSynthesis) —
 * voix la plus répandue nativement sur Windows/Chrome/Edge pour chaque langue. */
const TTS_LANG: Record<Locale, string> = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES', pt: 'pt-PT', us: 'en-US' };

/** 6 variantes de texte de parchemin (voir demande utilisateur « un parchemins posé dessus
 * permettant [...] de le lire avec un pop-up style parchemin [...] et en même temps, une voix qui
 * lit le contenu audio du message [...] Synk pourra [...] prendre ce parchemin [...] qui lui
 * permettra de découvrir l'emplacement de nouveaux passages secret [...] soit d'avoir la réponse à
 * une énigme du jeu ») — choisie déterministement par crypte (même hash que
 * CryptTunnelScene.tsx::cryptDestinationRoomFor) pour qu'un même joueur retrouve toujours le même
 * texte sur un même parchemin. Volontairement générique (pas un texte unique par crypte) : garde
 * l'i18n gérable (4 langues × 6 variantes au lieu de 4 × 20). */
const CLUE_COUNT = 6;
function clueIndexFor(cryptId: string): number {
  let h = 0;
  for (const c of cryptId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % CLUE_COUNT;
}

export function ParchmentPopup({ cryptId, address, onClose }: { cryptId: string; address?: string; onClose: (taken: boolean) => void }) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const clueIdx = clueIndexFor(cryptId);
  const text = t(`crypt.parchment.clue${clueIdx + 1}`);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const speak = () => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = TTS_LANG[locale] ?? 'fr-FR';
    u.rate = 0.95;
    utteranceRef.current = u;
    window.speechSynthesis.speak(u);
  };

  // Lecture automatique à l'ouverture (voir demande utilisateur « en même temps, une voix qui lit
  // le contenu audio du message ») — coupée proprement au démontage pour ne jamais laisser une
  // synthèse vocale continuer après fermeture du pop-up.
  useEffect(() => {
    speak();
    return () => { if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cryptId]);

  if (typeof document === 'undefined') return null;

  const take = async () => {
    if (!address || busy) { onClose(false); return; }
    setBusy(true);
    try {
      await addToInventory(address, {
        itemId: `parchment-${cryptId}`, name: t('item.parchment.name'), category: 'parchment', qty: 1,
      });
      await markParchmentTaken(address, cryptId);
      onClose(true);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[95] p-4" onClick={() => onClose(false)}>
      <div
        className="relative bg-[#e8d9ad] text-stone-900 border-4 border-amber-900 rounded-sm p-6 max-w-sm w-full shadow-2xl"
        style={{ fontFamily: 'serif' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold mb-3 text-center">📜 {t('crypt.parchment.title')}</h3>
        <p className="text-sm italic leading-relaxed mb-4 whitespace-pre-line">{text}</p>
        <div className="flex gap-2">
          <button className="flex-1 text-xs rounded px-2 py-1.5 bg-amber-800 text-amber-50 hover:bg-amber-700" onClick={speak}>
            🔊 {t('crypt.parchment.replay')}
          </button>
          <button className="flex-1 text-xs rounded px-2 py-1.5 bg-emerald-700 text-emerald-50 hover:bg-emerald-600 disabled:opacity-50" onClick={take} disabled={busy}>
            ✋ {t('crypt.parchment.take')}
          </button>
          <button className="flex-1 text-xs rounded px-2 py-1.5 bg-stone-600 text-stone-50 hover:bg-stone-500" onClick={() => onClose(false)}>
            {t('crypt.parchment.leave')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
