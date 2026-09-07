# 🏗️ Architecture — Horizon ZeldCraft

## Vue d'ensemble

```
┌──────────────┐        ┌──────────────┐        ┌────────────────────┐
│  Next.js     │        │   Expo       │        │  Smart Contract     │
│  Web (Vercel)│───┐  ┌─│  Mobile      │────────│  HorizonZeldCraft   │
└──────────────┘   │  │ └──────────────┘        │  (Sepolia + Mainnet)│
                   ▼  ▼                         └────────────────────┘
              ┌────────────┐                              │
              │  wagmi v2  │──────── RPC (Alchemy / Infura) ──┘
              │ RainbowKit │
              └────────────┘
```

## Smart Contract

- **Standard** : ERC-721 (chaque Synk est un NFT unique)
- **Lib** : OpenZeppelin (Ownable, ReentrancyGuard, Pausable)
- **Solidity** : 0.8.24
- **Réseaux** : Sepolia (chainId 11155111) + Mainnet (chainId 1)

### Fonctions principales

| Fonction                              | Description                                        | Access  |
| ------------------------------------- | -------------------------------------------------- | ------- |
| `mintVoxlyn(string name)`             | Crée son personnage Synk (1 par wallet, fonction historique `mintVoxlyn`) | Public  |
| `feed(uint256 tokenId, FeedType t)`   | Nourrit (Daily/Weekly/Monthly/Yearly) — payable    | Owner NFT |
| `buyCatalogItem(tokenId, itemId)`     | Achète sort/potion/skin — payable                  | Owner NFT |
| `startQuest(tokenId, questId)`        | Démarre une quête si XP suffisante                 | Owner NFT |
| `completeQuest(tokenId, questId)`     | Termine (validation owner contrat off-chain)       | Admin   |
| `addCatalogItem(...)`                 | Ajoute un item au catalogue                        | Admin   |
| `addQuest(...)`                       | Ajoute une quête                                   | Admin   |
| `setPrice(FeedType, uint256)`         | Modifie prix nourrissage                           | Admin   |
| `setTreasury(address)`                | Change adresse trésorerie                          | Admin   |
| `withdraw()`                          | Retire les fonds vers treasury                     | Admin   |
| `pause() / unpause()`                 | Pause d'urgence                                    | Admin   |

> ⚠️ **Quêtes à énigmes — migrées 100% hors-chaîne.** `addQuest`/`submitQuestAnswer` restent dans
> le contrat déployé (compat. historique, jamais re-déployé) mais **ne sont plus appelés par le
> client** : le catalogue de quêtes, la vérification de réponse (hash keccak256) et l'attribution
> des récompenses (XP, score, réputation) se font désormais exclusivement via Firebase RTDB
> (`catalog/quests/{id}`, `players/{addr}/quests/{questId}`) — zéro gas pour créer ou résoudre une
> quête. Voir `web/src/lib/gameState.ts` (`QuestDef`, `addQuestDef`, `submitQuestAnswerOffchain`)
> et `docs/FIREBASE_CHAT.md`.

### Événements

`VoxlynMinted` *(nom historique on-chain, non renommé)*, `Fed`, `LevelUp`, `ItemBought`, `QuestStarted`, `QuestCompleted`, `PriceChanged`

## Front Web (Next.js 14 App Router)

- **Wallets** : Metamask, Rainbow, WalletConnect, Ledger, Coinbase/Base (via RainbowKit)
- **State** : wagmi v2 + TanStack Query
- **Style** : Tailwind CSS
- **i18n** : `next-intl` — fichiers `web/src/i18n/messages/{fr,en,es,pt}.json` (1725 clés FR ;
  2667 clés EN/ES/PT — l'écart s'explique par les ~940 clés `quest.kingdom.*`/`quest.island_*`
  générées uniquement en EN/ES/PT, le FR utilisant le `label` français stocké en base comme
  fallback via `localizeName()`, voir § Traductions ci-dessous)
- **Sélecteur réseau** : composant `NetworkSwitcher` au login -> Sepolia / Mainnet
- **Onboarding** : `OnboardingWizard.tsx` (3 écrans : bienvenue/stades, lore Zorghon/quêtes/saisons,
  guide des widgets), rejouable à tout moment via le widget flottant « Aides » (`HelpWidget.tsx`)

### Routes

- `/` — landing + connexion + choix langue + choix réseau
- `/game` — dashboard Synk (stats, actions, inventaire, onboarding, 12 fenêtres flottantes - voir
  § Widgets flottants)
- `/admin` — panneau owner (26 rubriques - voir § Menu Administration)
- `/scoreboard` — classement public des joueurs (lecture seule, sans wallet requis)

### Widgets flottants (fenêtres déplaçables)

Tous partagent l'infrastructure commune `web/src/lib/useDraggableWidget.ts` (position/collapse
persistés en `localStorage`, distinction fiable clic/glissé via un `movedRef`, clic droit ->
`WidgetContextMenu.tsx` -> « Recentrer à l'écran », clampage automatique dans le viewport) :

| Widget                                   | Composant                     | Rôle |
| ----------------------------------------- | ------------------------------ | ---- |
| Lancer de dés                             | `DiceRollWidget.tsx`           | Jet de destin quotidien + combats PNJ (bonus/malus) |
| Chat d'équipe                             | `TeamChatWidget.tsx`           | Discussion temps réel multi-joueurs (Firebase) |
| Équipement Synk                           | `EquipmentWidget.tsx`          | Slots d'équipement (drag & drop depuis la besace), usure persistée |
| Sac / Besace                              | `InventoryWidget.tsx`          | Inventaire complet, glisser-déposer vers l'équipement |
| Boutique des terres de ZeldCraft          | `ShopWidget.tsx`                | Achat/vente d'objets par catégorie |
| Mapmonde                                  | `WorldMapWidget.tsx`           | Carte zoomable, POI, filtres, voyage, pop-up profondeur/altitude |
| Plateforme 2D isométrique                 | `GameCanvas2D.tsx`             | Déplacement 8 directions, articulation de Synk, dalles eau/montagne, oxygène/fatigue |
| Statistiques                              | `StatsWidget.tsx`              | Vie/Faim/Bonheur/Force/Sorts/Oxygène/Fatigue/XP/Wallet/Réputation |
| Quêtes du Royaume                         | `KingdomQuestsWidget.tsx`      | Progression des 400 quêtes / 40 chapitres, badge pleine lune |
| Aides                                     | `HelpWidget.tsx`               | Reprend le contenu de l'onboarding, disponible à tout moment |
| État d'avancement / inventaire            | `ProgressWidget.tsx`           | Ledger dépliable par thème (17 catégories, ✅/❌) |
| Widgets personnalisés (admin)             | `CustomWidgetsRenderer.tsx`    | Rendu dynamique des widgets créés en Administration |

`WorldMapWidget` et `GameCanvas2D` gèrent en plus leur propre redimensionnement (poignée de
resize) au-dessus de l'infrastructure commune de drag/collapse.

### Menu Administration (owner only, `/admin`)

Dans l'ordre d'affichage :

1. 💎 Revenus du contrat (solde trésorerie/contrat)
2. 📊 Statistiques par joueur (`PlayerStats.tsx`) + génération de facture PDF
3. Barème de reconnaissance (`RepRulesPanel.tsx`) - voir § Off-chain ci-dessous, ~20 sous-sections
4. Presets de rechargement wallet (`TopupPresetsPanel.tsx`)
5. Catalogue Familiers (`FamiliarsAdminPanel.tsx`)
6. Catalogue Équipement - armes & protections (`EquipmentAdminPanel.tsx`)
7. Catalogue Nourriture (`FoodAdminPanel.tsx`)
8. Catalogue Potions & Sortilèges (`PotionsSpellsAdminPanel.tsx`)
9. Filtres Mapmonde par défaut (`MapFiltersAdminPanel.tsx`)
10. Navigation Mapmonde - zoom/pan (`MapNavigationAdminPanel.tsx`)
11. Scripts de dialogue PNJ (`ChatScriptsAdminPanel.tsx`)
12. Widgets personnalisés (`CustomWidgetsAdminPanel.tsx`)
13. DLC / Packs de contenu (`ContentPacksAdminPanel.tsx`)
14. Ajouter un item catalogue · 15. Ajouter une quête à énigme · 16. Ajouter un PNJ ·
    17. Ajouter un trésor · 18. Ajouter un monde · 19. Ajouter un point d'intérêt (Carte)
20. Difficulté globale · 21. Conditions météo · 22. Saisons · 23. Pleine lune
24. Fréquence des rencontres PNJ · 25. Prix/Cooldowns de nourrissage
26. **Intelligence IA GamePlay** (`AiGameplayIntelligencePanel.tsx`) — analyse évolutive du
    gameplay des joueurs : DAU/rétention 7j/30j, temps passé par widget, entonnoir de quêtes
    (résolu/échoué/bloqué par catégorie), heatmap des zones visitées et des évanouissements
    (oxygène/fatigue), score de risque de décrochage par joueur (0-100), signaux de monétisation
    et de rencontres PNJ, plus un **assistant IA gratuit** (Google Gemini `gemini-2.0-flash`,
    clé `GEMINI_API_KEY` serveur uniquement, voir `DEPLOYMENT.md`) qui génère un résumé et des
    recommandations à partir de ces statistiques agrégées et anonymisées via
    `web/src/app/api/ai/insights/route.ts`. Toute la collecte est instrumentée en tâche de fond
    (fire-and-forget, ne bloque jamais le gameplay) dans `gameState.ts`, `GameCanvas2D.tsx` et
    `useDraggableWidget.ts`, activable/désactivable via `catalog/aiAnalyticsSettings`. Une
    sous-rubrique **« Suivi ciblé par joueur »** permet en plus d'activer/désactiver l'analyse
    fine pour UN joueur en particulier (`players/{addr}/analytics/trackingOverride`, prime sur le
    réglage global) et d'afficher son profil détaillé (temps par widget, entonnoir de quêtes,
    évanouissements) sans avoir à suivre tous les joueurs.
27. **Combinaisons de Potions / Élixirs** (`PotionComboAdminPanel.tsx`) — voir § dédiée ci-dessous.

## Traductions (i18n) — couverture complète du contenu généré

**Mécanisme** : `t(key)` (`next-intl`) lit `web/src/i18n/messages/{locale}.json`. Pour tout contenu
**généré par script et stocké en base** (quêtes, PNJ, trésors — par opposition aux libellés d'UI
statiques), l'affichage passe par `localizeName(t, i18nKey, frenchFallback)`
(`web/src/lib/i18n.tsx`) : si `t(i18nKey)` ne trouve pas la clé dans la langue active, le libellé
français stocké en base (`label`/`name`) sert de repli — c'est un comportement **voulu**, pas un
bug en soi. Le bug (signalé par l'utilisateur : « Quests » restent en français même en EN) venait
du fait qu'aucune traduction n'avait jamais été générée pour de larges pans de contenu procédural,
forçant systématiquement ce repli français quelle que soit la langue choisie.

**Catégories corrigées** (506 entrées au total, vérifiées une à une contre les données Firebase
réellement servies en jeu) :
- **400 Quêtes du Royaume** (`quest.kingdom.ch01`–`ch40`, 10 types de quête par chapitre × label +
  hint) — voir `web/scripts/seedKingdomQuests.mjs` (source FR, gabarits combinatoires) et
  `web/scripts/genKingdomQuestI18n.mjs` (génère et fusionne les 800 clés EN/ES/PT en répliquant
  exactement la logique d'assemblage par chapitre du script source, y compris la sélection de
  variante `v = idx % 4` et les 3 cas spéciaux du chapitre 40 final).
- **50 Énigmes des Îles** (`quest.island_01`–`_50`, archipel + île sauvage) — voir
  `web/scripts/seedIslandQuests.mjs` et `web/scripts/genIslandQuestI18n.mjs` (phrases uniques
  traduites une à une, pas de gabarit).
- **1 quête rare d'invisibilité** (`quest.guardians_camel`) — voir
  `web/scripts/seedInvisibilityQuest.mjs`, traduite dans `web/scripts/genMiscI18n.mjs`.
- **40 trésors supplémentaires** (`treasure.*`, noms d'objets uniquement) — voir
  `TREASURES_EXTRA` dans `web/scripts/migrateNpcsTreasuresWorldsToFirebase.mjs`, traduits dans
  `web/scripts/genMiscI18n.mjs`.
- **15 PNJ indigènes des îles** (`npc.island.*`) — contrairement aux 5 PNJ officiels
  (`npc.official.*`), ces PNJ n'avaient **aucun champ `i18nKey`** dans
  `web/scripts/seedIslandGeography.mjs` (pas seulement une traduction manquante : la clé elle-même
  n'existait pas). Ajout du champ `i18nKey: npc.island.<id>` dans le script + traductions du nom
  dans les 4 langues (y compris FR, par symétrie avec `npc.official.*`) dans
  `web/scripts/genMiscI18n.mjs`. Le champ `dialog` (texte d'ambiance libre) reste non traduit —
  limitation assumée, identique à celle des 5 PNJ officiels et des scripts de dialogue admin
  personnalisés (texte libre, intraduisible automatiquement).

**Convention de traduction** (identique à celle déjà en place pour les 5 énigmes historiques,
`quest.riddle_*`, voir `seedRiddleAnswers.mjs`) : seul le texte narratif (label/hint) est traduit ;
les réponses (`answer`/`answerHash`), les noms propres inventés (lieux, personnages) et tout champ
dépendant d'un hash restent strictement identiques dans les 4 langues — un joueur EN/ES/PT doit
toujours saisir la même réponse (souvent un mot français ou un nom propre) qu'un joueur FR.

**Ces 3 scripts `gen*I18n.mjs` sont à conserver** (pas des scripts jetables) : ils encodent la
logique de génération de traduction et doivent rester synchronisés avec leurs scripts `seed*`
respectifs si de nouveaux chapitres/quêtes/trésors sont ajoutés. Ré-exécution idempotente depuis
`web/` : `node scripts/genKingdomQuestI18n.mjs && node scripts/genIslandQuestI18n.mjs && node
scripts/genMiscI18n.mjs` (ils n'écrivent que dans les 4 fichiers JSON locaux, jamais Firebase — sauf
`seedIslandGeography.mjs` qui doit être ré-exécuté séparément pour propager le nouveau champ
`i18nKey` sur les PNJ déjà existants en base, idempotent).

**Second correctif (même audit, catégorie oubliée lors du premier passage)** : les 400 quêtes du
Royaume elles-mêmes étaient bien traduites, mais pas les **40 NOMS DE CHAPITRE/RÉGION**
(`KINGDOM_CHAPTERS` dans `gameState.ts`, ex. « Grottes de Kragmoor », « Terres Calcinées ») qui
servent d'en-tête de regroupement dans 3 endroits : le widget "Kingdom Quests"
(`KingdomQuestsWidget.tsx`), le widget "ZeldCraft Quests" / panneau admin "Statistiques par joueur"
(sous-groupes du thème "Kingdom quests" dans `ProgressLedgerView.tsx`, via
`getPlayerProgressLedger()`), et le filtre par région du "World Map" (`WorldMapWidget.tsx`). Ajout
du script permanent `web/scripts/genKingdomChapterI18n.mjs` (40 clés `kingdom.chapter.1`–`.40` en
EN/ES/PT ; pas de FR, le titre de `KINGDOM_CHAPTERS` faisant déjà foi de fallback français). Ce
correctif a aussi révélé un bug distinct dans `ProgressLedgerView.tsx` : `ProgressSubgroup.label`
était pré-calculé en clair (`${icon} ${title}` toujours en français, jamais passé par `t()`/
`localizeName()`), contrairement à `ProgressEntry` qui porte déjà un `i18nKey`. Corrigé en ajoutant
`i18nKey`/`title` optionnels à `ProgressSubgroup` et en localisant l'affichage dans
`SubgroupSection` (`ProgressLedgerView.tsx`) avec repli sur `label` si absents (rétrocompatible avec
d'éventuels futurs sous-groupes non traduits). Revérifié via Playwright dans les 3 langues (EN/ES/
PT) sur les 2 widgets concernés : aucun résidu français, aucune erreur console.

## Suppression ciblée de joueurs par catégorie (Administration → Statistiques par joueur)

Dans la zone d'actions irréversibles du panneau **📊 Statistiques par joueur** (`PlayerStats.tsx`),
en complément des actions existantes « supprimer le joueur sélectionné » et « réinitialiser TOUS
les joueurs » (`deleteAllPlayers()`), une troisième option permet de **supprimer uniquement une
catégorie précise** de comptes de test/démo sans toucher aux autres joueurs :

- **Accès Démo** (`accountType === 'demo'`) — comptes créés via le flux « 🎟️ Accès Démo » (Google
  ou anonyme).
- **Jouer sans portefeuille** (`accountType === 'fiat'`) — comptes créés via le flux e-mail/mot de
  passe sans wallet connecté.
- **playwright** — comptes dont l'e-mail ou le libellé (`PlayerListEntry.label`) contient
  « playwright » (insensible à la casse), résidus de campagnes de vérification automatisée passées.
- **dbg-move** — comptes dont l'e-mail ou le libellé contient « dbg-move »/« dbgmove »
  (`/dbg-?move/i`), résidus des sessions de débogage du système de déplacement de Synk.

Ces catégories **ne sont pas mutuellement exclusives** par conception : un compte « fiat » dont
l'e-mail contient accidentellement « playwright » correspondra aux deux filtres — c'est voulu, la
sélection reste un filtre ciblé sur les joueurs déjà chargés en mémoire (`players:
PlayerListEntry[]`), pas une classification stricte.

**Implémentation** :
- `matchesDeleteCategory(p: PlayerListEntry, category)` (module-scope dans `PlayerStats.tsx`) :
  prédicat pur, aucun accès réseau, appliqué à la liste déjà chargée par
  `subscribePlayersWithMeta()`.
- `deletePlayersBulk(entries: {address, uid}[])` (`gameState.ts`, après `deleteAllPlayers()`) :
  supprime en un seul `Promise.all` par lot les mêmes chemins Firebase que
  `deletePlayerAccount()` pour chaque adresse (`players/{addr}`, `playerIndex/{addr}`,
  `demoAccessRequests/{uid}`, `demoSessions/demo|anon/{uid}`, `announcements/targeted/{addr}` en
  best-effort), avec le **même garde-fou de format d'adresse**
  (`/^0x[a-fA-F0-9]{40}$/`) que le reste du code de suppression — une adresse vide/invalide
  résoudrait sinon le chemin racine `players/` et supprimerait TOUT le jeu au lieu du lot ciblé.
- **Sécurité UI** (même schéma que « réinitialiser tous les joueurs ») : un code de confirmation
  **différent par catégorie** (`DELETE_CATEGORY_CODES` : `SUPPRIMER DEMO` / `SUPPRIMER FIAT` /
  `SUPPRIMER PLAYWRIGHT` / `SUPPRIMER DBG-MOVE`) doit être saisi exactement (insensible à la
  casse/espaces) pour activer le bouton, suivi de deux `window.confirm()` successifs. Le nombre de
  joueurs correspondant à la catégorie sélectionnée s'affiche en direct à côté du menu déroulant.

**Vérification** : script jetable rejouant exactement `matchesDeleteCategory()` et
`deletePlayersBulk()` contre Firebase (4 faux joueurs injectés, un par catégorie) — confirmé que la
suppression ciblée d'une seule catégorie ne supprime QUE les comptes correspondants et laisse les
3 autres faux joueurs intacts, puis nettoyage complet. `npx tsc --noEmit` propre, `/admin` compile
sans erreur (warnings préexistants sans rapport : dépendances optionnelles React Native/pino de
wagmi/RainbowKit).

## 🔒 Mise en pause admin appliquée immédiatement à une session déjà en cours + sablier Démo qui disparaît

**Bug n°1 signalé** : en Administration → 📊 Statistiques par joueur, mettre un joueur en pause
(« ⏸ Mettre en pause ») ou le réactiver n'avait **AUCUN effet visible** tant que le joueur ne se
déconnectait/reconnectait pas volontairement — inacceptable pour une action de modération (abus,
triche suspectée en cours) censée être immédiate.

**Cause racine n°1** : le champ `paused` (`demoAccessRequests/{uid}`) n'était vérifié **QUE** dans
`logAccountAccess()` (`gameState.ts`), c'est-à-dire uniquement AU MOMENT de la connexion
(`NoWalletAccessPanel.tsx`). Aucun code ne l'observait ensuite pendant qu'une session Démo/Fiat
était déjà active — la mise en pause admin modifiait bien la base (RTDB), mais rien côté client
n'écoutait ce champ en temps réel une fois le joueur connecté.

**Correctif n°1** : nouvelle fonction `subscribePausedStatus(uid, cb)` (`gameState.ts`) qui écoute
`demoAccessRequests/{uid}/paused` en `onValue` temps réel, branchée dans un nouvel effet de
`EffectiveAccountProvider` (`effectiveAccount.tsx`) actif pour toute session `kind === 'demo'`
**ou** `'fiat'` (les deux modes partagent le même nœud `demoAccessRequests/{uid}`, voir
`logAccountAccess`). Dès que `paused` passe à `true` : déconnexion forcée
(`disconnectSession()` — libère le slot de concurrence + `signOutFirebase()`), pose d'un flag
`sessionStorage` (`zc.pausedByAdmin`) puis navigation complète (`window.location.href = '/'`, même
schéma que l'expiration du chrono Démo ci-dessous — évite tout état React/Firebase résiduel). La
page d'accueil (`page.tsx`) lit ce flag via `consumePausedByAdminFlag()`
(`effectiveAccount.tsx`) et affiche le message `home.demo.pausedByAdmin` (déjà traduit FR/EN/ES/PT,
préexistant mais jusqu'ici seulement affiché en cas de refus AU MOMENT de la connexion).

**Bug n°2 signalé** : le sablier ⏳ de compte-à-rebours Démo (`DemoSessionTimerWidget.tsx`, en haut
à droite) cessait de s'afficher « au bout d'un certain temps », après un rafraîchissement de page,
ou après une déconnexion/reconnexion — le joueur ne savait alors plus combien de temps il lui
restait.

**Cause racine n°2** : `demoAccessRequests`/`demoSessions` exigent `auth != null` dans les règles
RTDB (voir `docs/FIREBASE_CHAT.md` § 4). `subscribeDemoTimerInfo()` (tout comme la nouvelle
`subscribePausedStatus()` ci-dessus avant son propre correctif) attachait son `onValue` **avant**
d'attendre que Firebase Auth ait fini de restaurer l'utilisateur déjà connecté (restauration
asynchrone depuis IndexedDB, qui prend un court instant après un rafraîchissement de page ou la
réhydratation de la session mémorisée dans `localStorage` par `EffectiveAccountProvider`). Cette
course déclenchait sporadiquement une erreur `permission denied` sur le tout premier essai
d'attache du listener — erreur jamais rattrapée : le listener mourait silencieusement et `cb`
n'était plus JAMAIS rappelée, bloquant `startedAt` à `null` pour le reste de la session (`deadline`
donc toujours `null` ⇒ le widget `return null` en permanence, sans navigation ni message d'erreur).

**Correctif n°2** : `subscribeDemoTimerInfo()` et `subscribePausedStatus()` attendent désormais
explicitement `ensureAnonSignIn()` (résout dès que `onAuthStateChanged` confirme l'utilisateur
restauré — anonyme, Google OU e-mail, sans jamais écraser une identité déjà connectée, voir
`firebase.ts`) **avant** d'attacher `onValue`, exactement comme le font déjà toutes les fonctions
d'écriture de ce module (`logAccountAccess`, `pauseAccountAccess`, etc.). La fonction de
désabonnement retournée gère l'annulation si le composant démonte avant la résolution de la
promesse (`cancelled` flag), pour ne jamais attacher un listener orphelin.

**Vérification** : script Playwright jetable — session Démo anonyme démarrée, sablier confirmé
visible avant ET après un rafraîchissement complet de la page (`page.reload()`) ; puis écriture
RTDB directe (`update(..., { paused: true })`, simulant l'action admin) sur le nœud
`demoAccessRequests/{uid}` de la session active pendant qu'elle est en train de jouer : redirection
automatique vers l'accueil détectée en moins de 8 s, message de pause visible sur la page de
destination. Zéro erreur console. `tsc --noEmit` propre.

## 🔒 Identification des PNJ/Dragon errants sur la Mapmonde + intégration aux filtres

**Bug signalé** : les deux acteurs errants partagés entre la « Plateforme 2D isométrique » et la
« Plateforme 3D » (un PNJ — ex. « Forgeron de Corail Hoku », « Thrall (Chef de la Horde) » — et un
Dragon — ex. « Dragon de Bronze », « Dragon d'Argent ») n'étaient **pas identifiables** sur le
widget **Mapmonde** (`WorldMapWidget.tsx`) : impossible de savoir où ils se trouvaient réellement.
De plus, ils n'apparaissaient pas dans le filtre d'affichage « PNJ » de ce widget.

**Cause racine** : `lib/roamingActors.ts` est la source de vérité unique (état module-scope, hors
React Context — même patron que `lib/mapFilters.ts`/`lib/windowZOrder.ts`) de la position live
(coordonnées 0-100 %, même échelle que `players/{addr}/mapPos`) des deux acteurs errants, de leur
identité (`npcMarkerId`/`dragonMarkerId`, assignée une seule fois via `ensureRoamingIdentities()`)
et de leur direction/état de mouvement. `GameCanvas2D.tsx` exploitait déjà correctement cet état :
il exclut le marqueur catalogue STATIQUE (position x/y fixe en base) des deux acteurs errants de sa
liste de marqueurs affichés, et rend à la place un marqueur de position live distinct pour chacun,
respectant `markerMatchesFilters()` (`lib/mapFilters.ts`). **`WorldMapWidget.tsx` ne faisait ni
l'un ni l'autre** : il affichait TOUS les marqueurs catalogue (dont les deux entrées des acteurs
errants) à leur position fixe/figée en base, sans aucune couche de position live.

**Correctif** (`WorldMapWidget.tsx` uniquement — `GameCanvas2D.tsx`/`Platform3DWidget.tsx`/
`roamingActors.ts` déjà corrects, non modifiés) :
- Import de `useRoamingActors`/`ensureRoamingIdentities` (`lib/roamingActors.ts`) ; appel de
  `ensureRoamingIdentities(entityMarkers)` dans un effet (idempotent — sans effet si déjà résolu
  par `GameCanvas2D.tsx`).
- Nouveau mémo `roamingLiveMarkers` : construit deux `MapMarker` synthétiques
  (`id: 'roaming.npc.live'`, `kind: 'npc'` et `id: 'roaming.dragon.live'`, `kind: 'familiar'`) à la
  position live `roamingActors.npc.x/y` / `.dragon.x/y`, en réutilisant le nom/icône du marqueur
  catalogue résolu (repli sur les clés i18n `canvas2d.npcLabel` = « PNJ errant » /
  `canvas2d.dragonLabel` = « Dragon errant » et les icônes 🧙/🐉 si le catalogue n'est pas encore
  chargé).
- Le bloc de rendu des marqueurs catalogue existants exclut désormais
  `roamingActors.npcMarkerId`/`dragonMarkerId` (évite un doublon figé à côté du marqueur live).
- Nouveau bloc de rendu pour `roamingLiveMarkers`, filtré par le même `markerMatchesFilters()` que
  les autres marqueurs (donner `kind: 'npc'`/`'familiar'` aux marqueurs synthétiques suffit à les
  faire respecter automatiquement les boutons de filtre « PNJ »/« Familiers », sans code
  supplémentaire dans `lib/mapFilters.ts`) — avec un anneau `animate-ping` ambré et un libellé de
  nom toujours visible (contrairement aux POI statiques, qui n'affichent leur libellé qu'à fort
  zoom) pour les rendre clairement identifiables.

**Vérification** : script Playwright jetable — session Démo anonyme démarrée, widget Mapmonde
(collapsé par défaut, bouton `button[title="Mapmonde"]` 🗺️) déplié, filtres ouverts
(`button[title="Filtres d'affichage de la carte"]`) ; confirmé la présence d'un marqueur
`title` contenant « PNJ errant » et d'un marqueur `title` contenant « Dragon errant » ; désactivation
du filtre « PNJ » ⇒ le marqueur PNJ errant disparaît, le marqueur Dragon errant reste visible ;
réactivation puis désactivation du filtre « Familiers » ⇒ inverse (Dragon errant disparaît, PNJ
errant reste visible). Zéro erreur console. `tsc --noEmit` propre.

## 🔒 Approche progressive du PNJ de rencontre + marqueur live Mapmonde + filtre « declutter »

**Demande utilisateur** : quand un PNJ vient solliciter le joueur (quête/troc/combat/discussion,
voir `NpcEncounterPopup.tsx`), le voir **arriver progressivement** avec un déplacement naturel
(même esprit que les commits `80b4109`/`7cb9439`/`3770616`, déplacement du PNJ/Dragon errant)
jusqu'à Synk dans la « Plateforme 2D isométrique » ET la « Plateforme 3D » (widgets synchronisés),
au lieu d'apparaître instantanément à côté de lui. Il doit aussi être **clairement identifié sur la
Mapmonde** avec un anneau clignotant + libellé toujours visible + position live, en respectant les
filtres « PNJ »/« Familiers » — exactement comme le PNJ/Dragon errant (`c1941cc`). Enfin, un
**« filtre intelligent »** sur la Mapmonde doit éviter la surcharge visuelle de marqueurs.

**Cause racine** : `NpcEncounterPopup.tsx` expose l'info de rencontre (`EncounterMarkerInfo` :
archétype, skin, alignement, offre) via `onEncounterChange`, mais **sans aucune position propre par
conception** — chaque widget se contentait auparavant de le dessiner INSTANTANÉMENT juste à côté de
la position courante de Synk (aucun déplacement, aucune présence sur la Mapmonde).
`Platform3DWidget.tsx` ne recevait même pas la prop `encounterNpc` du tout (absente de son
appel dans `game/page.tsx`), d'où sa disparition totale du widget 3D.

**Correctif** :
- **`lib/npcApproach.ts` (nouveau module, portée module comme `lib/roamingActors.ts`)** : pilote
  une position live dédiée pour le PNJ « en approche ». Démarre à un point aléatoire (3 à 6 cases
  de Synk), avance par à-coups (`tick` toutes les 1100 ms, jusqu'à 1,1 case/tick) vers une case
  adjacente à Synk, expose `{active, x, y, facing, moving}`. `beginNpcApproach()`/
  `endNpcApproach()` sont appelées **uniquement** depuis `game/page.tsx::handleEncounterChange`
  (source de vérité unique, via `wasEncounterActiveRef` détectant les transitions null→info et
  info→null — évite tout déclenchement en double depuis plusieurs widgets).
  `reportSynkApproachTarget(x, y)` est appelée en continu par `GameCanvas2D.tsx` ET
  `Platform3DWidget.tsx` (chacun suit déjà la position monde de Synk via `subscribePlayerMapPos`).
- **`game/page.tsx`** : ajout du déclenchement begin/end + correction de la prop `encounterNpc`
  manquante sur `<Platform3DWidget>`.
- **`GameCanvas2D.tsx`** : l'ancien encart figé « adjacent à Synk » est remplacé par un rendu à la
  position live (`approachInView`/`approachLocal`, même gating de fenêtre de vue que le PNJ/Dragon
  errant), avec `transition-all duration-[1500ms]` pour l'effet de glissement, et `animate-bounce`
  seulement une fois arrivé (`!npcApproach.moving`).
- **`Platform3DWidget.tsx`** : ajout de la prop `encounterNpc` (absente jusqu'ici) ; un marqueur
  synthétique `id: 'encounter.npc.live'` (`kind: 'npc'`) est injecté dans `sceneMarkers`, avec
  position/`facing`/`moving` venant de `npcApproach` — réutilise intégralement le pipeline voxel
  articulé existant (`npcAppearance(id, name)` dérive une apparence 3D complète depuis un hash de
  l'id/nom, donc un marqueur synthétique sans entrée catalogue réelle s'affiche parfaitement). Le
  clic sur ce marqueur est un no-op délibéré (`onMarkerClick3D` suppose une entrée catalogue réelle).
- **`WorldMapWidget.tsx`** : nouveau mémo `encounterLiveMarker` (marqueur synthétique `kind: 'npc'`
  à la position `npcApproach.x/y`, actif seulement si `npcApproach.active`), fusionné avec
  `roamingLiveMarkers` dans `liveActorMarkers` pour un rendu unique (anneau `animate-ping` +
  libellé toujours visible, identique au PNJ/Dragon errant). Le libellé de catégorie est calculé
  par `liveActorKindLabel(m)` : pour ce marqueur, il affiche le **type de sollicitation**
  (`npc.offer.trade/quest/fight/chat` → « Troc »/« Quête »/« Combat »/« Discussion »), pas
  « PNJ errant » (qui n'aurait aucun sens ici). L'ancien encart statique (téléportation instantanée,
  sans anneau, sans filtre) a été retiré pour éviter un double affichage.
- **Filtre « declutter » (🧹, `lib/mapFilters.ts`)** : nouveau champ `declutter: boolean` (défaut
  `false` partout, pour ne jamais changer silencieusement la visibilité des marqueurs d'un joueur
  existant) ; constante `DECLUTTER_RADIUS_PCT = 24` (échelle Mapmonde 0-100) ; ensemble
  `LIVE_ACTOR_MARKER_IDS` (PNJ/Dragon errants + PNJ en approche) toujours exempté, de même que les
  marqueurs `isKingdom` et de type `zorghon`/`captive` (rares/temporaires, doivent rester visibles
  quelle que soit la distance). `markerMatchesFilters(m, f, playerPos?)` accepte un 3ᵉ paramètre
  optionnel `playerPos` : si `f.declutter` est actif et le marqueur non exempté, il est masqué au
  -delà de `DECLUTTER_RADIUS_PCT` de la position de Synk. Rétrocompatible : les appels existants de
  `GameCanvas2D.tsx` (sans ce 3ᵉ argument) restent inchangés — le fenêtrage caméra de ce widget est
  déjà bien plus étroit que le rayon de déclutter, rendant ce filtre inutile à cet endroit. Ajout
  d'une entrée dans `MAP_FILTER_CATEGORIES` : câble automatiquement un bouton joueur (barre de
  filtres de `WorldMapWidget.tsx`) et un défaut admin-configurable (`MapFiltersAdminPanel.tsx`,
  `gameState.ts::MapFilterDefaults`), sans code UI supplémentaire (les deux réutilisent une boucle
  `.map()` générique sur ce tableau).

**Vérification** : script Playwright jetable — session Démo anonyme, widgets Mapmonde/Plateforme 2D
isométrique/Plateforme 3D ouverts, rencontre PNJ forcée (horodatages `localStorage`
`zc.popupNext.*`/`zc.popupCount.*` du planificateur « battement de cœur » de `NpcEncounterPopup.tsx`
remis à zéro puis rechargement) : popup de rencontre confirmé affiché (offres « Quête »/« Troc »/
« Combat »/« Discussion » testées sur 5 tirages), 3 anneaux clignotants présents sur la Mapmonde
(PNJ errant, Dragon errant, PNJ en approche) avec libellés corrects (`"🥷 Templier · Quête"`,
`"🧙 Voleur · Combat"`, `"🧝 Sorcier · Troc"`, `"🧛 Villageois · Discussion"`), position en `%`
avec transition `1500ms` confirmée ; marqueur équivalent confirmé dans `GameCanvas2D.tsx` (position
locale en pixels, même transition, `animate-bounce` une fois arrivé) ; personnage voxel articulé
confirmé visible à proximité de Synk dans `Platform3DWidget.tsx` (capture d'écran). Filtre
« declutter » : 222 marqueurs catalogue avant activation → 89 après activation → 222 après
désactivation (retour exact à l'état initial, aucune régression persistante). Zéro erreur console
sur l'ensemble des scénarios. `tsc --noEmit` propre.

## 🔒 PNJ de rencontre persistants (fantômes errants) + trésors qui disparaissent/réapparaissent

**Demande utilisateur** : (1) les PNJ qui viennent solliciter Synk (voir section précédente) ne
doivent **plus disparaître** une fois le popup de rencontre fermé — ils doivent continuer à
progresser/se déplacer naturellement sur la Mapmonde, la Plateforme 2D isométrique et la
Plateforme 3D, et pouvoir revenir près de Synk plus tard ; ceux à moins de **10 cases** de Synk
doivent être matérialisés par un anneau clignotant sur la Mapmonde (paramétrable). (2) Un objet 3D
ramassé dans la Plateforme 3D doit naturellement rejoindre la Besace de Synk **si les conditions
sont remplies** (assez d'XP **ou** assez de pièces), disparaître de son emplacement précis, et n'y
réapparaître qu'après un délai (48h par défaut, paramétrable).

**Correctif — PNJ persistants** :
- **`lib/roamingActors.ts`** : le module (portée module, même pattern que `npcApproach.ts`) gagne un
  tableau additif `extras: ExtraRoamingActor[]` (en plus des PNJ/Dragon errants historiques,
  inchangés). `spawnExtraRoamingActor(actor, maxCount)` est **idempotent par id** (un PNJ déjà
  fantôme n'est pas dupliqué), **éviction FIFO** au-delà de `RepRules.npcMaxPersistentExtras`
  (défaut 5 — évite un encombrement infini de la carte au fil des rencontres), et purge les entrées
  orphelines de la map interne `extraMotions` à chaque éviction.
- **`game/page.tsx::handleEncounterChange`** : au moment où une rencontre se termine
  (`active → false`, transition détectée via `wasEncounterActiveRef`, AVANT l'appel à
  `endNpcApproach()`), si `repRules.npcPersistAfterEncounter` (défaut `true`) est actif, la dernière
  position connue du PNJ en approche (`getNpcApproachState()`) + son identité (`encounterNpc`) sont
  figées dans un `ExtraRoamingActor` persistant via `spawnExtraRoamingActor(...,
  repRules.npcMaxPersistentExtras)`. Le PNJ « fantôme » continue ensuite d'errer indéfiniment (pas
  de despawn automatique, seulement borné par le plafond FIFO).
- **Rendu identique dans les 3 widgets** : `WorldMapWidget.tsx` fusionne les extras dans
  `liveActorMarkers` (nouveau cas `formerEncounterLabel` dans `liveActorKindLabel`) ;
  `GameCanvas2D.tsx` les affiche via `extrasInView` (icônes fantômes non interactives, même
  transition `duration-[1500ms]` que les autres acteurs vivants) ; `Platform3DWidget.tsx` les
  injecte dans `sceneMarkers` via une map `extraById` (facing/moving en O(1)), avec
  `isEncounterMarker` étendu pour exempter le préfixe `encounter.extra.` du routage de clic (les
  fantômes restent volontairement non interactifs, sans identité catalogue).
- **Anneau conditionnel à la proximité (changement de comportement assumé)** : sur la Mapmonde, le
  **libellé reste toujours visible** (garantie verrouillée du commit `c1941cc`), mais l'**anneau**
  clignotant (`animate-ping`) n'apparaît désormais que si le marqueur est à moins de
  `RepRules.npcProximityRadiusTiles` (défaut 10 cases, distance euclidienne directe — l'espace
  Mapmonde est déjà en coordonnées 0-100, aucune conversion d'unité nécessaire) de la position
  courante de Synk, via un nouveau garde `isNearSynk()`. Ce comportement s'applique à **tous** les
  acteurs vivants (PNJ/Dragon errants historiques + PNJ en approche + fantômes persistants), pas
  seulement aux nouveaux — demande explicite du porteur de projet dans cette itération.

**Correctif — trésors avec disparition/réapparition + condition XP OU pièces** :
- **`lib/gameState.ts`** : `TreasureDef.coinsRequired?: number` (nouveau champ catalogue, admin) ;
  nouveau type `TreasureFoundEntry` + `getFoundTreasureEntries()`/`subscribeFoundTreasureEntries()`
  (variantes de `getFoundTreasureIds`/`subscribeFoundTreasureIds`, conservées intactes pour les
  autres appelants) qui exposent aussi le timestamp `foundAt` déjà stocké dans
  `treasuresFound/{RKEY(id)}` ; `isTreasureCurrentlyHidden(entry, respawnHours)` calcule si un
  trésor doit rester masqué (`respawnHours <= 0` = ne réapparaît jamais, comportement historique
  conservé comme échappatoire). `openTreasureOffchain(address, treasure, opts?: {respawnHours?,
  payWithCoins?})` déduit désormais le portefeuille (`applyEffect(address, {wallet: -coût})`,
  clampé à 0) quand `payWithCoins` est vrai, et utilise `isTreasureCurrentlyHidden()` pour la
  vérification « déjà ouvert ».
- **`lib/treasureVisibility.ts` (nouveau fichier)** : hook partagé `useHiddenTreasureIds(address,
  respawnHours)` (s'abonne à `subscribeFoundTreasureEntries`, retourne un `Set` de clés **RKEY'd**)
  consommé identiquement par les 3 widgets pour filtrer les marqueurs de trésors déjà ramassés et
  pas encore réapparus. ⚠️ Piège documenté dans le JSDoc du fichier : les ids bruts de marqueurs de
  trésor (contenant parfois des points) diffèrent de leur clé de stockage Firebase — les appelants
  doivent tester `hiddenTreasureIds.has(RKEY(m.id))`, jamais `.has(m.id)` directement.
- **`GameCanvas2D.tsx`/`Platform3DWidget.tsx`** : la donnée brute de marqueurs a été renommée
  `rawMarkers`, et une nouvelle valeur dérivée `markers` (via `useMemo`, filtrée par
  `useHiddenTreasureIds`) est utilisée partout en aval — préserve tous les noms/usages existants
  dans ces gros fichiers (aucun autre site d'appel modifié).
- **`PoiInteractionModal.tsx` (`TreasureBody`)** : nouvelle logique `canOpen = xpOk || coinsOk`
  (condition **OU**, pas ET — interprétation retenue pour la formulation « moyennant expériences ou
  suffisamment de coins nécessaire », documentée en commentaire de code au cas où le porteur de
  projet souhaite l'inverser en ET) ; `payWithCoins = !xpOk && coinsOk` (les pièces ne sont déduites
  que si le palier XP n'est pas déjà atteint) ; affichage d'un décompte du temps restant avant
  réapparition si le trésor est actuellement masqué ; prop `playerWallet` ajoutée au composant
  racine et propagée depuis les deux widgets porteurs.
- **`RepRulesPanel.tsx` / `admin/page.tsx`** : nouvelle section admin « 🧙 PNJ vivants & Trésors »
  (`npcPersistAfterEncounter`, `npcMaxPersistentExtras`, `npcProximityRadiusTiles`,
  `treasureCoinsUnlockEnabled`, `treasureRespawnHours`) ; champ `coinsRequired` ajouté au formulaire
  de création de trésor et à `TreasureRow` (édition), avec badge `🪙` d'affichage.

**Vérification** : `npx tsc --noEmit` propre, `npm run build` réussi (warnings pré-existants
inchangés, liés aux dépendances wallet WalletConnect/MetaMask, sans rapport avec ces
modifications). Script Playwright jetable : connexion Démo anonyme → ouverture Mapmonde/Plateforme
2D isométrique/Plateforme 3D → aucune erreur console sur l'ensemble du parcours. L'accès au menu
Administration nécessitant un wallet réel correspondant au propriétaire du contrat (`isOwner` dans
`admin/page.tsx`), les nouveaux champs `RepRulesPanel` n'ont pas pu être exercés en boîte noire dans
ce contexte Playwright — validés par revue de code (même schéma que les champs `RepRules` existants
juste au-dessus, mêmes conventions de nommage/persistance). Toutes les nouvelles clés i18n
ajoutées dans `fr.json`/`en.json`/`es.json`/`pt.json` (les 4 langues, validées JSON-valides).
Aucune régression : le système de déplacement de Synk (verrouillé), le PNJ/Dragon errant historique
et le filtre « declutter » (`ce78d9d`, section précédente) restent intacts et continuent de
fonctionner exactement comme avant.

## 🔒 Fantômes qui s'agglutinent/clignotent + rappel d'énigme après acceptation d'une quête

**Demande utilisateur** : (1) quand un PNJ vient solliciter Synk, « une multitude de PNJ »
semblaient apparaître en clignotant/se téléportant de façon erratique dans la Plateforme 3D au lieu
de se disperser naturellement — seuls les PNJ à ≤ 10 cases de Synk doivent clignoter, et
uniquement sur la Mapmonde (`ce78d9d`). (2) après avoir accepté une quête proposée par un PNJ de
rencontre, recliquer sur ce PNJ (devenu fantôme persistant) ne rouvrait aucun pop-up — l'utilisateur
veut un rappel de l'énigme/question (même type de pop-up), avec la possibilité d'y répondre à
nouveau.

**Cause racine du clustering/clignotement** :
- `spawnExtraRoamingActor()` (`lib/roamingActors.ts`) plaçait toujours le nouveau fantôme à la
  dernière position d'approche (donc **toujours adjacente à Synk**, par construction de
  `npcApproach.ts`) avec un mouvement initial nul (`{dx:0, dy:0, holdTicks:0}`), suivi d'une marche
  aléatoire à tenue **courte** (3-9 tics ≈ 12-36s, 20% de chance de pause). Au fil d'une session,
  jusqu'à 5 fantômes (plafond FIFO `npcMaxPersistentExtras`) pouvaient donc s'accumuler presque au
  même endroit, tout près de Synk.
- `Platform3DWidget.tsx::MarkerBlock` liait la position 3D directement via la prop JSX
  `<group position={[x, 0, z]}>`, réévaluée à chaque tic partagé (`STEP_MS = 4000ms`,
  `lib/roamingActors.ts`) — un **saut instantané** sans interpolation, contrairement à la 2D
  (`GameCanvas2D.tsx`, transition CSS `duration-[1500ms]`). Ce saut, déjà présent avant cette
  itération pour tous les acteurs vivants (PNJ/Dragon errants historiques inclus), ne devenait
  visuellement gênant (« clignotement ») que lorsque plusieurs fantômes se concentraient dans le
  faible rayon de vue (`VIEW_RADIUS = 7`) autour de Synk.

**Correctif — dispersion + lissage visuel** :
- **`lib/roamingActors.ts`** : nouvelle fonction `escapeMotion()` (constantes
  `ESCAPE_MIN_HOLD_TICKS=16`/`ESCAPE_MAX_HOLD_TICKS=28`, soit ~64-112s) qui choisit une direction
  non nulle aléatoire et **ne fait jamais de pause** — remplace le mouvement initial nul du fantôme
  fraîchement créé dans `spawnExtraRoamingActor()`. Chaque nouveau fantôme s'éloigne donc
  immédiatement et durablement de Synk au lieu de tourner en rond sur place.
- **`Platform3DWidget.tsx::MarkerBlock`** : les branches `isNpc`/`isFamiliar` (les seules à recevoir
  `facing`/`moving`, donc les seules « entités vivantes » — trésor/quête/monde/poi restent
  statiques et inchangés) utilisent désormais un `ref` (`posGroupRef`) mis à jour dans un
  `useFrame` qui **lisse** (`lerp`, facteur `0.12`/frame) la position vers la nouvelle cible plutôt
  que de la réaffecter directement en JSX. Un `posInitedRef` garantit un positionnement direct
  (sans glissement depuis l'origine) à l'initialisation, puis un lissage exclusivement ensuite —
  élimine le saut/clignotement pour **tous** les acteurs vivants (PNJ/Dragon errants historiques,
  PNJ en approche, fantômes persistants), sans toucher aux marqueurs catalogue statiques.

**Correctif — rappel d'énigme sur re-clic** :
- **`lib/roamingActors.ts`** : `ExtraRoamingActor.questId?: string` (nouveau champ optionnel) rend
  un fantôme cliquable **uniquement** si une quête a effectivement été accordée pendant sa
  rencontre d'origine.
- **`NpcEncounterPopup.tsx`** : `EncounterMarkerInfo.grantedQuestId?: string` propage l'id de la
  quête accordée (`questGranted?.quest?.id`, renseigné par `accept()` pour l'offre `'quest'`) au
  parent pendant toute la durée de la rencontre encore affichée.
- **`game/page.tsx::handleEncounterChange`** : passe `questId: encounterNpc.grantedQuestId` à
  `spawnExtraRoamingActor(...)` au moment de la persistance du fantôme.
- **`GameCanvas2D.tsx`/`Platform3DWidget.tsx`** : un fantôme avec `questId` devient cliquable
  (`onExtraQuestClick`/`onExtraQuestClick3D`, badge `📜` additionnel, tooltip dédié) et route son
  clic vers un **marqueur synthétique** `{ id: questId, kind: 'quest', ... }` — réutilise à 100%
  `PoiInteractionModal::QuestBody` (déjà utilisé partout ailleurs pour répondre à une énigme),
  **sans dupliquer sa logique** (récompense, `solved`, `submitQuestAnswerOffchain`...). L'apparence
  3D/2D du fantôme (voxel PNJ) reste totalement indépendante de ce marqueur de clic synthétique. Les
  fantômes sans `questId` (troc/combat/discussion terminés) restent volontairement non interactifs.

**🐛 Bug de boucle infinie de rendu détecté et corrigé pendant la vérification Playwright** (non
demandé explicitement, mais directement couplé à l'effet modifié ci-dessus) : l'effet de
`NpcEncounterPopup.tsx` qui répercute `current`/`questGranted` au parent (`onEncounterChange`)
dépendait **aussi** de la référence `onEncounterChange` elle-même — or
`game/page.tsx::handleEncounterChange` n'est **pas** stable en référence (il dépend de
`encounterNpc`, l'état qu'il met justement à jour), donc chaque appel recrée une nouvelle fonction,
qui redéclenche l'effet, qui rappelle la fonction, etc. : un cycle de rendu infini
(« Maximum update depth exceeded », reproduit en test Playwright dès qu'une rencontre PNJ
s'affichait). **Correctif** : la dernière version de `onEncounterChange` est désormais lue via un
`ref` (`onEncounterChangeRef`, mis à jour dans un effet séparé et inoffensif) au lieu d'être mise en
dépendance directe — l'effet principal ne se redéclenche plus que lorsque `current`/`questGranted`
changent réellement. Même traitement pour le filet de sécurité au démontage. Ce bug préexistait
probablement avant cette itération (le tableau de dépendances incluait déjà `onEncounterChange`
dans le commit `cbac7b9`) mais n'avait jamais été rapporté par l'utilisateur — corrigé par
prudence car strictement dans le périmètre du fichier modifié ici.

**Vérification (Playwright)** : script jetable — connexion Démo anonyme, déclenchement forcé d'une
rencontre PNJ de type « quête » (via manipulation ciblée de `localStorage['zc.popupNext.*']` +
`reload()`, le planificateur capturant sa prochaine échéance dans une variable JS locale au montage
plutôt que de la relire en continu), acceptation, fermeture du résultat. Confirmé : (a) **aucune**
erreur console « Maximum update depth exceeded » sur l'ensemble du parcours (avant le correctif,
l'erreur apparaissait de façon systématique et continue) ; (b) le fantôme persistant (badge `📜`)
apparaît bien dans la Plateforme 2D isométrique et est cliquable ; (c) cliquer dessus ouvre bien le
conteneur modal `PoiInteractionModal` (`.z-[90]`, vérifié absent avant clic puis présent après) avec
le même titre, la même récompense, le même champ de réponse et le même bouton "Valider" que la
quête d'origine (⚠️ le titre affiché à l'origine était le nom de l'archétype PNJ, corrigé dans la
section suivante — voir « Fantômes qui affichaient le nom du PNJ au lieu de la question ») ; (d) la
Plateforme 3D (canvas WebGL) s'affiche sans erreur avec le lissage de position actif. `npx tsc
--noEmit` et `npm run build` propres. Aucune régression détectée sur le système de déplacement de
Synk, le PNJ/Dragon errant historique, ni le filtre « declutter ».

## 🔒 Fantômes affichant le nom du PNJ au lieu de la question de la quête (rappel d'énigme)

**Demande utilisateur** : après re-clic sur un fantôme de rencontre ayant accordé une quête (voir
section précédente), le pop-up de rappel affichait le nom de l'archétype PNJ (ex. « Faucheur
d'Automne ») comme titre au lieu du texte complet de la question posée — l'utilisateur ne
retrouvait donc ni le nom complet ni l'énoncé de l'énigme, et ne trouvait logiquement aucune trace
de « Faucheur d'Automne » dans le menu Administration (les quêtes PNJ ne sont jamais rattachées à
un archétype précis, voir plus bas).

**Cause racine** : `QuestDef.label`/`i18nKey` (`lib/gameState.ts`) contient en réalité le texte
INTÉGRAL de l'énigme (ex. `quest.riddle_first` = « 🪨 Énigme 1 : Je suis dur comme la pierre mais je
flotte sur l'eau. Que suis-je ? », voir aussi les 20 quêtes PNJ de
`scripts/seedNpcRiddleQuests.mjs` et les quêtes d'îles de `scripts/seedIslandQuests.mjs`) — il n'y a
pas de champ « nom » distinct de la « question » dans ce système, les deux ne font qu'un (confirmé
par `getKingdomQuestMarker()` qui construit son marqueur `kind:'quest'` avec `name: q.label,
i18nKey: q.i18nKey`, jamais avec un nom de PNJ). Or le marqueur synthétique construit lors du
re-clic sur un fantôme (`GameCanvas2D.tsx::onExtraQuestClick` / `Platform3DWidget.tsx
::onExtraQuestClick3D`) utilisait par erreur `actor.name`/`actor.i18nKey` (le nom de l'ARCHÉTYPE
PNJ, ex. « Faucheur d'Automne », `NpcEncounterPopup.tsx::ARCHETYPES`) au lieu de
`QuestDef.label`/`i18nKey` — car ces deux informations n'étaient jusqu'ici pas propagées
distinctement le long de la chaîne fantôme persistant. Les quêtes PNJ ne sont d'ailleurs PAS
propres à un archétype donné : n'importe quel PNJ avec `offer: 'quest'` peut se voir attribuer
n'importe quelle quête `npcGiver` disponible via `pickNpcQuestForPlayer()` — d'où l'absence
normale de toute trace de « Faucheur d'Automne » dans le menu Administration (qui liste les quêtes
par leur propre texte/label, jamais par PNJ donneur).

**Correctif — propagation du texte de la quête distinct du nom du PNJ** :
- **`NpcEncounterPopup.tsx`** : `EncounterMarkerInfo` gagne `grantedQuestLabel?: string` et
  `grantedQuestI18nKey?: string` (renseignés depuis `questGranted.quest.label`/`.i18nKey`, à côté
  de `grantedQuestId` déjà existant), propagés dans le même effet que `grantedQuestId`.
- **`game/page.tsx::handleEncounterChange`** : passe `questLabel`/`questI18nKey` (repris de
  `encounterNpc.grantedQuestLabel`/`.grantedQuestI18nKey`) à `spawnExtraRoamingActor(...)`, en plus
  de `questId`.
- **`lib/roamingActors.ts`** : `ExtraRoamingActor` (et le paramètre `actor` de
  `spawnExtraRoamingActor`) gagnent `questLabel?: string`/`questI18nKey?: string` — distincts de
  `name`/`i18nKey` qui restent le nom de l'archétype PNJ (utilisé pour l'apparence/l'infobulle du
  fantôme, inchangé).
- **`GameCanvas2D.tsx::onExtraQuestClick`** : construit désormais le marqueur `kind:'quest'` avec
  `name: actor.questLabel ?? actor.name, i18nKey: actor.questI18nKey ?? actor.i18nKey` (repli sur
  le nom du PNJ uniquement pour un fantôme déjà persisté AVANT ce correctif, sans ces nouveaux
  champs — évite un titre vide en cas de redéploiement à chaud).
- **`Platform3DWidget.tsx`** : `SceneMarker` gagne les mêmes `questLabel?`/`questI18nKey?`
  (renseignés depuis `extraById.get(m.id)?.questLabel`/`.questI18nKey` dans `sceneMarkers`),
  propagés à `onExtraQuestClick(m.marker, m.questId!, m.questLabel, m.questI18nKey)` ; la signature
  de la prop `onExtraQuestClick` et `onExtraQuestClick3D` acceptent ces deux paramètres
  supplémentaires optionnels et les utilisent en priorité sur `m.name`/`m.i18nKey` pour construire
  le marqueur synthétique.

**Vérification (Playwright)** : script jetable — connexion Démo anonyme (« 🎟️ Accès Démo » →
« 👤 Jouer en anonyme »), déclenchement forcé d'une rencontre PNJ de type « quête » (réinitialise
`zc.popupNext.*` ET `zc.popupCount.*` en localStorage avant chaque `reload()`, ce dernier point
nécessaire car `RepRules.npcMaxPerDay` — défaut 4 — bloque tout nouveau tirage au-delà du quota
journalier, y compris entre plusieurs tentatives de test), acceptation de la quête offerte,
fermeture du résultat, clic sur le fantôme persistant (badge `📜`). Confirmé par capture d'écran et
lecture du DOM : le pop-up de rappel affiche désormais « 📜 🧑‍🤝‍🧑 Énigme des îles 22 : Doyenne
respectée de la plus petite île de l'archipel, gardienne de ses secrets malgré sa taille modeste.
Qui est-elle ? » (texte intégral de la question) au lieu du nom du PNJ donneur (« Marchand ambulant
l'Errant » dans cette tentative), avec la récompense (+134 XP, +201 score), le champ de réponse et
les boutons "Valider"/"Fermer" inchangés. Zéro erreur console. `npx tsc --noEmit` propre. Aucune
régression sur le reste du parcours (dispersion des fantômes, lissage 3D, boucle infinie déjà
corrigés dans la section précédente).

## Lisibilité des champs de formulaire du menu Administration (classe partagée `.input`)

**Bug signalé** : dans le menu Administration, le texte des champs (valeurs numériques du Barème
de reconnaissance, adresses de joueurs, options de listes déroulantes, zones de message/annonce,
codes de confirmation…) s'affichait en gris très clair sur fond blanc, quasi illisible —
captures d'écran à l'appui sur ~10 panneaux différents (Statistiques par joueur, Barème de
reconnaissance, Dé d'Action, Plafonds de statistiques, Pondération de l'humeur, Plateforme 3D,
Pop-up profondeur/altitude…).

**Cause racine** : la classe `className="input"`, utilisée par convention sur environ 220
`<input>`/`<textarea>`/`<select>` répartis dans 18 composants (tous les panneaux admin, plus
`ChatHistory.tsx`, `EncountersLog.tsx`, `PlayerEmailPanel.tsx`, `FiatTopupPresetsPanel.tsx`),
**n'était définie nulle part** dans le CSS du projet (aucune règle `.input` dans `globals.css`, ni
plugin Tailwind, ni `@apply` ailleurs). Les champs n'affichaient donc que le rendu par défaut du
navigateur (fond blanc), mais le **Preflight de Tailwind** applique `color: inherit` aux contrôles
de formulaire — le texte héritait donc du `color: #e2e8f0` (gris-bleu clair, pensé pour un fond
sombre) posé sur `<body>`, d'où un texte clair sur fond blanc.

**Correctif** : définition de la classe `.input` dans `web/src/app/globals.css` (fond blanc, texte
`text-slate-900` foncé, `placeholder:text-slate-500` gris moyen lisible, bordure/coins arrondis,
état `:focus` avec anneau `voxlyn-crystal`, état `:disabled` grisé, et `.input option` stylé
explicitement pour que la liste déroulante native des `<select>` soit également lisible) — un seul
point de correction central pour les ~220 usages, **sans** inclure de classe de largeur (pas de
`w-full`/`w-24`/`flex-1`) dans `.input` afin de ne jamais entrer en conflit avec les classes de
largeur ajoutées au cas par cas par chaque appelant (les utilitaires Tailwind, générés après les
classes composants dans la cascade, restent prioritaires).

**Vérification (Playwright)** : page de test jetable reproduisant exactement les combinaisons de
classes trouvées dans `PlayerStats.tsx`/`RepRulesPanel.tsx`/`admin/page.tsx`
(`input`, `input w-24`, `input flex-1`, `input w-full`, `input text-xs w-48`, `select.input`
avec `<option>`, `input:disabled`) — confirmé via `getComputedStyle()` que le texte et les options
de `<select>` passent de `rgb(226, 232, 240)` (illisible) à `rgb(15, 23, 42)` (foncé, lisible) sur
fond `rgb(255, 255, 255)`, et que les largeurs (`w-24` = 96px vs `w-full` = largeur du conteneur)
restent inchangées (aucune régression de mise en page). `npx tsc --noEmit` propre. Page de test et
scripts supprimés après vérification (convention jetable du projet). Le panneau Admin lui-même
(gated par `isOwner`, wallet propriétaire réel requis) n'est pas cliquable via Playwright dans cet
environnement — limitation déjà documentée dans l'historique du projet — la vérification s'appuie
donc sur le CSS réellement compilé par Tailwind contre les mêmes classes, pas sur un clic-through
de l'UI admin protégée.

## Combinaisons de Potions (Élixirs)

Mécanisme de fabrication d'objets, disponible dans le widget **"Sac / Besace"** (`InventoryWidget.tsx`,
onglet Potions & Sortilèges, section "🧪 Combiner des potions") : le joueur combine plusieurs
potions/sortilèges déjà possédés (recette fixe, quantités exactes) pour obtenir un **Élixir**
surpuissant, dans l'esprit Donjons & Dragons.

- **Modèle de données** (`gameState.ts`) : `PotionCombo` (id, label, icône, `ingredients`
  (`{itemId, qty}[]`), `effectKind`, `durationMinutes`, `forceMultiplier`, `grantItem`, `active`),
  stocké hors-chaîne à `catalog/potionCombos/{id}` (repli sur `DEFAULT_POTION_COMBOS` si vide,
  fusion Firebase-prioritaire — même stratégie que le catalogue boutique).
- **6 recettes de départ** : Invulnérabilité de Vie (24h), Force Titanesque (×2, 30min), Souffle
  Éternel (oxygène plein, 30min), Vigueur Sans Fin (fatigue pleine, 10min), Festin Royal (faim
  pleine, instantané), Épée Divine de Lumière (objet unique `grantItem`, non présent en boutique).
- **Effets temporisés** (`hpInvulnerableUntil`, `forceBoostUntil`/`forceBoostMultiplier`,
  `oxygenShieldUntil`, `fatigueShieldUntil` sur `PlayerState`) branchés au point d'entrée unique
  `applyEffect()` (bloque toute perte de vie/oxygène/fatigue tant que le bouclier est actif — les
  gains restent inchangés) et à `computePlayerDiceBonus()` (multiplie la contribution de la Force
  au bonus de combat) — **aucun autre fichier** n'a eu besoin d'être modifié pour que les boucliers
  s'appliquent partout (combats PNJ, noyade, altitude, fatigue).
- **Pop-up "sablier" `ActiveElixirsBanner.tsx`** : bandeau fixe en haut de l'écran, clignotant
  (`animate-pulse`), une carte par Élixir temporisé actif avec décompte live (⏳ animé), lu en
  temps réel depuis `PlayerState` (`subscribePlayer`) — combiner deux fois la même recette
  rafraîchit simplement son horodatage au lieu de dupliquer la carte.
- **Administration** (`PotionComboAdminPanel.tsx`, menu Administration § 27) : CRUD complet des
  recettes (ingrédients dynamiques, type d'effet, durée, multiplicateur de Force, objet unique
  offert) — même patron que `PotionsSpellsAdminPanel.tsx`/`EquipmentAdminPanel.tsx`.
- i18n complet FR/EN/ES/PT (`elixir.kind.*`, `elixir.desc.*`, `game.inventory.combine.*`,
  `admin.potionCombos.*`).
- Vérifié par un scénario Playwright bout-en-bout (session Démo anonyme → seed d'ingrédients →
  combinaison des 6 recettes → vérification des messages de succès, de la consommation exacte des
  ingrédients et de l'affichage simultané des 4 cartes temporisées dans le bandeau) : aucune
  régression détectée sur le flux "Utiliser"/"Équiper" existant ni sur la section fixe dupliquée
  `InventoryPanel.tsx` (volontairement non modifiée, le mécanisme n'existe que dans le widget
  flottant, conformément à la demande).

## Modèle de terrain (Mapmonde / Plateforme 2D / Plateforme 3D)

`web/src/lib/worldTerrain.ts` génère chaque tuile de façon **déterministe** (même seed pour tous
les joueurs) via `worldTileAt(colonne, ligne, poiPoints)`, avec le modèle :

```ts
type Tile = {
  terrain: 'grass' | 'rock' | 'water' | ...;
  prop?: string;           // décor (arbre, rocher, PNJ...)
  altitudeM?: number;      // 0-6000, uniquement si terrain === 'rock'
  depthM?: number;         // profondeur, uniquement si terrain === 'water'
  waterKind?: string;      // mer / océan / lac / étang / ruisseau
  isIsland?: boolean;      // marque les tuiles d'île/archipel
};
```

Cette structure a été pensée dès l'origine pour être réutilisable telle quelle par un widget
« Plateforme 3D » (même donnée altitude/profondeur, sans réécriture) : c'est désormais le cas —
`web/src/components/Platform3DWidget.tsx` (Phase 2 Roadmap, Three.js/React Three Fiber) consomme
`worldTileAt`/`getAllMapMarkers` à l'identique de `GameCanvas2D.tsx`/`WorldMapWidget.tsx`, garantissant
que les 3 vues (2D isométrique, Mapmonde, 3D voxel) restent strictement cohérentes entre elles (même
décor, même position `players/{addr}/mapPos`). Le rendu 3D transpose directement `altitudeM` en
hauteur de bloc rocheux et `depthM` en profondeur/teinte de bloc d'eau. Les mécaniques d'oxygène/
fatigue/raréfaction de l'air restent intégralement pilotées par `GameCanvas2D.tsx` (toujours monté
dans `game/page.tsx`) : le widget 3D n'en est qu'une vue et un canal de déplacement supplémentaires,
sans y dupliquer aucune logique de décompte (zéro risque de régression/double-décompte).

## PNJ/Dragon errant synchronisé entre la Plateforme 2D isométrique et la Plateforme 3D

Depuis leur création, la Plateforme 2D isométrique (`GameCanvas2D.tsx`) fait « errer » doucement un
PNJ générique (🧙) et un Dragon générique (🐉) dans sa grille, pour donner l'impression d'un monde
vivant — chacun se voit attribuer une fois une véritable identité catalogue (PNJ ou familier-dragon
réel, voir `getAllMapMarkers`) afin qu'un clic ouvre le vrai pop-up d'interaction. Demande
utilisateur : que ce MÊME PNJ/Dragon, à la MÊME position et strictement synchronisé, soit également
visible dans `Platform3DWidget.tsx`, matérialisé comme un personnage 3D voxel (même rendu que les
PNJ/familiers fixes du catalogue), se déplaçant case par case en cohérence avec la vue 2D.

**Registre partagé `web/src/lib/roamingActors.ts`** (portée module, même technique que
`lib/mapFilters.ts`/`lib/platform3dActive.ts` — aucun Context nécessaire, les deux widgets sont
montés simultanément dans `/game`) devient la SEULE source de vérité :

- **Position en coordonnées MAPMONDE (0-100 %)**, pas en coordonnées de viewport local — l'échelle
  native de `players/{addr}/mapPos`. Chaque widget convertit ensuite vers son propre repère
  d'affichage : `GameCanvas2D.tsx` soustrait son `origin` de caméra pour revenir en coordonnées
  LOCALES (`npcLocal`/`dragonLocal`) ; `Platform3DWidget.tsx` soustrait directement
  `centerCol`/`centerRow` de Synk, exactement comme pour tout marqueur catalogue statique (voir
  `sceneMarkers`). **Le marqueur n'est rendu QUE si cette position locale tombe réellement dans la
  fenêtre de caméra actuelle** (`npcInView`/`dragonInView` en 2D ; garde `Math.abs(dx) > VIEW_RADIUS`
  en 3D) — voir le correctif ci-dessous, ceci n'a pas toujours été le cas en 2D.
- **Cadence d'errance INCHANGÉE** (`STEP_MS = 4000`) par rapport à l'ancienne implémentation locale
  de `GameCanvas2D.tsx`. L'intervalle de mouvement démarre au premier widget abonné et s'arrête au
  dernier (`subscribeRoamingActors`/`useRoamingActors`), jamais de minuteur qui tourne dans le vide.
- **Identité catalogue idempotente** (`ensureRoamingIdentities(markers)`, appelée par les DEUX
  widgets dès que leur propre `markers` est chargé) : le premier appelant gagne (`if (!state.npcMarkerId)`),
  garantissant que 2D et 3D affichent toujours le même PNJ/Dragon nommé, quel que soit l'ordre de
  montage des deux widgets.

### 🔒 Errance sur la mapmonde ENTIÈRE avec démarche persistante (ne pas réintroduire l'« attache »)

Retour utilisateur après la première version ci-dessus : le PNJ et le Dragon errants restaient
« aimantés » à Synk (mécanisme d'attache `TETHER_X=5`/`TETHER_Y=4` qui clampait leur position dans une
fenêtre autour de la dernière position connue de Synk, signalée via `reportSynkWorldPos(x, y)` depuis
l'effet `worldPos` de chaque widget) — ce qui donnait l'impression que les deux PNJ suivaient Synk
comme des animaux de compagnie au lieu de vivre leur propre vie sur l'île. Ce mécanisme d'attache a
été **entièrement supprimé** (`reportSynkWorldPos`, `TETHER_X`, `TETHER_Y`, `synkPos` n'existent
plus dans `roamingActors.ts`, et les deux widgets n'appellent/n'importent plus `reportSynkWorldPos`) :

- **Bornes d'errance = mapmonde complète** : `ROAM_MARGIN = 3` de chaque bord, soit un déplacement
  possible dans `[3, WORLD_SIZE-3] = [3, 97]` sur les deux axes (`WORLD_SIZE = 100`, importé de
  `worldTerrain.ts`), sans aucune dépendance à la position de Synk.
- **Marche à direction persistante** (au lieu d'un tirage aléatoire indépendant ±1 par tique, qui
  produisait des trajectoires en dents de scie non naturelles) : chaque acteur choisit une direction
  parmi 8 (ou une pause, `PAUSE_PROBABILITY = 0.2`) et la CONSERVE pendant `MIN_HOLD_TICKS = 3` à
  `MAX_HOLD_TICKS = 9` tiques (12 à 36 s), avant de retirer une nouvelle direction — ce qui donne une
  trajectoire qui ressemble à une vraie marche (lignes droites courtes, pauses occasionnelles) plutôt
  qu'à un tremblement aléatoire. Toucher le bord de la mapmonde force un nouveau tirage immédiat
  (`holdTicks = 0`) plutôt que de rester bloqué contre le mur pendant le reste de la tenue.
- **Orientation exposée** : `RoamingActorsState` porte désormais `npcFacing`/`dragonFacing`
  (type `SynkDirection`, calculé à partir du delta de déplacement de la tique précédente, via une
  copie locale de `directionFromDelta` — même convention de duplication volontaire que dans
  `GameCanvas2D.tsx`/`Platform3DWidget.tsx`) et `npcMoving`/`dragonMoving` (faux pendant une pause).

### 🔒 Correctif « toupie » + démarche articulée en 3D (ne pas réintroduire la rotation continue)

**Bug détecté** : dans `Platform3DWidget.tsx::MarkerBlock`, le `useFrame` faisait
`obj.rotation.y += isQuest ? 0.006 : 0.01` pour TOUT marqueur « flottant » (quête, familier, PNJ,
trésor, portail-monde, zorghon, captif confondus) — ce qui faisait tourner sur eux-mêmes en continu
non seulement les objets inanimés (parchemins, trésors, portails, pour lesquels une rotation lente
est un effet voulu) mais aussi les PNJ et Dragons, personnages vivants qui ne doivent jamais pivoter
sans raison (effet « toupie » signalé par l'utilisateur).

**Correctif** : introduction d'un drapeau `spinning = floating && !isNpc && !isFamiliar` qui exclut
désormais les PNJ/Dragons de cet incrément continu ; à la place, leur `<group>` reçoit une rotation
PONCTUELLE `rotation={[0, facingAngle, 0]}` dérivée de leur direction de déplacement courante
(`FACING_ANGLE[facing]`, même table que `SynkVoxel`), qui ne change que lorsque l'acteur change
réellement de direction. `facing`/`moving` ne sont renseignés QUE pour les deux entités errantes
(comparaison `m.id === roamingActors.npcMarkerId`/`.dragonMarkerId` dans `sceneMarkers`) ; tout autre
PNJ/familier statique du catalogue garde `facingAngle = 0` (orientation par défaut inchangée, sans
aucune régression visuelle).

**Démarche articulée** : `MarkerBlock` transmet `walking={!!moving}` à `NpcVoxel`/`DragonMarker`,
mais UNIQUEMENT pour les deux instances réellement errantes (tout autre PNJ/familier fixe du
catalogue reçoit `walking=false`, conservant son ancien balancement d'idle inchangé) :
- **`NpcVoxel`** : les jambes, auparavant des mailles statiques, sont désormais deux `<group>`
  articulés (`leftLegRef`/`rightLegRef`) pivotés à la hanche, positionnés de façon à reproduire
  EXACTEMENT la position absolue des anciennes mailles statiques (zéro régression visuelle en idle,
  `rotation.x` forcé à `0` quand `walking=false`). Quand `walking=true`, un cycle de marche complet
  anime bras/jambes en controlatéral (`legSwing = Math.sin(t·8)·0.55`, `armSwing = -legSwing·0.7`)
  plus un léger rebond du corps.
- **`DragonMarker`** : ajout de 4 pattes articulées avec pieds (`legFrontLeftRef`/`legFrontRightRef`/
  `legBackLeftRef`/`legBackRightRef`) positionnées sous le corps ellipsoïdal, et de deux yeux (sphère
  blanche + pupille sombre) près de la tête/des cornes — absents jusqu'ici sur TOUS les dragons/
  familiers du jeu (le rendu `DragonMarker` étant partagé par tout marqueur familier-dragon, pas
  seulement le Dragon errant). Quand `walking=true`, une démarche quadrupède en diagonale anime les
  pattes (`Math.sin(t·8)·0.5` : avant-gauche + arrière-droite en phase, avant-droit + arrière-gauche
  en opposition de phase) ; au repos les pattes restent statiques comme n'importe quel autre familier
  posé sur le sol (zéro régression pour les marqueurs familiers fixes du catalogue).

**Rendu 3D** : `Platform3DWidget.tsx::sceneMarkers` matérialise le PNJ/Dragon errant comme un
marqueur SYNTHÉTIQUE (même mécanisme que les marqueurs Zorghon/captifs déjà générés dynamiquement)
dont `x`/`y` suivent la position mapmonde COURANTE (pas la position catalogue statique, qui n'a pas
de sens pour une entité mobile), mais dont `name`/`id`/`icon` proviennent de sa véritable fiche
catalogue — afin que `MarkerBlock` choisisse le bon rendu voxel (`npcAppearance`/`NpcVoxel` ou
`familiarDragonColor`/`DragonMarker`, déjà utilisés pour tout PNJ/familier fixe, réutilisés SANS
AUCUNE modification). Aucune interpolation de mouvement n'a été ajoutée : la position se met à jour
instantanément à chaque tick (4 s), exactement comme tous les autres marqueurs/tuiles de la scène 3D
lorsque Synk se déplace (cohérence avec l'esthétique « par case » existante de tout le moteur).

**Anti-duplication (bug détecté et corrigé pendant la mise en œuvre)** : si la fiche catalogue du
PNJ/Dragon errant se trouve ELLE-MÊME dans le rayon affiché (`VIEW_RADIUS` en 3D, la fenêtre de
caméra en 2D), l'ancienne liste statique l'aurait affichée EN DOUBLE (une fois à sa position
catalogue fixe, une fois à sa position errante courante) — en 3D cela produisait une clé React
dupliquée (`MarkerBlock key={m.id}`) avec avertissement console et rendu indéterminé. Les deux
widgets EXCLUENT désormais de leur liste de marqueurs statiques toute fiche dont l'id correspond à
l'identité errante en cours (`markers.filter(m => m.id !== roamingActors.npcMarkerId && ...)`).

**Débogage/Playwright** : les deux widgets exposent `data-roaming-npc`/`data-roaming-dragon`
(`"<id-catalogue>,<x>,<y>"`, invisibles) sur leur conteneur racine (icône réduite ET fenêtre
dépliée) — même convention que `data-synk-pos`/`data-synk-running` déjà en place pour le
déplacement de Synk — permettant de vérifier par script (sans dépendre du rendu WebGL) que
l'identité et la position restent identiques entre les deux widgets à tout instant, et que la
position change bien à chaque cycle de 4 s.

### 🔒 Correctif « PNJ/Dragon coincés sur le bord de la grille » en Plateforme 2D isométrique (ne pas réintroduire le clamp inconditionnel)

**Bug détecté** : une fois l'errance étendue à la mapmonde ENTIÈRE (voir section précédente), le
PNJ et le Dragon errants restaient visibles en permanence dans `GameCanvas2D.tsx`, épinglés sur le
bord de la grille 8×10 (`COLS=10`, `ROWS=8`), alors même qu'ils se trouvaient déjà loin de Synk sur
la mapmonde et n'apparaissaient plus dans `Platform3DWidget.tsx` (qui, lui, les masque correctement
hors de son `VIEW_RADIUS`). Cause : `npcLocal`/`dragonLocal` passaient leur delta
(position-mapmonde − `origin`) dans `clampCoord(v, max) = Math.max(0, Math.min(max-1, v))`
**inconditionnellement**, donc même un delta très hors-limites (ex. -40 ou +60) se retrouvait
ramené à la case `0` ou `COLS-1`/`ROWS-1` — l'acteur restait donc « collé » au bord de la fenêtre de
caméra au lieu de disparaître, contrairement à tous les autres marqueurs de `visibleMarkers`
(construits avec une garde explicite `if (col >= 0 && col < COLS && row >= 0 && row < ROWS)`).

**Correctif** : calcul explicite de `npcInView`/`dragonInView` (même test de plage que
`visibleMarkers`) à partir du delta BRUT (`npcRawCol`/`npcRawRow`, non clampé) ; les deux `<div>`
marqueurs (`🧙`/`🐉`) ne sont désormais rendus dans le JSX que si leur booléen `InView` respectif
est vrai — `clampCoord` n'est conservé que pour le calcul de `left`/`top` du marqueur (sûr, puisqu'il
n'est utilisé que lorsque déjà dans la plage). Résultat : le PNJ/Dragon disparaît bien de la
Plateforme 2D isométrique dès qu'il erre hors de la fenêtre de caméra de Synk, exactement comme il
disparaît déjà de la Plateforme 3D — cohérence rétablie entre les deux vues.

**Vérification** : script Playwright jetable — Synk immobile (origine de caméra fixe), position
mapmonde du PNJ/Dragon et présence effective de leur `<div>` marqueur (filtré sur la classe CSS
`duration-[1500ms]`, propre à ces deux marqueurs, pour ne pas confondre avec d'autres marqueurs
PNJ/familiers statiques du catalogue qui réutilisent les mêmes émojis 🧙/🐉) échantillonnés toutes
les 8 s sur ~90 s : confirmé que `npcVisible`/`dragonVisible` passent bien de `true` à `false` au fur
et à mesure que leur position s'éloigne de la fenêtre de caméra (plus aucun cas où ils restent
affichés indéfiniment à distance). Zéro erreur console. `tsc --noEmit` propre.

### 🔒 Correctif « tête/corps de Synk tournant en miroir » en Plateforme 3D (ne pas réinverser les angles)

**Bug détecté** : appuyer sur ← faisait pivoter la tête et le corps de Synk vers la DROITE de
l'écran au lieu de la gauche, et inversement pour → (le déplacement lui-même — la case atteinte —
restait, lui, toujours correct ; seule l'orientation visuelle du modèle était en cause).

**Cause racine** : `FACING_ANGLE` (table d'angle de rotation Y en radians par direction à 8 valeurs,
`Platform3DWidget.tsx`, partagée par `SynkVoxel` ET par `MarkerBlock` pour le PNJ/Dragon errant, voir
section précédente) appliquait un angle de signe INVERSÉ pour toute direction comportant une
composante gauche/droite. Démonstration : le modèle de `SynkVoxel` a son visage (yeux/nez) tourné
vers `+Z` au repos (angle 0, voir les meshes d'yeux positionnés à `z > 0`). Le groupe englobant subit
`rotation={[0, angle, 0]}` ; la formule standard de rotation Y de Three.js transforme le vecteur de
visage `(0,0,1)` en `(sin(angle), 0, cos(angle))`. Or la caméra par défaut (`[0, 3.2, 5.6]`, visant
l'origine où Synk reste fixe — c'est le décor qui défile autour de lui, voir `centerCol`/`centerRow`)
a, par construction géométrique standard (caméra sans roulis, `up=(0,1,0)`), son axe « droite-écran »
aligné sur `+X` monde. Avec l'ancienne table (`left: +π/2`, `right: -π/2`, diagonales correspondantes
inversées), le visage tourné donnait `(+1,0,0)` pour `left` (donc **+X = DROITE écran**, alors que
« gauche » devrait donner `-X`) et `(-1,0,0)` pour `right` (donc **-X = GAUCHE écran**, inversé). Les
directions `up`/`down` (sans composante X) n'étaient, elles, pas affectées — ce qui explique
pourquoi seuls gauche/droite (et implicitement les 4 diagonales, non signalées séparément par
l'utilisateur mais souffrant du même mécanisme) étaient en cause.

**Correctif STRICTEMENT limité à la table `FACING_ANGLE`** (inversion du signe des angles latéraux :
`left: -π/2`, `right: +π/2`, `down-left: -π/4`, `up-left: -3π/4`, `up-right: +3π/4`,
`down-right: +π/4` ; `down: 0` et `up: π` inchangés) — **aucune autre ligne modifiée**. En
particulier, `directionFromDelta`, `useHoldMovement.ts`, la gestion clavier (maintien/course), le
callback `move`/`moveTo`, et l'architecture verrouillée ci-dessous restent **strictement intacts**,
conformément à la demande explicite de l'utilisateur de ne corriger QUE l'orientation visuelle sans
toucher au déplacement (fonctionnalité longuement stabilisée après plusieurs tentatives, voir
ci-dessous).

**Vérification** : instrumentation Playwright temporaire (exposition ponctuelle de
`window.__debugSynkFacing`/`__debugSynkFacingAngle` dans `SynkVoxel`, retirée immédiatement après
test, jamais committée) confirmant qu'un appui sur ← donne bien l'angle `-π/2` et → l'angle `+π/2`
(`up`/`down` inchangés à `π`/`0`) ; script de non-régression complémentaire confirmant que la
position mapmonde de Synk évolue toujours normalement après chaque touche (haut/bas/gauche/droite)
et que le mode course au maintien prolongé continue de fonctionner. Zéro erreur console.
`tsc --noEmit` propre.

### 🔒 Déplacement de Synk en Plateforme 3D — architecture VERROUILLÉE (ne pas régresser)

**Ceci est la référence technique à relire avant toute modification de `Platform3DWidget.tsx` ou
`useHoldMovement.ts` touchant au déplacement/à la caméra.** Après **5 tentatives de correctif
successives infructueuses** (chacune ayant réintroduit une boucle de rétroaction caméra↔déplacement
sous une forme différente), l'architecture a été **volontairement simplifiée** plutôt que corrigée
une 6e fois — voir `docs/ROADMAP.md` § « Historique — abandon complet de la caméra-relative/chase-cam »
pour le récit complet des tentatives précédentes et leurs causes racines.

**Règles impératives de cette architecture (NE JAMAIS les réintroduire à l'identique) :**

1. **Déplacement en repère MONDE FIXE, jamais relatif à la caméra.** Haut = nord (`dy:-1`), Bas = sud
   (`dy:+1`), Gauche = ouest (`dx:-1`), Droite = est (`dx:+1`) — strictement identique et indépendant
   de l'orientation de la caméra, exactement comme `GameCanvas2D.tsx` (Plateforme 2D isométrique),
   qui n'a jamais souffert de ce bug. `dispatchMove(dx, dy)` appelle directement `move(dx, dy)`
   (ou `moveUnderwater` en plongée), **sans aucune rotation d'entrée par un angle de caméra.**
2. **La caméra 3D (`OrbitControls`, drei) est une orbite 100% libre, pilotée UNIQUEMENT par la
   souris du joueur.** Le code ne doit **jamais** la repositionner/rappeler `.update()` sur elle
   automatiquement (pas de « caméra suiveuse »/chase-cam qui replace la caméra derrière Synk pendant
   la marche — toutes les variantes de cette idée ont, sans exception, fini par réinjecter l'angle
   caméra dans la résolution de direction et provoquer allers-retours/rotations sur place/dérive en
   spirale). S'il faut un jour redonner ce confort visuel, il devra être implémenté de façon
   **strictement à sens unique** : jamais lu en retour pour interpréter une touche.
3. **Garde-fou anti-glissé obligatoire sur les clics 3D.** Les gestionnaires `onClick` de React
   Three Fiber (`onMarkerClick3D`, `onPortalTileClick3D`, `onHutTileClick3D`, `onTileClick`) doivent
   commencer par `if (dragStateRef.current?.dragged) return;` — sans ce garde-fou, un glissé-souris
   d'orbite qui se termine au-dessus d'une tuile/d'un marqueur déclenche un déplacement/une
   interaction non voulus EN PLUS de faire orbiter la caméra. Le seuil (`DRAG_THRESHOLD_PX = 6`) est
   mesuré entre `pointerdown` et les `pointermove` suivants sur le conteneur du canevas
   (`onCanvasPointerDownForDrag`/`onCanvasPointerMoveForDrag`).
4. **Pas immédiat à la bascule marche→course (`useHoldMovement.ts::press`).** Au moment précis où le
   seuil de course (`runHoldThresholdMs`) est atteint, un appel à `moveRef.current(dx, dy)` doit être
   déclenché **avant** de démarrer le nouvel intervalle à cadence course (`runStepMs`) — sans ce pas
   immédiat, le trou de cadence entre l'ancien intervalle (marche) et le nouveau (course) peut
   dépasser `WALK_STOP_DELAY_MS`, ce qui repasse `isRunning`/`isWalking` à `false` quelques dizaines
   de ms après être passé à `true`, sans jamais s'y remettre pour le reste du maintien (ce callback
   n'est appelé qu'une seule fois par transition).
5. Ce hook (`useHoldMovement.ts`) est **partagé entre la Plateforme 2D et la Plateforme 3D** — toute
   modification doit être revalidée sur les DEUX widgets.

**Test de non-régression Playwright de référence** (à rejouer intégralement avant tout changement
touchant le déplacement/la caméra 3D) : voir `docs/ROADMAP.md` pour le scénario détaillé — 3 cycles
Haut/Bas/Gauche/Droite en appui bref (1 case exacte, bon sens à chaque fois), maintien >1,5 s dans
chacune des 4 directions (bascule en course confirmée ET stable jusqu'au relâchement), glissé-souris
sur le canevas (Synk ne doit JAMAIS bouger), clic simple sans glissé (doit toujours déclencher le
déplacement/l'interaction). Les attributs de débogage `data-synk-pos`/`data-synk-running`/
`data-widget-collapsed` (invisibles, posés sur le conteneur du widget) permettent de rejouer ce
scénario par script sans dépendre du rendu visuel Three.js.

## 🔒 Familiers/dragons du catalogue immobiles + PNJ surdimensionnés sans jambes visibles (widget 3D)

**Symptôme signalé** : (1) les familiers/dragons du catalogue AUTRES que le Dragon errant historique
(ex. « Dragon Vert ») restaient figés sur place et pivotaient sur eux-mêmes façon toupie au lieu de
se déplacer, dans les 3 widgets (Plateforme 2D, Plateforme 3D, Mapmonde) ; (2) les PNJ affichés dans
la Plateforme 3D étaient bien plus grands que Synk et leurs jambes étaient presque invisibles, sans
variation d'expression faciale.

**Cause racine (1) — un seul familier/dragon suivi.** `RoamingActorsState` (`lib/roamingActors.ts`)
ne suivait historiquement qu'**un seul** PNJ (`npcMarkerId`) et **un seul** familier/dragon
(`dragonMarkerId`) parmi tout le catalogue `entityMarkers` — tous les autres marqueurs
`kind:'familiar'` restaient donc rendus avec leurs coordonnées catalogue statiques et l'animation
idle (pivot sur place) faute de position « live » à interpoler.

**Correctif (1)** — ajout **additif**, sans toucher au système `npc`/`dragon` existant ni aux
`extras` (fantômes de rencontre) :
- Nouveau type exporté `RoamingFamiliarState` (`RoamingActorPos & {facing, moving}`) et nouveau champ
  `familiars: Record<string, RoamingFamiliarState>` sur `RoamingActorsState`.
- Nouvelle map de module `familiarMotions` (jamais purgée, contrairement à `extraMotions` qui est
  plafonnée FIFO) — un familier reste suivi tant que le catalogue le contient.
- `ensureRoamingIdentities()` boucle désormais sur tous les marqueurs `kind==='familiar'` du
  catalogue (hors celui déjà choisi comme `dragonMarkerId`) pour peupler `familiars`/
  `familiarMotions` de façon idempotente (ignore les ids déjà suivis).
- `stepActors()` fait avancer chaque entrée de `state.familiars` à chaque tick (même cadence
  `STEP_MS` que `npc`/`dragon`/`extras`), avec la même logique de fuite anti-clustering au spawn et
  de pause intermittente occasionnelle.
- Câblage dans les 3 widgets : `GameCanvas2D.tsx` (nouveau `familiarsInView`, exclusion des ids
  suivis dans `baseMarkers`), `Platform3DWidget.tsx` (`generalFamiliarMarkers`/
  `generalFamiliarFacing` injectés dans `sceneMarkers`, réutilisant le rendu `MarkerBlock`/
  `DragonMarker` générique — aucune duplication de code de rendu), `WorldMapWidget.tsx`
  (`generalFamiliarLiveMarkers`, rendu en marqueur standard SANS anneau clignotant — traitement
  anneau/label toujours réservé au PNJ/Dragon errant historique + `extras`, voir section
  précédente ; à réévaluer si une demande future souhaite l'étendre).
- Vérifié par script Playwright jetable (lecture d'un attribut `data-roaming-familiars` exposé sur
  le widget 3D, comparé entre deux relevés espacés de 4 ticks) : 7 familiers suivis, 6-7/7 ayant
  changé de position selon les runs (le reste respecte une pause intermittente volontaire, identique
  au comportement historique `npc`/`dragon`).

**Cause racine (2) — échelle par défaut trop grande + jambes qui clippent sous le sol.**
`DEFAULT_PLATFORM3D_OBJECT_FLAGS['marker:npc'].scale` valait `1.6` (`lib/gameState.ts`) alors que
Synk a une échelle de `1`. Les bottes du PNJ (bas non mis à l'échelle ≈ `-0.39`) se retrouvaient à
`-0.39 × 1.6 ≈ -0.62`, sous le plateau du sol (`y = -0.42`) — d'où à la fois l'effet « trop grand »
et « jambes invisibles » (clippées sous le sol), un seul et même bug.

**Correctif (2)** :
- `DEFAULT_PLATFORM3D_OBJECT_FLAGS['marker:npc'].scale` ramené à `1` (échelle des familiers/dragons,
  `marker:familiar` = `2.4`, volontairement inchangée — ils sont censés être plus grands).
- Nouveau helper déterministe `hashString()` (djb2) dans `Platform3DWidget.tsx` : un booléen
  `smiling` est calculé une seule fois par id/nom de PNJ (`hashString(s) % 2 === 0`), stable pour un
  PNJ donné (pas de scintillement au re-rendu) mais varié selon la population. `NpcVoxel()` rend
  soit une bouche « sourire » (barre centrale + coins relevés), soit la bouche neutre plate
  d'origine, selon `smiling`.
- ⚠️ **Risque de migration Firestore non traité** : si un administrateur a déjà enregistré une
  valeur via le panneau « 🧱 Objets & décor 3D » (`RepRulesPanel.tsx`), l'ancienne valeur
  `scale: 1.6` pour `marker:npc` peut persister en base et prévaloir sur le nouveau défaut (le merge
  `mergeRepRules()` fusionne les valeurs sauvegardées par-dessus les défauts). Si ce cas se présente,
  l'administrateur peut simplement réajuster le curseur d'échelle existant dans ce panneau.

## 🔒 Pattes de dragon/familier enterrées dans le sol + longue queue articulée + souffle de feu

**Symptôme signalé** : malgré le correctif précédent (« PNJ 3D taille correcte »), les pattes des
**familiers/dragons** (ex. « Dragon Vert ») restaient invisibles, comme enterrées sous le sol du
widget « Plateforme 3D ». L'utilisateur a également demandé une **longue queue** se balançant
naturellement de gauche à droite, et un **souffle de feu** périodique (paramétrable en
Administration) pour un rendu plus crédible.

**Cause racine (enfoncement)** : le correctif précédent avait résolu le cas des PNJ (`scale`
ramené de `1.6` à `1`), mais les familiers/dragons utilisent volontairement une échelle bien plus
grande (`Platform3DObjectFlags['marker:familiar'].scale`, défaut `2.4`, car « un familier doit
rester nettement plus grand que Synk »). Le bas des pattes de `DragonMarker` (en unités NON mises à
l'échelle) se situe à `y≈-0.27` — à l'échelle `2.4`, cela devient `y≈-0.65`, largement sous le
plateau du socle (`y=-0.42`, sommet à `y=-0.34`), donc invisible. Le petit flottement (« bob »)
vertical partagé par tous les marqueurs « en lévitation » (`bobAmplitude≈0.15`) ne suffisait pas à
compenser cet enfoncement amplifié par l'échelle.

**Correctif (`Platform3DWidget.tsx::MarkerBlock`)** : un **relevage compensatoire** proportionnel à
`(scale - 1)` est désormais ajouté à la position Y du groupe animé (`bobRef`), calculé à partir de
la magnitude du point le plus bas non mis à l'échelle de chaque type de personnage
(`groundAnchorUnscaled` = `0.27` pour un familier, `0.39` pour un PNJ) :

```
groundLift = groundAnchorUnscaled * (scale - 1)
```

- Pour un PNJ à `scale=1` (défaut), `groundLift = 0` → **strictement aucun changement** de rendu
  par rapport au correctif précédent (zéro régression garantie par construction, pas seulement par
  test).
- Pour un familier/dragon à `scale=2.4`, `groundLift ≈ 0.378` — cela ramène le bas des pattes à
  `y≈-0.06` à `-0.18` (bien au-dessus du sommet du socle à `-0.34`), les rendant clairement
  visibles, avec une marge similaire à celle des PNJ (par construction, la formule replace toujours
  le bas des pattes à la même hauteur relative qu'à l'échelle `1×`).
- Si un administrateur augmente un jour l'échelle des PNJ au-delà de `1` via le panneau
  « 🧱 Objets & décor 3D », ce même mécanisme les protège aussi contre un enfoncement futur — un
  effet bénéfique, pas une régression.

**Longue queue articulée (`DragonMarker`)** : l'ancien cône unique (0,42 de long) est remplacé par
une chaîne de **3 segments** (base épaisse → milieu → pointe fine, ~0,8 de long au total), chaque
segment étant un enfant du précédent. Un balancement `rotation.y` (l'axe vertical local, qui déplace
la queue gauche/droite puisque le corps est orienté le long de l'axe X) anime les 3 segments avec un
**déphasage croissant** (`-0.7`, puis `-1.4` rad) pour un effet de vague façon fouet plutôt qu'une
planche rigide — actif en permanence (amplitude réduite à l'arrêt, amplifiée en marche), jamais de
rotation continue façon toupie.

**Souffle de feu périodique (`DragonMarker` + `RepRules`)** : un jet de flammes (2 cônes émissifs
orange/jaune) émis depuis le museau, caché (`visible=false`) hors des courtes fenêtres de souffle.
Nouveaux champs `RepRules.dragonFireBreathEnabled` (défaut `true`) et
`RepRules.dragonFireBreathIntervalSec` (défaut `60`), réglables dans le panneau Administration
(section « 🐉 Souffle de feu des dragons », `RepRulesPanel.tsx`) et traduits dans les 4 langues.
Chaque dragon déphase son cycle via un `seedOffset` déterministe (`hashString` de son id/nom, déjà
utilisé pour l'expression faciale des PNJ) afin que plusieurs dragons visibles simultanément ne
crachent pas tous en même temps. Purement cosmétique — aucun impact stats/mécanique.

**Câblage des props** : `RepRules.dragonFireBreathEnabled/dragonFireBreathIntervalSec` → composant
`Scene` (nouveaux props `fireBreathEnabled`/`fireBreathIntervalSec`) → `MarkerBlock` → `DragonMarker`
(avec `seed={markerId ?? name}`), suivant exactement le même chemin de câblage que
`eyeBlinkEnabled`/`eyeBlinkIntervalSec` déjà en place pour Synk — aucune nouvelle abstraction
introduite.

**Vérifié** : `tsc --noEmit` propre, `npm run build` OK, script Playwright jetable rejoué (connexion
démo, ouverture Plateforme 3D, lecture `data-roaming-familiars` avant/après 4 ticks) : 7 familiers
suivis, 6/7 en mouvement (comportement de pause intermittente inchangé), **0 erreur console** —
confirme l'absence de régression sur le correctif précédent (mouvement des familiers/dragons).

## 🔒 Dragons : correction de l'orientation (« glissement en crabe ») + démarche des pattes + gerbe de feu allongée

**Symptôme signalé** : après les correctifs précédents, les dragons/familiers se déplaçaient bien
sur les 3 widgets, mais dans « Plateforme 3D » leur corps et leurs pattes ne s'orientaient jamais
dans le sens réel du déplacement — ils semblaient « glisser » de côté (démarche en crabe) au lieu
d'avancer face à leur direction. L'utilisateur a aussi demandé une **plus longue gerbe de feu**.

**Cause racine (rotation du corps)** : la convention `FACING_ANGLE` (voir plus haut) suppose qu'un
modèle est construit avec son « avant » vers l'axe local **+Z** au repos — c'est le cas de
`SynkVoxel`/`NpcVoxel` (yeux/visage placés à `z > 0`). Or `DragonMarker` a été construit à l'inverse
: son cou/sa tête sont en position locale **+X** (`[0.22, 0.13, 0]`) et sa queue s'étend vers **-X**.
Appliquer `rotation.y = facingAngle` directement (comme pour les PNJ) provoquait donc un décalage
systématique de 90° — d'où l'impression de glissement latéral au lieu d'une marche orientée.

**Correctif (rotation)** : dans `MarkerBlock`, branche `isFamiliar`, le groupe du dragon utilise
désormais `dragonRotationY = facingAngle - Math.PI / 2` au lieu de `facingAngle` brut. Dérivation :
pour un modèle « avant = +Z », `rotation.y = θ` produit un vecteur avant-monde `(sin θ, 0, cos θ)`.
Pour un modèle « avant = +X », `rotation.y = φ` produit `(cos φ, 0, -sin φ)`. En égalant les deux et
en résolvant, `φ = θ - π/2`. Vérifié numériquement pour les 4 directions cardinales (ex. `right` :
`θ=π/2 → φ=0 →` avant-monde `(1,0,0)` = +X ✓). **Portée du correctif strictement limitée** à la
branche `isFamiliar` — la branche `isNpc` continue d'utiliser `facingAngle` sans changement, donc
l'orientation des PNJ (déjà corrigée lors d'un précédent bug « tête tournée à l'envers ») est
intacte.

**Cause racine (pattes) et correctif** : les 4 pattes de `DragonMarker` balançaient via
`rotation.x` (copié du motif PNJ/Synk), ce qui déplace le pied dans le plan Y-Z — correct
uniquement pour un modèle « avant = +Z ». Comme l'avant du dragon est +X, ce même balancement
déplaçait en réalité le pied selon Z (perpendiculaire au vrai sens de marche), ce qui donnait un pas
« en crabe » même une fois le corps correctement orienté. Les 4 pattes balancent désormais via
`rotation.z` (même schéma de phase en diagonale qu'avant), ce qui déplace bien le pied selon X,
l'axe avant/arrière réel du modèle. Changement strictement localisé à `DragonMarker` (jamais utilisé
par les PNJ) — aucun impact sur leur démarche.

**Gerbe de feu allongée (`DragonMarker`)** : les 2 cônes de flammes (portée ~0,27) sont remplacés
par **4 segments** dégradés (orange → jaune pâle), atteignant ~0,66 de portée depuis le museau, pour
un jet visuellement bien plus long et spectaculaire (« longue gerbe de feu »). Le mécanisme
d'animation existant (`flameRef.current.scale.setScalar(flicker * grow)` dans le `useFrame`) met à
l'échelle le groupe entier — les segments ajoutés grandissent/rétrécissent donc automatiquement avec
le reste, sans logique supplémentaire. Les champs `RepRules.dragonFireBreathEnabled` /
`dragonFireBreathIntervalSec` (Administration, section « 🐉 Souffle de feu des dragons ») restent
inchangés et continuent de piloter la fréquence/activation du souffle.

**Vérifié** : `tsc --noEmit` propre, `npm run build` OK (0 erreur, warnings pré-existants sans
rapport type MetaMask SDK/`ox` tempo). Script Playwright jetable rejoué (connexion démo, ouverture
Plateforme 3D, lecture `data-roaming-familiars` avant/après 4 ticks) : 7 familiers suivis, 5/7 en
mouvement (comportement de pause intermittente inchangé), **0 erreur console** — confirme l'absence
de régression sur le mouvement des familiers/dragons et des PNJ.

## 🔒 « Piétinement » des jambes + cadence trop lente + pauses de 2s + gel de proximité de Synk

**Symptômes signalés** : (1) les jambes des PNJ/dragons/familiers continuaient à s'agiter en
continu alors que le personnage était visuellement immobile pendant plusieurs secondes
(« piétinent ou moulinent sur place puis avance un peu ») ; (2) la vitesse de déplacement globale
était jugée trop lente ; (3) une pause d'environ 2 secondes s'intercalait entre chaque case
franchie, cassant la continuité de la marche ; (4) demande d'une **pause volontaire distincte** de
4 à 8 secondes (pour laisser le joueur approcher/interagir) ; (5) demande que les PNJ/dragons/
familiers **s'arrêtent** quand Synk est adjacent, et **reprennent** leur marche dès qu'il s'éloigne
(sans jamais se rapprocher ou s'orienter vers lui, pour ne pas réintroduire l'ancien bug
« aimanté »/« magnétisé » à Synk déjà corrigé lors d'une session précédente).

**Cause racine** : les 3 widgets (`GameCanvas2D.tsx`, `Platform3DWidget.tsx`, `WorldMapWidget.tsx`)
partagent tous la même source de vérité (`lib/roamingActors.ts`, un `setInterval` unique qui fixait
une NOUVELLE case-cible toutes les `STEP_MS=4000ms`), mais chaque widget lissait visuellement la
position vers cette cible avec une durée bien PLUS COURTE que 4000ms : `transition-all
duration-[1500ms]` (CSS, 2D et Mapmonde) ou une interpolation exponentielle `useFrame` convergeant
en ~1s (3D). Résultat : sur chaque intervalle de 4s, l'acteur atteignait visuellement sa case-cible
en ~1 à 1,5s puis restait **visuellement figé pendant ~2,5 à 3s** avant le prochain tick — alors que
le drapeau `moving`/`walking` (qui pilote le balancement sinusoïdal des jambes dans
`NpcVoxel`/`DragonMarker`) restait `true` pendant TOUTE la durée du « maintien » de plusieurs ticks
(12 à 36s de marche réelle), faisant ainsi animer les jambes en continu pendant que le corps ne
bougeait pas — exactement le bug de « piétinement » remonté. La même incohérence de cadence
expliquait aussi la lenteur perçue (`WORLD_SIZE=100`, delta de ±1 unité par tick à 4000ms = 0,25
unité/s) et le fait que l'ancienne pause volontaire (`PAUSE_PROBABILITY`) réutilisait par erreur la
MÊME plage que la marche normale (jusqu'à 36s), bien plus longue que les 4-8s demandés.

**Correctif (`lib/roamingActors.ts`)** :
- `STEP_MS` fixe devient `stepMs` **mutable et paramétrable** (défaut **1500ms**, choisi car il
  correspond exactement à l'ancienne durée CSS déjà codée en dur `duration-[1500ms]` dans 2D et
  Mapmonde — ces deux widgets deviennent donc immédiatement cohérents sans aucune modification CSS,
  puisque la nouvelle case-cible arrive pile quand l'ancienne transition se termine).
- Les durées de maintien (marche 12-36s, fuite post-rencontre 64-112s) sont désormais exprimées en
  **secondes réelles** (`WALK_HOLD_MIN_SEC`/`MAX_SEC`, `ESCAPE_MIN_HOLD_SEC`/`MAX_SEC`) converties en
  nombre de ticks via un nouvel helper `secToTicks(sec) = round(sec*1000/stepMs)` — garantit que ces
  durées réelles restent **strictement identiques** malgré l'accélération de la cadence (zéro
  régression sur le rythme de jeu déjà calibré).
- Nouvelle plage de **pause volontaire** distincte (`pauseMinSec=4`/`pauseMaxSec=8`, paramétrable),
  utilisée UNIQUEMENT quand `pickDirection()` tire une pause (`dx=dy=0`) — `randomHoldTicks(isPause)`
  distingue désormais explicitement les deux plages.
- Nouveau **gel de proximité** : `reportSynkPositionForFreeze(x, y)` (appelée par les 3 widgets à
  chaque mise à jour de la position de Synk) alimente `synkPos` ; `advanceActor()` court-circuite en
  tête de fonction si `distanceToSynk(pos) <= proximityFreezeTiles` (défaut 2 unités monde, échelle
  0-100, ≈ adjacence cardinale/diagonale) : l'acteur reste **totalement immobile** ce tick, SANS
  consommer son `holdTicks` ni tirer une nouvelle direction — il reprend donc exactement là où il
  s'était arrêté (même direction, même maintien restant) dès que Synk s'éloigne. ⚠️ Ce mécanisme est
  **strictement unidirectionnel** (il ne fait qu'arrêter un acteur déjà proche) — **ne jamais** y
  ajouter d'attraction/orientation vers Synk, sous peine de réintroduire le bug « aimanté » déjà
  corrigé par le passé.
- Nouveaux exports : `getRoamStepMs()` (cadence courante, lue par les 3 widgets pour synchroniser
  leur durée de transition CSS/interpolation 3D), `configureRoaming(cfg)` (applique les valeurs
  `RepRules` ci-dessous ; redémarre l'intervalle `setInterval` si `stepMs` change réellement, car un
  intervalle déjà créé ne peut pas changer de délai de lui-même).

**Correctif (`Platform3DWidget.tsx`)** : le lissage exponentiel `g.position.x += (x -
g.position.x) * 0.12` de `MarkerBlock` est remplacé par une **interpolation linéaire temporelle**
(`fromRef`/`targetRef`/`tickStartRef`, `performance.now()`) qui parcourt exactement `getRoamStepMs()`
millisecondes entre l'ancienne et la nouvelle position — élimine le même temps mort visuel que le
correctif CSS pour 2D/Mapmonde, cette fois côté 3D.

**Correctif (les 3 widgets)** : chacun appelle désormais `configureRoaming({...})` dès que ses
`RepRules` sont chargées et `reportSynkPositionForFreeze(x, y)` à chaque changement de la position
de Synk. Les 5 usages de `duration-[1500ms]` liés aux acteurs errants dans `GameCanvas2D.tsx` (PNJ,
Dragon errant, familiers généralistes, PNJ de rencontre persistés) et le seul usage dans
`WorldMapWidget.tsx` (marqueurs live Mapmonde) sont convertis en `style={{ transitionDuration:
\`${getRoamStepMs()}ms\` }}` dynamique, pour rester synchronisés même si `roamStepMs` est modifié en
Administration. Le marqueur du PNJ **en approche** (`lib/npcApproach.ts`, système séparé avec sa
propre cadence `STEP_MS=1100ms` indépendante) n'est volontairement **pas touché** — hors périmètre
de cette demande, qui concerne uniquement l'errance ambiante.

**Nouveaux réglages Administration** (`RepRules`, section « 🚶 Déplacement des PNJ/Familiers
errants ») : `roamStepMs` (défaut 1500), `roamPauseMinSec`/`roamPauseMaxSec` (défaut 4/8),
`roamProximityFreezeEnabled` (défaut true), `roamProximityFreezeTiles` (défaut 2).

**Vérifié** : `tsc --noEmit` et `npm run build` propres (0 erreur). Script Playwright jetable
(connexion démo anonyme, ouverture Plateforme 3D, échantillonnage de `data-roaming-familiars` toutes
les 250ms pendant 15s) : changements de position détectés toutes les ~1500ms pendant les phases de
marche (gaps mesurés : 1584/1307/1584/1582/1563/1309ms, cohérent avec `stepMs=1500`, aucun trou
anormal), le drapeau `moving` bascule correctement `false`→`true` lors de la reprise après une pause
observée, **0 erreur console**. Confirme l'absence de régression sur l'orientation/la démarche des
PNJ et dragons déjà corrigées lors des sessions précédentes.

## Architecture DLC / Content Packs

`ContentPackDef` (`id`, `nom`, `description`, `actif`, `order`) est stocké dans
`catalog/contentPacks/{id}` et ne contient **aucune donnée de jeu** - c'est un simple interrupteur.
Pour livrer une nouvelle saison narrative : créer le pack en Administration, taguer les nouvelles
quêtes/PNJ/mondes/POI avec son `id` via leur champ `contentPack`, puis activer le pack quand le
contenu est prêt. Tant qu'il est inactif, `isContentPackVisible()` masque tout son contenu aux
joueurs - zéro risque de régression sur le contenu déjà en place.

## Mobile Expo

- Réutilise la même ABI et les mêmes traductions
- Connect via WalletConnect (Expo-compatible)
- Publiable sur Expo Go (mode dev) et builds EAS (prod)

## Sécurité

- `ReentrancyGuard` sur tous les `payable`
- `Pausable` pour urgence
- Owner via `Ownable2Step` (transfert sécurisé)
- Pas de `tx.origin`, pas de `delegatecall`
- Tests unitaires Hardhat (couverture cible ≥ 80%)

## Évolutivité

Le catalogue historique (items, quêtes, mondes) est **stocké on-chain sous forme de mappings
dynamiques** ajoutables par l'admin sans redéploiement, mais **depuis la v2.2 la quasi-totalité du
contenu de jeu (quêtes, PNJ, familiers, équipement, nourriture, potions, engins, DLC, saisons/
météo/lune, filtres carte, widgets personnalisés, scripts de dialogue…) vit dans Firebase RTDB**
(voir `docs/FIREBASE_CHAT.md`), ajoutable/éditable en direct depuis `/admin` sans aucun
redéploiement ni gas. Le smart contract ne reste responsable que des opérations **monétaires**
(mint, nourrissage payant, achats premium). Pour des évolutions majeures du smart contract lui-même
(nouveaux mécaniques on-chain), on prévoit un pattern **UUPS proxy** en Phase 2.

## Évolutivité du contenu narratif (DLC)

Voir § Architecture DLC / Content Packs ci-dessus : chaque nouvelle saison narrative (après la
défaite de Zorghon) est livrée comme un pack de contenu isolé, activable indépendamment, sans
toucher au contenu déjà publié.
