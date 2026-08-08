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
