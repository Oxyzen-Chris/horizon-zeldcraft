# 🎟️💳 Accès Démo & Paiement fiat (sans portefeuille crypto)

Cette fonctionnalité permet de jouer à Horizon ZeldCraft **sans posséder de portefeuille crypto**
(Metamask, Rainbow, WalletConnect, Ledger…), via deux parcours distincts, tous deux
activables/désactivables et paramétrables depuis `Administration > Barème & règles` :

1. **🎟️ Accès Démo** — gratuit, en avant-première, pour des invités/testeurs (« gueststars »).
2. **💳 Jouer sans portefeuille (paiement fiat)** — pour les joueurs payants qui préfèrent régler
   par carte bancaire, PayPal, Apple Pay ou Google Pay plutôt qu'en ETH.

## 🧭 Pourquoi et comment (architecture)

Tout le jeu (~27 widgets) lit l'adresse du joueur courant via `useAccount()` de wagmi pour savoir
quelle clé Firebase (`players/{addr}`) charger. Plutôt que de modifier la configuration wagmi/
RainbowKit partagée (risque de régression sur le flux de connexion crypto déjà en production), on a
introduit un hook de remplacement :

```ts
// web/src/lib/effectiveAccount.tsx
useEffectiveAccount() // remplace useAccount() de wagmi dans tous les widgets de jeu
```

Comportement :
- **Portefeuille crypto réellement connecté** → renvoie EXACTEMENT l'objet `useAccount()` de wagmi,
  sans aucune modification. **Zéro changement de comportement pour les joueurs crypto existants.**
- **Sinon, session Démo/Fiat active** (créée depuis la page d'accueil) → renvoie une adresse
  **virtuelle** dérivée de manière déterministe de l'UID Firebase Auth (Google/e-mail/anonyme) via
  `deriveVirtualAddress(uid)` (hash keccak256 — jamais une vraie clé privée, aucune signature
  possible, aucune valeur réelle transférable on-chain), avec `isConnected: true` et
  `accountType: 'demo' | 'fiat'`.
- **Sinon** → déconnecté, comme avant.

Ce hook est utilisé dans TOUS les composants de jeu **sauf** :
- `app/admin/page.tsx` — la sécurité d'accès au menu Administration (owner du contrat) reste
  strictement liée à un vrai portefeuille connecté, jamais à une session virtuelle.
- `components/NetworkSwitcher.tsx` — la bascule Sepolia/Mainnet ne concerne que les vrais
  portefeuilles (une adresse virtuelle n'est reliée à aucun réseau/chainId réel).

## 🎟️ Accès Démo — deux sous-modes

| Sous-mode | Authentification | Validation admin ? | Plafond (paramétrable) |
|---|---|---|---|
| **Approuvé** | Connexion Google | Oui — file d'attente dans `Administration > Demandes d'accès Démo` | `RepRules.demoMaxConcurrentSessions` (défaut 90) |
| **Anonyme** | Aucune (Firebase Auth anonyme) | Non — accès instantané | `RepRules.demoAnonymousMaxConcurrentSessions` (défaut 40) |

Pourquoi ces plafonds précis : le plan gratuit **Spark** de Firebase limite à **100 connexions RTDB
simultanées** (voir `docs/FIREBASE_CHAT.md` § Coûts) ; 90 + 40 laisse une marge pour les joueurs
crypto classiques tant que le projet n'est pas passé au plan payant **Blaze**. Les deux valeurs
(ainsi que l'activation de chaque sous-mode) sont ajustables sans redéploiement dans
`Administration`.

Parcours « Approuvé » :
1. Le joueur clique « 🎟️ Accès Démo » sur la page d'accueil → « Continuer avec Google ».
2. `requestDemoAccess()` enregistre une `DemoAccessRequest` (statut `pending`) dans
   `demoAccessRequests/{uid}`.
3. L'administrateur reçoit la demande dans `Administration > Demandes d'accès Démo`
   (`DemoAccessRequestsPanel`, écoute temps réel) et clique **Valider** ou **Rejeter**.
4. `approveDemoAccess()` crée/seed le compte joueur (`getOrCreatePlayer` avec
   `accountType: 'demo'`, portefeuille virtuel initial = `RepRules.demoInitialCoins`, défaut 4000
   coins) et marque `players/{addr}.demoApproved = true`.
5. Au prochain essai de connexion (ou immédiatement si déjà sur la page), le joueur est
   automatiquement redirigé vers `/game` une fois la capacité vérifiée.

Parcours « Anonyme » : identique mais sans étape 2-4 — connexion Firebase anonyme instantanée,
sous réserve de place disponible (`countActiveDemoSessions('anon') < demoAnonymousMaxConcurrentSessions`).

## 💳 Paiement fiat — sans portefeuille crypto

Un joueur qui ne souhaite pas utiliser d'ETH peut :
1. Cliquer « 💳 Jouer sans portefeuille » sur la page d'accueil.
2. Se connecter avec Google ou un couple e-mail/mot de passe (`signInWithGoogle`/`signInWithEmail`,
   `web/src/lib/firebase.ts`).
3. Accéder **immédiatement** au jeu (`accountType: 'fiat'`, pas de validation admin — un joueur
   payant n'a pas à attendre d'autorisation).
4. Recharger sa monnaie de jeu par CB, PayPal, Apple Pay ou Google Pay via le composant
   `FiatTopupPanel.tsx`, intégré à la fois dans le widget flottant « Rechargement du portefeuille »
   (`WalletTopupWidget.tsx`) et la page « Portefeuille » (`WalletPanel.tsx`) — **visible aussi pour
   les joueurs avec un vrai portefeuille crypto**, qui peuvent ainsi payer par carte en plus de l'ETH.

### Mode simulation (par défaut)

`RepRules.fiatSimulationMode` vaut `true` par défaut : aucune intégration Stripe/PayPal réelle
n'est câblée pour le moment. Un « achat » fiat (`useFiatTopup.ts`) crédite instantanément le
portefeuille de jeu hors-chaîne et enregistre une `TxRecord` (`type: 'fiat_topup', offchain: true`)
pour garder un historique cohérent dans `Administration > Statistiques par joueur` (le lien
Etherscan est automatiquement masqué pour ces lignes, voir `PlayerStats.tsx`).

### Bascule vers un vrai paiement (à faire plus tard)

Quand une vraie passerelle de paiement sera configurée (ex. clés API Stripe côté serveur), il
suffira de remplacer l'appel `simulateFiatPayment` dans `useFiatTopup.ts` par un appel à une
future route API (ex. `web/src/app/api/payments/checkout/route.ts`, Stripe Checkout Session — CB +
PayPal + Apple Pay + Google Pay en une seule intégration), **sans changer l'UI** qui consomme ce
hook (`FiatTopupPanel.tsx` reste identique). Voir `docs/ROADMAP.md` § Phase 4 pour le suivi.

## 🧮 Comment la progression (XP/niveau/stade) est simulée hors-chaîne

Les comptes Démo/Fiat n'ont pas de Voxlyn NFT réel (pas de mint on-chain). Le code existant calcule
déjà, pour TOUS les joueurs, `totalXp = Math.max(0, Number(xp) + (player?.xpBonus ?? 0))` à partir
d'un tuple on-chain `xp` et d'un bonus hors-chaîne `xpBonus` (stocké dans Firebase). Pour un compte
virtuel, `synthesizeOffchainVoxlyn()` (dans `game/page.tsx`) construit un tuple synthétique avec
`xp = 0n` — donc `totalXp` devient exactement `player.xpBonus`, qui porte alors 100% de la
progression du joueur, sans aucune nouvelle mécanique. `level`/`stage` sont recalculés de façon
cohérente via `computeOffchainStageLevel(xpBonus)`, qui reproduit exactement la formule du smart
contract (`_levelFromXp`/`_stageFromLevel`).

## ⚠️ Limites connues (disclosed scope, pas des bugs)

- **Équipes on-chain** (`TeamsPanel.tsx`) : création/adhésion/départ d'équipe restent réservées aux
  vrais portefeuilles crypto — un compte Démo/Fiat n'a pas de signataire réel, une transaction
  échouerait. Un message explicite (`game.teams.walletOnlyHint`) informe le joueur.
- **Repas on-chain** (4 boutons `feed()`) : déjà masqués par défaut pour tous les joueurs
  (`RepRules.onchainFeedButtonsEnabled = false`, voir dette technique § ROADMAP.md) ; si l'admin les
  réactive malgré tout, ils restent invisibles pour les comptes Démo/Fiat (pas de signataire réel).
- **Mint du Voxlyn** : les comptes Démo/Fiat n'appellent jamais `mintVoxlyn()` — leur Voxlyn est
  entièrement simulé côté client/Firebase (voir § ci-dessus).

## 🔧 Correctifs post-lancement (gel démo, déconnexion, session fantôme)

Trois bugs sérieux ont été identifiés après la mise en production initiale et corrigés :

1. **Gel/lenteur extrême en mode Démo** (freeze, pop-up « page non réactive »). Cause racine :
   `VoxlynDashboard` (dans `game/page.tsx`) avait un `useEffect` qui dépendait du tuple `v`
   entier (`synthesizeOffchainVoxlyn(virtualPlayer)`), recréé — nouvelle référence — à CHAQUE
   rendu pour un compte virtuel. Or `getOrCreatePlayer()` appelle `markPlayerActiveToday()`, qui
   écrit inconditionnellement `lastSeenAt` sous `players/{addr}/analytics` à chaque appel ; cette
   écriture redéclenchait les deux abonnements `subscribePlayer()` (celui de `GamePage` et celui de
   `VoxlynDashboard`), ce qui recalculait `v` (nouvelle référence) → refaisait tourner l'effet →
   nouvelle écriture → boucle infinie de lecture/écriture Firebase et de re-rendus React, saturant
   le thread principal. Les comptes portefeuille n'étaient jamais touchés car leur `v` (lecture
   on-chain via wagmi/tanstack-query) reste une référence stable tant que la donnée n'a pas changé.
   **Correctif** : l'effet ne dépend plus que du nom (`v?.[0]`, primitif comparé par valeur), pas du
   tuple entier — voir `game/page.tsx`.
2. **Aucune déconnexion possible en session Démo/Fiat**. Le `<ConnectButton />` de RainbowKit
   propose nativement une déconnexion pour un vrai portefeuille, mais rien d'équivalent n'existait
   pour les sessions Démo/Fiat (aucun moyen de revenir à l'écran de choix sans vider le
   `localStorage` à la main). **Correctif** : nouveau composant
   `components/EffectiveAccountBadge.tsx` (menu déroulant « 🚪 Se déconnecter »), affiché à la
   place du badge statique dans l'en-tête du jeu et sur la page d'accueil. Il libère le slot de
   concurrence (`releaseDemoSession`), déconnecte Firebase Auth (`signOutFirebase`) et efface la
   session (`disconnectSession()` — voir `lib/effectiveAccount.tsx`).
3. **Session Démo/Fiat fantôme après (dé)connexion d'un vrai portefeuille**. Rien ne nettoyait la
   session Démo/Fiat stockée en `localStorage` quand un vrai portefeuille se connectait : après
   déconnexion du portefeuille, l'app retombait silencieusement sur l'ancienne session Démo/Fiat au
   lieu de réafficher l'écran de choix complet — rendant impossible de tester une autre méthode
   (ex. Google) après un essai anonyme. **Correctif** : un nouvel effet dans
   `EffectiveAccountProvider` (`lib/effectiveAccount.tsx`) termine automatiquement toute session
   Démo/Fiat restante dès qu'un vrai portefeuille wagmi devient connecté
   (`wagmiAccount.isConnected`). `signOutFirebase()` réinitialise aussi le cache interne de
   `ensureAnonSignIn()` (`firebase.ts`), qui renvoyait sinon l'ancien utilisateur déjà déconnecté.
4. **Bug latent connexe** : dans `NoWalletAccessPanel.tsx`, `startAnonymousDemo()` lisait le
   compteur `demoSessions/anon` (règle RTDB `auth != null`) AVANT d'appeler `ensureAnonSignIn()` —
   sur un navigateur sans session Firebase déjà persistée, cela levait un « Permission denied » et
   bloquait l'accès Démo anonyme. Corrigé en authentifiant d'abord.
5. **« Continuer avec Google » échouait avec une erreur générique** (« Une erreur est survenue lors
   de la connexion. Réessaie. »), aussi bien depuis « 🎟️ Accès Démo » que « 💳 Jouer sans
   portefeuille ». Deux causes distinctes ont été identifiées et corrigées :
   - **(a) Faux-négatif COOP** : `signInWithPopup()` (Firebase Auth) ouvre une popup vers
     `accounts.google.com`, puis surveille en interne la fermeture de cette popup
     (`window.closed`) pour détecter la fin de connexion — or les navigateurs Chromium récents
     appliquent une politique **Cross-Origin-Opener-Policy** qui bloque cette vérification
     (`Cross-Origin-Opener-Policy policy would block the window.closed call`), un bug connu du SDK
     Firebase JS (voir [firebase/firebase-js-sdk#6716](https://github.com/firebase/firebase-js-sdk/issues/6716)).
     **Correctif** : `signInWithGoogle()` (`lib/firebase.ts`) tente d'abord `signInWithPopup()`, et
     **bascule automatiquement sur `signInWithRedirect()`** dès que la popup échoue pour n'importe
     quelle raison — le flux redirection (navigation pleine page, sans popup) n'est pas affecté par
     ce problème COOP. `NoWalletAccessPanel.tsx` mémorise l'intention en cours (Démo approuvée ou
     Jouer sans portefeuille) dans `sessionStorage` avant la redirection, puis la reprend au retour
     via `consumeGoogleRedirectResult()` une fois les règles admin (`RepRules`) chargées.
   - **(b) Domaine de production non autorisé côté Firebase (root cause réelle du bug signalé)** :
     Firebase Authentication n'autorise par défaut que `localhost` et les domaines Firebase Hosting
     (`horizon-zeldcraft.firebaseapp.com`, `horizon-zeldcraft.web.app`) — le domaine de production
     Vercel (`horizon-zeldcraft.vercel.app`) n'y était **pas** inclus. Résultat : `auth/unauthorized-domain`
     dès l'ouverture de la popup (ou de la redirection, le blocage étant au niveau du domaine, pas
     du mécanisme popup/redirect), d'où une fenêtre qui semblait s'ouvrir puis se fermer
     immédiatement en production, alors que tout fonctionnait en local (`localhost` déjà autorisé).
     **Correctif : ajout de `horizon-zeldcraft.vercel.app` dans Firebase Console → Authentication →
     Settings → Authorized domains** (action manuelle, aucun accès CLI/API en écriture disponible
     pour ce paramètre). Si un domaine personnalisé est ajouté plus tard sur Vercel, il faudra
     l'ajouter de la même façon dans cette liste.

   Validé via l'API publique `identitytoolkit/v3/relyingparty/getProjectConfig` (confirme la liste
   `authorizedDomains`) et un test Playwright direct sur `https://horizon-zeldcraft.vercel.app` :
   après l'ajout du domaine, la popup Google s'ouvre et atteint l'écran de connexion réel
   (`accounts.google.com/v3/signin/identifier`) sans erreur affichée dans l'app.

Ces correctifs ont été validés avec Playwright (parcours complet : accès démo anonyme → jeu
chargé et réactif → déconnexion → retour à l'écran de choix → session bien effacée du
`localStorage`) et un scénario de non-régression (rechargement de page en session Démo, sans
portefeuille connecté, conserve bien la session — comportement inchangé).

## 🔐 Sécurité & suivi

- L'adresse virtuelle (`deriveVirtualAddress`) est un simple hash déterministe : elle ne correspond
  à AUCUNE clé privée existante, ne peut ni recevoir ni envoyer de vrais fonds on-chain.
- Chaque joueur (crypto, Démo ou Fiat) continue d'être suivi normalement par l'Intelligence IA
  GamePlay (`AiGameplayIntelligencePanel`) — DAU/rétention, temps par widget, entonnoir de quêtes,
  heatmaps — ce qui permet d'auditer finement le parcours des joueurs Démo/Fiat au même titre que
  les joueurs crypto (voir `docs/ROADMAP.md` § Phase 1.5).
- Voir `docs/FIREBASE_CHAT.md` pour les règles de sécurité RTDB des chemins
  `demoAccessRequests/*` et `demoSessions/*`, et les fournisseurs d'authentification Firebase
  (Google, E-mail/Mot de passe) à activer en plus de l'anonyme déjà requis.

## ⚙️ Réglages admin (Administration > Barème & règles)

| Réglage | Défaut | Effet |
|---|---|---|
| `demoAccessEnabled` | `true` | Affiche/masque le bouton « 🎟️ Accès Démo » sur la page d'accueil |
| `demoAnonymousEnabled` | `true` | Active/désactive le sous-mode anonyme (nécessite `demoAccessEnabled`) |
| `demoMaxConcurrentSessions` | `90` | Plafond de connexions Démo approuvées simultanées |
| `demoAnonymousMaxConcurrentSessions` | `40` | Plafond de connexions anonymes simultanées |
| `demoInitialCoins` | `4000` | Portefeuille virtuel de départ offert à un compte Démo validé |
| `fiatPaymentEnabled` | `true` | Affiche/masque le bouton « 💳 Jouer sans portefeuille » + le panneau `FiatTopupPanel` partout |
| `fiatMethodCardEnabled` / `fiatMethodPaypalEnabled` / `fiatMethodApplePayEnabled` / `fiatMethodGooglePayEnabled` | `true` | Active/désactive chaque moyen de paiement individuellement |
| `fiatSimulationMode` | `true` | Mode simulation (aucun paiement réel) — à désactiver seulement après intégration d'une vraie passerelle |
