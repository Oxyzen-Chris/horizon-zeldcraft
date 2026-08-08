'use client';

/**
 * Identité "effective" du joueur — pont entre un vrai portefeuille crypto (wagmi/RainbowKit) et
 * une session Démo/Fiat sans portefeuille (voir docs/DEMO_FIAT.md).
 *
 * Pourquoi ce module : TOUT le jeu (27 widgets) lit `useAccount()` de wagmi pour connaître
 * l'adresse du joueur courant et clé Firebase (`players/{addr}`). Plutôt que de brancher un
 * connecteur wagmi factice dans la configuration partagée (risque de régression sur le flux de
 * connexion RainbowKit existant, déjà en production), on introduit ici un hook de remplacement
 * `useEffectiveAccount()` :
 *   - Si un vrai portefeuille wagmi est connecté → renvoie EXACTEMENT `useAccount()` (aucune
 *     différence de comportement pour les joueurs crypto existants, zéro régression).
 *   - Sinon, si une session Démo/Fiat est active (voir startDemoSession/startFiatSession sur la
 *     page d'accueil) → renvoie l'adresse virtuelle dérivée (voir deriveVirtualAddress côté
 *     gameState.ts), `isConnected: true`.
 *   - Sinon → déconnecté, comme avant.
 *
 * Tous les composants du jeu importent CE hook au lieu de `useAccount` de wagmi directement (seul
 * `app/admin/page.tsx` — la sécurité de propriétaire du contrat — et `NetworkSwitcher.tsx` — qui
 * bascule le réseau d'un VRAI portefeuille — restent volontairement sur le vrai `useAccount()`).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { useAccount } from 'wagmi';

export type EffectiveAccountKind = 'wallet' | 'demo' | 'fiat';

export interface EffectiveSession {
  kind: 'demo' | 'fiat';
  uid: string;               // UID Firebase Auth (Google/email/anonyme)
  address: `0x${string}`;    // adresse virtuelle dérivée (voir deriveVirtualAddress)
  demoMode?: 'approved' | 'anonymous'; // sous-mode, uniquement pour kind === 'demo'
  displayName?: string;
}

const STORAGE_KEY = 'zc.effectiveSession';

function readStoredSession(): EffectiveSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as EffectiveSession) : null;
  } catch { return null; }
}

interface EffectiveAccountContextValue {
  session: EffectiveSession | null;
  setSession: (s: EffectiveSession | null) => void;
}

const EffectiveAccountContext = createContext<EffectiveAccountContextValue>({ session: null, setSession: () => {} });

/** À placer une seule fois, haut dans l'arbre (voir providers.tsx) — englobe TOUTE l'app. */
export function EffectiveAccountProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<EffectiveSession | null>(null);

  useEffect(() => { setSessionState(readStoredSession()); }, []);

  const setSession = useCallback((s: EffectiveSession | null) => {
    setSessionState(s);
    if (typeof window === 'undefined') return;
    if (s) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  const value = useMemo(() => ({ session, setSession }), [session, setSession]);
  return <EffectiveAccountContext.Provider value={value}>{children}</EffectiveAccountContext.Provider>;
}

/**
 * Remplacement de `useAccount()` de wagmi, à utiliser dans tous les widgets de jeu (voir
 * commentaire d'en-tête). Forme du retour volontairement alignée sur les champs réellement
 * consommés dans le code existant (`address`, `isConnected`, `isConnecting`) + `accountType` en
 * plus, pour les composants qui doivent adapter leur UI (ex. masquer un bouton on-chain).
 */
export function useEffectiveAccount() {
  const wagmiAccount = useAccount();
  const { session } = useContext(EffectiveAccountContext);

  if (wagmiAccount.isConnected) {
    // Portefeuille crypto réel connecté : comportement 100% inchangé (priorité absolue).
    return { ...wagmiAccount, accountType: 'wallet' as EffectiveAccountKind };
  }
  if (session) {
    return {
      ...wagmiAccount,
      address: session.address,
      isConnected: true,
      isConnecting: false,
      isDisconnected: false,
      accountType: session.kind as EffectiveAccountKind,
    };
  }
  return { ...wagmiAccount, accountType: 'wallet' as EffectiveAccountKind };
}

/** Session Démo/Fiat active (ou null) — pour du code hors composant widget (ex. redirections). */
export function useEffectiveSession(): EffectiveSession | null {
  return useContext(EffectiveAccountContext).session;
}

/** Démarre/termine explicitement une session Démo/Fiat (voir page.tsx, game/page.tsx). */
export function useEffectiveSessionControls() {
  return useContext(EffectiveAccountContext);
}
