'use client';

/**
 * Pop-up "🔑 Reset mot de passe" — changement VOLONTAIRE du mot de passe par le joueur lui-même,
 * pour un compte "Jouer sans portefeuille" par e-mail/mot de passe (`session.authMethod ===
 * 'email'`, voir EffectiveAccountBadge.tsx, docs/EMAIL_NOTIFICATIONS.md). Demande le nouveau mot
 * de passe + sa confirmation ; si Firebase exige une reconnexion récente
 * (`auth/requires-recent-login`), affiche en plus un champ "mot de passe actuel" pour
 * ré-authentifier avant de réessayer (voir lib/firebase.ts::selfUpdatePassword).
 *
 * Envoie ensuite un e-mail de confirmation (SANS le mot de passe, juste une alerte de sécurité —
 * voir templates.ts::buildPasswordChangedEmail) et incrémente
 * `PlayerState.passwordResetCount` (gameState.ts::incrementPasswordResetCount).
 */
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { selfUpdatePassword, describeEmailAuthErrorKey } from '@/lib/firebase';
import { incrementPasswordResetCount } from '@/lib/gameState';

export function PasswordResetModal({
  email, address, locale, onClose,
}: {
  email?: string;
  address: string;
  locale: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [needsReauth, setNeedsReauth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submit = async () => {
    setMessage(null);
    if (newPassword.length < 6) { setMessage(t('home.fiat.emailErrorWeakPassword')); return; }
    if (newPassword !== confirmPassword) { setMessage(t('home.fiat.passwordMismatch')); return; }
    setBusy(true);
    try {
      const result = await selfUpdatePassword(newPassword, needsReauth ? currentPassword : undefined);
      if (!result.ok) {
        if (result.errorCode === 'auth/requires-recent-login' && !needsReauth) {
          setNeedsReauth(true);
          setMessage(t('connect.passwordResetNeedsReauth'));
          setBusy(false);
          return;
        }
        setMessage(t(describeEmailAuthErrorKey(result.errorCode)));
        setBusy(false);
        return;
      }
      await incrementPasswordResetCount(address).catch(() => {});
      if (email) {
        fetch('/api/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'password-changed', to: email, locale }),
        }).catch(() => {}); // best-effort — le changement reste valide même si l'e-mail échoue
      }
      setSuccess(true);
      setBusy(false);
    } catch (e) {
      console.error('[PasswordResetModal] submit failed:', e);
      setMessage(t('home.demo.authError'));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4" style={{ zIndex: 10000 }}
         onClick={() => !busy && onClose()}>
      <div className="bg-slate-900 border-2 border-purple-500 rounded-xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-3">🔑 {t('connect.passwordResetTitle')}</h3>
        {success ? (
          <>
            <p className="text-sm text-emerald-400 mb-4">{t('connect.passwordResetSuccess')}</p>
            <div className="flex justify-end">
              <button className="btn-primary text-sm" onClick={onClose}>{t('common.close')}</button>
            </div>
          </>
        ) : (
          <>
            <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} type="password"
              placeholder={t('connect.passwordResetNewPlaceholder')}
              className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 mb-2 text-sm" />
            <input value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} type="password"
              placeholder={t('home.fiat.confirmPasswordPlaceholder')}
              className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 mb-2 text-sm" />
            {needsReauth && (
              <input value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} type="password"
                placeholder={t('connect.passwordResetCurrentPlaceholder')}
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 mb-2 text-sm" />
            )}
            {message && <p className="text-sm text-amber-300 mb-2">{message}</p>}
            <div className="flex justify-end gap-2 mt-2">
              <button className="btn-secondary text-sm" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>
              <button
                className="btn-primary text-sm"
                disabled={busy || !newPassword || !confirmPassword || (needsReauth && !currentPassword)}
                onClick={submit}
              >
                {busy ? t('common.loading') : t('connect.passwordResetSubmit')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
