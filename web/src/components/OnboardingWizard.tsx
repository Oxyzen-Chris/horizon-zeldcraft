'use client';

import { useState } from 'react';
import { ONBOARDING_STEPS } from '@/lib/onboardingContent';
import { useI18n } from '@/lib/i18n';

/**
 * Visite guidée ludique/didactique affichée UNE FOIS (drapeau localStorage, voir game/page.tsx)
 * à la première entrée en jeu, juste après l'écran de bienvenue (page.tsx) — 3 étapes : univers &
 * quête finale, quêtes/dangers/vie de royaume, outils du Dresseur (widgets & mécaniques). Rejouable
 * à tout moment via le bouton dédié du widget "Aides" (voir HelpWidget.tsx, qui reprend exactement
 * le même contenu — voir onboardingContent.ts, source unique partagée par les deux).
 * `onboardingEnabled` (menu Administration) contrôle uniquement l'affichage automatique de la
 * première visite ; le bouton "Revoir la visite guidée" fonctionne toujours, même si désactivé.
 */
export function OnboardingWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);

  if (!open) return null;

  const total = ONBOARDING_STEPS.length;
  const current = ONBOARDING_STEPS[step];
  const isLast = step === total - 1;

  const next = () => (isLast ? onClose() : setStep(s => Math.min(total - 1, s + 1)));
  const prev = () => setStep(s => Math.max(0, s - 1));

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[97] p-4">
      <div className="card max-w-3xl w-full max-h-[88vh] overflow-y-auto relative">
        <button
          className="absolute top-3 right-3 text-xs opacity-70 hover:opacity-100"
          onClick={onClose}
        >✕ {t('onboarding.skip')}</button>

        <div className="text-center mb-5">
          <div className="text-4xl mb-2">{current.icon}</div>
          <h2 className="text-xl md:text-2xl font-bold text-voxlyn-crystal">{t(current.titleKey)}</h2>
          <p className="text-slate-400 text-sm mt-1 max-w-xl mx-auto">{t(current.introKey)}</p>
        </div>

        <div className="grid md:grid-cols-2 gap-3 mb-6">
          {current.topics.map(topic => (
            <div key={topic.titleKey} className="bg-slate-800/60 border border-slate-700 rounded-lg p-3">
              <p className="text-sm font-semibold mb-1">{topic.icon} {t(topic.titleKey)}</p>
              <p className="text-xs text-slate-400">{t(topic.bodyKey)}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {ONBOARDING_STEPS.map((_, i) => (
              <span
                key={i}
                className={`w-2 h-2 rounded-full ${i === step ? 'bg-cyan-400' : 'bg-slate-600'}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && <button className="btn-secondary text-sm" onClick={prev}>← {t('onboarding.prev')}</button>}
            <button className="btn-primary text-sm" onClick={next}>
              {isLast ? `✅ ${t('onboarding.finish')}` : `${t('onboarding.next')} →`}
            </button>
          </div>
        </div>
        <p className="text-center text-[11px] text-slate-500 mt-3">
          {t('onboarding.stepIndicator', { n: step + 1, total })}
        </p>
      </div>
    </div>
  );
}
