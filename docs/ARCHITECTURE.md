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
- `/game` — dashboard Synk (stats, actions, inventaire, onboarding, 13 fenêtres flottantes - voir
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
| Météo                                      | `WeatherPanel.tsx`             | Horloge temps réel, jour/nuit, phase de lune, thème d'ambiance actif, saison |
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
28. **Thèmes Jour/Nuit & cycle temporel** (`WorldThemesAdminPanel.tsx`) — voir § « Cycle jour/nuit,
    thèmes d'ambiance & widget Météo » ci-dessous.

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

## 🔒 Pop-up « Altitude », « Manque d'oxygène » et « Récupération d'oxygène » masqués derrière un widget

**Symptôme signalé** : ces trois indicateurs ambiants (ainsi que « Profondeur », qui partage le
même composant/toggle que « Altitude ») devaient s'afficher **au-dessus de TOUS les widgets
flottants**, exactement comme le fait déjà le compteur « Fin de l'accès Démo dans : »
(`DemoSessionTimerWidget.tsx`), avec un interrupteur Administration pour activer/désactiver ce
comportement.

**Cause racine (contexte d'empilement CSS piégé)** : chaque widget flottant
(`GameCanvas2D.tsx`, `WorldMapWidget.tsx`, `Platform3DWidget.tsx`, etc.) est un conteneur
`position:fixed` doté d'un `zIndex` explicite compris entre 40 et 89 (voir `lib/windowZOrder.ts`,
`BASE_Z`/`MAX_Z`, système de mise au premier plan `bringToFront`). En CSS, `position:fixed` +
`z-index` établit TOUJOURS un nouveau contexte d'empilement pour ses descendants : un pop-up interne
avec `z-[90]` n'est comparé qu'aux AUTRES enfants du MÊME widget, jamais directement aux widgets
frères — c'est tout le sous-arbre du widget qui est comparé aux autres widgets, au niveau du
`zIndex` du widget lui-même (40-89). Résultat : si un autre widget est amené au premier plan (son
`z` grimpe jusqu'à 89), il peut visuellement recouvrir l'INTÉGRALITÉ du sous-arbre d'un widget moins
récemment focalisé — y compris ses pop-up internes en `z-[90]` — même si 90 > 89 en valeur brute,
car ces valeurs ne sont jamais comparées directement (contextes d'empilement différents). C'est
exactement le même problème qu'avait déjà résolu par le passé `NpcEncounterPopup.tsx` (placé en
`z-[95]`/`z-[96]`, au-dessus de `MAX_Z=89`, mais SANS portail — donc lui aussi théoriquement
vulnérable si un jour nourri dans un widget plus profondément imbriqué).

**Correctif** : nouveau composant partagé `web/src/components/EnvStatusPopupLayer.tsx` — enveloppe
ses enfants dans `createPortal(<>{children}</>, document.body)` quand la prop `onTop` est vraie
(sinon rendu inline inchangé, comportement historique). Ce pattern de portail est celui déjà établi
dans ce projet pour ce type de problème (`ConfirmDialog.tsx`, `FightResultModal.tsx`,
`PoiInteractionModal.tsx`, `WalletPanel.tsx`) : monter le DOM réel sous `document.body` fait
échapper le nœud à TOUS les contextes d'empilement ancêtres, si bien que son `z-[90]` déjà présent
dans le JSX (aucune valeur de z-index modifiée) se compare enfin directement à la racine, battant
naturellement tout widget (max z=89) tout en restant sous les bannières globales `z-[9997]`+
(`DemoSessionTimerWidget.tsx`, `AnnouncementBanner.tsx`, `ActiveElixirsBanner.tsx`), qui ne se
superposent de toute façon jamais spatialement.
- `GameCanvas2D.tsx` : l'ancien bloc unique `oxygenUi` est scindé en `oxygenAmbientUi` (avertissement
  ⏳ + récupération 🌿, éligibles au portail) et `oxygenModalUi` (évanouissement/résultat plein
  écran, `z-[100]`, **volontairement laissés inchangés/locaux** — hors périmètre car non nommés par
  la demande). `depthAltitudeUi` (Altitude/Profondeur) est également porté.
- `WorldMapWidget.tsx` : sa propre copie « miroir » de `depthAltitudeUi` est portée de la même façon.
- Portée strictement limitée aux 3 pop-up nommés — les modales d'évanouissement, la fatigue, les
  fantômes (`zorghonUi`) et `islandBlockedUi` restent inchangés (mêmes bug potentiel, mais non
  demandés, pour un changement chirurgical à faible risque de régression).

**Nouveau réglage Administration** (`RepRules`, section « 🚨 Pop-up d'état environnemental ») :
`envStatusPopupsOnTop` (booléen, défaut **true**) — un seul interrupteur partagé pour les 3 pop-up ;
si désactivé, restitue exactement le rendu local historique (peut être recouvert par un autre
widget mis au premier plan).

**Vérifié** : `tsc --noEmit` et `npm run build` propres (0 erreur). Script Playwright jetable
reproduisant isolément le scénario du bug (un widget « A » bas z-index contenant le pop-up, un
widget « B » plus haut z-index simulant un widget mis au premier plan) : avec `onTop=true`, le
pop-up est bien un enfant direct de `<body>` et reste visuellement AU-DESSUS du widget B ; avec
`onTop=false`, le pop-up reste imbriqué dans le widget A et se retrouve bien MASQUÉ derrière le
widget B (reproduction fidèle du bug historique en mode opt-out, comme attendu) — **0 erreur
console** dans les deux cas. Test de non-régression complémentaire (connexion Démo anonyme,
ouverture des widgets Plateforme 2D isométrique et Mapmonde) : rendu normal, sablier « Fin de
l'accès Démo » toujours visible, **0 erreur console**.

## 🔒 Message d'expiration de session Démo affichant une durée fixe "(2h)" incohérente avec une surcharge personnelle

**Symptôme signalé** : le message affiché sur l'écran d'accueil après expiration d'une session
Démo (« Ta session Démo (2h) est arrivée à son terme... ») indiquait toujours "2h" en dur, même
pour un joueur (`christophe.sintes.oxyzen@gmail.com`) pour lequel l'admin avait défini une
**surcharge personnelle de 36h** (Administration > Statistiques par joueur > "Compte Démo / sans
portefeuille" > `maxDurationMinOverride`) — le message induisait donc le joueur en erreur sur la
durée réellement accordée.

**Cause racine** : la clé i18n `home.demo.sessionExpired` contenait la chaîne "(2h)" codée en dur
dans les 4 langues (fr/en/es/pt), sans aucun paramètre. Le message est affiché à 2 endroits
distincts, tous deux ignorant la surcharge par joueur :
1. `NoWalletAccessPanel.tsx` (tentative de RECONNEXION alors que le chrono est déjà expiré) : les
   fonctions `ensureDemoAccountTimer()`/`ensureDemoAnonTimer()` (`gameState.ts`) calculaient déjà en
   interne la durée EFFECTIVE (surcharge par joueur si présente, sinon la valeur globale
   `RepRules.demoSessionMaxDurationMin`) pour déterminer si `expired` est vrai, mais ne la
   renvoyaient PAS à l'appelant — impossible d'afficher la bonne durée sans la recalculer.
2. `DemoSessionTimerWidget.tsx` (expiration EN COURS DE PARTIE, décompte du sablier arrivé à zéro) :
   calculait bien `maxMin` (avec surcharge) pour piloter le sablier, mais ne le transmettait pas au
   flag `sessionStorage` lu ensuite par `page.tsx` lors du retour forcé à l'accueil.

**Correctif** :
- `gameState.ts` : `ensureDemoAccountTimer()`/`ensureDemoAnonTimer()` renvoient désormais aussi
  `effectiveMaxMin` (la durée EFFECTIVEMENT appliquée, surcharge par joueur incluse pour le mode
  identifié Google). Nouvel helper exporté `formatDemoDurationLabel(minutes)` : `120` → `"2h"`,
  `2160` → `"36h"`, `90` → `"1.5h"`, `45` → `"45 min"` (sous l'heure, plus lisible en minutes).
- `NoWalletAccessPanel.tsx` : les deux appels (`startAnonymousDemo`/`completeApprovedDemo`) passent
  désormais `formatDemoDurationLabel(effectiveMaxMin)` en paramètre `{duration}` du message.
- `DemoSessionTimerWidget.tsx` : le `maxMin` déjà calculé pour le sablier est mémorisé dans un
  nouveau flag `sessionStorage` (`zc.demoSessionExpiredDurationMin`) juste avant la déconnexion
  forcée + redirection vers l'accueil, aux côtés du flag existant `zc.demoSessionExpired`.
  `consumeDemoExpiredFlag()` renvoie désormais `{ expired, durationMin }` (au lieu d'un simple
  booléen) pour transmettre cette durée à `page.tsx`.
- `page.tsx` : affiche `t('home.demo.sessionExpired', { duration: formatDemoDurationLabel(...) })`
  avec la durée reçue (par défaut 120 min si absente, pour rester rétro-compatible avec un flag
  posé par une version antérieure du code sans la nouvelle clé).
- i18n (fr/en/es/pt) : `home.demo.sessionExpired` remplace "(2h)" par `({duration})`.

**Vérifié** : `tsc --noEmit` et `npm run build` propres (0 erreur). Script Playwright jetable
injectant directement les flags `sessionStorage` (`zc.demoSessionExpired`/
`zc.demoSessionExpiredDurationMin`) avant chargement de la page d'accueil : avec `120` → message
affiche bien "(2h)" (comportement historique préservé) ; avec `2160` → message affiche bien "(36h)"
(cas du joueur signalé) — **0 erreur console** dans les deux cas. Test de non-régression
complémentaire (connexion Démo anonyme complète jusqu'en jeu) : sablier "Fin de l'accès Démo dans :"
toujours affiché normalement, **0 erreur console**.

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

## 🔒 Dépôt d'objets au sol par glisser-déposer (Plateforme 2D/3D/Mapmonde) + doublons d'icône

**Demande utilisateur** : permettre à Synk de déposer, par glisser-déposer à la souris (même
mécanisme que pour équiper Synk dans `EquipmentWidget.tsx`), un objet de sa besace à un endroit
précis de la vue 2D isométrique ou de la vue 3D ; conserver les coordonnées monde exactes et
l'objet déposé pour permettre de venir le rechercher plus tard ; matérialiser l'objet déposé dans
la Plateforme 3D par sa forme 3D selon son type, et dans la Plateforme 2D isométrique / la
Mapmonde par une icône + une info-bulle avec son nom ; ajouter un filtre dédié « Objets déposés »
dans les filtres du widget Mapmonde.

**Modèle de données (`lib/gameState.ts`)** : nouvelle interface `WorldDroppedItem` (`itemId`,
`name`, `category`, `slot`, `rarity`, `qty`, `x`/`y` en coordonnées monde absolues — même repère que
`worldPosRef.current`, aucune transformation nécessaire —, `droppedBy`, `droppedAt`, plus les
champs d'équipement pertinents type `damage`/`effect`/`durabilityMax` recopiés depuis l'objet de
besace au moment du dépôt). Persisté dans Firebase RTDB sous `catalog/worldDrops/{id}`, **partagé
entre tous les joueurs** (tout joueur peut voir et ramasser un objet déposé par un autre — cohérent
avec l'esprit « écosystème vivant partagé » du jeu). API : `dropInventoryItemAt(address, item, qty,
x, y)` (retire l'objet de la besace, écrit l'entrée RTDB), `subscribeWorldDrops(cb)` (écoute temps
réel pour les 3 widgets), `getWorldDrop(id)`, `pickupWorldDrop(address, id)` (ajoute l'objet à la
besace du joueur qui ramasse, supprime l'entrée RTDB — premier arrivé, premier servi, la lecture
Firebase gérant nativement la concurrence entre joueurs).

**Glisser-déposer (source)** : dans `InventoryPanel.tsx`/`InventoryWidget.tsx`, l'attribut
`draggable` sur chaque carte d'objet est désormais **toujours actif** (auparavant restreint aux
objets équipables/consommables — `equippableDrag` ne sert plus qu'à choisir l'indice affiché, plus
à activer/désactiver le drag natif) : tout objet de la besace, pas seulement les objets équipables,
doit pouvoir être déposé dans le monde. La charge utile transportée par `dataTransfer` reste le
simple `itemId` (comportement historique inchangé) — `GameCanvas2D.tsx`/`Platform3DWidget.tsx`
résolvent eux-mêmes l'objet complet via l'inventaire courant du joueur, exactement comme le fait
déjà `EquipmentWidget.onDrop`. Comme un seul widget reçoit l'évènement `drop` natif du navigateur
(celui sous le curseur au relâchement), aucun conflit entre les handlers `onDrop` d'`EquipmentWidget`
(équiper), de `GameCanvas2D`/`Platform3DWidget` (déposer au sol) bien qu'ils lisent tous le même
format `dataTransfer`.

**Rendu (cible)** : `GameCanvas2D.tsx` et `WorldMapWidget.tsx` affichent chaque drop comme un
marqueur cliquable (icône du type d'objet + info-bulle `${icône} ${nom}`), `Platform3DWidget.tsx`
matérialise l'objet par sa forme 3D selon la catégorie (`MarkerBlock`, branche objet-au-sol). Les 3
widgets s'abonnent tous à `subscribeWorldDrops()` — un dépôt apparaît donc simultanément et en
temps réel dans les 3 vues, comme les PNJ/familiers/trésors. Nouveau filtre **« 📦 Objets
déposés »** dans les filtres du widget Mapmonde (même mécanisme que les filtres « PNJ »/
« Familiers » déjà existants), permettant de les afficher/masquer indépendamment pour éviter de
surcharger la carte.

**Ramassage (cible)** : clic sur le marqueur → `PoiInteractionModal.tsx` (composant `DropBody`)
affiche le nom/icône de l'objet et un bouton « Ramasser » → `pickupWorldDrop()`. Comme pour tous
les autres types de marqueurs interactifs (PNJ/familier/trésor/quête), `onMarkerClick`
(`GameCanvas2D.tsx`) n'ouvre la popup que si Synk est à ≤1 case du marqueur (distance de Chebyshev)
— sinon le clic fait simplement marcher Synk vers le marqueur (`moveTo`). **Ce comportement est
partagé par tous les types de marqueurs et n'est pas spécifique aux objets déposés.**

**🐛 Bug corrigé — doublon d'icône dans l'info-bulle carte (`worldDropToMarker`, `lib/worldDrops.ts`)** :
le nom traduit d'un objet inclut déjà son icône (ex. `"item.sword_ep": "⚔️ Épée épique"` dans
`i18n/messages/*.json`), mais le code du marqueur préfixait une seconde fois l'icône
(`${worldDropIcon(...)} ${localizeName(...)}`), produisant `"⚔️ ⚔️ Épée épique"`. Correctif : nouvel
helper `stripLeadingEmoji()` retire l'éventuel emoji déjà présent dans le nom traduit avant de
composer le titre du marqueur, garantissant une seule icône.

**🐛 Bug corrigé — même doublon d'icône dans la popup de ramassage (`DropBody`,
`PoiInteractionModal.tsx`)** : exactement la même confusion, réapparue indépendamment dans la popup
de ramassage : `localizeName(t, 'item.${itemId}', drop.name)` (déjà icônée) était combiné avec un
second `worldDropIcon(drop.category)` préfixé séparément. Correctif : remplacement par
`itemLabel(t, drop.itemId, drop.name)` — l'helper déjà utilisé de façon cohérente par la besace et
la boutique, qui retourne directement la chaîne icônée sans préfixe supplémentaire. **Règle à
retenir pour tout nouveau code affichant un nom d'objet : utiliser `itemLabel()` seul, jamais
combiné à une icône préfixée séparément.**

**🐛 Bug corrigé — doublon similaire dans le message de confirmation de ramassage** : le message
`"game.worldDrop.pickedUp"` (`"✅ Objet ramassé !"`) inclut déjà sa coche verte dans la traduction,
mais `DropBody` préfixait une seconde coche (`✅ {t('game.worldDrop.pickedUp')}`), affichant
`"✅ ✅ Objet ramassé !"`. Correctif : suppression du préfixe littéral, la traduction porte seule
l'icône (comme `"game.worldDrop.gone"`, qui elle n'a jamais eu d'icône embarquée et n'est donc pas
concernée).

**Vérifié (Playwright)** : script jetable simulant le flux complet — achat d'une Épée épique,
glisser-déposer sur une case sûre proche de Synk dans la Plateforme 2D isométrique, confirmation du
toast « déposé au sol », vérification RTDB (nouvelle entrée `catalog/worldDrops` créée avec les
coordonnées exactes), clic sur le nouveau marqueur (sélectionné par proximité à Synk plutôt que par
ordre DOM, car le même marqueur s'affiche simultanément dans les 3 widgets), ouverture de la popup
« Ramasser », clic, confirmation finale **« ✅ Objet ramassé ! »** (icône affichée une seule fois) et
disparition du marqueur — **flux dépôt → persistance → rendu → clic → ramassage vérifié de bout en
bout, 0 erreur console**. Points d'attention découverts pendant le test, utiles pour tout futur
script similaire : (1) `page.dragTo(target, { force: true })` ne rejoue pas fidèlement le protocole
HTML5 natif (`dragstart`/`dragover`/`drop` + `dataTransfer`) et échoue silencieusement (aucune
entrée créée, aucune erreur) — utiliser `dragTo()` **sans** `force` pour un vrai glisser-déposer ;
(2) le clic sur un marqueur nécessite que Synk soit déjà à ≤1 case (voir ci-dessus), sinon le
premier clic ne fait que déplacer Synk sans ouvrir la popup.

**Zéro régression confirmée** : `EquipmentWidget.onDrop`/`onMouthDrop` continuent de lire
`dataTransfer` au même format (`itemId` brut, ou `familiar:{id}` pour les familiers via
`FAMILIAR_DRAG_PREFIX`) et de fonctionner indépendamment des nouveaux handlers de dépôt au sol —
aucune modification de leur logique. `tsc --noEmit` et `npm run build` propres.

## 🔒 Classement mondial (`/scoreboard`) : seuls les joueurs avec un Voxlyn on-chain apparaissaient

**Bug signalé** : la page **Classement mondial des joueurs** (`/scoreboard`) n'affichait qu'un
unique joueur (« Pouic ») alors qu'elle doit lister **tous** les joueurs ayant un compte ou jouant
au jeu, quel que soit leur mode d'accès (portefeuille crypto, Démo sans portefeuille, paiement
Fiat/abonnement).

**Cause racine** (`app/scoreboard/page.tsx`) : la page listait bien toutes les adresses connues
(`listPlayers()` → `playerIndex`, alimenté pour **tous** les types de comptes), mais construisait
ensuite les lignes du tableau à partir de `validTokenIds` — la liste des adresses ayant un
**Voxlyn réellement miné on-chain** (`voxlynOf(addr) > 0`) — et ignorait silencieusement toutes
les autres. Or les comptes **Démo**/**Fiat** (sans portefeuille crypto, voir
`docs/DEMO_FIAT.md`/§ « Comptes sans portefeuille crypto » ci-dessus) n'ont **jamais** de Voxlyn
on-chain par construction (toute leur progression est portée par `PlayerState.xpBonus` en
Firebase, voir `synthesizeOffchainVoxlyn` dans `game/page.tsx`), et un portefeuille connecté mais
n'ayant pas encore minté son Voxlyn se trouvait dans le même cas — d'où la disparition de tous ces
joueurs du classement. Le calcul des « Mondes découverts » aggravait le problème : il lisait le
mapping on-chain `worldUnlocked(tokenId, worldId)`, lui aussi indisponible sans tokenId.

**Correctif** : le classement construit désormais **une ligne par adresse de `playerIndex`**, sans
exception :
- Pour les adresses ayant un tokenId on-chain valide (`voxlynOf > 0`) : XP/niveau/stade/nom lus
  depuis `voxlyns(tokenId)` + `playerScore(tokenId)`, comme avant (`onChainIndexByAddr` fait
  correspondre chaque adresse à son index dans les lectures batchées `useReadContracts`).
- Pour toutes les autres (Démo, Fiat, portefeuille pas encore minté) : niveau/stade synthétisés
  hors-chaîne via `computeOffchainStageLevel(xpBonus)` (`lib/gameState.ts`) — **exactement la même
  formule** que celle qui alimente déjà le dashboard de jeu de ces comptes
  (`synthesizeOffchainVoxlyn`), donc aucune incohérence entre le classement et l'expérience de jeu.
- **« Mondes découverts »** : remplacé par une lecture **hors-chaîne uniforme**,
  `getUnlockedWorldIds(address)` (`players/{addr}/worldsUnlocked`, écrit par
  `discoverWorldOffchain` quel que soit le type de compte — voir `PoiInteractionModal.tsx`),
  comptée face au catalogue total (`getWorldDefs().length`). Fonctionne donc identiquement pour un
  joueur avec ou sans Voxlyn miné ; supprime au passage la dépendance à l'ancien hook
  `useIdsList`/au mapping on-chain `worldUnlocked` sur cette page (toujours utilisé ailleurs, ex.
  `PlayerStats.tsx`, aucun changement là-bas).
- Les autres colonnes (score, réputation, quêtes résolues, rencontres, combats gagnés, familiers)
  étaient **déjà** lues hors-chaîne pour tous les comptes (`getPlayerActivityStats`,
  `PlayerState.score`/`reputation`) — aucun changement nécessaire, elles s'affichaient simplement
  jamais faute de ligne créée pour ces joueurs.

**Vérifié (Playwright + inspection RTDB)** : `playerIndex` de production contenait 22 adresses
(2 avec un vrai Voxlyn miné, 20 comptes Démo/Fiat/test sans tokenId). Avant correctif : 1 seule
ligne affichée (« Pouic »). Après correctif : **22 lignes affichées**, triées par XP total
décroissant, avec les 2 joueurs on-chain en tête (XP on-chain + bonus hors-chaîne combinés comme
avant) et les comptes sans Voxlyn correctement synthétisés (niveau/stade cohérents avec leur
`xpBonus`, y compris un `xpBonus` négatif clampé à 0 pour l'XP totale affichée) — **0 erreur
console**, mise en page inchangée avec un plus grand nombre de lignes. `tsc --noEmit` et
`npm run build` propres (mêmes avertissements préexistants MetaMask SDK/`ox` tempo, sans rapport).

**Zéro régression confirmée** : le sous-ensemble de joueurs affiché précédemment (ceux avec un
Voxlyn on-chain) obtient des valeurs strictement identiques à avant (même source on-chain, même
formule XP on-chain + bonus) ; seul un nouvel ensemble de lignes est désormais ajouté pour les
comptes qui n'apparaissaient jamais.

## Cycle jour/nuit, thèmes d'ambiance & widget Météo

**Demande utilisateur** : caler le jeu sur une vraie journée de 24 heures (jour/nuit), avec un
décor nocturne (lune + ses quartiers, ciel étoilé, étoiles filantes, hibou, loup-garou, chauve-
souris) et un décor diurne (soleil, oiseaux/hirondelles, rapaces qui tournoient, troupeau de
sangliers/marcassins traversant toute la Mapmonde, sorcière volante en sifflotant, nuages, pluie
rare) — le tout aléatoire mais réaliste, entièrement paramétrable en Administration via un système
de **thèmes** (Jour/Nuit intégrés + thèmes personnalisés programmables sur une plage horaire, un
jour de semaine ou une période de dates), plus un nouveau widget dédié **« Météo »** affichant
horloge/jour-nuit/phase de lune/thème actif/saison, et un journal des nouveautés dans le widget
« Aides » et l'écran d'accueil.

**Modèle de données** (`lib/gameState.ts`) :
- `RepRules.dayStartHour`/`nightStartHour` (bornes horaires du jour, en mode auto) et
  `weatherWidgetEnabled` (bascule d'affichage du nouveau widget, comme les autres widgets).
- `TimeState` (`catalog/timeState`) : mode `auto`/`day`/`night` forcé par l'administrateur via
  `setTimeState`/`getTimeState` — permet de tester ou d'imposer un thème sans attendre l'heure
  réelle.
- `MoonPhaseKey` + `computeMoonPhaseFromState` : 8 phases lunaires calculées déterministiquement à
  partir de la date (même mécanisme que le badge pleine lune déjà existant), plus
  `computeEasterSunday`/`isLuneRousseWindow` pour le repère folklorique de la « lune rousse »
  (nouvelle lune suivant Pâques).
- `WorldThemeDef`/`WorldThemeElements`/`WorldThemeSchedule` (`catalog/worldThemes/{id}`) : chaque
  thème définit ses éléments d'ambiance (13 booléens + `rainChancePct` +
  `ambientEventIntervalSec`) et sa programmation (`always`/`hourRange`/`weekday`/`dateRange`,
  avec un `forcedTimeOfDay` optionnel). `DEFAULT_WORLD_THEMES` fournit les thèmes **Jour**/**Nuit**
  intégrés (protégés de la suppression via `BUILTIN_THEME_IDS`) ; `resolveActiveTheme` choisit le
  thème actif en résolvant priorité + fenêtre de programmation + heure courante.

**Widget « Météo »** (`WeatherPanel.tsx`, 13ᵉ widget flottant, distinct du badge d'en-tête
`WeatherWidget.tsx` qui gère la météo on-chain difficulté/saison) : horloge en direct, libellé
jour/nuit, phase de lune (+ étiquette « Lune rousse » le cas échéant), nom du thème actif, saison.
Paramétrable via `weatherWidgetEnabled` (menu Administration).

**Hook partagé** `lib/useWorldTheme.ts::useWorldThemeAmbience()` : source unique de vérité
(`isNight`/`theme`/`moonPhase`), abonnée à `RepRules`/`TimeState`/`MoonState`/`WorldThemeDef[]`,
réutilisée par `WeatherPanel.tsx`, `Platform3DWidget.tsx` et `WorldMapWidget.tsx` pour garantir que
les trois widgets affichent toujours exactement le même jour/nuit/thème (zéro incohérence
inter-widgets).

**Rendu visuel** :
- Plateforme 3D : `Platform3DAmbientScene.tsx` (voir § « Objets d'ambiance 3D + module Audio »
  ci-dessous) — **vrais objets Three.js** dans la scène (remplace l'ancien overlay DOM/CSS
  `Platform3DAmbientOverlay.tsx`, supprimé).
- `WorldMapAmbientOverlay.tsx` (dans `WorldMapWidget.tsx`, overlay DOM/CSS `pointer-events-none`
  conservé tel quel — vue 2D top-down, les icônes plates y restent pertinentes) : troupeau de
  sangliers/marcassins traversant l'intégralité de la largeur de la Mapmonde, sorcière volante en
  diagonale, deux rapaces qui tournoient (jour uniquement). Animations en `<style jsx>`
  (styled-jsx, déjà utilisé dans `admin/page.tsx`) — aucune dépendance supplémentaire.

**Panneau Administration** `WorldThemesAdminPanel.tsx` (§ 28, `admin-sec-worldThemes`) : réglage
des heures jour/nuit, bascule manuelle auto/jour/nuit forcée, éditeur de thèmes (actif, ordre,
type de programmation avec champs dédiés, heure forcée, les 13 booléens d'ambiance,
`rainChancePct`, `ambientEventIntervalSec`), suppression protégée pour les thèmes intégrés.

**Journal des nouveautés** (`lib/changelog.ts::CHANGELOG_ENTRIES`) : liste manuelle des dernières
fonctionnalités déployées (cycle jour/nuit, correctif classement, dépôt d'objets par glisser-
déposer, PNJ/dragons plus vivants, fiabilisation session Démo), affichée dans un nouvel onglet
« 🆕 Quoi de neuf ? » du widget **Aides** (`HelpWidget.tsx` — volontairement **indépendant** de
`ONBOARDING_STEPS`/`onboardingContent.ts` pour ne pas l'injecter dans la visite guidée plein écran
`OnboardingWizard.tsx`, non demandée par l'utilisateur) et dans un bloc dépliable sur l'écran
d'accueil (`app/page.tsx`), juste au-dessus du pied de page.

**Vérifié (Playwright)** : widget Météo testé en plein jour (horloge, « Il fait jour », thème
« Jour », saison) et de nuit (`page.clock.install()` pour fixer l'heure du navigateur à 23h sans
accès admin réel, moon icône + phase correcte) ; overlay Plateforme 3D confirmé en jour (soleil) et
nuit (lune + étoiles) par capture d'écran ; overlay Mapmonde confirmé (troupeau de sangliers
visible après ~20s, le temps que l'animation CSS entre dans le champ visible) ; onglet « Quoi de
neuf ? » du widget Aides et bloc « Quoi de neuf ? » de l'écran d'accueil vérifiés affichant les 5
entrées attendues, **0 erreur console**. `WorldThemesAdminPanel.tsx` type-vérifié (`tsc --noEmit`)
mais non testé au clic en conditions réelles (nécessite un portefeuille propriétaire de contrat
réellement connecté, indisponible dans cet environnement de test).

**Zéro régression confirmée** : `tsc --noEmit` et `npm run build` propres ; tous les widgets
existants (stats, sablier de session Démo, badge météo on-chain, saisons, phase de lune du badge
d'en-tête) inchangés et vérifiés visuellement lors des captures d'écran ci-dessus.

## Objets d'ambiance 3D (Plateforme 3D) + module Audio

Suite au retour utilisateur : les éléments d'ambiance jour/nuit ci-dessus (lune, soleil, étoiles,
nuages, pluie, hibou, loup-garou, chauves-souris, rapaces, oiseaux, troupeau de sangliers, sorcière
volante) doivent être de **vrais objets 3D dans la scène Three.js** de la Plateforme 3D (et non des
icônes plates en overlay DOM/CSS, qui n'ont pas de sens dans un espace x/y/z) — plus un **module
audio** pour donner vie à chaque créature (hululement, hurlement, sifflement, cris d'animaux…).

**`Platform3DAmbientScene.tsx`** (nouveau composant R3F, rendu comme enfant de `<Canvas>` dans
`Platform3DWidget.tsx`, sibling de `<Scene>`/`<CameraBridge>`, masqué en mode sous-marin — remplace
et supprime `Platform3DAmbientOverlay.tsx`) :
- `Moon3D` : texture canvas générée par `getMoonTexture()` (algorithme d'ellipse-terminateur,
  8 phases `MoonPhaseKey` + teinte « lune rousse »), billboard toujours face caméra (copie du
  quaternion caméra).
- `Sun3D` : disque billboard équivalent, actif uniquement en thème Jour (`sun`/`moon` mutuellement
  exclusifs selon le thème, jamais besoin de gérer leur coexistence).
- `Starfield3D` (nuage de points `THREE.Points`) + `ShootingStar3D` (streak périodique animée).
- `Clouds3D`/`Cloud3D` (amas de sphères qui dérivent), `Rain3D` (système de particules qui tombent,
  actif selon `rainChancePct`).
- `Owl3D` (perché, hululement + animation tête/ailes périodique), `Werewolf3D` (assis, hurlement
  périodique).
- `Bat3D`/`BatsSwarm3D`, `Raptor3D`/`RaptorsFlock3D`, `Bird3D`/`BirdsFlock3D` : vols circulaires/en
  banking avec battement d'ailes, réutilisent le même schéma d'orbite paramétrée (rayon, hauteur,
  vitesse, décalage de phase par `hashSeed()`).
- `Boar3D`/`BoarHerd3D` : troupeau de sangliers/marcassins quadrupèdes en marche (démarche
  diagonale, même principe que `DragonMarker`), `Witch3D` : vol sur balai avec trajectoire en 8.
- `useAmbientSoundCycle(key, intervalSec, seedOffset, onTrigger, adminAudio)` : hook `useFrame`
  déclenchant une fois par cycle (`Math.floor((elapsedTime + seedOffset) / intervalSec)`) à la fois
  l'animation visuelle (`onTrigger`) et le son (`playAmbientSound`).

**⚠️ Leçon retenue — calibrage empirique au frustum caméra** : la caméra par défaut de la
Plateforme 3D est positionnée en `[0, 3.2, 5.6]`, vise `[0, 0.3, 0]`, `fov: 45` — un pitch
descendant prononcé (~27°) avec un demi-FOV vertical étroit (~22.5°). Des positions « logiques »
naïves (grande hauteur `y=7-8.5` pour « haut dans le ciel », `z` positif pour « proche du joueur »)
tombent **hors du frustum visible** ou sont masquées par la canopée des arbres, même si le
composant est monté et fonctionne sans erreur. Convention de positionnement retenue après
calibrage par captures d'écran successives (sondes de couleur placées puis retirées) :
- **z négatif** (à l'arrière-plan, loin de la caméra, ex. `-3` à `-16`) = généralement visible ;
  **z positif** (entre l'origine et la caméra) = généralement hors-champ/rogné.
- **y bas** (environ `0.7` à `3`) plutôt que haut (`>4`) pour rester dans le cône visible.
- Excursions en `x` modestes (rayon d'orbite ≤ ~2.5) pour ne pas sortir latéralement du champ.
- Le joueur peut orbiter la caméra (`OrbitControls` : `minPolarAngle=0.25`, `maxPolarAngle=1.35`,
  `minDistance=3`, `maxDistance=11`) donc ce calibrage vise une **vue par défaut représentative**,
  pas une garantie de visibilité sous tout angle. À réutiliser pour tout futur ajout d'objet 3D
  décoratif dans ce widget : valider par capture d'écran Playwright plutôt que par intuition.

**Module Audio** (`lib/audio.ts`) : sons synthétisés procéduralement via Web Audio API (aucun
fichier audio externe — évite les risques de droits d'auteur/liens morts), une entrée par créature
(`AudioSourceKey`). `unlockAudioOnFirstGesture()` lève la restriction navigateur d'autoplay au
premier clic/touche. `playAmbientSound(key, adminSettings)` respecte le volume/mute global et
par-source. `useAudioPrefs()` (préférences joueur, `localStorage`) et `useAdminAudioSettings()`
(réglages globaux, `catalog/audioSettings/{key}`, CRUD dans `gameState.ts`).

**Widget « Audio »** (`AudioWidget.tsx`, 14ᵉ widget flottant) : contrôle maître + un contrôle par
créature (volume/mute), paramétrable via `RepRules.audioWidgetEnabled`.

**Panneau Administration** `AudioAdminPanel.tsx` (`admin-sec-audio`) : active/désactive et règle le
volume par défaut de chaque source sonore ; base pour un chargement futur de sons personnalisés par
créature/thème (non requis dans l'itération actuelle, des sons par défaut sont fournis pour
chaque créature).

**Vérifié (Playwright)** : `tsc --noEmit` propre. Scène testée en thème **Jour** (soleil visible,
nuages, troupeau de sangliers en arrière-plan) et en thème **Nuit** (bascule survenue naturellement
pendant les tests, l'heure réelle ayant franchi minuit) : lune (billboard, halo), ciel étoilé,
nuages, un oiseau/chauve-souris en vol capturé en cadrage par défaut, troupeau de sangliers visible
également de nuit. Caméra inclinée manuellement (drag souris) pour confirmer nuages/silhouettes
volantes plus haut dans le ciel. **0 erreur console/page** sur l'ensemble des scénarios. Widget
Audio confirmé monté sans erreur (ouverture testée hors mode plein écran de la Plateforme 3D — en
plein écran, comme les autres widgets flottants, il reste superposé par le calque plein écran,
comportement préexistant du système de widgets, non spécifique à cette fonctionnalité).

**Zéro régression confirmée** : `tsc --noEmit` et `npm run build` propres ; déplacement de Synk
(touches fléchées), marqueurs PNJ/dragon existants (ex. dragon doré) toujours rendus et animés
correctement aux côtés de la nouvelle couche d'ambiance ; `WorldMapAmbientOverlay.tsx` (Mapmonde)
non modifié.

## 🔒 Ciel qui se vide au dézoom/à la rotation + hibou/loup-garou « collés » à Synk

Deux bugs remontés par l'utilisateur sur les objets d'ambiance 3D décrits ci-dessus :

1. **Le ciel se vide au dézoom ou en pivotant la caméra** — `Moon3D`/`Sun3D`/`Starfield3D`/
   `ShootingStar3D`/`Cloud3D`/`Rain3D` utilisaient une `position=[...]` LOCALE fixe, calibrée
   empiriquement pour la seule vue caméra par défaut (voir section précédente). `Moon3D`/`Sun3D`
   ne recopiaient que le `quaternion` caméra (billboard), jamais leur position : dès que la caméra
   pivotait de plus de quelques degrés ou dézoomait, ces objets sortaient du frustum et le ciel
   apparaissait vide.
2. **Le hibou et le loup-garou suivent Synk comme s'ils y étaient collés** — `Scene()` dans
   `Platform3DWidget.tsx` rend tous les marqueurs à une position **relative à Synk**
   (`dx = worldX - centerCol`, `dz = worldY - centerRow` — Synk est toujours à l'origine locale).
   `Owl3D`/`Werewolf3D` étaient montés à une position LOCALE fixe (`[2.4,0,-3.4]`/`[-2.6,0,-4]`),
   donc mathématiquement toujours au même offset de Synk, où qu'il se déplace : impossible de les
   approcher ou de les toucher.

### Correctif 1 — ciel « à parallaxe nulle » + ancrage caméra pour les astres

`Platform3DAmbientScene.tsx` :
- **`SkyFollowGroup`** (nouveau composant) : enveloppe `Starfield3D`/`ShootingStar3D`/`Clouds3D`/
  `Rain3D` — un seul `useFrame` translate (PAS de rotation) le groupe sur `camera.position.x/z`
  chaque frame. Combiné à une **redistribution sur 360° d'azimut** (au lieu de l'ancienne boîte
  orientée uniquement face à la caméra par défaut) pour `Starfield3D` (320 étoiles, rayon 6-16),
  `Clouds3D` (8 nuages répartis sur le cercle, `Cloud3D` a désormais un prop `x0`/`z0` d'ancrage
  d'azimut en plus de sa dérive locale existante) et `Rain3D` (zone circulaire pleine), ceci
  garantit qu'il y a TOUJOURS quelque chose de visible dans le ciel quel que soit l'angle/zoom —
  technique de « skybox à parallaxe quasi nulle » classique en jeu vidéo.
- **`Moon3D`/`Sun3D`** : ancrage sur le **vecteur de vue de la caméra** plutôt qu'une position
  locale fixe — chaque frame, `camera.getWorldDirection(dir)` + un vecteur `right`
  (`dir × camera.up`) + un vecteur `up` (`right × dir`) permettent de positionner le groupe à
  `camera.position + dir·14 + right·(±4) + up·(2.5-3)`. Décision assumée : priorise la demande
  explicite de l'utilisateur (« dans tout le ciel [...] quand je tourne l'angle de vue [...] il
  n'y a plus rien ») sur un rendu astronomiquement réaliste où lune/soleil pourraient sortir du
  champ — ils sont donc désormais des décors de ciel « toujours en vue », pas des objets à
  position monde fixe.
- `ShootingStar3D` choisissait déjà un angle 0-2π en interne : seul l'ajout du `SkyFollowGroup`
  était nécessaire, aucune redistribution de sa logique propre.

### Correctif 2 — hibou/loup-garou convertis en vraie faune errante du monde

Plutôt que des décors à position fixe, le hibou et le loup-garou sont désormais de **véritables
entités errantes de la mapmonde**, gérées par le même moteur que les PNJ/dragons/familiers
(`lib/roamingActors.ts`) et rendues de façon synchronisée dans les 3 widgets (Plateforme 2D
isométrique, Plateforme 3D, Mapmonde) :

- **`lib/roamingActors.ts`** : `WildlifeKind = 'owl' | 'werewolf'`, `WildlifeActorState` (position
  mapmonde, `facing`, `moving`, `kind`), champ `wildlife: Record<string, WildlifeActorState>` sur
  `RoamingActorsState`, avancé chaque tick par `stepActors()` via le même `advanceActor()` que les
  familiers (gel de proximité, direction persistante, pauses aléatoires 4-8 s — comportement
  identique, aucune logique dupliquée). `ensureWildlifeSpawns(enabled, owlCount, werewolfCount,
  seedVersion)` (idempotente) génère les positions : `owl-0`/`werewolf-0` sont **garantis** à
  proximité (rayon 12-25 cases) du point de départ par défaut du joueur pour assurer au moins une
  rencontre par partie ; les instances suivantes sont réparties uniformément sur la mapmonde
  (0-100). `enabled=false` vide `wildlife` (aucune entité générée).
- **`gameState.ts`** : `MapMarkerKind` gagne `'wildlife'` ; `RepRules.wildlifeEnabled` (défaut
  `true`), `wildlifeOwlCount` (13), `wildlifeWerewolfCount` (12), `wildlifeSpawnSeed` (0, incrémenté
  pour forcer une régénération) ; `MapFilterDefaults.showWildlife`.
- **`mapFilters.ts`** : filtre `showWildlife` (icône 🦉, catégorie « Faune ») ; les ids `owl-*`/
  `werewolf-*` sont exemptés du filtre « intelligent » de réduction d'affichage (`declutter`), au
  même titre que le PNJ/Dragon errant.
- **`WorldMapWidget.tsx`/`GameCanvas2D.tsx`** : mêmes patterns déjà établis pour les familiers
  (`familiarsInView`/`generalFamiliarMarkers`) — dupliqués pour la faune (`wildlifeLiveMarkers`/
  `wildlifeInView`), avec anneau clignotant + libellé toujours visible dans le rayon de proximité
  (Mapmonde) et rendu non-interactif dans la grille visible (2D isométrique). Un `useEffect` par
  widget appelle `ensureWildlifeSpawns(...)` avec les valeurs `RepRules` courantes (idempotent,
  dernier appelant gagne — même widgets déjà cohérents pour PNJ/familiers).
- **`Platform3DWidget.tsx`** : `MarkerBlock` gagne une branche `isWildlife` (même traitement que
  `isNpc`/`isFamiliar` : pas de rotation continue « toupie », taille/ancrage au sol identiques à un
  PNJ) qui rend `<Owl3D>`/`<Werewolf3D>` dans le groupe de positionnement/orientation déjà utilisé
  par tout PNJ/familier errant — leur position 3D est donc désormais **exactement** celle de
  l'entité `roamingActors.wildlife` correspondante, relative à Synk comme tout le reste du décor
  (plus aucune position locale fixe). Les entrées `roamingActors.wildlife` sont fusionnées dans le
  `sceneMarkers` memo au même titre que `generalFamiliarMarkers`/`extraMarkers`.
- **`Platform3DAmbientScene.tsx`** : `Owl3D`/`Werewolf3D` exportés (`export function`), leur
  `<group position=[...]>` racine fixe est supprimé (ils héritent désormais entièrement du
  placement fourni par `MarkerBlock`), nouveaux props `soundEnabled` (gate le cycle sonore
  `useAmbientSoundCycle` — remplace l'ancien gate `elements.owlHootEnabled`/`werewolfHowlEnabled`
  au niveau de `Platform3DAmbientScene`, qui ne les rend plus du tout directement) et `seedKey`
  (déphase le hululement/hurlement de chaque instance via `hashSeed(seedKey)` — sans cela, les 13
  hiboux/12 loups-garous hurleraient tous en parfaite synchronie).
- **Panneau Administration** (`RepRulesPanel.tsx`, section « 🦉🐺 Faune sauvage errante ») :
  interrupteur d'activation, nombre de hiboux/loups-garous, bouton « 🎲 Régénérer les positions de
  la faune » (incrémente `wildlifeSpawnSeed`, sauvegarde instantanée comme les autres actions
  admin à effet immédiat).
- **i18n** : `map.filters.wildlife`, `canvas2d.owlLabel`/`werewolfLabel`,
  `admin.repRules.wildlife*` (fr/en/es/pt).

**Vérifié (Playwright)** : `tsc --noEmit` propre. Widget Plateforme 3D — capture par défaut, puis
après dézoom (molette) et après ~180° de rotation caméra cumulée (glisser-déposer) : lune et étoiles
toujours visibles dans les 3 captures (avant le correctif, elles disparaissaient dès rotation).
Widget Mapmonde — 13 « Hibou » et 12 « Loup-garou » comptés simultanément avec les marqueurs PNJ/
Dragon errants existants (aucune régression de comptage) ; positions de plusieurs hiboux comparées
à 6 s d'intervalle : coordonnées pixel différentes à chaque capture, confirmant un déplacement
autonome (et non plus un calage sur la position de Synk, qui n'apparaît même pas sur ce widget).
**0 erreur console/page** sur les 3 widgets (Plateforme 2D, Plateforme 3D, Mapmonde) après ouverture
séquentielle.

**Zéro régression confirmée** : `tsc --noEmit` propre ; PNJ errant, dragon errant et le reste du
décor d'ambiance (soleil/nuages/troupeau de sangliers en thème Jour) toujours rendus et comptés
correctement aux côtés de la nouvelle faune ; `WorldMapAmbientOverlay.tsx` non modifié.

## 🔒 Lune fixe dans le ciel, démarche à 4 pattes du loup-garou, vol du hibou, Audio redimensionnable, PNJ qui s'agglutinent

**Demandes utilisateur** (suite au correctif précédent « ciel qui se vide au dézoom/rotation +
hibou/loup-garou collés à Synk ») :
- La lune est trop basse, s'enfonce dans le sol au changement de caméra, et **bouge/suit la
  rotation de la caméra** alors qu'elle devrait rester à son endroit d'origine (plus haute, derrière
  les nuages).
- Le loup-garou doit animer ses **4 pattes** proportionnellement à son déplacement (démarche
  réaliste), pas seulement translater.
- Le hibou doit battre des ailes en vol, synchronisé avec son déplacement, et **ne plus emporter le
  morceau de bois/perchoir** avec lui quand il vole (celui-ci doit rester en place, le hibou peut
  s'y reposer occasionnellement).
- Le widget **Audio** doit être redimensionnable (sizable) tout en restant lisible une fois réduit.
- Bug : plusieurs PNJ s'agglutinent en une masse bloquée sur Synk sans jamais repartir — un PNJ
  proche de Synk doit s'arrêter pour permettre l'interaction, mais **reprendre sa marche après un
  délai (6 s, paramétrable)** si le joueur n'interagit pas avec lui spécifiquement.

**Lune/Soleil à position FIXE** (`Platform3DAmbientScene.tsx`) : la version précédente ancrait
`Moon3D`/`Sun3D` sur `camera.getWorldDirection()` + vecteurs droite/haut + copie du quaternion de la
caméra, pour rester « toujours visibles quel que soit l'angle » (demande antérieure, qui concernait
en réalité le remplissage général du ciel — étoiles/nuages/pluie, toujours 360° via
`Starfield3D`/`Clouds3D`/`Rain3D`, inchangé). Cette demande-ci **inverse explicitement la priorité**
pour la lune/le soleil : `MOON_ANCHOR`/`SUN_ANCHOR` sont désormais des constantes de position FIXE
(`[-16, 18, -27]`/`[17, 16, -24]`, altitude et distance très supérieures aux nuages `y=2.6-3.4,
rayon 7-9`), rendues à l'intérieur de `<SkyFollowGroup>` (qui ne fait que **translater** avec la
position monde de Synk, jamais tourner). `useFrame` ne touche plus qu'à `groupRef.current.lookAt
(camera.position)` (orientation billboard du disque plat) — jamais à la position. Conséquence
assumée : la lune peut désormais sortir du champ de vision en tournant complètement autour de
Synk (comportement voulu, exactement l'inverse de l'ancien comportement « toujours visible en
suivant la caméra »). Le disque principal de la lune passe `depthWrite={false}` → `depthWrite`
(true) pour être correctement occulté par les nuages (profondeur réelle) ; rayons de géométrie
doublés (halo 1.55→3.4, disque 1.05→2.3 ; soleil 2.4→5.4/0.75→1.7) pour compenser la distance et
conserver une taille apparente similaire.

**Loup-garou à 4 pattes** (`Werewolf3D`) : ajout de 2 pattes arrière (`legRLRef`/`legRRRef`) en plus
des 2 pattes avant existantes. Démarche « trot diagonal » (patron de marche réaliste standard pour
un quadrupède) : deux ondes sinusoïdales en opposition de phase (`swingA`/`swingB`, amplitude nulle
si `!moving` pour conserver exactement la pose statique « assise » d'origine à l'arrêt) — avant-
gauche/arrière-droite en phase A, avant-droit/arrière-gauche en phase B.

**Hibou en vol réaliste** (`Owl3D`) : `bodyRef` enveloppe désormais le corps/tête/ailes (mais pas le
perchoir, qui devient un élément frère). Battement d'ailes dramatique quand `moving` (fréquence 9,
amplitude 0.95) contre un léger ébouriffement quand posé (fréquence 2.4, amplitude 0.05) ; le corps
s'élève (y: 0.7→0.95) et s'incline vers l'avant en vol. Le perchoir en bois n'est rendu que
`{!moving && (...)}` — corrige le bug où le morceau de bois suivait le hibou en vol.

**Widget Audio redimensionnable** (`AudioWidget.tsx`) : même patron de redimensionnement que
`Platform3DWidget.tsx` (poignée `⤡` en bas à droite, persistance `localStorage`, bornes
`MIN 240×200` – `MAX 560×760`). Un mode `compact` (largeur < 280 px) réduit la taille du texte/
padding et masque le texte d'aide secondaire pour rester lisible même très réduit.

**Gel de proximité PNJ non permanent** (`roamingActors.ts`) : ajout de
`proximityFreezeResumeSec` (défaut 6 s, `RepRules.roamProximityFreezeResumeSec`,
`RepRulesPanel.tsx`), `freezeStartedAt: Map<string, number>` (horodatage de début de gel par
acteur) et `interactingActorId` (acteur avec lequel le joueur interagit actuellement, via
`setInteractingActorId`, synchronisé depuis `interactionMarker` dans `GameCanvas2D.tsx`/
`Platform3DWidget.tsx`). `advanceActor(pos, motion, id)` prend désormais un `id` : à l'entrée dans
le rayon de gel, l'horodatage de départ est mémorisé ; l'acteur reste immobile **seulement** si
`interactingActorId === id` OU si le délai de grâce n'est pas écoulé — au-delà, il reprend sa marche
même si Synk reste à proximité (corrige l'agglutination). `freezeStartedAt` est effacé dès que
l'acteur quitte le rayon (délai de grâce entièrement renouvelé à chaque nouvelle approche).

**Vérifié (Playwright)** : flux Accès Démo → Jeu anonyme → `/game`, ouverture Plateforme 3D,
rotation caméra (drag souris) + zoom (molette) — 0 erreur console. Ciel étoilé/nuageux nocturne
confirmé stable sur plusieurs angles de caméra (horloge navigateur forcée à 23h via
`page.addInitScript` pour atteindre le thème Nuit sans compte administrateur). Loup-garou et
dragon observés avec leurs pattes visibles en gros plan. Widget Audio ouvert, redimensionné (largeur
320→~230 px, hauteur 460→~290 px) : contenu reste lisible, défilement fonctionnel, 0 erreur
console.

**Zéro régression confirmée** : `tsc --noEmit` propre ; 4 locales JSON valides ; le PNJ/dragon/
familier/faune errants continuent de fonctionner normalement en dehors du rayon de gel (aucun
changement de leur logique de marche/pause existante) ; `WorldMapWidget.tsx` (sans `interactionMarker`)
ne reçoit que le paramètre `proximityFreezeResumeSec` sans logique d'interaction supplémentaire.

## 🌙 Régression lune/soleil invisibles, passage périodique de la sorcière dans le ciel

**Demande/régression utilisateur** (suite au correctif précédent « lune fixe, ne suit plus la
rotation de caméra ») : après avoir fixé `MOON_ANCHOR`/`SUN_ANCHOR` à une position monde figée
(`[-16, 18, -27]`/`[17, 16, -24]`), la lune/le soleil ne sont plus **du tout visibles**, même en
faisant pivoter la caméra dans tous les sens. Le joueur souhaite les retrouver un peu plus haut que
leur ancienne position basse (au niveau des nuages, pour que les nuages/chauves-souris continuent à
passer devant), et demande si la sorcière volante sur son balai (déjà demandée précédemment) a bien
été ajoutée, ne l'ayant jamais vue passer au loin — si ce n'est pas fait, la faire traverser le ciel
et passer devant la lune toutes les 10 minutes (paramétrable en Administration).

**Cause de la régression** : `MOON_ANCHOR`/`SUN_ANCHOR` avaient été fixés à une distance de ~33-40
unités de la caméra par défaut (`position: [0, 3.2, 5.6]`, `fov: 45`), avec un décalage vertical
(`y=16-18`) largement hors du demi-champ de vision vertical (~22.5°) quel que soit l'angle de
caméra — un mauvais calibrage empirique (voir la leçon retenue sur le frustum caméra ci-dessus),
pas un bug de logique. **Correctif** : `MOON_ANCHOR`/`SUN_ANCHOR` ramenés à `[-6, 6.5, -12]`/
`[7, 6, -11]` (distance ~14-15 unités, cohérente avec la config caméra qui fonctionnait avant
l'introduction de l'ancrage fixe), rayons de géométrie réduits en proportion (halo lune 3.4→1.7,
disque 2.3→1.15 ; lueur soleil 5.4→2.7, cœur 1.7→0.85) pour conserver une taille apparente
cohérente. Toujours rendus dans `<SkyFollowGroup>` (translation-only avec la position de Synk,
jamais de rotation avec la caméra — comportement demandé conservé intact).

**`ShootingStar3D`** : trajectoire revue pour « passer au-dessus, au lointain » (au lieu de tomber
vers le joueur) — rayon de spawn `6→13-19`, hauteur de spawn `3.2-4.5→8.5-11`, descente réduite et
dispersion latérale augmentée (arc plus horizontal), durée `0.85s→1.1s`.

**`Witch3D` — passages périodiques (au lieu d'un survol continu en petit rayon)** : la sorcière
existait déjà mais volait en continu dans une boucle de ~34 s très proche du sol (rayon 12, y≈2.6),
et `NIGHT_ELEMENTS.witchEnabled` valait `false` — d'où l'impression de ne « jamais » la voir passer
au loin. Redesign complet :
- Nouveau champ `WorldThemeElements.witchFlybyIntervalSec` (défaut `600` = 10 min, paramétrable par
  thème dans `WorldThemesAdminPanel.tsx`, icône 🧙‍♀️, `min={30}`), `NIGHT_ELEMENTS.witchEnabled`
  passé à `true` (elle vole désormais aussi bien de jour que de nuit).
- `Witch3D` réutilise `useAmbientSoundCycle('witch', intervalSec, ...)` (même mécanisme que le
  hululement du hibou/hurlement du loup-garou) pour déclencher un survol : la sorcière devient
  visible et balaie le ciel lointain sur `x: -13 → +13` (span 26, traverse aussi bien
  `MOON_ANCHOR.x` que `SUN_ANCHOR.x`) en 14 secondes à `y≈6.4±1.1`/`z≈-11±1.4` (même profondeur que
  la lune/le soleil, pour bien passer devant), puis redevient invisible jusqu'au prochain cycle.
  `Math.max(30, intervalSec)` empêche un réglage admin trop court de provoquer des survols qui se
  chevauchent.
- **Bug de fond découvert et corrigé pendant la vérification Playwright** : au premier test, la
  sorcière restait invisible malgré un déclenchement confirmé correct (elle est censée jouer un
  premier survol quasi immédiatement au montage de la scène, `useAmbientSoundCycle` comptant le tout
  premier `useFrame` comme un changement de cycle). En forçant temporairement le survol en boucle
  continue (diagnostic), elle apparaissait bien à l'écran mais **minuscule et quasi invisible** :
  ses proportions (rayons de géométrie 0.02-0.34) avaient été calibrées pour un survol proche façon
  chauve-souris/rapace (orbite à 2-7 unités de la caméra, voir `Bat3D`/`Raptor3D`), alors qu'elle est
  désormais positionnée à la distance de la lune/du soleil (~14-18 unités) — à cette distance sa
  silhouette ne mesurait que quelques pixels, aggravé par sa robe bleu-nuit (`#1e1b4b`) quasiment
  identique à la couleur du ciel nocturne (camouflage involontaire). **Correctif** : groupe entier
  mis à l'échelle ×4.4, matériaux de la robe/du chapeau passés à une teinte violette plus saturée
  (`#3b0764`/`#44403c`/`#57534e`) avec `emissive`/`emissiveIntensity` (0.25-0.55) pour qu'elle reste
  visible en silhouette même sans lumière directe (comme éclairée par la lune), au lieu de
  sombre-sur-sombre. Balai gardé en couleur bois clair (`#a16207`/`#ca8a04`) pour le contraste.

**Compatibilité ascendante des thèmes en base** : `getWorldThemeDefs()`/`subscribeWorldThemes()`
faisaient un merge **shallow** (`merged[th.id] = th`) des thèmes lus depuis Firebase par-dessus les
défauts — un thème déjà enregistré en base sous l'ancien schéma (sans `witchFlybyIntervalSec`)
aurait donc ce champ `undefined` après merge. Ajout d'une constante `ELEMENTS_FALLBACK =
{ witchFlybyIntervalSec: 600 }` fusionnée en base de `elements` (`{ ...ELEMENTS_FALLBACK,
...th.elements }`) dans les deux fonctions — tout futur champ ajouté à `WorldThemeElements` doit
suivre le même patron pour rester robuste face à des thèmes déjà enregistrés.

**Vérifié (Playwright)** : horloge navigateur forcée à 23h (thème Nuit), ouverture Plateforme 3D en
plein écran, zoom arrière + inclinaison de la caméra vers l'horizon puis balayage azimutal complet
(plusieurs dizaines de captures) — lune retrouvée clairement visible (grande, au-dessus des tours du
château, non enfoncée dans le sol, ne tourne pas avec la caméra) à plusieurs angles de caméra ;
chauve-souris/nuages/étoiles confirmés visibles simultanément dans le même cadrage. Sorcière
confirmée fonctionnelle par un test de diagnostic (survol forcé en boucle continue, retiré avant
commit) : silhouette violette distincte visible traversant le ciel entre les frondaisons, dans le
bon plan de profondeur (même zone que la lune) — le comportement de production (un seul passage de
14 s toutes les `witchFlybyIntervalSec` secondes, ~600 s par défaut) n'a pas pu être capturé sur un
angle de caméra précis en une seule fenêtre de test courte (aléa d'angle, comme pour la lune), mais
le rendu/l'échelle/le déclenchement sont désormais validés corrects.

**Zéro régression confirmée** : `tsc --noEmit` propre ; 4 locales JSON valides (nouvelle clé
`admin.worldThemes.witchInterval` ajoutée à fr/en/es/pt) ; owl/werewolf/chauves-souris/rapaces/
oiseaux/sangliers non modifiés (aucun changement de leur code) ; `SkyFollowGroup` et le comportement
« lune fixe, ne suit pas la rotation de caméra » de la demande précédente restent inchangés.

## 🌙 Régression #2 : lune/soleil encore hors cadre par défaut — recalibrage géométrique complet

**Régression utilisateur** (suite au correctif précédent ci-dessus) : « la lune est encore trop
haute dans le ciel, je ne la vois pas du tout et perçois à peine la base de son cercle en gris »,
constatée dans le widget Plateforme 3D **sans dézoomer** (cadrage par défaut). Le correctif
précédent (`MOON_ANCHOR`/`SUN_ANCHOR` à ~14-15 unités, y=6-6.5) restait donc encore hors du champ de
vision par défaut malgré la correction de la régression n°1 (anciens anchors à ~33-40 unités).

**Cause racine (calcul géométrique précis)** : la caméra par défaut de `Platform3DWidget.tsx`
(`position:[0,3.2,5.6]`, `fov:45°`, `OrbitControls target:[0,0.3,0]`) a un axe de visée penché
**~27° vers le bas** (le point visé est nettement plus bas que la caméra). Le champ de vision
vertical ne couvre que ±22,5° autour de cet axe déjà incliné — en calculant précisément la
projection en repère caméra (vecteurs `right`/`up`/`forward` de la base orthonormée de la caméra),
un point placé à `y=6.5` et `z=-12` (l'ancienne ancre) se retrouvait à **~38-42° du centre de vue**,
très au-delà de la limite de 22,5°, ce qui explique l'invisibilité quasi totale (juste un fragment
visible au bord du cadre par accident d'arrondi). Fait notable découvert par ce calcul : parce que
l'axe de visée est penché vers le bas, un point à la fois **élevé** (grand `y`) et **lointain**
(grand `|z|`) sort presque nécessairement du cône de vue à ce pitch de caméra — même les nuages
(`Clouds3D`, `y=2.6-3.4`) ne sont visibles qu'en rasant tout juste la limite haute du cadre (~22,5°),
jamais plus haut. Un objet céleste ne peut donc être à la fois lointain, élevé ET dans le cadre par
défaut : il faut sacrifier un peu d'altitude apparente pour rester dans le cône visible.

**Correctif** : `MOON_ANCHOR`/`SUN_ANCHOR` recalculés pour rester à ~19-20° de l'axe de visée
(marge de sécurité sous la limite de 22,5°) tout en gardant une profondeur proche de celle des
nuages (registre de distance similaire, `Az≈-8`) :
- `MOON_ANCHOR` : `[-6, 6.5, -12]` → `[-4, 2, -8]` (distance caméra ~9 unités, contre ~14 avant).
- `SUN_ANCHOR` : `[7, 6, -11]` → `[4.5, 1.9, -7.5]` (distance caméra ~8.8 unités).
- Rayons de géométrie réduits en proportion de la distance ~35% plus courte (pour conserver une
  taille apparente cohérente avec les captures de référence) : halo lune `1.7→1.1`, disque lune
  `1.15→0.75` ; lueur soleil `2.7→1.8`, cœur soleil `0.85→0.56`.
- `Witch3D` (survol périodique, voir section précédente) repositionnée sur le même plan
  profondeur/altitude que les nouvelles ancres (`y≈2±1.1`, `z≈-8±1.4` au lieu de `y≈6.4±1.1`,
  `z≈-11±1.4`) pour continuer à passer visuellement devant/près de la lune/du soleil ; son échelle
  réduite en proportion (`×4.4 → ×2.9`) pour conserver une taille apparente cohérente à la distance
  plus courte (sans quoi elle serait ~1,5× trop grande par rapport à son calibrage précédent).

**Vérifié (Playwright)** : horloge navigateur forcée à 23h (nuit) et 14h (jour), connexion en mode
« Jeu anonyme », ouverture du widget Plateforme 3D **maximisé sans zoomer** (cadrage par défaut
identique à la capture utilisateur) — lune ET soleil désormais clairement visibles dès l'ouverture,
sans aucune manipulation de caméra, dans le même cadrage que la capture du bug remonté. Confirmé
également que la lune sort du cadre normalement quand la caméra pivote pour regarder ailleurs
(comportement attendu d'un objet céleste réel à position fixe, pas une régression). Sorcière
revérifiée par la même technique de diagnostic (survol forcé en boucle continue, retiré avant
commit) : silhouette (visage clair + robe violette) retrouvée nettement visible à la nouvelle
distance/échelle, confirmant que le repositionnement/rescaling n'a pas cassé son rendu. 0 erreur
console/page sur l'ensemble des passages de test.

**Zéro régression confirmée** : `tsc --noEmit` propre ; comportement « lune/soleil à position
fixe, ne suivent pas la rotation de caméra » (régression n°1) intégralement conservé — seule la
valeur des ancres/rayons a changé, pas le mécanisme (`SkyFollowGroup`, billboard `lookAt`) ; étoiles
filantes, nuages, pluie, hibou/loup-garou/rapaces/oiseaux/sangliers non touchés.

## 🌲 Régression #3 : la lune passe devant les arbres/la maison/le château au lieu de derrière

**Régression utilisateur** : « la lune doit être en arrière-plan et passer derrière les arbres ou
derrière Synk ou derrière la maison ou le château et non devant », constatée sur plusieurs captures
où le disque lunaire recouvre visiblement des sapins, une maison et les tours du château au premier
plan — alors que ce même code de test de profondeur (jamais désactivé, `depthTest` par défaut à
`true` sur tous les matériaux `Moon3D`/`Sun3D`) fonctionnait déjà correctement pour les objets
proches (un sapin très proche de Synk occultait bien un morceau du halo, cf. captures précédentes).

**Cause racine** : l'ancre de la régression #2 (`Az≈-8`) plaçait la lune à une profondeur MONDE de
seulement `caméra.z + Az ≈ 5,6 - 8 = -2,4` (la caméra par défaut de `Platform3DWidget.tsx` étant à
`z=5,6`, `SkyFollowGroup` ne faisant que translater avec elle). Or le décor (arbres/PNJ/
maison/château, voir `Scene()` dans `Platform3DWidget.tsx`) peut être affiché jusqu'à `VIEW_RADIUS`
(7 tuiles) de profondeur, donc jusqu'à un Z monde de `-7` — largement plus loin que `-2,4`. Le test
de profondeur standard plaçait donc, à juste titre selon les règles du moteur 3D, la lune (plus
proche de la caméra) DEVANT la plupart du décor de fond, contrairement à l'intention voulue (un
astre censé être à une distance quasi infinie, donc toujours le plus profond de la scène).

**Correctif** : `MOON_ANCHOR`/`SUN_ANCHOR` repoussés à `Az=-16`/`Az=-15` (au lieu de `-8`/`-7,5`),
donnant un Z monde ≈ `-10,4`, au-delà de la portée maximale du décor (`-7`) avec une marge
confortable — la lune/le soleil restent ainsi TOUJOURS l'élément le plus profond de la scène, donc
occultés par tout arbre/PNJ/bâtiment placé devant, tout en recalculant `Ay` (via le même calcul
géométrique de frustum que la régression #2) pour rester à ~19° de l'axe de visée de la caméra et
ne pas ressortir du cadre par défaut :
- `MOON_ANCHOR` : `[-4, 2, -8]` → `[-4, 0.85, -16]` (distance caméra ~16,7 unités, contre ~9 avant).
- `SUN_ANCHOR` : `[4.5, 1.9, -7.5]` → `[4.5, 0.99, -15]` (distance caméra ~15,8 unités).
- Arbitrage accepté (imposé par la géométrie de la caméra, axe de visée penché vers le bas — voir
  régression #2) : l'altitude apparente redescend à `y≈0,85-1` (au lieu de `~2`), plus basse mais
  toujours visible dans le cadre par défaut et cohérente avec « en arrière-plan, au-dessus de
  l'horizon plutôt qu'au zénith ».
- Rayons de géométrie augmentés en proportion de la distance ~1,8× plus grande (pour conserver une
  taille apparente cohérente avec les captures de référence) : halo lune `1.1→2.0`, disque lune
  `0.75→1.4` ; lueur soleil `1.8→3.2`, cœur soleil `0.56→1.0`.
- `Witch3D` (survol périodique) repositionnée sur le même plan profondeur/altitude que les
  nouvelles ancres (`y≈0,9±1.1`, `z≈-15,5±1.4` au lieu de `y≈2±1.1`, `z≈-8±1.4`) ; échelle augmentée
  en proportion (`×2.9 → ×5.3`) pour conserver une taille apparente cohérente à la distance plus
  grande.

**Vérifié (Playwright)** : horloge navigateur forcée à 23h (nuit) et 14h (jour), connexion en mode
« Jeu anonyme », widget Plateforme 3D maximisé sans zoomer, balayage caméra (rotation + déplacement
de Synk au clavier sur plusieurs tuiles) capturant une dizaine de cadrages successifs — confirmé à
plusieurs reprises que le disque/halo de la lune est désormais correctement recouvert par les
sapins/canopées placés devant elle à l'écran (contrairement aux captures du bug remonté), y compris
lorsque Synk se rapproche du château (tours/mur d'enceinte visibles sans recouvrement erroné par la
lune). Même comportement confirmé pour le soleil (halo partiellement occulté par un palmier au
premier plan). 0 erreur console/page sur l'ensemble des passages de test.

**Zéro régression confirmée** : `tsc --noEmit` propre ; comportement « lune/soleil à position fixe,
ne suivent pas la rotation de caméra » (régression n°1) et « visible dans le cadrage par défaut sans
zoomer » (régression n°2) intégralement conservés — seule la profondeur (`Az`) et l'altitude (`Ay`)
des ancres ont été recalculées (avec les rayons/l'échelle de la sorcière ajustés en proportion),
sans toucher au mécanisme (`SkyFollowGroup`, billboard `lookAt`, test de profondeur standard) ;
étoiles filantes, nuages, pluie, hibou/loup-garou/rapaces/oiseaux/sangliers non touchés.

## 🏰 Proportions des bâtiments (hutte/château) et regroupement des étendues d'eau/montagnes en amas

**Régression utilisateur** : « les maisons, les châteaux sont trop petits au regard de la taille de
Synk » (capture à l'appui montrant une hutte à peine plus haute que Synk et un château dont la porte
est minuscule) ; « cela s'applique également aux montagnes ou aux mers, océans, étangs, lacs qui
doivent être plus grands et représenter [...] un groupe de 10x10 carrés ou 10x20 carrés, ou 20x20
carrés ou 40x40 carrés pour les plus grands » (au lieu d'une case isolée) — demande explicitement
motivée par une future fonctionnalité (« Synk pourra rentrer dans une maison ou un château »).

**Cause racine (bâtiments)** : dans `PropBlock()` (`Platform3DWidget.tsx`), la géométrie de la hutte
(boîte `[1,1,1]` + toit conique, sommet à `y≈1,6`) et du château (boîte `[1.5,1.8,1.5]` + créneaux +
tourelle + toit conique, sommet à `y≈3,3`) n'était comparée à aucune échelle de référence : rapportée
à la hauteur réelle de Synk (`≈1,07` unité, du dessous des bottes au sommet des cheveux, voir
`SynkVoxel`), la hutte ne culminait qu'à ~1,5-1,6× Synk et le château à ~3,1× Synk — bien trop petit
pour des bâtiments habitables face à un personnage humanoïde.

**Cause racine (eau/montagnes)** : `worldTileAt()` (`web/src/lib/worldTerrain.ts`, fonction
déterministe partagée par les 3 widgets `Platform3DWidget`, `GameCanvas2D`, `WorldMapWidget`)
attribuait le terrain d'eau/rocher « ambiant » (hors zone d'influence d'un POI lac/mer/montagne
explicite) par un simple tirage aléatoire **indépendant par tuile** (`r0 < 0.04` pour l'eau,
`r0 < 0.07` pour le rocher), sans aucune corrélation spatiale entre tuiles voisines — ce qui ne
pouvait produire que des taches isolées de 1 à 2 cases, jamais de grands lacs ou massifs montagneux
contigus.

**Correctif (bâtiments)** — `Platform3DWidget.tsx` :
- Ajout de constantes `HUT_SCALE=[1.3, 1.8, 1.3]` et `CASTLE_SCALE=[1.2, 2.0, 1.2]` : mise à
  l'échelle **anisotrope** (hauteur `y` agrandie bien plus que l'emprise au sol `x`/`z`) appliquée
  via un `<group scale={...}>` interne enveloppant la géométrie existante de la hutte/du château,
  au-dessus du multiplicateur `scale` déjà configurable côté Administration
  (`Platform3DObjectFlags.scale`, qui continue de s'appliquer par-dessus, inchangé).
- Hauteur résultante : hutte `≈2,9` unités (`≈2,7×` Synk, contre `≈1,5×` avant), château `≈6,6`
  unités (`≈6,2×` Synk, contre `≈3,1×` avant) — proportions réalistes d'un logis/d'une forteresse.
- Choix délibéré de l'anisotropie (plutôt qu'une échelle uniforme) : l'emprise au sol ne grandit que
  modestement (hutte `1,3×`, château `1,8×` de large) pour éviter tout chevauchement visuel avec le
  décor des tuiles voisines (arbres/autres bâtiments), les tuiles étant espacées de 1 unité et leur
  décor n'étant pas mutuellement contraint par la taille d'un bâtiment agrandi.
- Ajout d'une porte/poterne (mesh sombre, non fonctionnelle — cosmétique seulement) dimensionnée
  pour rester cohérente avec un futur passage de Synk (`≈1,4` unité de haut pour la hutte, `≈2,2`
  pour le château), en préparation d'une entrée dans les bâtiments (non implémentée dans ce
  correctif).

**Correctif (eau/montagnes)** — `worldTerrain.ts` :
- Nouvelle fonction `ambientClusterAt(wc, wr, salt)` : amas seedés sur une grille grossière de
  `AMBIENT_CLUSTER_CELL=20` tuiles (probabilité de présence de 16 % par cellule grossière, salts
  distincts `500`/`600` pour éviter que les amas d'eau et de rocher coïncident systématiquement),
  centre du blob décalé aléatoirement dans la cellule, rayon aléatoire `5-20` tuiles (diamètre
  `10-40` tuiles, conforme à la demande explicite), plus un bruit de `±1.5` unité sur le test de
  distance pour un contour moins parfaitement circulaire (organique). Recherche étendue à la
  cellule courante + ses 8 voisines pour couvrir les amas à cheval sur une frontière de cellule.
- `worldTileAt()` : le tirage plat d'origine (`r0 < 0.04`/`0.07`) est remplacé par un test sur ces
  amas — **uniquement lorsqu'aucun biais POI n'est actif** (`!bias`), donc sans toucher au
  comportement déjà correct des lacs/mers/montagnes explicitement placés par l'administration
  (qui utilisaient déjà un rayon d'influence, `POI_RADIUS_BY_TYPE`, jusqu'à 48 unités).
- Altitude (rocher) et profondeur (eau) recalculées à partir du recul (`falloff`)/rayon de l'amas
  pour une transition plus naturelle (rocher ambiant : 100-2500 m au pic ; eau ambiante :
  profondeur 0,3-10 m, `waterKind` étiqueté `'pond'` ou `'lake'` selon un seuil de rayon de 12).
- Correctif **partagé automatiquement** par les 3 widgets (2D, 3D, Mapmonde) sans modification
  individuelle, `worldTileAt()` étant leur unique source de vérité pour le terrain.

**Vérifié (Playwright + script statistique)** :
- `tsc --noEmit` propre sur les deux fichiers modifiés.
- Connexion « Jeu anonyme », widget Plateforme 3D maximisé, comparaison visuelle directe château/
  hutte vs Synk à plusieurs distances de zoom : porte du château désormais nettement plus grande que
  Synk, silhouette imposante conforme à la demande (contre une porte quasi invisible avant le
  correctif).
- Script Node (`tsx`) import direct de `worldTileAt()` sur une grille de test `200×200` tuiles :
  détection de composantes connexes (flood-fill) confirmant des amas d'eau/rocher contigus allant
  jusqu'à ~1467 tuiles (eau) et ~4729 tuiles (rocher) dans la fenêtre testée — équivalent à des blocs
  bien au-delà de 40×40, alors que l'ancien tirage plat ne produisait que des taches de 1-2 tuiles.

**Zéro régression confirmée** : `tsc --noEmit` propre ; comportement des tuiles POI-biaisées (lacs/
mers/montagnes explicitement placés par l'Administration) totalement inchangé (`bias` toujours
prioritaire sur l'amas ambiant) ; mécaniques de jeu dépendant de `terrain==='water'`/`'rock'` et de
`depthM`/`altitudeM` (oxygène/nage, dégâts de chute, découverte de POI) non affectées, ces champs
restant peuplés de la même façon, seule leur distribution spatiale et leurs plages de valeurs ont
évolué ; multiplicateur `scale` configurable côté Administration pour `prop:hut`/`prop:castle`
toujours fonctionnel et appliqué en plus de `HUT_SCALE`/`CASTLE_SCALE`.

## 🔭 Zoom élargi et caméra « tête levée » dans la Plateforme 3D

**Régression utilisateur** : « augmente encore le zoom pour voir de près ou voir de loin, notamment
les grands édifices comme les châteaux dont on ne peut plus voir le sommet même en utilisant les
caméras et les vues » et « permets à Synk et au joueur de lever la tête encore plus haut à la
verticale [...] pour voir au-dessus de lui [...] et aussi voir le toit des grands édifices [...] et
le ciel et les étoiles au-dessus de sa tête » — le joueur pouvait déjà regarder le sol à la verticale
(vue plongeante) mais pas l'inverse (vue en contre-plongée/vers le ciel), et le château agrandi par
le correctif précédent (« Proportions des bâtiments ») dépassait désormais le cadre de la caméra une
fois zoomée à fond.

**Cause racine (zoom)** : `<OrbitControls>` (`Scene()` dans `Platform3DWidget.tsx`) était configuré
avec `minDistance={3} maxDistance={11}` — une plage bien trop étroite pour un château de `≈6,6`
unités de haut (voir correctif précédent) vu à `maxDistance=11`, dont les tourelles/le toit
sortaient du champ de vision vertical (FOV 45°) dès que la caméra n'était pas assez reculée.

**Cause racine (tête levée)** : `maxPolarAngle={1.35}` (rad, ≈77,4°) empêchait même d'atteindre
l'horizontale (90°/`π/2`), a fortiori de regarder vers le haut — l'angle polaire d'OrbitControls
étant mesuré depuis l'axe +Y (0 = caméra au zénith au-dessus de la cible, `π/2` = caméra à
l'horizontale de la cible, `π` = caméra sous la cible en train de regarder vers le haut). Une simple
augmentation statique de cette borne se heurte cependant à un second problème géométrique : avec un
pivot de caméra bas (`target.y=0,3`, quasi au ras du sol) et une distance de zoom fixe, tout angle
polaire dépassant nettement 90° fait mécaniquement passer `caméra.y = target.y + distance·cos(angle)`
sous 0 — la caméra plonge alors sous le sol, à l'intérieur des tuiles de terrain solides (`boxGeometry`
`[1,1,1]`), un artefact visuel confirmé lors d'un premier essai naïf (voir ci-dessous).

**Premier essai (rejeté)** : élévation statique de `maxPolarAngle` à 2,55 rad + un correctif *a
posteriori* de la position Y de la caméra (`OrbitCameraGroundGuard`, clampant `caméra.position.y`
après coup et rappelant `caméra.lookAt(cible)`). Testé au clavier/souris via Playwright : le zoom
élargi fonctionnait bien (château entier visible en dézoomant), mais le glissement de souris vers le
haut provoquait, passé un certain angle, un effondrement visuel de la caméra dans le modèle de Synk
ou un tronc d'arbre proche (vue quasi uniforme marron/dégradée) au lieu du ciel attendu — car en ne
corrigeant que la coordonnée Y, la coordonnée horizontale (`distance·sin(angle)`) continuait de
tendre vers 0 à mesure que l'angle approchait 180°, ramenant la caméra tout près du pivot bas (donc
au ras de Synk) plutôt que de préserver une vue reculée et levée.

**Correctif retenu** — `Platform3DWidget.tsx`, `Scene()` :
- Constantes `CAMERA_TARGET=[0, 0.85, 0]` (pivot relevé à hauteur des yeux de Synk, au lieu de
  `[0, 0.3, 0]` proche du sol), `CAMERA_MIN_DISTANCE=1.3` (zoom rapproché, contre `3` avant),
  `CAMERA_MAX_DISTANCE=20` (zoom large, contre `11` avant — un château de `≈6,6` unités de haut
  tient alors intégralement dans le FOV 45° même dézoomé au maximum), `CAMERA_MAX_POLAR_ANGLE=2.4`
  rad (≈137°, plafond absolu), `CAMERA_GROUND_CLAMP_Y=0.05` (garde-fou géométrique : altitude
  minimale jamais franchie par la caméra).
- Remplacement d'`OrbitCameraGroundGuard` par `OrbitCameraLookUpLimiter` : au lieu de corriger la
  position de la caméra après coup, ce composant recalcule à **chaque image** la borne
  `controls.maxPolarAngle` en fonction de la distance caméra-cible **courante** :
  `maxPolarAngle = min(CAMERA_MAX_POLAR_ANGLE, acos((CAMERA_GROUND_CLAMP_Y − cible.y) / distance))`
  (ratio préalablement borné à `[-1, 1]`). Le mécanisme interne d'OrbitControls (qui re-clampe son
  angle polaire (`phi`) par rapport à `minPolarAngle`/`maxPolarAngle` à chaque appel d'`update()`)
  empêche alors nativement et progressivement la caméra de descendre sous le sol, sans jamais avoir
  besoin de la repositionner brutalement après coup — supprimant l'artefact d'effondrement du
  premier essai.
- Compromis assumé (imposé par la géométrie, pas un choix arbitraire) : plus la caméra est zoomée en
  arrière, moins l'angle de tête levée disponible est grand — proche de Synk (distance `1,3`), l'angle
  polaire max atteint `≈128°` (forte contre-plongée, ciel/toits largement visibles) ; loin (distance
  `20`, nécessaire pour voir un château entier), il redescend à `≈92-95°` (à peine au-dessus de
  l'horizontale). Compromis jugé acceptable : le zoom élargi résout déjà « voir le sommet d'un
  château » sans avoir besoin d'un angle extrême à cette distance, la tête levée profitant surtout à
  la vue rapprochée.
- `orbitControlsRef` (`useRef<any>(null)`, typé de façon permissive pour contourner l'incompatibilité
  du type de `ref` exposé par `<OrbitControls>` de `@react-three/drei`, issu de `three-stdlib` et non
  directement importable ici) partagé entre `<OrbitControls ref={orbitControlsRef} .../>` et
  `<OrbitCameraLookUpLimiter controlsRef={orbitControlsRef} target={CAMERA_TARGET} />`.

**Vérifié (Playwright)** : connexion « Jeu anonyme », widget Plateforme 3D maximisé —
1. Vue par défaut inchangée visuellement (distance initiale `≈6,1`, toujours dans la nouvelle plage
   `1,3-20`, aucune rupture de cadrage).
2. Dézoom maximal (25 crans de molette) : château entier visible avec ses trois tourelles et leurs
   toits coniques, plus la sorcière au loin — confirmant la résolution du « sommet du château coupé ».
3. Zoom maximal (40 crans) : plan rapproché sur un objet du décor (tronc d'arbre), comportement
   normal d'un zoom avant très serré, aucune anomalie.
4. Glissement de souris vers le haut à distance rapprochée, répété 6 fois : vue en contre-plongée
   progressive montrant nuages/étoiles au-dessus du décor, **aucun effondrement/artefact** (contre
   l'essai précédent) ; capture dédiée en zone dégagée montrant simultanément le visage de Synk, une
   tourelle du château, des nuages, la lune et des étoiles dans un cadrage cohérent.
5. Glissement de souris vers le bas (8 fois) : vue plongeante au sol toujours pleinement
   fonctionnelle, comportement antérieur non régressé.
6. 0 erreur console/page sur l'ensemble des interactions.

**Zéro régression confirmée** : `tsc --noEmit` propre ; `UnderwaterScene()` (caméra de plongée
distincte, `target=[pos.x,-1,pos.y]`, `minDistance={2} maxDistance={9}`) non touchée ; mécaniques de
déplacement au clavier, interactions avec PNJ/dragons/objets déposés, et les correctifs
lune/soleil/sorcière/hibou/loup-garou des sections précédentes (position fixe hors rotation caméra,
profondeur derrière le décor, visibilité par défaut) intégralement conservés — seuls les bornes de
zoom, la hauteur du pivot de la caméra et le plafond dynamique de l'angle polaire ont été modifiés.

## 🌌 Régression #4 : lune/soleil/étoiles « plantés dans le décor » au lieu de rester à l'arrière-plan

**Régression utilisateur** : suite à l'élargissement du zoom (voir section précédente), « en
dézoomant [...] la lune comme le soleil se retrouve au milieu du décor », « même de près, la lune
comme le soleil est planté dans le décor et les étoiles passent au-dessus du château [...] alors
qu'ils devraient être derrière en arrière-plan peu importe la rotation de la caméra ».

**Cause racine** : `Moon3D`/`Sun3D`/`Starfield3D`/`ShootingStar3D`/`Clouds3D` (`Platform3DAmbientScene.
tsx`) étaient enveloppés dans `SkyFollowGroup`, un groupe qui **translatait avec `camera.position`**
chaque frame (mais ne tournait jamais) — une technique de « skybox à parallaxe quasi nulle » conçue
lors d'une régression antérieure pour que le ciel reste toujours rempli. Problème : le décor (arbres/
PNJ/château, voir `Platform3DWidget.tsx`) est positionné par rapport à **Synk/l'origine** (fixe, le
monde défile autour de lui), alors que les éléments du ciel étaient positionnés par rapport à **la
caméra**, qui se déplace désormais dans une plage bien plus large (`minDistance=1,3`/`maxDistance=20`
depuis le correctif caméra précédent, contre `3-11` avant). Résultat : à chaque zoom/orbite différent
de la position par défaut, l'ancre locale (ex. `MOON_ANCHOR=[-4,0.85,-16]`) retombait à un endroit du
monde absolu différent — parfois plus proche de la caméra que le décor lui-même (donc rendue PAR-DESSUS
lui, exactement comme dans les captures utilisateur), au lieu de rester à une profondeur constante par
rapport au décor.

**Correctif** — `Platform3DAmbientScene.tsx` :
- `SkyFollowGroup` ne translate plus DU TOUT (identité fixe) : Synk étant toujours rendu à l'origine
  locale (le monde défile autour de lui), une position vraiment fixe dans le monde revient à une
  position fixe par rapport à Synk — il suffit de ne plus jamais déplacer ce groupe.
- Nouvelle constante `SKY_SAFE_MIN_DISTANCE=40` : marge géométrique garantissant qu'un élément de
  ciel placé à au moins cette distance de l'origine ne peut JAMAIS être dépassé ni par le décor le
  plus éloigné (`VIEW_RADIUS≈7` tuiles ⇒ ≈9,9 unités en diagonale) ni par la caméra elle-même
  (`CAMERA_MAX_DISTANCE=20`), avec une marge confortable.
- `MOON_ANCHOR`/`SUN_ANCHOR` repoussés de `[-4,0.85,-16]`/`[4.5,0.99,-15]` (≈16,5/15,7 unités,
  relatifs à la caméra) à `[-18,7,-67]`/`[21,8,-63]` (≈69,8/66,9 unités, **absolus**, direction
  conservée depuis la position initiale de la caméra pour ne pas changer le cadrage par défaut).
  Rayons agrandis en proportion (×~4,3) pour conserver une taille apparente cohérente : halo lune
  `2,0→8,6`, disque lune `1,4→6,0` ; lueur soleil `3,2→13,8`, cœur soleil `1,0→4,3`.
- `Starfield3D` : rayon `6-16→42-64`, altitude `1,2-8→14-38` (autour de l'origine, plus de
  translation caméra). `ShootingStar3D` : rayon `13-19→46-62`, altitude `8,5-11→24-32`, amplitude du
  déplacement/traînée ×3 pour rester visuellement significative à cette distance. `Clouds3D` : rayon
  `7-11→44-60`, altitude `2,6-3,4→15-18`, échelle ×4,2 par nuage, largeur de dérive `20→90`.
- `Witch3D` (survol périodique) : balayage/profondeur repoussés dans les mêmes proportions
  (`span 26→112`, profondeur `-15,5→-65`, altitude `0,9→7`) et échelle `×5,3→×22,8`, pour rester
  cohérente avec la nouvelle distance, bien plus grande, de la lune/du soleil qu'elle est censée
  croiser.
- `Rain3D` conservé inchangé (rayon `0-9` autour de l'origine) : la pluie est un effet LOCAL autour
  du joueur (pas un élément céleste distant), son comportement était déjà correct et n'est pas
  concerné par le bug remonté.

**Vérifié (Playwright)** : connexion « Jeu anonyme », widget Plateforme 3D maximisé, thème nuit
(par défaut) ET thème jour (horloge navigateur forcée à 14h) —
1. Vue par défaut, dézoom modéré (6 crans), dézoom maximal (26 crans, reproduisant exactement le
   scénario des captures utilisateur montrant la lune « dans » le château) : lune/soleil restent
   systématiquement dans le ciel noir, au-dessus et en arrière du château/des arbres, jamais
   superposés ni incrustés dans le décor.
2. Rotation/orbite de la caméra (glissements horizontaux répétés, plusieurs azimuts) : lune/soleil
   sortent parfois du cadre lorsque la caméra regarde dans une autre direction (comportement RÉALISTE
   attendu, comme un vrai ciel — ce n'était pas le problème signalé) mais ne réapparaissent JAMAIS
   incrustés dans le décor lorsqu'ils sont visibles.
3. Zoom rapproché : lune toujours correctement à l'arrière-plan, aucune incrustation.
4. 0 erreur console/page sur l'ensemble des interactions, dans les deux thèmes.

**Zéro régression confirmée** : `tsc --noEmit` propre ; correctifs des régressions #1/#2/#3 (position
fixe hors rotation caméra, visibilité par défaut, profondeur derrière le décor de proximité)
intégralement conservés — seule la référence de translation (caméra → fixe/origine) et les distances/
échelles ont changé ; `Rain3D` et la faune terrestre/volante (hibou/loup-garou/rapaces/oiseaux/
sangliers, gérés séparément via `lib/roamingActors.ts`) non affectés ; correctif caméra zoom/tête
levée de la section précédente non modifié.

## ☁️ Réglage fin post-régression #4 : nuages/étoiles paramétrables, ciel bleu de jour, sorcière redimensionnée

**Demande utilisateur** (suite à la validation de la régression #4 ci-dessus) : abaisser légèrement
l'altitude des nuages (sans toucher le toit des châteaux), ajouter un peu plus de nuages (ciel qui
« doit rester dégagé »), rendre l'altitude/le nombre de nuages paramétrables dans le menu
Administration, abaisser légèrement l'altitude des étoiles et en ajouter un peu plus (paramétrable),
donner au thème Jour un ciel bleu horizon légèrement dégradé (au lieu du fond sombre du conteneur,
identique jour/nuit jusqu'ici), et réduire la taille de la sorcière volante (rapprochée de celle de
Synk).

**`WorldThemeElements` (`lib/gameState.ts`)** — 4 nouveaux champs numériques, suivant exactement le
même schéma que `rainChancePct`/`witchFlybyIntervalSec` (valeurs par thème, fusionnées « en creux »
via `ELEMENTS_FALLBACK` pour les thèmes déjà enregistrés en base sans ces champs) :
- `cloudAltitude` (défaut **11**, contre 15-18 auparavant) et `cloudCount` (défaut **11**, contre 8) ;
- `starAltitude` (défaut **9**, contre 14) et `starCount` (défaut **400**, contre 320).

Seule l'**altitude** (Y) de `Clouds3D`/`Starfield3D` a été abaissée — le **rayon horizontal** (X/Z,
44-60 pour les nuages, 42-64 pour les étoiles) reste strictement inchangé. Ce découplage est
intentionnel : la marge de sécurité anti-incrustation de la régression #4 (`SKY_SAFE_MIN_DISTANCE=40`)
est une distance radiale 3D (`√(x²+y²+z²)`), or le décor le plus proche (portée max ≈9,9 unités) et le
plus haut (toit de château ≈6,6 unités, voir « Proportions des bâtiments » plus haut) sont tous deux
largement dépassés dès que le rayon horizontal seul atteint 40+ — abaisser l'altitude sans toucher au
rayon ne peut donc jamais réintroduire le bug d'incrustation de la régression #4.

**Administration** (`WorldThemesAdminPanel.tsx`) : 4 nouveaux champs numériques (☁️ Altitude/Nombre de
nuages, ✨ Altitude/Nombre d'étoiles) ajoutés à côté des réglages existants (pluie, intervalle
d'ambiance, passage de la sorcière), mêmes clés i18n (`admin.worldThemes.cloudAltitude`/`cloudCount`/
`starAltitude`/`starCount`, FR/EN/ES/PT) que le reste du panneau.

**Ciel bleu de jour** (`Platform3DAmbientScene.tsx::SkyBackdrop`, nouveau composant) : jusqu'ici AUCUN
fond n'était posé par la scène 3D — le widget laissait transparaître le fond sombre du conteneur DOM
(`bg-slate-950`, `Platform3DWidget.tsx`), identique de jour comme de nuit, d'où un ciel toujours
sombre même en thème Jour. `SkyBackdrop` pose `scene.background` directement : une texture canvas
(dégradé vertical `#3f83c9` zénith → `#7ec3ed` médian → `#d9f0fb` horizon, cache mémoïsé
`daySkyTextureCache`) côté jour, et `null` côté nuit — restaurant EXACTEMENT le fond sombre déjà
validé du conteneur (zéro régression sur le rendu nocturne). `Platform3DAmbientScene` reçoit
désormais effectivement sa prop `isNight` (déclarée dans le type depuis l'origine mais jamais
consommée) pour piloter ce composant.

**Sorcière (`Witch3D`)** : échelle ramenée de `×22,8` à `×9` (hauteur ≈6 unités au lieu de ≈15, soit
environ la moitié du diamètre visuel de la lune/du soleil plutôt que le double) — silhouette lointaine
plausible plutôt que géante, tout en restant clairement identifiable à sa distance de survol
(~65-70 unités, inchangée : balayage/profondeur non retouchés, seule l'échelle a changé).

**Vérifié (Playwright)** : connexion « Jeu anonyme », widget Plateforme 3D maximisé —
1. Thème Jour (par défaut à l'heure du test) : ciel bleu horizon dégradé visible par défaut, au
   dézoom, et en vue orbitée à 360° (jamais de retour au fond sombre) ; nuage visible nettement
   au-dessus des tours du château sans jamais toucher leur toit, à plusieurs angles de caméra
   (dézoom maximal + orbite complète).
2. Thème Nuit (horloge forcée à 23h via `Date` surchargée) : fond sombre du conteneur inchangé
   (aucune régression), lune toujours correctement positionnée derrière les arbres/le château,
   étoiles visibles plus nombreuses et plus basses sans avoir à lever excessivement la caméra, nuage
   nocturne également bien positionné au-dessus du château.
3. `npx tsc --noEmit` propre.
4. 0 erreur console/page sur l'ensemble des scénarios testés.

**Zéro régression confirmée** : régressions #1-#4 (position fixe hors rotation caméra, visibilité par
défaut, profondeur derrière le décor, marge de sécurité radiale) intégralement conservées — seuls
l'altitude (Y) des nuages/étoiles, leur nombre, l'échelle de la sorcière et le fond de scène en thème
Jour ont changé ; `Moon3D`/`Sun3D`/`ShootingStar3D`/`Rain3D` et la faune terrestre/volante non
affectés ; correctif caméra zoom/tête levée non modifié.

## 🐗 Régression #5 : sanglier/marcassins « collés » à Synk et déplacement en biais (crabe) + sorcière qui vole de travers

**Demande utilisateur** : « le sanglier et les petits marcassins se déplacent mais en biais de côté
et par translation en glissant et bougent avec les mouvements de Synk et du fait, je ne peux jamais
les atteindre car ils glissent dans le décor [...] la sorcière sur son balai vole également en biais
ou sur le côté et pas en avant ce qui n'est pas naturel ».

**Cause racine (sanglier)** : exactement la même classe de bug que le hibou/loup-garou (voir
Correctif 2 ci-dessus), non recorrigée à l'époque pour le troupeau de sangliers. `BoarHerd3D`/
`Boar3D` (`Platform3DAmbientScene.tsx`) avançaient chaque sanglier par translation LOCALE directe
(`groupRef.current.position.set(x, 0, z0)` avec `x` dérivé de `state.clock.elapsedTime`) à un offset
proche de l'origine du repère de la scène — or ce repère est recentré sur Synk à CHAQUE rendu (le
DÉCOR défile autour de lui, qui reste toujours à l'origine locale) : un sanglier ainsi positionné
restait donc TOUJOURS au même endroit relatif à Synk, quel que soit l'endroit du monde où celui-ci se
trouvait réellement — d'où l'effet « collé à Synk, inatteignable ». De plus, `groupRef.current.
rotation.y = speedMul >= 0 ? Math.PI / 2 : -Math.PI / 2` orientait le modèle (bâti « tête vers +X »,
donc en avançant sur l'axe X) PERPENDICULAIREMENT à son déplacement réel — un modèle tourné de 90°
par rapport à sa trajectoire présente son FLANC dans le sens de la marche, produisant le glissement
en crabe observé.

**Correctif (sanglier)** : conversion en VRAIE faune errante mapmonde, à l'identique du hibou/loup-
garou (voir Correctif 2) :
- `lib/roamingActors.ts` : `WildlifeKind` étendu à `'owl' | 'werewolf' | 'boar'` ; `ensureWildlifeSpawns`
  accepte désormais un 5ᵉ paramètre optionnel `boarCount` (rétro-compatible, défaut `0`) et peuple
  `wildlife['boar-N']` avec le même mécanisme `randomWildlifeSpawn`/rencontre garantie pour l'index 0
  que le hibou/loup-garou.
- `lib/gameState.ts` : nouveau champ `RepRules.wildlifeBoarCount` (défaut **8**), à côté de
  `wildlifeOwlCount`/`wildlifeWerewolfCount`.
- `RepRulesPanel.tsx` : 3ᵉ champ numérique (🐗 Nombre de troupeaux de sangliers) ajouté à côté des
  deux existants — même bouton « 🎲 Régénérer les positions » (`wildlifeSpawnSeed`) commun aux trois.
- `Platform3DAmbientScene.tsx` : `Boar3D`/`BoarHerd3D` (position/rotation internes) **retirés** et
  remplacés par un nouveau `Boar3D` **exporté**, composant d'animation pure (comme `Owl3D`/
  `Werewolf3D`) sans AUCUNE position/rotation interne — reconstruit selon la convention « tête vers
  +Z » (`FACING_ANGLE`/`down` = 0, la même que tous les autres PNJ/familiers/faune) au lieu de
  « tête vers +X » : toutes les coordonnées locales ont été permutées (X↔Z) en conservant la symétrie
  gauche/droite du modèle (aucun changement visuel de forme, seulement d'orientation de référence).
  Affiche l'adulte + 2 marcassins miniatures en formation fixe juste derrière lui (cosmétique, ils
  partagent exactement la même position/orientation que l'adulte — conserve l'effet « troupeau » sans
  faire de chaque marcassin une entité d'errance séparée), chacun avec sa propre démarche à 4 pattes
  au trot diagonal, amplitude **proportionnelle à `moving`** (nulle à l'arrêt, comme le loup-garou).
- `Platform3DWidget.tsx::MarkerBlock` : branche `isWildlife` étendue (`id.startsWith('boar-')` →
  `Boar3D`), positionnement/orientation intégralement délégués au groupe parent (`facingAngle` calculé
  depuis la direction de marche RÉELLE, moteur `advanceActor` commun à tous les PNJ/faune).
- `GameCanvas2D.tsx`/`WorldMapWidget.tsx` : icône `🐗`/libellé « Troupeau de sangliers » (i18n
  `canvas2d.boarLabel`, FR/EN/ES/PT) ajoutés aux ternaires existants (owl/werewolf) ; `lib/mapFilters.
  ts::isLiveActorMarkerId` complété avec le préfixe `boar-` (sans ce correctif, le troupeau aurait pu
  être masqué à tort par le « filtre intelligent » de la Mapmonde — même exemption que le hibou/loup-
  garou). Le filtre "Faune" existant (`MapFilterState.showWildlife`) couvre déjà tout `kind:
  'wildlife'` sans distinction de sous-type : aucun changement nécessaire côté filtre lui-même.
- Ancien champ de thème `WorldThemeElements.boarHerdEnabled` : plus lu par `Platform3DAmbientScene`
  (remplacé par `RepRules.wildlifeBoarCount`) mais conservé dans le schéma/panneau Administration pour
  rétro-compatibilité (aucune migration de données nécessaire).

**Cause racine (sorcière) et correctif** : `Witch3D` fixait `rotation.y = Math.PI / 2` en dur, quel que
soit l'instant du survol — alors que son déplacement réel suit `x(p) = -span/2 + span·p` (dérivée
constante, cap ≈ +X) et `z(p) = -65 + sin(2πp)·6` (dérivée oscillante). Remplacé par un cap RÉEL
calculé à chaque frame via `rotation.y = Math.atan2(-dz/dp, dx/dp)` (dérivées analytiques des deux
formules paramétriques) — la fait voler naturellement orientée vers l'avant de sa trajectoire, avec un
léger virage/inclinaison suivant son slalom en Z, au lieu d'une orientation fixe perpendiculaire à son
déplacement.

**Vérifié (Playwright)** : connexion « Jeu anonyme » (compte Démo), widget Plateforme 3D ouvert,
Mapmonde dézoomée au maximum — les 8 troupeaux de sangliers par défaut (`wildlifeBoarCount`)
apparaissent bien comme marqueurs `🐗`/« Troupeau de sangliers » répartis sur l'ENSEMBLE de la
Mapmonde (jamais regroupés près de Synk comme l'ancien décor fixe) ; un loup-garou rencontré à
proximité immédiate de Synk confirme que le moteur de faune errante reste pleinement fonctionnel après
l'ajout du 3ᵉ type ; déplacement prolongé de Synk (marche + nage) dans le widget 3D sans jamais
« traîner » un sanglier ou une sorcière dans son sillage ; 0 erreur console/page sur l'ensemble des
scénarios ; `npx tsc --noEmit` propre.

**Zéro régression confirmée** : hibou/loup-garou (Correctif 2) strictement inchangés dans leur
comportement (seule la branche de sélection de composant dans `MarkerBlock` a été étendue d'un
ternaire à deux branches à un ternaire à trois, sans toucher aux deux branches existantes) ; lune/
soleil/étoiles/nuages/ciel de jour (régressions #1-#4 et réglage fin ci-dessus) non modifiés ; sorcière
: seule la formule de `rotation.y` change, ni son échelle, ni son intervalle de passage
(`witchFlybyIntervalSec`), ni sa trajectoire (x/y/z) ni son sifflement (`useAmbientSoundCycle`) ne sont
affectés.

## 🟦 Régression #6 : dalle noire flottante sous chaque objet/créature au-dessus de l'eau

**Demande utilisateur** : « il y a sous chaque objet qui se déplace (hibou, sangliers, marcassin,
dragons, etc...) ou même statique, une dalle noire qui est visible lorsque l'objet passe au-dessus de
l'eau [...] cela perturbe et alourdit l'expérience utilisateur ».

**Cause racine** : `MarkerBlock` (`Platform3DWidget.tsx`) faisait systématiquement précéder CHAQUE
type de marqueur (PNJ, familier/dragon, faune errante, trésor/objet déposé, quête, portail de monde,
Zorghon, captif·ve, marqueur générique — 9 branches au total) d'un petit socle décoratif fixe :
`<mesh position={[0, -0.42, 0]}><boxGeometry args={[0.5, 0.16, 0.5]} /><meshStandardMaterial
color="#334155" /></mesh>` (couleur `#1c1917` pour Zorghon). Une dalle de terrain classique
(`TerrainBlock`, herbe/roche) occupe l'espace Y de -1 à 0 : ce socle (Y de -0.5 à -0.34) reste donc
ENTIÈREMENT enfoui/invisible sous la surface du sol, sans aucun effet visuel — un vestige de code mort
en pratique sur toute tuile non-aquatique. Une dalle d'eau (`TerrainBlock`, cas `tile.terrain ===
'water'`), en revanche, est volontairement RECULÉE en profondeur pour simuler un niveau d'eau
(`y = -0.62 - depthNorm * 0.3`, soit une surface toujours ≤ -0.5) — alors que le groupe racine du
marqueur reste, lui, positionné à Y=0 comme sur terre ferme (aucune logique de flottaison/enfoncement
pour ces marqueurs, à la différence de Synk qui gère spécifiquement la nage). Le socle, fixe à Y
∈ [-0.5, -0.34], se retrouve donc mécaniquement AU-DESSUS de la surface de l'eau recueillie dès qu'un
marqueur est positionné sur une tuile aquatique — exactement la « dalle noire flottante » remontée par
l'utilisateur.

**Correctif** : suppression pure et simple de ce socle dans les 9 branches de `MarkerBlock`
concernées (PNJ, familier, faune errante, trésor/objet déposé, quête, portail de monde, Zorghon,
captif·ve, marqueur générique) — puisqu'il n'apportait STRICTEMENT aucun rendu visible sur terre (déjà
enfoui) et ne servait à rien d'autre (ni ombre portée — aucun `castShadow`/`receiveShadow` — ni
hit-test dédié, le `onClick` étant porté par le `<group>` parent et non par ce mesh), le retirer ne
change RIEN à l'affichage sur toute tuile non-aquatique et élimine intégralement l'artefact sur l'eau.

**Vérifié (Playwright)** : `npx tsc --noEmit` propre après suppression des 9 occurrences ; connexion
« Jeu anonyme » (compte Démo), widget Plateforme 3D ouvert en plein écran, zoom/dézoom et orbite
caméra sur plusieurs zones du monde (dont un point d'eau visible à proximité du château de spawn) —
0 erreur console/page ; scène (herbe, arbres, château, portails, oiseaux/chauves-souris, PNJ) rendue
à l'identique de l'état pré-correctif, aucune régression visuelle observée sur les tuiles non-
aquatiques.

**Zéro régression confirmée** : aucune des 9 branches de `MarkerBlock` n'a été modifiée au-delà de la
suppression de cette unique ligne de socle ; positionnement/orientation/animation de chaque type de
marqueur (PNJ, familier, faune, trésor, quête, portail, Zorghon, captif·ve) intégralement inchangés ;
le rendu du sol lui-même (`TerrainBlock`, dalles d'eau/herbe/roche) non modifié ; la gestion dédiée de
la nage de Synk (`swimming`, dalle d'eau sous ses pieds) — mécanisme distinct, non touché — continue de
fonctionner comme avant.

## 🧲 Disposition des fenêtres/widgets ancrée et mémorisée par joueur

**Demande utilisateur** : « ancrer et sauvegarder la position des widgets sur l'écran pour conserver
leur position à chaque nouvelle ouverture de session de jeu [...] en fonction de chaque utilisateur
[...] Ancrer ne veut pas dire figer, le joueur doit toujours pouvoir déplacer ses widgets ». Objectif :
éviter de retrouver ses fenêtres dispersées à chaque reprise de partie, sans jamais empêcher de les
redéplacer librement.

**État avant correctif** : la position (`pos`) et l'état réduit/déplié (`collapsed`) de chacune des 17
fenêtres flottantes du jeu (StatsWidget, InventoryWidget, EquipmentWidget, Platform3DWidget,
GameCanvas2D, WorldMapWidget, WeatherPanel, AudioWidget, HelpWidget, DiceRollWidget,
KingdomQuestsWidget, ProgressWidget, QuestsZeldaCraftWidget, ShopWidget, TeamChatWidget,
WalletTopupWidget, ainsi que les widgets personnalisés admin via `CustomWidgetsRenderer.tsx`) étaient
**déjà** persistées en `localStorage` par le hook partagé `useDraggableWidget()`
(`lib/useDraggableWidget.ts`) — mais sous une clé **globale au navigateur**, identique pour tout le
monde (ex. `zc.statsWidgetPos`). Un même navigateur/appareil enchaînant plusieurs comptes (portefeuille
A puis B, ou compte Démo puis portefeuille réel) voyait donc TOUS ces comptes partager exactement la
même disposition — pas de personnalisation par joueur.

**Correctif — clé `localStorage` « scopée » par joueur** : ajout de deux fonctions exportées dans
`useDraggableWidget.ts` :
- `scopedKey(base, address)` → `` `${base}::${address.toLowerCase()}` `` si une adresse est connue,
  sinon `base` inchangé ;
- `readScoped(base, address)` → lit d'abord la clé scopée, et si elle n'existe pas encore, **retombe
  sur l'ancienne clé globale non-scopée** — mécanisme de migration garantissant qu'aucun joueur
  existant ne voit sa disposition actuelle réinitialisée après déploiement (elle est simplement
  « copiée » vers sa propre clé dès la prochaine sauvegarde).

`address` provient de `useEffectiveAccount()` (`lib/effectiveAccount.tsx`), qui fournit une adresse
stable aussi bien pour un portefeuille crypto réel que pour une session Démo/Fiat (adresse virtuelle
déterministe dérivée de l'UID Firebase) — **tous** les comptes, pas seulement les portefeuilles
crypto, bénéficient donc d'une disposition propre.

Tous les points d'écriture du hook (glissement terminé, bascule réduit/déplié, recentrage clic-droit,
re-clampage au redimensionnement) écrivent désormais via `scopedKey(..., addressRef.current)` ; l'effet
de chargement initial dépend de `[address]` et utilise `readScoped()`. Les 3 widgets gérant leur
propre état de taille de fenêtre en dehors du hook partagé (`Platform3DWidget.tsx` — `SIZE_KEY =
'zc.platform3dWidgetSize'`, `GameCanvas2D.tsx` — `'zc.iso2dWidgetSize'`, `WorldMapWidget.tsx` —
`'zc.mapWidgetSize'`) reçoivent le même traitement, `scopedKey`/`readScoped` étant exportées pour
réutilisation.

**Volontairement 100% local (pas de synchronisation entre appareils)** : la disposition des fenêtres
est une préférence d'affichage propre à un écran/navigateur donné (résolution, taille de fenêtre) —
la resynchroniser entre appareils de tailles différentes via Firebase serait contre-productif (une
disposition pensée pour un écran large déborderait sur un petit écran). « À chaque nouvelle ouverture
de session de jeu » est donc interprété comme « sur ce même appareil/navigateur », ce qui correspond
à la lecture la plus naturelle de la demande.

**Vérifié (Playwright)** : `npx tsc --noEmit` propre. Scénario 1 (persistance) : connexion Démo
anonyme, widget Statistiques glissé vers une position distinctive, `localStorage` confirmé contenant
la clé scopée `zc.statsWidgetPos::0x...`, rechargement de page → icône restaurée exactement à la
position sauvegardée. Scénario 2 (isolation par compte, même stockage navigateur) : après avoir
déplacé le widget pour le compte A, simulation d'un changement de compte (adresse `zc.effectiveSession`
remplacée par une seconde adresse factice, sans toucher à la clé scopée du compte A) puis rechargement
→ le widget apparaît à sa position PAR DÉFAUT (aucune contamination depuis le compte A) ; restauration
de l'adresse du compte A puis nouveau rechargement → le widget réapparaît exactement à sa position
personnalisée d'origine. 0 erreur console/page dans les deux scénarios.

**Zéro régression confirmée** : la clé de repli (`readScoped`) préserve à l'identique la disposition
déjà mémorisée par tout joueur existant (aucune réinitialisation surprise au déploiement) ; identité et
tableaux de dépendances des callbacks (`reclampToRenderedSize`, `onPointerUp`, `resetPosition`,
`toggleCollapsed`) inchangés hors l'ajout du scoping (toujours basés sur `addressRef.current`, un ref,
pas une dépendance React) ; comportement de glissement/réduction/recentrage/menu-contextuel des 17
widgets strictement identique, seule la clé `localStorage` sous-jacente change.

## 🌤️ Sorcière volante : passe désormais devant le soleil en journée (comme déjà devant la lune la nuit)

**Demande utilisateur** : « En journée, il faudrait que la sorcière sur son balai passe devant le
soleil et derrière les nuages. La nuit, la sorcière sur son balai passe bien à priori devant la lune
et derrière les nuages, mais vérifie tout de même avec Playwright ! ».

**Cause racine** : l'occlusion des astres/de la sorcière (`Platform3DAmbientScene.tsx`) repose
uniquement sur la profondeur WebGL standard (aucun `depthTest`/`renderOrder` manuel) — l'objet le
plus PROCHE de la caméra masque l'objet le plus LOINTAIN, la distance à l'origine servant de proxy
fiable (la caméra orbite dans un rayon ≤ `CAMERA_MAX_DISTANCE` = 20 autour de l'origine, très petit
face aux 60-90+ unités séparant ces éléments de ciel). Le survol de la sorcière (`Witch3D`) suit une
trajectoire fixe : `x(p) = -56+112·p`, `y(p) = 7+4,7·sin(πp)`, `z(p) = -65+6·sin(2πp)` pour `p∈[0,1]`
sur 14 secondes — sa distance à l'origine varie entre ≈63,4 (croisement avec l'azimut de la lune) et
≈86,1 (aux extrémités du survol, vérifié empiriquement, voir ci-dessous). Avant ce correctif,
`SUN_ANCHOR = [21, 8, -63]` (distance ≈66,9) était plus PROCHE de la caméra que la sorcière à son
croisement avec l'azimut du soleil (≈74,4) : le soleil (plus proche) masquait donc à tort la sorcière
(plus lointaine) — l'inverse du comportement demandé. `MOON_ANCHOR` (distance ≈69,7), lui, était déjà
plus loin que la sorcière à son propre croisement (≈63,4) : le comportement nocturne était donc correct
par pure coïncidence géométrique, non par conception — cette asymétrie entre les deux ancres était la
véritable cause du bug, spécifique au thème jour.

**Correctif** : `SUN_ANCHOR` repoussé ×1,375 dans la même direction (même azimut/élévation apparents),
de `[21, 8, -63]` (distance ≈66,9) à `[29, 11, -87]` (distance ≈92,4) — désormais strictement
supérieure à la distance MAXIMALE de la sorcière sur l'intégralité de son survol (≈86,1, marge
incluse), garantissant qu'elle passe devant le soleil non seulement au point de croisement mais à
TOUT instant du survol. Rayons du disque solaire (`Sun3D`) agrandis dans la même proportion (halo
13,8→19, disque intérieur 4,3→5,9) pour conserver une taille apparente à l'écran inchangée malgré
l'éloignement. `MOON_ANCHOR` et tous les autres éléments de ciel (étoiles, nuages, pluie, chauves-
souris, rapaces, oiseaux) n'ont pas été touchés — le comportement nocturne, déjà correct, reste
strictement inchangé.

**Vérifié (Playwright)** : `npx tsc --noEmit` propre. Une instrumentation temporaire (retirée après
vérification) a enregistré, image par image, la distance réelle (`position.length()`) du groupe
`Witch3D` sur l'intégralité de son survol de 14s, aussi bien en thème jour qu'en thème nuit (date
système simulée via un `Date`/`Date.now()` surchargé par `page.addInitScript`, en laissant volontairement
`requestAnimationFrame`/`performance.now()` réels — contrairement à `page.clock`, qui aurait figé
l'animation temps-réel de la sorcière). Résultat mesuré : distance minimale ≈63,37, maximale ≈86,08,
identique dans les deux thèmes (la trajectoire ne dépend pas du thème) — confirmant empiriquement que
la sorcière reste, sur tout son parcours, plus proche de l'origine que la nouvelle distance du soleil
(≈92,36) et donc toujours rendue devant lui ; au point de croisement avec l'azimut lunaire, sa distance
mesurée (≈63,37) reste inférieure à celle de la lune (≈69,73), confirmant qu'elle continue de passer
devant la lune la nuit, sans régression. 0 erreur console/page dans les deux scénarios (jour/nuit).
Vérification visuelle complémentaire : connexion Démo anonyme, widget Plateforme 3D en plein écran,
caméra orientée précisément vers l'azimut du soleil (calculé analytiquement) — le soleil apparaît
correctement dans le cadre, derrière les nuages passant devant lui comme attendu (comportement déjà
correct, non affecté par ce correctif, car les nuages restent toujours plus proches de l'origine que
la sorcière et le soleil).

**Zéro régression confirmée** : seuls `SUN_ANCHOR` et les rayons du disque de `Sun3D` ont été modifiés
dans `Platform3DAmbientScene.tsx` ; `MOON_ANCHOR`, `Moon3D`, `Witch3D` (trajectoire, animation, cap),
`Clouds3D`, `Starfield3D` et tous les autres éléments d'ambiance (pluie, hibou, loup-garou, chauves-
souris, rapaces, oiseaux, sangliers/marcassins) restent inchangés ; le fond de ciel bleu horizon du
thème jour et le comportement d'occlusion « sorcière derrière les nuages » (jour comme nuit) ne
dépendaient pas de la distance du soleil et ne sont donc pas affectés.

## 🧭 Boussole N/E/S/O + recentrage automatique de Synk et de la caméra vers le Nord (Plateforme 3D)

**Demande utilisateur** : « place dans un coin une boussole translucide Nord, Est, Sud, Ouest qui
permet de savoir dans quelle direction s'oriente/se dirige Synk sachant que par défaut, Synk est
orienté vers le Nord. Ajoute un bouton qui permettra s'il est actionné de faire revenir
l'orientation/direction de Synk par défaut à sa position d'origine vers le Nord et donc également la
vue du joueur. De même si Synk reste sans activité, sans rien faire, sans bouger pendant 6 secondes
(rend le paramétrable dans le menu Administration), réoriente Synk automatiquement vers son
orientation et donc la vue du joueur par défaut, vers le Nord en faisant glisser doucement la caméra
de Synk et son orientation vers le Nord. »

**Repère monde confirmé (rappel)** : le déplacement de Synk (`dispatchMove`/`move`/`moveUnderwater`,
`Platform3DWidget.tsx`) est en repère MONDE FIXE depuis un correctif antérieur documenté plus haut —
Haut = Nord (`facing:'up'`, angle `FACING_ANGLE.up = π`, monde -Z), Bas = Sud (`down`, angle `0`,
monde +Z), Gauche = Ouest (`left`, angle `-π/2`, monde -X), Droite = Est (`right`, angle `π/2`, monde
+X), diagonales aux 45°/135°/225°/315° restants. La caméra par défaut (`position:[0,3.2,5.6]`,
`target:[0,0.85,0]`) regarde donc bien vers le Nord, azimut `0`.

**Conception** :
- **Boussole** : rose des vents HTML/CSS FIXE (le Nord reste toujours en haut, elle ne tourne PAS
  avec l'orbite de la caméra — seule son aiguille pivote), rendue en overlay non-R3F dans le coin
  supérieur droit du widget (précédemment libre). Une nouvelle table `COMPASS_NEEDLE_DEG` (distincte
  de `FACING_ANGLE`, qui reste en radians 3D) associe chaque `SynkDirection` à un angle CSS en degrés
  (Nord=0°, Est=90°, Sud=180°, Ouest=270°, diagonales à 45°/135°/225°/315°), cohérent avec le repère
  monde fixe ci-dessus.
- **Bouton de recentrage** (« 🧭 Nord ») sous la boussole : déclenche `triggerRecenter()`, qui (1)
  appelle **une seule fois** `orbitControlsRef.current.setAzimuthalAngle(0)` — comme
  `enableDamping`/`dampingFactor={0.12}` est déjà actif et que le wrapper `<OrbitControls>` de `drei`
  appelle `controls.update()` à chaque frame, three.js fait alors glisser la caméra en douceur vers
  l'azimut 0 tout SEUL, sans code d'interpolation manuel — et (2) active `recentering=true`, qui
  demande à `SynkVoxel` d'interpoler sa rotation Y vers le Nord (voir ci-dessous) plutôt que de la
  laisser instantanément liée à `facing`. Seul l'azimut (lacet) de la caméra est réinitialisé — son
  angle polaire (inclinaison) et son zoom restent inchangés, l'utilisateur n'ayant demandé qu'une
  réorientation, pas une remise à zéro complète de la vue.
- **`orbitControlsRef` déplacé** du composant `Scene` (interne à `<Canvas>`) vers le composant PARENT
  non-R3F (comme `cameraRef`/`CameraBridge`, déjà utilisé pour le glisser-déposer d'objets) et transmis
  en prop à `Scene`, afin que le bouton et la minuterie d'inactivité (tous deux hors `<Canvas>`)
  puissent appeler `setAzimuthalAngle` dessus.
- **Rotation Y de `SynkVoxel` rendue 100% impérative** : l'ancienne prop JSX déclarative
  `rotation={[0, FACING_ANGLE[facing], 0]}` est retirée (elle aurait écrasé toute interpolation en
  cours à chaque rendu) et remplacée par une mutation directe de `groundRef.current.rotation.y` dans
  le `useFrame` existant, piloté par un nouveau ref `rotYRef` : hors recentrage, le comportement
  historique (rotation INSTANTANÉE = angle de `facing`) est reproduit à l'identique frame par frame ;
  pendant un recentrage, l'angle interpole en douceur vers `FACING_ANGLE.up` par le plus court chemin
  angulaire (delta replié dans `[-π, π]`, vitesse `diff × min(1, delta×5)`), puis appelle
  `onRecenterComplete()` une seule fois la cible atteinte (le composant parent fixe alors
  `facing='up'`, cohérent avec l'angle visuel final — aucun « saut » possible car `π`/`-π` produisent
  la même orientation visuelle). `recentering`/`onRecenterComplete` sont optionnels : `undefined`
  reproduit exactement l'ancien comportement, utilisé tel quel par `UnderwaterScene` (non concernée —
  voir ci-dessous) sans aucun changement.
- **Minuterie d'inactivité** : `lastMoveAtRef` (horodatage du dernier déplacement RÉEL de Synk, mis à
  jour en tête de `move()`) comparé toutes les 500 ms à `platform3dCompassIdleRecenterSec` (nouveau
  champ `RepRules`, défaut 6, voir plus bas) ; `idleRecenteredRef` garantit un seul déclenchement par
  période d'inactivité (désarmé dès que Synk bouge réellement). La minuterie n'est active que sur la
  vue de surface (widget non réduit/désactivé, hors mode sous-marin — voir portée ci-dessous).
- **Interruption propre** : tout déplacement réel de Synk (`move()`) remet immédiatement
  `recentering` à `false` en plus de réarmer la minuterie — `SynkVoxel` reprend alors, dès la frame
  suivante, la rotation instantanée normale liée à la nouvelle `facing`, sans à-coup ni conflit avec
  une interpolation abandonnée en plein vol.
- **Portée volontairement limitée à la vue de surface** : le monde sous-marin (`UnderwaterScene`) a
  sa propre caméra/cible (recentrée sur la position de nage, rayon d'exploration borné) où un cap
  Nord/Sud n'a pas de sens — la boussole, le bouton et la minuterie sont donc masqués/inactifs en mode
  sous-marin (`!underwaterMode`), et `UnderwaterScene`/son `<SynkVoxel>` ne reçoivent pas les nouvelles
  props (comportement strictement inchangé pour cette vue).

**🔒 Non-régression vis-à-vis du verrou caméra existant** : un commentaire historique du fichier
documente qu'après cinq tentatives ratées de rendre le déplacement « relatif à la caméra » (boucle de
rétroaction caméra↔direction), la caméra a été volontairement rendue « 100% libre à orbiter/zoomer à
la souris, sans plus jamais être repositionnée automatiquement par le code ». Ce recentrage
n'enfreint PAS ce verrou : il s'agit d'une action EXPLICITE et PONCTUELLE (un clic utilisateur ou un
seuil d'inactivité paramétré), un unique appel à `setAzimuthalAngle(0)` totalement DÉCOUPLÉ de la
résolution du déplacement (`dispatchMove`/`move`/`moveUnderwater` restent strictement en repère
MONDE FIXE, ni lus ni modifiés par ce nouveau code) — pas une coupure CONTINUE recalculant l'angle de
caméra à partir de la direction de marche (la cause du bug historique). Un commentaire renvoyant à
cette analyse a été ajouté dans `gameState.ts` et `Platform3DWidget.tsx`.

**Nouveau réglage Administration** : `RepRules.platform3dCompassIdleRecenterSec` (défaut `6`),
ajouté dans la section « 🏃 Cadence de déplacement & course » de `RepRulesPanel.tsx` (aux côtés de
`movementRunHoldThresholdMs`, dont il partage la portée « mouvement/inactivité de Synk »), traduit
dans les 4 langues (`admin.repRules.platform3dCompassIdleRecenterSec`).

**Vérifié (Playwright)** : `npx tsc --noEmit` et `npm run build` propres (0 erreur). Script jetable —
connexion Démo anonyme, ouverture du widget Plateforme 3D :
1. Aiguille initiale à 180° (Sud), cohérente avec l'état initial `facing='down'` du composant.
2. Déplacement clavier vers l'Est (flèche droite maintenue) → aiguille à 90° (Est), capture d'écran
   confirmant visuellement la boussole et le pointage correct.
3. Clic sur le bouton « 🧭 Nord » → aiguille instantanément revenue à 0° (Nord).
4. Nouveau déplacement vers l'Est (90°) puis 7,5 secondes d'inactivité (> 6 s par défaut) → aiguille
   automatiquement revenue à 0° (Nord) sans aucune interaction, confirmant le recentrage automatique.
5. Test complémentaire : orbite manuelle de la caméra (glissé-souris ~220 px), capture d'écran
   confirmant un changement d'angle de vue net, puis clic sur « 🧭 Nord » → capture d'écran après
   ~1,4 s montrant la vue **exactement revenue** à l'angle par défaut (même arbres/mare/décor que la
   toute première capture), confirmant le glissement en douceur de `setAzimuthalAngle(0)` porté par
   le damping natif d'OrbitControls.
6. Test d'interruption : nouvelle orbite manuelle, clic sur « 🧭 Nord », puis appui immédiat (150 ms
   plus tard, en plein vol de l'interpolation) sur une touche de déplacement réel → aucune erreur
   console, aucun blocage visuel, Synk reprend une rotation normale liée à sa nouvelle direction.
7. **0 erreur console/page** sur l'intégralité des 7 scénarios ci-dessus.

**Zéro régression confirmée** : seuls `Platform3DWidget.tsx` (nouvelle table `COMPASS_NEEDLE_DEG`,
`SynkVoxel`/`Scene`/composant parent), `gameState.ts` (nouveau champ `RepRules` + valeur par défaut)
et `RepRulesPanel.tsx` (nouveau champ admin) ont été modifiés ; `FACING_ANGLE`, `directionFromDelta`,
`dispatchMove`/`move`/`moveUnderwater` (résolution du déplacement) restent strictement inchangés ;
`UnderwaterScene` et son `<SynkVoxel>` ne reçoivent pas les nouvelles props et conservent leur
comportement exact ; le clignement des yeux, le bob de marche/nage, le balancement bras/jambes et le
saut de `SynkVoxel` (autres animations du même `useFrame`) ne sont pas affectés ; `MarkerBlock`
(PNJ/dragons/familiers errants, qui partage `FACING_ANGLE` mais pas `SynkVoxel`) est totalement
inchangé.

## 🪟 Correctif : empilement (z-index) et position des fenêtres widget flottantes

### Demande

Deux bugs distincts remontés par le joueur sur les fenêtres widget flottantes (Dés, Chat
d'équipe, Équipement de Synk, Statistiques, Plateforme 3D, Mapmonde, etc.) :

1. **Superposition/focus** : cliquer ou déplacer une fenêtre déjà active la faisait parfois
   passer SOUS les autres fenêtres, obligeant à re-cliquer sur chacune des autres puis sur la
   fenêtre voulue pour la refaire apparaître au premier plan.
2. **Position perdue au redimensionnement du navigateur** : rétrécir la fenêtre du navigateur
   (ex. Edge) faisait glisser les widgets en bordure d'écran, et — contrairement à la demande
   précédente de sauvegarde de position par joueur (voir section « Position des fenêtres
   mémorisée par joueur » ci-dessous) — cette position rétrécie était mémorisée, si bien que
   ré-agrandir la fenêtre du navigateur ne restaurait JAMAIS la disposition d'origine.

### Bug 1 — empilement (`windowZOrder.ts`)

**Cause racine identifiée** : l'ancienne implémentation utilisait un compteur global
`sharedTopZ`, incrémenté à chaque `bringToFront()` et **plafonné à `MAX_Z = 89`** (pour ne
jamais dépasser le z-index des pop-up plein écran — rencontre PNJ, repos en hutte, etc., à
z-[90] et au-delà). Une fois le plafond atteint, le compteur revenait juste après `BASE_Z` et
**repartait à zéro** : deux fenêtres distinctes pouvaient alors se voir attribuer le **même**
z-index (ou un widget jamais retouché récemment recevoir malgré tout un z-index supérieur à
celui de la fenêtre réellement active), auquel cas l'ordre d'affichage retombe sur l'ordre du
DOM (le dernier widget monté dans l'arbre React gagne, indépendamment du clic du joueur). Avec
16 widgets natifs (et potentiellement d'autres widgets personnalisés créés par l'admin) et un
plafond de seulement 50 valeurs (40-89), ce rebouclage survenait au bout d'à peine ~50
clics/glissers cumulés sur l'ensemble des widgets d'une partie — largement atteignable en
quelques minutes de jeu normal, ce qui explique la fréquence du bug remonté.

**Correctif** : remplacement du compteur global plafonné par une **pile partagée** (`stack`,
du plus ancien/arrière au plus récent/premier plan) qui ne connaît **aucun plafond
numérique**. Le z-index affiché de chaque fenêtre est recalculé à chaque changement comme
`BASE_Z + rang_dans_la_pile`, où le rang est toujours un entier **compact et unique** parmi les
fenêtres actuellement montées (0, 1, 2, … sans trou ni doublon) :

- `bringToFront()` déplace simplement l'identifiant de la fenêtre en tête de pile.
- Démonter un widget (fermeture définitive, changement de page) le retire de la pile, ce qui
  recompacte automatiquement le rang des autres.
- Un petit système pub/sub (`listeners`, portée module) notifie **toutes** les fenêtres
  montées à chaque changement de la pile, pour qu'elles recalculent leur rang (et donc leur
  z-index affiché) — nécessaire car amener une fenêtre au premier plan, ou en démonter une
  autre, peut décaler le rang de fenêtres qui n'ont elles-mêmes reçu aucune interaction.
- `Math.min(BASE_Z + rang, MAX_Z)` reste un garde-fou de sécurité : le nombre de fenêtres
  flottantes réellement montées en même temps restant très inférieur à 50, ce plafond n'est en
  pratique jamais atteint — mais protège malgré tout contre un cas extrême (des dizaines de
  widgets personnalisés ouverts simultanément) en empêchant définitivement tout dépassement du
  z-index des pop-up plein écran.

`handleWidgetPointerDownCapture()` (le garde-fou empêchant le bouton "✕" de déclencher
`bringToFront()`) est inchangé — il fonctionne à l'identique avec la nouvelle implémentation de
`bringToFront`.

### Bug 2 — position au redimensionnement (`useDraggableWidget.ts`)

**Cause racine identifiée** : la position affichée (`pos`, état React utilisé pour
`style={{ left, top }}`) et la position **mémorisée** en `localStorage` étaient **la même
valeur** — l'ancien `reclampToRenderedSize()` (appelé aussi bien après une bascule
réduit/déplié qu'à chaque évènement `resize` de la fenêtre du navigateur) recalculait un clamp
« dans les limites du viewport ACTUEL » puis **persistait immédiatement** ce résultat clampé
dans `localStorage`. Rétrécir la fenêtre du navigateur déclenchait donc un clamp (légitime,
pour garder le widget atteignable), mais celui-ci écrasait définitivement la position d'origine
— ré-agrandir la fenêtre ensuite ne pouvait plus jamais la restaurer, puisqu'elle n'existait
tout simplement plus nulle part.

**Correctif** : découplage strict de deux notions désormais distinctes :

- **`canonicalPosRef`** (un `ref`, pas un state) — la position **canonique**, "vraie" position
  voulue par le joueur. Ne change QUE sur une action explicite du joueur : glisser une fenêtre
  (mis à jour en direct pendant `onPointerMove`, confirmé à `onPointerUp`) ou "🎯 Recentrer" du
  menu contextuel (clic droit). C'est cette seule valeur qui est lue/écrite en `localStorage`.
- **`pos`** (état React, utilisé pour le rendu) — recalculé à chaque évènement pertinent
  (montage, bascule réduit/déplié, redimensionnement de la fenêtre du navigateur) comme
  `clampToViewport(canonicalPosRef.current, tailleRéellementAffichée)` — un simple ajustement
  **visuel et temporaire** pour rester atteignable si le viewport actuel est trop petit, qui ne
  touche **jamais** `canonicalPosRef` ni `localStorage`.

Concrètement : rétrécir la fenêtre du navigateur continue de clamper visuellement le widget
pour qu'il reste atteignable (aucune régression sur ce point), mais sans jamais perdre la
position d'origine — ré-agrandir la fenêtre (immédiatement, ou même après avoir totalement
fermé/rouvert le jeu entre-temps, la valeur canonique étant en `localStorage`) fait toujours
réapparaître le widget exactement là où le joueur l'avait laissé.

## 🔒 Évitement intelligent des obstacles par les PNJ/familiers/faune errants (eau, montagnes, props solides)

**Demande utilisateur** : « les familiers, PNJ, sangliers, marcassins, loup-garou et tout autre
faunes ne doit pas pouvoir marcher sur les dalles d'eau ou les dalles de montagnes mais les
contourner [...] ne doivent pas traverser les arbres, blocs de montagnes, maisons, huttes,
baobab, chateau ou tout autres éléments du jeu qui en face d'eux est un obstacle [...] ils
doivent en faire le tour et contourner [...] dans le monde 3D, 2D ou sur la mapmonde ».

**Constat avant correctif** : `lib/roamingActors.ts::advanceActor()` — le moteur de déplacement
PARTAGÉ par les 3 widgets (Plateforme 2D isométrique, Plateforme 3D, Mapmonde) pour TOUT acteur
errant vivant (PNJ, dragon errant, familiers du catalogue, faune procédurale hibou/loup-garou/
sanglier/marcassin) — choisissait une direction purement AU HASARD parmi 8 (voir `DIRECTIONS`)
sans la moindre conscience du terrain ni des props du décor : seule la bordure de la mapmonde
(`ROAM_MARGIN`/`WORLD_SIZE`) limitait le déplacement. Rien n'empêchait donc un loup-garou de
marcher en pleine eau, de grimper une paroi rocheuse comme si de rien n'était, ou de traverser
un arbre/une hutte/un château de part en part.

**Correctif — un SEUL point d'implémentation pour les 3 vues** : comme `roamingActors.ts` est
l'unique source de vérité de la position de tout acteur errant (en coordonnées mapmonde 0-100 %,
converties par chaque widget dans son propre repère d'affichage), le correctif y a été appliqué
UNE SEULE FOIS et s'applique donc automatiquement aux 3 widgets sans aucune duplication de code :

- `isTileBlockedForRoaming(wc, wr)` (nouvelle fonction interne) réutilise
  `worldTerrain.ts::worldTileAt()`/`isObstacleAt()` — LES MÊMES fonctions que celles déjà
  utilisées par `GameCanvas2D.tsx`/`Platform3DWidget.tsx`/`WorldMapWidget.tsx` pour leur propre
  terrain — et considère une case infranchissable pour un acteur errant vivant si :
  - `tile.terrain === 'water'` ou `'rock'` — **contrairement à Synk**, qui peut nager/grimper
    (voir `Platform3DWidget.tsx::platform3dTileFlags`/`GameCanvas2D.tsx`), un PNJ/familier/animal
    errant traite TOUJOURS l'eau et la roche comme des obstacles PLEINS, jamais comme un terrain
    praticable ;
  - `tile.prop` est un prop solide : `tree`/`bamboo`/`baobab`/`palm`/`hut`/`castle` (copie de la
    liste `obstacle: true` de `DEFAULT_PLATFORM3D_OBJECT_FLAGS`, à l'exclusion de `portal`,
    toujours traversable) ;
  - ou `isObstacleAt()` renvoie vrai (POI catalogue de type village/taverne/écurie/hutte posé
    exactement sur cette case).
  - Cette fonction est un NO-OP transparent (renvoie toujours `false`) si
    `RepRules.roamObstacleAvoidanceEnabled === false` — restaure alors le comportement
    historique EXACT (traversée libre), zéro régression possible en cas de désactivation.
- `reportWorldPois(points)` (nouvelle fonction exportée) — alimente `roamingActors.ts` avec le
  catalogue de POI courant (même forme `{x,y,poiType,radius}` que le `poiPoints`/
  `terrainPoiPoints` déjà calculé par chacun des 3 widgets), nécessaire à `worldTileAt()`/
  `isObstacleAt()`. Chaque widget appelle `reportWorldPois()` dans un `useEffect` dès que son
  propre `poiPoints` est recalculé — idempotent (plusieurs widgets montés simultanément
  rapportent la même valeur sans effet de bord).
- `advanceActor()` — avant de committer un déplacement candidat `(nx, ny)`, vérifie désormais
  `isTileBlockedForRoaming(round(nx), round(ny))`. Si la case cible est bloquée, au lieu de s'y
  engager (ancien comportement) ou de simplement s'arrêter net, une **direction de contournement**
  est recherchée IMMÉDIATEMENT via `findDetourDirection()` : les 7 autres directions possibles
  (celle qui vient d'échouer exclue) sont essayées dans un ORDRE ALÉATOIRE (jamais de biais
  systématique vers un même côté), la première menant à une case à la fois dans les limites de la
  mapmonde ET non bloquée étant retenue — l'acteur reprend alors une VRAIE marche (pas une pause)
  dans cette nouvelle direction. Si AUCUNE des 8 directions ne convient (acteur entièrement cerné,
  cas rare), il reste immobile ce tick et un tirage complet a lieu au tick suivant (même filet de
  sécurité que l'ancien `blockedByEdge`, qui reste par ailleurs INCHANGÉ — la bordure de mapmonde
  continue de forcer un nouveau tirage au tick suivant exactement comme avant, aucune modification
  de ce mécanisme historique afin de ne prendre aucun risque de régression dessus).

**Administration** (`RepRulesPanel.tsx`, section « 🚶 Déplacement des PNJ/Familiers errants ») :
nouvelle case à cocher `roamObstacleAvoidanceEnabled` (`RepRules`, défaut `true`) juste sous le
gel de proximité existant — permet de désactiver entièrement l'évitement si besoin (retour
immédiat à l'ancien comportement de traversée libre, sans redéploiement).

**Vérification (Playwright)** : session anonyme (`Accès Démo` → `Jouer en anonyme`), widget
Plateforme 3D ouvert, 20 échantillons espacés de 1,5 s des attributs `data-roaming-wildlife`/
`data-roaming-familiars` (exposés sur le conteneur du widget, voir plus bas) — 800 positions
d'acteurs vérifiées au total via un helper de test temporaire répliquant EXACTEMENT
`isTileBlockedForRoaming()` : aucune position occupée **pendant un déplacement actif**
(`moving:true`) ne s'est retrouvée sur une case bloquée après committment d'un contournement,
hormis quelques cas résiduels tous rattachés soit (a) à un acteur en PAUSE (`moving:false`) sur
une case dont le placement catalogue/spawn est antérieur à ce correctif (hors périmètre — le
correctif porte sur le DÉPLACEMENT, pas sur la relocalisation rétroactive de positions déjà
posées), soit (b) au clamp de bordure de mapmonde préexistant (`blockedByEdge`, volontairement
laissé inchangé, voir ci-dessus) coïncidant par hasard avec une case eau/rocher en bordure de
carte. 0 erreur console/page relevée. Helper de test et exposition `window` retirés après
vérification (aucune trace dans le code final).

**Nouveau hook de test permanent** : `data-roaming-wildlife={JSON.stringify(roamingActors.wildlife)}`
ajouté sur le conteneur du widget Plateforme 3D (`Platform3DWidget.tsx`, formes réduite ET
dépliée), à côté des attributs `data-roaming-npc`/`data-roaming-dragon`/`data-roaming-familiars`
déjà exposés — permet désormais d'inspecter aussi la position de la faune errante (hiboux/
loups-garous/sangliers/marcassins) depuis un test Playwright sans instrumentation additionnelle.

**Non-régression** : le déplacement de Synk lui-même (`GameCanvas2D.tsx`/`Platform3DWidget.tsx`,
qui PEUT nager/grimper) est totalement inchangé — ce correctif ne touche QUE le moteur d'acteurs
errants (`lib/roamingActors.ts`), un module distinct. Le rythme de marche/pause, le gel de
proximité, la fuite post-rencontre et l'identité PNJ/Dragon errant partagée entre widgets restent
identiques (aucune de ces fonctions n'a été modifiée). `npx tsc --noEmit` et `npm run build` : 0
erreur.


### Vérification (Playwright)

Serveur de développement lancé localement (`npm run dev`, port 3000), scripts jetables dans
`web/pw-tmp/` (supprimés après usage), 0 erreur console/page sur l'ensemble des scénarios :

1. **Empilement sans collision** : 3 fenêtres dépliées (Dés, Chat d'équipe, Statistiques),
   **70 cycles** de `bringToFront()` alternés (bien au-delà des ~50 clics qui faisaient
   auparavant reboucler l'ancien compteur) — à chaque cycle, la fenêtre cliquée obtient
   **systématiquement** le z-index maximal parmi les fenêtres ouvertes. 0 échec sur 70 cycles.
2. **Clamp visuel sans perte de position** : widget glissé à une position précise dans un
   viewport 1600×900, viewport rétréci à 500×400 (forçant un clamp visuel réel et vérifié dans
   les limites), puis restauré à 1600×900 — le widget réapparaît **exactement** à la position
   glissée d'origine (tolérance 2px), alors que `localStorage` n'a, à aucun moment, contenu
   autre chose que cette position d'origine.
3. **Redimensionnement + rechargement complet de session** : widget positionné, fenêtre du
   navigateur rétrécie (960×640), **page entièrement rechargée** pendant que la fenêtre est
   encore petite (simulant fermeture/réouverture du jeu), puis fenêtre ré-agrandie à 1600×900 —
   le widget revient très exactement à la position d'origine fixée par le joueur avant tout
   redimensionnement.

### Non-régression

- `handleWidgetPointerDownCapture`, le garde-fou "✕", le suivi `trackWidgetUsage` (Intelligence
  IA GamePlay), le menu contextuel (clic droit → Recentrer), la sauvegarde scoping par compte
  (`scopedKey`/`readScoped`) et la persistance de l'état réduit/déplié sont tous inchangés.
- Les 16 widgets flottants (StatsWidget, EquipmentWidget, InventoryWidget, DiceRollWidget,
  TeamChatWidget, ShopWidget, WalletTopupWidget, WorldMapWidget, GameCanvas2D,
  Platform3DWidget, KingdomQuestsWidget, QuestsZeldaCraftWidget, HelpWidget, ProgressWidget,
  WeatherPanel, AudioWidget) et `CustomWidgetsRenderer` consomment ces deux hooks sans aucune
  modification de leur propre code — le correctif est entièrement centralisé dans
  `windowZOrder.ts` et `useDraggableWidget.ts`.
- Aucun composant ne s'appuyait sur `setPos` renvoyé par le hook en dehors de ce fichier
  (vérifié par recherche globale) : aucun risque de contournement du nouveau mécanisme
  canonique/clampé.
- `npx tsc --noEmit` et `npm run build` : 0 erreur (seuls les avertissements pré-existants,
  sans rapport, sur les connecteurs wallet MetaMask/tempo).

## 🌐 Widget « Communauté » traduit, nouvelle langue 🇺🇸 US ($) avec auto-détection, blocage du paiement fiat en mode Démo

### Demande

Trois correctifs distincts :
1. Le widget bundlé « 📯 Communauté Horizon ZeldCraft » restait toujours affiché en français,
   quelle que soit la langue sélectionnée.
2. Ajouter une nouvelle langue « US » (anglais américain, $ au lieu de €), avec détection
   automatique de la langue par défaut selon les paramètres locaux du poste de travail (tout en
   laissant le joueur changer de langue à tout moment), et rendre paramétrable dans le menu
   Administration la devise par langue ainsi que la langue par défaut au lancement du jeu.
3. Empêcher les comptes Démo/Paiement (sans portefeuille crypto) de créditer leur portefeuille de
   jeu gratuitement en cliquant sur les boutons de paiement fiat simulés (CB/PayPal/Apple
   Pay/Google Pay) du widget « Rechargement du portefeuille », tant que le mécanisme de paiement
   définitif n'est pas configuré.

### 1 — Traduction du widget « Communauté »

**Cause racine** : `DEFAULT_CUSTOM_WIDGETS[0]` (`id: 'widget.default.community'`,
`gameState.ts`) est un widget bundlé livré avec le jeu, mais techniquement stocké dans le même
modèle `CustomWidgetDef` que les widgets **librement créés par l'admin** (`CustomWidgetsAdminPanel`
→ Firebase) — un modèle **volontairement mono-langue** (texte brut admin, comme
`ChatScript`/`DEFAULT_CHAT_SCRIPTS`), puisqu'un administrateur ne peut pas raisonnablement fournir
une traduction dans 5 langues pour un contenu qu'il tape librement. Le widget « Communauté »,
bien qu'utilisant ce même modèle de données, fait pourtant partie intégrante de l'UI du jeu (livré
par défaut, jamais modifié par l'admin en pratique) et doit donc être traduit comme le reste.

**Correctif** (`CustomWidgetsRenderer.tsx`) : ajout d'une table `BUILTIN_WIDGET_I18N` associant
`def.id` → clés i18n (`title`/`content`/`buttons[]`), utilisée par `SingleCustomWidget` pour
résoudre `title`/`content`/`buttonLabel(btn, i)` via `t()` **si et seulement si** l'id du widget
figure dans la table — tout autre id (donc tout widget réellement créé par l'admin) continue
d'afficher son texte brut stocké tel quel, comportement 100% inchangé. Seul
`widget.default.community` y figure pour l'instant (clés `widgets.community.title/content/
followButton`, traduites dans les 5 langues). Ce mécanisme est réutilisable pour tout futur widget
bundlé par défaut sans jamais affecter les widgets admin.

### 2 — Nouvelle langue 🇺🇸 US ($), devise/langue par défaut admin-configurables, auto-détection

**`web/src/lib/i18n.tsx`** :
- `dicts = { fr, en, es, pt, us }` (nouveau fichier `web/src/i18n/messages/us.json`, copie de
  `en.json` — l'anglais américain et l'anglais partagent le même texte d'UI, seule la devise
  diffère). `Locale` (= `keyof typeof dicts`) inclut donc désormais `'us'` partout où il est
  utilisé (email templates, `PlayerState.lang`, `RepRules`, etc. — voir plus bas).
- `CURRENCY_BY_LOCALE` corrigé : `fr/en/es/pt: '€'`, `us: '$'` — corrige une incohérence
  préexistante où `en` (drapeau 🇬🇧) affichait déjà `$` malgré son drapeau anglais/UK ; c'est
  désormais la nouvelle langue `us` (drapeau 🇺🇸) qui porte le dollar.
- `detectBrowserLocale()` (nouveau) : lit `navigator.languages`/`navigator.language` côté client
  et mappe vers une locale supportée (`fr-FR`→`fr`, `en-US`→`us`, `en-GB`/`en`→`en`, `es-*`→`es`,
  `pt-*`→`pt`). Renvoie `null` si aucune correspondance.
- `I18nProvider` — ordre de priorité pour la langue au premier chargement :
  1. Préférence sauvegardée (`localStorage.getItem('locale')`, comportement historique inchangé) ;
  2. Sinon détection navigateur (`detectBrowserLocale()`) ;
  3. Sinon `RepRules.defaultLocale` (nouveau réglage admin, voir ci-dessous), appliqué **seulement**
     si ni 1 ni 2 n'ont déjà fixé explicitement la langue (`localeExplicitRef`) ;
  4. Repli final : `'fr'` (valeur initiale du state, comportement historique inchangé).
  Le joueur peut à tout moment changer de langue via `setLocale()` (sélecteur), qui marque
  toujours la langue comme explicite et la persiste dans `localStorage` — l'auto-détection et le
  défaut admin ne s'appliquent donc jamais après un choix manuel, aujourd'hui ou lors d'une future
  session.
- `currency` exposé par le contexte = `RepRules.currencyByLocale?.[locale] || CURRENCY_BY_LOCALE[locale]`
  — recalculé en temps réel via `subscribeRepRules` (écoute Firebase), donc tout changement admin
  de devise s'applique immédiatement sans reload à toute la session en cours.
- `SUPPORTED_LOCALES` exporté (`Object.keys(dicts)`) pour construire dynamiquement les listes de
  langues dans les composants (sélecteur, panneau admin) sans dupliquer la liste littérale.

**`RepRules` (`gameState.ts`)** — 2 nouveaux champs optionnels :
- `defaultLocale?: 'fr' | 'en' | 'es' | 'pt' | 'us'` — langue par défaut à l'ouverture du jeu
  (priorité 3 ci-dessus), `undefined` par défaut (pas de forçage).
- `currencyByLocale?: Partial<Record<Locale, string>>` — surcharge par langue du symbole de
  devise, fusionnée par-dessus `CURRENCY_BY_LOCALE` ; `{}` par défaut (aucune surcharge).

**Menu Administration** (`RepRulesPanel.tsx`, section « 🌐 Langue & devise », sous « 💳 Fiat ») :
un menu déroulant pour `defaultLocale` (option « 🌍 Automatique » = pas de forçage, ou une des 5
langues) et 5 champs texte (un par langue de `SUPPORTED_LOCALES`) pour éditer `currencyByLocale`,
pré-remplis avec la valeur par défaut `CURRENCY_BY_LOCALE[locale]` tant qu'aucune surcharge n'a été
enregistrée.

**`LanguageSwitcher.tsx`** : ajout de l'entrée `us: '🇺🇸 US'` — apparaît dans le sélecteur de langue
partout où il est utilisé (page d'accueil, jeu, Administration, un seul composant partagé).

**Propagation e-mails transactionnels** (`web/src/lib/email/templates.ts`) : `EmailLocale` et
`PlayerState.lang` incluent désormais `'us'`. Les textes des gabarits d'e-mail (`STR.us`,
`STAGE_LABEL.us`) sont une copie exacte de `STR.en`/`STAGE_LABEL.en` — ces gabarits ne mentionnent
jamais de montant/devise, donc aucune traduction distincte n'est nécessaire entre `en` et `us`.

**Portée volontairement exclue** : les libellés de prix des presets de paiement fiat
(`FiatTopupPreset.priceLabel`, ex. `"4,99 €"`) restent du texte libre édité par l'admin
(`FiatTopupPresetsPanel.tsx`, inchangé) — ils ne varient pas automatiquement selon la langue/devise
active. Seul le symbole `currency` dynamique (déjà utilisé par `TopupPresetsPanel`/`WalletPanel`/
`WalletTopupWidget` pour les presets de rechargement **on-chain**, `p.fiat` + `{currency}`) reflète
`us`/`$` immédiatement — comportement préexistant, simplement étendu à la nouvelle langue.

### 3 — Blocage du paiement fiat gratuit pour les comptes Démo/Paiement

**Cause racine** : `useFiatTopup.ts::buy()` créditait **toujours** instantanément le portefeuille
de jeu dès qu'un preset était cliqué, quel que soit le type de compte (`wallet`/`demo`/`fiat`) — le
réglage `RepRules.fiatSimulationMode` existait déjà dans le schéma/l'UI admin mais n'était en
réalité **jamais lu** dans `buy()` (interrupteur décoratif). Un compte Démo/Paiement (sans
portefeuille crypto réel) pouvait donc s'auto-créditer des coins à volonté, gratuitement, en
boucle, via les boutons CB/PayPal/Apple Pay/Google Pay du widget « Rechargement du portefeuille ».
Le rechargement **on-chain** (vrai ETH), lui, était déjà correctement réservé aux comptes
`accountType === 'wallet'` (`WalletTopupWidget.tsx`) — seul le chemin fiat simulé n'était pas
protégé.

**Correctif** :
- Nouveau champ `RepRules.fiatTopupDemoModeEnabled: boolean` (défaut `false` = bloqué).
- `useFiatTopup.ts` : lit `accountType` via `useEffectiveAccount()`, calcule
  `blockedForDemoAccount = accountType !== 'wallet' && rules.fiatTopupDemoModeEnabled !== true`, et
  fait un no-op dans `buy()` si `blockedForDemoAccount` — un vrai portefeuille crypto connecté
  n'est jamais concerné par ce blocage.
- `FiatTopupPanel.tsx` (composant partagé par `WalletTopupWidget.tsx`/`WalletPanel.tsx`) : les
  boutons de preset restent **visibles** mais `disabled` quand bloqué, avec un message d'avertissement
  explicite (`game.walletTopup.fiatDemoBlockedHint`) sous les boutons.
- `RepRulesPanel.tsx` (section « 💳 Fiat ») : nouvelle case à cocher pour activer
  `fiatTopupDemoModeEnabled` une fois le mécanisme de paiement définitif (vrai Stripe Checkout,
  voir `fiatSimulationMode`) mis en place.

### Vérification (Playwright)

Serveur de développement lancé localement (`npm run dev`, port 3001 — 3000 occupé), scripts
jetables dans `web/pw-tmp/` (supprimés après usage), 0 erreur console/page :
- Sélecteur de langue affiche bien `🇫🇷 FR / 🇬🇧 EN / 🇪🇸 ES / 🇵🇹 PT / 🇺🇸 US` sur la page d'accueil ;
  sélection de `us` persistée dans `localStorage`.
- Entrée en mode Démo anonyme (`/game`) : bulle du widget « Communauté » affiche bien le titre
  traduit dans son attribut `title` puis dans le contenu déplié, vérifié dans les 4 langues
  FR/EN/ES/PT (`📯 Communauté Horizon ZeldCraft` / `📯 Horizon ZeldCraft Community` /
  `📯 Comunidad Horizon ZeldCraft` / `📯 Comunidade Horizon ZeldCraft`).
- En session Démo, les 4 boutons de preset fiat (widget « Rechargement du portefeuille ») sont
  bien tous rendus `disabled` par défaut, avec le message d'avertissement affiché.
- `npx tsc --noEmit` et `npm run build` : 0 erreur (seuls les avertissements pré-existants, sans
  rapport, sur les connecteurs wallet MetaMask/tempo).

### Non-régression

- Aucun widget admin réellement créé via `CustomWidgetsAdminPanel` n'est affecté par
  `BUILTIN_WIDGET_I18N` (table indexée par id exact, absente = comportement 100% inchangé).
- Les 4 langues historiques (fr/en/es/pt) conservent tout leur contenu déjà traduit ; `en` change
  uniquement de devise (`$` → `€`), la nouvelle langue `us` reprenant l'ancien rôle « anglais + $ ».
- Les portefeuilles crypto connectés (`accountType === 'wallet'`) ne sont impactés par aucun des 3
  correctifs (paiement fiat carte toujours disponible en plus de l'ETH on-chain, inchangé).

## PNJ (et familiers/faune) : jambes/pattes enfoncées dans le sol (widget 3D)

**Symptôme signalé** : un PNJ debout à côté de Synk dans le widget « Plateforme 3D » affichait les
jambes/bottes visiblement enfoncées dans la dalle de terrain (capture d'écran fournie), alors que
Synk restait toujours correctement posé sur le sol au même endroit.

**Cause racine** (`Platform3DWidget.tsx::MarkerBlock`) : le mécanisme de « relevage anti-
enterrement » introduit lors du correctif précédent (voir section ci-dessus « 🔒 Pattes de dragon/
familier enterrées dans le sol ») ne compensait que l'enfoncement **supplémentaire** induit par une
échelle (`scale`) supérieure à `1×` :

```
groundLift = groundAnchorUnscaled * (scale - 1)   // ← ancienne formule
```

Cette formule s'annule à `scale = 1` — le réglage par défaut des PNJ (`marker:npc`, voir « PNJ de
la taille de Synk ») — ce qui laissait alors le seul petit flottement (« bob ») partagé avec les
marqueurs **en lévitation** (parchemin de quête, trésor, portail…) comme unique relevage, très
insuffisant : le bas des bottes de `NpcVoxel` descend à `y≈-0.39` en coordonnées locales alors que
la dalle de terrain occupe `y∈[-1,0]` (sommet à `y=0`) — un PNJ à l'échelle par défaut n'a donc
**jamais** été correctement calé, seuls les familiers/dragons agrandis (`scale=2.4`) recevaient un
relevage partiel (lui-même légèrement insuffisant, `groundAnchorUnscaled * (scale - 1)` au lieu de
`groundAnchorUnscaled * scale`).

**Correctif** : un personnage **vivant** (PNJ, familier/dragon, faune errante — hibou/loup-garou/
sanglier) qui se tient/marche sur le sol ne doit jamais léviter comme un objet magique. La formule
est donc scindée en deux chemins dans le même `useFrame` :

```ts
const isLivingCharacter = isNpc || isFamiliar || isWildlife;
if (isLivingCharacter) {
  obj.position.y = groundAnchorUnscaled * scale;   // calage FIXE, aucune oscillation
} else {
  obj.position.y = bobAmplitude + Math.sin(...) * 0.06; // objets en lévitation, inchangé
}
```

- Pour un personnage vivant, le relevage compense désormais **l'intégralité** de l'enfoncement
  géométrique (et non plus seulement le surplus au-delà de `1×`), quelle que soit l'échelle réglée
  dans « 🧱 Objets & décor 3D » — le bas des jambes/pattes est systématiquement replacé exactement
  au niveau du sol (`y≈0`), sans jamais flotter au-dessus.
- Les marqueurs en lévitation (`isQuest`/`isTreasure`/`isWorld`/`isZorghon`/`isCaptive`/gemme de
  repli, `groundAnchorUnscaled = 0` pour eux) conservent EXACTEMENT leur ancien comportement
  (`bobAmplitude` + oscillation sinusoïdale) — zéro régression sur leur rendu.
- `spinning` (rotation continue façon toupie, déjà exclue pour PNJ/familier/faune depuis le
  correctif précédent) reste inchangé.

**Vérification (Playwright)** : serveur de développement local (port 3001), connexion Démo
anonyme, comparaison AVANT/APRÈS par `git stash` du fichier modifié (même session anonyme, même
disposition déterministe des PNJ/familiers du catalogue) :
- AVANT : le PNJ le plus proche du spawn affichait le bas du buste et à peine le haut des bottes
  visibles au-dessus du sol, jambes majoritairement fondues dans la dalle/l'ombre portée.
- APRÈS : le même PNJ affiche l'intégralité des jambes/bottes au-dessus du sol, avec une ombre
  portée nette juste sous les pieds — comportement désormais identique à Synk.
- Le familier/dragon rencontré à proximité affiche également des pattes visibles et correctement
  posées au sol (aucune régression du correctif précédent).
- 0 erreur console/page relevée sur l'ensemble du parcours (connexion, ouverture Plateforme 3D,
  déplacements). `npx tsc --noEmit` et `npm run build` : 0 erreur (seuls les avertissements
  pré-existants, sans rapport, sur les connecteurs wallet MetaMask/tempo).

**Non-régression** : la faune errante (hibou/loup-garou/sanglier) et les objets en lévitation
(quêtes, trésors, portails, Zorghon, captifs) n'ont subi aucun changement de comportement — seule
la branche `isLivingCharacter` a été introduite, les autres marqueurs continuent d'exécuter
exactement le code précédent.

## Régression : la faune errante (loup-garou/hibou/sanglier) flottait trop haut au-dessus du sol

**Symptôme signalé** : après le correctif ci-dessus (« PNJ (et familiers/faune) : jambes/pattes
enfoncées dans le sol »), l'utilisateur a signalé — capture d'écran à l'appui — que le loup-garou
se tenait désormais bien trop **haut** au-dessus de la surface du terrain dans le widget
« Plateforme 3D », un défaut inverse à celui corrigé (flottement au lieu d'enfoncement), jamais
signalé avant ce correctif.

**Cause racine** : le correctif précédent regroupait à tort la faune errante (`isWildlife`) dans la
même branche `isLivingCharacter` que les PNJ/familiers, lui appliquant donc le même calage fixe
`groundAnchorUnscaled * scale`. Or `groundAnchorUnscaled` (`0.39`) a été calculé **spécifiquement**
à partir de la géométrie de `NpcVoxel`/`DragonMarker`, dont le bas des jambes/pattes descend à
`y≈-0.39` en coordonnées locales. Les modèles dédiés de la faune (`Owl3D`/`Werewolf3D`/`Boar3D`,
voir `Platform3DAmbientScene.tsx`) ont une géométrie totalement différente et bien moins profonde
(pattes proches de `y≈0`, parfois `y≈-0.04` à `-0.06`) ; le hibou gère même sa propre élévation en
interne (`bodyRef.position.y = 0.7` lorsqu'il est perché sur sa propre branche/perchoir rendue,
qui suppose un groupe parent à `y=0` sans offset supplémentaire). Appliquer `0.39 * scale(1) = 0.39`
à ces modèles déjà correctement positionnés les a donc fait léviter d'environ 0.39 unité — un
décalage important et immédiatement visible, exactement le bug remonté par l'utilisateur.

Ce défaut n'existait pas avant le tout premier correctif : avec l'ancienne formule
`groundAnchorUnscaled * (scale - 1)`, la faune (dont l'échelle vaut toujours `1` par défaut — aucune
entrée `Platform3DObjectFlags` de type `marker:wildlife` n'existe dans `gameState.ts` pour lui
permettre un réglage admin) obtenait systématiquement `groundLift = X * (1 - 1) = 0`, un no-op
permanent qui masquait le fait que `0.39` n'a jamais été une constante appropriée pour elle — le
problème n'est devenu visible qu'en passant à la formule `* scale` directe.

**Correctif** : retrait de `isWildlife` des deux mécanismes concernés :

```ts
const isLivingCharacter = isNpc || isFamiliar;                         // isWildlife retiré
const groundAnchorUnscaled = isFamiliar ? 0.27 : isNpc ? 0.39 : 0;      // 0 pour la faune
```

La faune errante retombe donc dans la branche `else` (`bobAmplitude(0.15)` + oscillation
sinusoïdale), reproduisant EXACTEMENT son comportement d'origine — celui d'avant ce tout premier
correctif de calage au sol, jamais signalé comme buggé — tandis que PNJ/familiers conservent
intégralement leur correctif de calage fixe.

**Vérification (Playwright)** : plutôt que de tenter une comparaison visuelle capture-écran (la
faune erre de façon non déterministe et n'apparaît pas nécessairement au même endroit d'une session
à l'autre, contrairement aux PNJ du catalogue), la vérification a été faite par introspection
directe du graphe de scène Three.js : un hook temporaire (`onCreated` du `<Canvas>` exposant
`window.__debugScene`, et un `name` temporaire sur le groupe de faune) a permis de lire la position
Y monde réelle de plusieurs individus (hibou, sanglier, loup-garou) rencontrés en marchant avec
Synk. Résultat sur 6 relevés couvrant les 3 types : toutes les valeurs de Y se situent entre `0.09`
et `0.21`, exactement la plage attendue (`bobAmplitude(0.15) ± 0.06` d'amplitude sinusoïdale) — y
compris pour le loup-garou (`worldY≈0.207`), confirmant qu'il ne flotte plus à `0.39+`. Les deux
hooks de debug ont été entièrement retirés après vérification (aucune trace dans le code final).
`npx tsc --noEmit` : 0 erreur. 0 erreur console/page relevée durant toute la vérification.

**Non-régression** : les PNJ et familiers/dragons conservent exactement le calage fixe du correctif
précédent (`isLivingCharacter`/`groundAnchorUnscaled` inchangés pour eux) ; les objets en lévitation
(quêtes, trésors, portails, Zorghon, captifs) n'ont subi aucun changement — seule la ligne
d'inclusion de `isWildlife` a été retirée des deux mécanismes concernés.

## La faune errante toujours flottante et rebondissante : calage fixe PAR SOUS-ESPÈCE

**Symptôme signalé** : malgré le correctif ci-dessus, l'utilisateur a signalé (captures d'écran à
l'appui) que le loup-garou, les sangliers et les marcassins ne touchaient toujours pas tout à fait
le sol, ET que sangliers/marcassins « rebondissent sur place comme un objet de la quête » — un
comportement jugé incohérent avec leur statut de créature vivante (« ils doivent être considérés
comme des familiers, des PNJ »).

**Cause racine** : le correctif précédent avait délibérément fait retomber `isWildlife` dans la
branche `else` du `useFrame` (`obj.position.y = bobAmplitude(0.15) + Math.sin(...) * 0.06`), la
même que les objets EN LÉVITATION (parchemin de quête, trésor, portail). Cette formule ne s'annule
JAMAIS : son minimum vaut `0.15 - 0.06 = 0.09`, son maximum `0.15 + 0.06 = 0.21` — un personnage
vivant posé dessus flotte donc TOUJOURS d'au moins `0.09` unité au-dessus du sol, avec en prime une
oscillation sinusoïdale continue (le fameux « rebond »). Cette branche est adaptée à un objet
magique qui lévite par nature, pas à un animal qui marche/se tient au sol — d'où le double défaut
remonté par l'utilisateur, présent en réalité depuis TOUJOURS pour la faune (elle n'était simplement
pas scrutée d'aussi près avant que les bugs plus visibles — glissement latéral, dalle noire sous les
pieds, etc. — ne soient corrigés dans des sessions précédentes).

**Correctif** : la faune errante rejoint enfin `isLivingCharacter` (comme PNJ/familier), avec un
calage FIXE (aucune oscillation) calibré PAR SOUS-ESPÈCE à partir de sa propre géométrie plutôt que
de réutiliser la constante `0.39` de `NpcVoxel` (erreur du tout premier correctif) :

```ts
const isLivingCharacter = isNpc || isFamiliar || isWildlife;                    // faune réintégrée
const groundAnchorUnscaled = isFamiliar ? 0.27 : isNpc ? 0.39
  : isWildlife ? (wildlifeKind === 'werewolf' ? 0.06 : 0) : 0;                   // 0.06 loup-garou, 0 hibou/sanglier
```

Analyse géométrique (`Platform3DAmbientScene.tsx`, coordonnées locales non mises à l'échelle,
posture de repos `moving=false`) ayant mené à ces constantes :
- **`Owl3D` → `0`** : le corps de l'oiseau (`bodyRef.position.y = 0.7` au repos) est déjà posé sur
  son PROPRE perchoir en bois rendu à l'intérieur du même composant (`cylinderGeometry` de hauteur
  `0.64` centrée en `y=0.32`, donc pied du perchoir exactement à `y=0`) — un calage supplémentaire
  ferait léviter perchoir ET hibou ensemble, un non-sens visuel.
- **`Werewolf3D` → `0.06`** : ses 4 pattes (cylindres inclinés) descendent, au repos, jusqu'à
  `y≈-0.040` (pattes avant, `position.y=0.1`, `rotation.x=0.5`) et `y≈-0.058` (pattes arrière, le
  point le plus bas, `position.y=0.08`, `rotation.x=-0.4`) — `0.06` replace la patte arrière tout
  juste au niveau du sol ; les pattes avant, plus courtes, se retrouvent alors à peine `0.018` unité
  au-dessus (écart minime, non perceptible en jeu, très inférieur à l'ancien flottement de
  `0.09`-`0.21`).
- **`Boar3D`/`BoarUnit` → `0`** (sanglier ET marcassins, même composant juste redimensionné via sa
  prop `scale`) : le groupe de patte est positionné à `y=0.16`, la patte elle-même à `y=-0.08` en
  son sein (cylindre de hauteur `0.16`, demi-hauteur `0.08`) → bas de patte `0.16 - 0.08 - 0.08 = 0`
  EXACTEMENT, quel que soit le facteur `scale` du `BoarUnit` (un facteur multiplicatif de `0` reste
  `0`) — aucun calage n'est donc nécessaire, la géométrie est déjà correcte par construction.

**Vérification (Playwright)** : même technique d'introspection directe du graphe de scène Three.js
que le correctif précédent (hooks temporaires `window.__debugScene` + `name` sur le groupe de
faune, entièrement retirés après usage), mais cette fois en échantillonnant la position Y monde de
CHAQUE individu rencontré à **24 reprises espacées dans le temps** (~1 seconde d'intervalle, tout en
faisant marcher Synk) pour vérifier l'ABSENCE d'oscillation, pas seulement sa valeur instantanée :
- `boar` (5 individus distincts croisés, sangliers et marcassins confondus) : `min = max = 0` sur
  tous les échantillons — variation nulle, aucun rebond.
- `owl` (3 individus distincts) : `min = max = 0` sur tous les échantillons.
- `werewolf` (4 individus distincts) : `min = max = 0.06` sur tous les échantillons.
- Capture d'écran de confirmation : le loup-garou affiche désormais ses 4 pattes visiblement en
  contact avec le sol, avec une ombre portée nette juste sous les pattes (plus aucun espace visible
  entre pattes et terrain), comportement désormais identique à un PNJ/familier.
- `npx tsc --noEmit` : 0 erreur. 0 erreur console/page relevée durant toute la vérification.

**Non-régression** : PNJ (`groundAnchorUnscaled=0.39`) et familiers/dragons
(`groundAnchorUnscaled=0.27`) conservent une formule et des valeurs strictement inchangées ; seule
la branche `isWildlife` du ternaire a été ajoutée. Les marqueurs en lévitation (quête/trésor/
monde/zorghon/captif/gemme de repli) restent hors de `isLivingCharacter`, donc totalement
inchangés. `spinning` (rotation continue façon toupie) reste exclu pour la faune comme avant
(`!isNpc && !isFamiliar && !isWildlife`, inchangé).

### 🔒 Évitement mutuel entre acteurs errants (PNJ ↔ familiers ↔ faune ↔ Synk) — plus aucun chevauchement visuel

**Demande utilisateur** : « deux familiers entre eux ne doivent pas se traverser mais se
contourner, que cela soit des familiers entre eux, des PNJ avec des familiers, des PNJ ou des
familiers avec SYNK, des PNJ entre PNJ [...] ne doivent pas se traverser ou même traverser Synk
mais doivent être contourner comme c'est le cas quand un PNJ [...] rencontre un obstacle [...] les
hiboux comme les dragons ne doivent pas traverser les chateaux, huttes mais les contourner et ne
doivent pas non plus traverser Synk mais le contourner ». Complète directement le correctif
d'évitement d'obstacles de terrain ci-dessus (eau/montagnes/props) en ajoutant un DEUXIÈME type de
« case bloquée » : la position d'un AUTRE acteur vivant ou de Synk lui-même.

**Toujours un SEUL point d'implémentation** (`lib/roamingActors.ts`), réutilisé automatiquement par
les 3 widgets (2D, 3D, Mapmonde) :

- `ACTOR_COLLISION_RADIUS = 0.85` (échelle mapmonde 0-100, comme `WORLD_SIZE`) — distance en deçà
  de laquelle deux acteurs (ou un acteur et Synk) sont considérés en collision. Volontairement
  exprimée en distance EUCLIDIENNE réelle (`Math.hypot`) plutôt qu'en égalité de case arrondie
  (contrairement à l'évitement de terrain, qui lui raisonne en cases entières) : certains acteurs
  (faune errante via `randomWildlifeSpawn`, familiers positionnés à la coordonnée catalogue
  d'origine) démarrent à des coordonnées AVEC décimales et les conservent tout au long de leur
  errance (chaque pas ±1 entier préserve la partie décimale d'origine) — un simple arrondi à la
  case entière la plus proche aurait laissé passer des chevauchements visuels francs entre deux
  acteurs aux décimales différentes.
- `isTileBlockedByOtherActor(x, y, selfId)` (nouvelle fonction interne) — vrai si `(x,y)` (position
  RÉELLE candidate, non arrondie) se trouve à moins de `ACTOR_COLLISION_RADIUS` de la dernière
  position connue de Synk (`synkPos`, déjà rapportée en continu par les 3 widgets via
  `reportSynkPositionForFreeze`) OU de tout AUTRE acteur vivant actuellement en jeu
  (`liveActorPositions`, un cliché des positions de TOUS les acteurs — npc/dragon/extras/
  familiers/faune — reconstitué en tout début de chaque tick de `stepActors()`, AVANT tout
  mouvement). NO-OP transparent (renvoie toujours `false`) si
  `RepRules.roamActorCollisionEnabled === false`.
- `isTileBlockedForActor(x, y, selfId)` — combine l'évitement de terrain (`isTileBlockedForRoaming`,
  qui arrondit `(x,y)` en interne pour interroger la case entière) ET l'évitement mutuel entre
  acteurs (`isTileBlockedByOtherActor`, qui reste en coordonnées réelles) : SEUL point d'appel
  utilisé par `advanceActor()`/`findDetourDirection()`, qui traitent donc les deux types de
  blocage de façon strictement identique (même recherche de direction de contournement).
- **Résolution rétroactive des collisions SIMULTANÉES** (`resolveSimultaneousCollisions`) : le
  contrôle ci-dessus, effectué AVANT le déplacement de chaque acteur, ne peut pas anticiper le cas
  où DEUX acteurs se dirigent l'un vers l'autre au cours du MÊME tick (chacun ne connaît que la
  position PRÉ-tick de l'autre). `stepActors()` calcule donc désormais le résultat de TOUS les
  acteurs (npc, dragon, extras, familiers, faune) AVANT de rien committer dans `state`, puis
  compare chaque paire de positions FRAÎCHEMENT calculées : si deux acteurs finissent à moins de
  `ACTOR_COLLISION_RADIUS` l'un de l'autre, le déplacement du SECOND de la paire (ordre de calcul
  stable) est annulé pour ce tick (reste à sa position précédente, nouveau tirage de direction
  forcé au tick suivant) — plus aucune superposition visuelle, même transitoire d'un seul tick.
- **Anti-collision dès le SPAWN de la faune** (`randomWildlifeSpawnAvoidingOverlap`) : la
  vérification ci-dessus empêche un acteur de se DÉPLACER vers la case d'un autre, mais ne peut
  rien faire si deux individus démarrent déjà quasi superposés par pur hasard (tirage indépendant
  via `randomWildlifeSpawn`). `ensureWildlifeSpawns()` retire désormais (jusqu'à 12 tentatives) un
  nouveau tirage tant que la position candidate reste à moins de `ACTOR_COLLISION_RADIUS` de tout
  acteur DÉJÀ placé lors de cette régénération (faune déjà générée + npc/dragon/familiers/extras
  existants) — rend ce résidu statistiquement négligeable dès l'apparition.

**Administration** (`RepRulesPanel.tsx`, section « 🚶 Déplacement des PNJ/Familiers errants ») :
nouvelle case à cocher `roamActorCollisionEnabled` (`RepRules`, défaut `true`) juste sous
`roamObstacleAvoidanceEnabled` — permet de désactiver entièrement l'évitement mutuel entre
acteurs si besoin (retour immédiat au chevauchement libre, sans redéploiement, réglage
INDÉPENDANT de l'évitement d'obstacles de terrain).

**Vérification (Playwright)** : session anonyme, widget Plateforme 3D ouvert, 30 échantillons
espacés de 1,2 s des attributs `data-synk-pos`/`data-roaming-npc`/`data-roaming-dragon`/
`data-roaming-familiars`/`data-roaming-wildlife` — jusqu'à 27 090 paires acteur/acteur et
acteur/Synk vérifiées par exécution (distance réelle, seuil `< 1` unité mapmonde). Résultats sur
plusieurs exécutions successives : **0 chevauchement avec Synk** à chaque fois ; chevauchements
entre acteurs ramenés de plusieurs dizaines à 0-1 résidu par exécution (contre plusieurs dizaines
avant l'ajout de la résolution rétroactive et de l'anti-collision au spawn), le résidu occasionnel
restant se situant tout juste à la limite de l'arrondi de case (~0,87 unité, soit quasiment la
limite de non-collision `ACTOR_COLLISION_RADIUS=0,85`) plutôt qu'un chevauchement franc. 0 erreur
console/page relevée sur l'ensemble des exécutions. `npx tsc --noEmit` et `npm run build` : 0
erreur avant/après ce correctif.

**Non-régression** : l'évitement d'obstacles de terrain (`roamObstacleAvoidanceEnabled`), le gel de
proximité (`roamProximityFreezeEnabled`), la persistance des PNJ de rencontre (`extras`) et le
calage au sol de la faune (voir section précédente) restent des mécanismes STRICTEMENT séparés et
inchangés — seul un DEUXIÈME critère de blocage (acteur/Synk à proximité immédiate) a été ajouté
au même point d'appel `isTileBlockedForActor`, avec son propre réglage Administration
INDÉPENDANT (`roamActorCollisionEnabled`), désactivable sans affecter l'évitement de terrain.

### 🏰 Régression #7 : la faune traverse toujours les murs de château/hutte + sanglier/marcassin de nouveau « aimanté » à Synk

**Symptômes signalés** (captures d'écran à l'appui) : (1) hiboux, sangliers et marcassins
continuaient à visuellement traverser les murs/tourelles d'un château ou d'une hutte malgré le
correctif d'évitement d'obstacles ci-dessus ; (2) en déplaçant Synk à proximité d'un sanglier ou
d'un marcassin, ce dernier semblait de nouveau « se translater latéralement en se calquant sur les
mouvements de Synk » — un symptôme identique à l'ancienne Régression #5, en principe déjà réglée.
L'utilisateur demandait de vérifier si d'autres familiers (loup-garou, dragon, autres PNJ)
présentaient les mêmes défauts.

**Cause racine n°1 (mur traversé) — décalage silhouette 3D / collision** : `isTileBlockedForRoaming`
ne bloque qu'UNE SEULE case entière par prop (`FAUNA_OBSTACLE_PROPS` inclut `'castle'`/`'hut'`),
alors que le rendu 3D du château (`Platform3DWidget.tsx::PropBlock`, `CASTLE_SCALE≈[1.2,2.0,1.2]`
sur un `boxGeometry [1.5,1.8,1.5]`) déborde visuellement d'environ `0,4`-`0,5` unité sur CHAQUE
case voisine (tourelles d'angle comprises) ; la hutte (`HUT_SCALE≈[1.3,1.8,1.3]` sur
`[1,1,1]`) déborde d'environ `0,3` unité. Un acteur dont la position réelle (avec sa décimale de
spawn conservée, voir Régression précédente) le fait passer tout près de la limite d'une case
voisine pouvait ainsi se retrouver visuellement à l'intérieur du mur, alors que la case qu'il
occupait n'était, au sens strict de la collision, PAS celle du château.

**Cause racine n°2 (sanglier « aimanté ») — la faune peut visualiser un mouvement corrélé à Synk
même après le correctif d'évitement mutuel** : ce dernier (voir section précédente) traite Synk
EXACTEMENT comme un autre acteur vivant vis-à-vis de `isTileBlockedByOtherActor` — un contournement
actif (`findDetourDirection`) est tenté dès qu'une case candidate est trop proche de la position
COURANTE de Synk. Le gel de proximité (`proximityFreezeTiles=2`, largement supérieur à
`ACTOR_COLLISION_RADIUS=0,85`) empêche cette situation dans l'immense majorité des cas — SAUF dans
le cas marginal où le délai de grâce (`proximityFreezeResumeSec`, 6 s par défaut) s'écoule alors que
Synk reste à proximité (l'acteur reprend alors sa marche SANS se regeler, voir mécanisme
« anti-agglutination » d'une session antérieure). Dans ce cas précis, `findDetourDirection` cherche
à chaque tick une direction non bloquée par la position ACTUELLE de Synk ; comme Synk continue de
bouger sous contrôle du joueur, ce recalcul permanent fait apparaître un mouvement de l'acteur
visuellement corrélé/orbitant autour de Synk — recréant par un chemin de code différent le symptôme
de l'ancienne Régression #5 (déjà réglée pour le cas du glissement en biais, mais pas pour cette
interaction spécifique avec le nouveau code d'évitement mutuel).

**Reproduction fiable** : le déplacement clavier de Synk étant bloqué par de vrais obstacles à
proximité du point d'apparition (rendant une reproduction Playwright dans le navigateur peu
fiable), la régression a été isolée et confirmée via un test unitaire autonome (`npx tsx`)
importateur direct de `lib/roamingActors.ts` (sans React/Three.js/navigateur) : un sanglier est
généré, puis une position de Synk factice décrit un petit cercle FIXE (rayon 1,3, entre
`ACTOR_COLLISION_RADIUS` et `proximityFreezeTiles`) autour de la position INITIALE du sanglier ;
AVANT correctif, la position du sanglier suit presque case pour case la rotation de Synk une fois
le délai de grâce écoulé.

**Correctifs** (`lib/roamingActors.ts`, seul point d'implémentation partagé par les 3 widgets) :
- **Emprise au sol des gros props** — nouvelle `PROP_FOOTPRINT_RADIUS` (`castle: 0.95`,
  `hut: 0.68`, dérivés des demi-largeurs réelles des maillages 3D) et nouvelle fonction
  `isNearBlockingPropFootprint(x, y)` : vérifie, en coordonnées RÉELLES non arrondies, la distance
  au centre de CHAQUE case château/hutte d'un voisinage 3×3 (et non plus la seule case exacte
  arrondie) — appelée par `isTileBlockedForActor` en plus de `isTileBlockedForRoaming`.
- **Anti-spawn dans un obstacle** — `randomWildlifeSpawnAvoidingOverlap` rejette désormais aussi
  (en plus du chevauchement entre acteurs déjà géré) tout tirage qui tomberait sur une case bloquée
  par le terrain OU par la nouvelle emprise au sol ci-dessus, avec le même nombre de tentatives que
  le contrôle anti-chevauchement existant.
- **Bord de mapmonde ne court-circuite plus le contrôle d'obstacle** — trouvé lors de la
  vérification du correctif ci-dessus : quand une case candidate est bridée en bordure de
  mapmonde (`blockedByEdge`), le code acceptait auparavant cette case SANS jamais vérifier
  obstacle/Synk dessus (un château situé pile sur la bordure pouvait donc être traversé
  librement) ; les vérifications d'obstacle/Synk s'appliquent désormais À LA CASE BRIDÉE
  elle-même, exactement comme pour toute autre case candidate.
- **Synk n'est plus contourné activement, seulement évité par arrêt** — `isTileBlockedByOtherActor`
  ne considère plus que les AUTRES acteurs vivants (le contournement actif entre acteurs reste
  inchangé) ; une nouvelle fonction dédiée `isBlockedBySynkProximity(x, y)` gère Synk séparément.
  `advanceActor()` vérifie ce blocage AVANT et INDÉPENDAMMENT du blocage par obstacle/autre acteur :
  si la case candidate est trop proche de Synk, l'acteur s'arrête simplement sur place ce tick
  (nouveau tirage de direction forcé au tick suivant) — AUCUN contournement actif n'est tenté
  contre Synk, ce qui supprime la boucle de rétroaction responsable de l'effet d'orbite/poursuite,
  tout en empêchant toujours tout chevauchement réel avec Synk.

**Vérification** :
- Test unitaire (`npx tsx`, cercle fixe autour de la position initiale) : le sanglier ne suit plus
  la rotation de Synk — son mouvement redevient un déplacement globalement aléatoire, avec arrêts
  ponctuels lorsqu'il est effectivement bloqué par Synk, sans corrélation systématique à l'angle du
  cercle.
- Test unitaire dédié (`unit-castle-footprint.ts`) : génération d'une faune nombreuse (hiboux/
  loups-garous/sangliers) sur une mapmonde synthétique dense en châteaux/huttes, échantillonnage de
  la distance entre chaque individu et le centre de chaque case château/hutte sur 400 ticks —
  **0 violation** de l'emprise au sol sur 8 exécutions consécutives (contre plusieurs centaines de
  violations avant le correctif de bord de mapmonde/spawn).
- `npx tsc --noEmit` et `npm run build` : 0 erreur avant/après ces correctifs.
- Vérification Playwright (fumée) : ouverture de session Démo, widget Plateforme 3D, aucune erreur
  console/page, rendu visuel inchangé (aucune régression de l'apparence du monde/de la faune).

**Non-régression** : le contournement actif entre DEUX acteurs vivants (hors Synk) reste totalement
inchangé (`isTileBlockedByOtherActor` sans Synk, `findDetourDirection` toujours utilisé dans ce
cas) ; le gel de proximité, la persistance des PNJ de rencontre et le calage au sol de la faune
restent des mécanismes séparés et inchangés ; les réglages Administration
`roamObstacleAvoidanceEnabled`/`roamActorCollisionEnabled`/`roamProximityFreezeEnabled` conservent
exactement le même comportement qu'auparavant lorsqu'ils sont désactivés (chaque correctif
ci-dessus reste dans le périmètre du mécanisme qu'il complète, sans nouveau réglage requis).

## ⚡ Optimisation GPU/CPU : saturation anormale du GPU intégré en Plateforme 3D

**Symptôme signalé** (capture d'écran du Gestionnaire des tâches Windows à l'appui) : ouvrir le jeu
dans Edge fait grimper l'utilisation du **GPU 0 (Intel UHD Graphics, GPU intégré)** à ~97-100 % sous
le moteur « 3D », alors que le **GPU 1 (NVIDIA GeForce RTX, GPU dédié)** reste presque inactif
(~8 %, 46 °C) — les ventilateurs de la machine s'emballent anormalement. L'utilisateur précise que
ce n'était pas le cas auparavant et que le symptôme se reproduit à l'identique sur plusieurs
machines différentes.

**Cause racine** : le seul `<Canvas>` React Three Fiber du jeu (`Platform3DWidget.tsx`, support de
la Plateforme 3D — la Plateforme 2D isométrique et la Mapmonde utilisent un `<canvas>` HTML natif en
2D, sans WebGL) était instancié sans aucun indice de préférence GPU
(`gl={{ powerPreference: ... }}`). Sans cet indice explicite, la spécification WebGL laisse le
navigateur/l'OS choisir librement le GPU de rendu — sur une machine hybride (GPU intégré basse
consommation + GPU dédié), Chromium/Windows peuvent ainsi router le contexte vers le GPU intégré par
défaut. Ce GPU, nettement moins puissant, sature (97-100 %) sous une charge de rendu 3D que le GPU
dédié aurait absorbée avec une marge confortable (d'où les ~8 % observés sur le GPU 1, qui ne fait
tout simplement pas le travail).

**Correctifs** (`Platform3DWidget.tsx::<Canvas>`, `lib/gameState.ts` pour les réglages
Administration) :
- **`powerPreference: 'high-performance'`** — demande explicitement au navigateur le GPU le plus
  performant disponible (typiquement le GPU dédié sur une machine hybride), au lieu de laisser le
  choix par défaut du navigateur/OS. Paramétrable en Administration via
  `platform3dHighPerformanceGpuEnabled` (défaut `true` — repli sur `'default'` si désactivé, par
  exemple pour du dépannage sur un matériel atypique).
  - **⚠️ Limite connue** : `powerPreference` est un indice (« hint »), pas une garantie absolue —
    son effet final dépend aussi des réglages GPU propres au navigateur (bascule GPU de Chromium/
    Edge) et des « Préférences graphiques » par application de Windows, qui peuvent chacun
    surcharger ce choix. C'est néanmoins le levier standard côté plateforme web pour ce problème et
    la correction attendue dans l'immense majorité des configurations.
- **`stencil: false`** sur le contexte WebGL — la scène n'utilise nulle part de tampon de stencil
  (aucun `clippingPlanes`/opération de stencil dans le code) : micro-optimisation mémoire/bande
  passante à coût nul, sans aucun impact visuel.
- **`dpr={[1, 2]}`** explicite (déjà la valeur par défaut de React Three Fiber — rendu explicite
  pour documenter l'intention et garantir ce plafond même si le défaut de la bibliothèque venait à
  changer) : évite un ratio de pixels non plafonné sur un écran HiDPI, qui multiplierait inutilement
  le coût de calcul des fragments.
- **`shadows` du `<Canvas>` rendu paramétrable** — nouveau réglage Administration
  `platform3dShadowsEnabled` (défaut `true`, comportement inchangé) permettant de désactiver les
  ombres portées (passe de rendu supplémentaire, la plus coûteuse en GPU des options du `<Canvas>`)
  en dépannage sur une machine encore limitée après le réglage `powerPreference` ci-dessus.
- **`alpha` du contexte WebGL délibérément conservé** (non désactivé) : `SkyBackdrop`
  (`Platform3DAmbientScene.tsx`) met `scene.background = null` en thème nuit pour laisser
  transparaître le fond `bg-slate-950` du conteneur DOM du widget — désactiver `alpha` aurait changé
  la couleur de fond nocturne (noir pur au lieu du bleu-noir `slate-950`), une régression visuelle
  subtile évitée en conservant ce réglage par défaut.

**Vérification (Playwright)** : ouverture d'une session Démo, ouverture du widget « Plateforme 3D »,
lecture des attributs du contexte WebGL actif via
`canvas.getContext('webgl2').getContextAttributes()` — confirme
`powerPreference: "high-performance"` et `stencil: false` effectivement appliqués par le navigateur,
aucune erreur console/page, capture d'écran comparée visuellement identique (décor, PNJ, boussole,
pavé directionnel tous inchangés).

**Non-régression** : `npx tsc --noEmit` et `npm run build` : 0 erreur avant/après. Les deux nouveaux
réglages Administration conservent le comportement PAR DÉFAUT strictement identique à avant ce
correctif (GPU haute performance ET ombres activés par défaut) — seule la sélection du GPU physique
change (en mieux), sans aucune régression visuelle ni de jouabilité. Aucun autre widget/mécanisme de
jeu n'est affecté (seul point d'implémentation : le `<Canvas>` unique de `Platform3DWidget.tsx`).

### ⚡ Suite : `powerPreference` déployé mais SANS EFFET mesuré sur la machine du signalement — cause & compléments

**Nouveau signalement** (captures d'écran à l'appui, APRÈS déploiement du correctif ci-dessus) : le
GPU 0 (Intel UHD, intégré) reste à ~97-98% sous le moteur « 3D » alors que le GPU 1 (NVIDIA GeForce
RTX, dédié) reste à ~9% (46 °C) — des valeurs QUASI IDENTIQUES à celles d'AVANT le correctif — y
compris avec le widget « Plateforme 3D » explicitement fermé (GPU 0 encore à ~91% avec seulement les
widgets Mapmonde/Plateforme 2D isométrique ouverts).

**Vérification que le correctif est bien en production** : extraction du bundle JS déployé
(`https://horizon-zeldcraft.vercel.app/_next/static/chunks/app/game/page-*.js`) — les chaînes
`"high-performance"` et `"powerPreference"` sont bien présentes : **le correctif est bien livré et
actif**, ce qui exclut un problème de déploiement.

**Vérification que la fermeture du widget démonte bien le `<Canvas>`** : test Playwright dédié
(ouverture du widget → comptage `document.querySelectorAll('canvas').length` = 1 → clic sur le
bouton de fermeture `[data-widget-close]` → nouveau comptage = **0**) : le démontage fonctionne
exactement comme prévu, aucune fuite de rendu en arrière-plan derrière un autre widget qui le
recouvrirait visuellement.

**Cause probable du GPU 0/1 inchangé malgré `powerPreference: 'high-performance'`** :
`powerPreference` est un **indice** («&nbsp;hint&nbsp;»), pas une contrainte — la spécification WebGL
ne garantit PAS que le navigateur l'honore. Sur Windows avec une configuration GPU hybride
(intégré + dédié), le choix final du GPU peut être **verrouillé au niveau du système d'exploitation**
via *Paramètres Windows → Système → Affichage → Graphismes*, qui permet d'assigner un GPU **par
exécutable** (ex. `msedge.exe`, `chrome.exe`) : si ce réglage impose « Économie d'énergie » (GPU
intégré) pour le navigateur, **AUCUN indice émis depuis la page ne peut le contourner** — le pilote
graphique/le système décide en amont du navigateur lui-même. Les valeurs GPU 0/1 rigoureusement
identiques avant/après le correctif (alors que celui-ci est confirmé actif dans le bundle) sont la
signature typique de ce verrouillage côté OS plutôt que d'un bug applicatif.

**➡️ Procédure Windows définitive (à effectuer par le joueur, hors de portée du code de
l'application)** :
1. Ouvrir *Paramètres Windows → Système → Affichage → Graphismes* (ou rechercher « Paramètres
   graphiques » dans le menu Démarrer).
2. Sous « Choisissez une application à personnaliser », sélectionner « Application de bureau »,
   parcourir jusqu'à l'exécutable du navigateur utilisé (ex.
   `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`), l'ajouter.
3. Cliquer sur « Options », choisir **« Performances élevées »** (et non « Économie d'énergie » ni
   « Laisser Windows décider »), Enregistrer.
4. Fermer **complètement** le navigateur (toutes les fenêtres, y compris celles en arrière-plan
   dans la barre des tâches) puis le rouvrir — le changement ne s'applique qu'aux nouveaux
   processus navigateur.
5. Revérifier le Gestionnaire des tâches (onglet Performance) en rejouant : le rendu devrait
   désormais basculer sur le GPU dédié (utilisation qui augmente sur GPU 1, diminue sur GPU 0).

**Compléments apportés côté code** (aucun ne peut se substituer à la procédure Windows ci-dessus si
le verrouillage OS est en cause, mais réduisent le coût réel de rendu quel que soit le GPU utilisé,
et corrigent un vrai gaspillage indépendant du choix de GPU) :
- **Rendu totalement suspendu quand l'onglet n'est pas au premier plan** — nouveau
  `frameloop={documentVisible ? 'always' : 'never'}` sur le `<Canvas>`, piloté par l'évènement
  natif `visibilitychange` (`document.visibilityState`). Auparavant, R3F continuait d'appeler le
  rendu à chaque `requestAnimationFrame` restant même onglet masqué (le throttling natif du
  navigateur réduit la cadence mais ne l'annule pas forcément à zéro) ; ceci l'arrête
  complètement, sans jamais démonter le `<Canvas>` (reprise instantanée et sans à-coup au retour au
  premier plan — vérifié par test Playwright : 21&nbsp;666-21&nbsp;791 appels `drawElements`/s
  onglet visible, **0** onglet masqué simulé, ~21&nbsp;666/s après reprise, aucune erreur, rendu
  visuel identique après reprise).
- **`platform3dAntialiasEnabled`** (nouveau réglage Administration, défaut `true`) — permet de
  désactiver l'anticrénelage MSAA (deuxième réglage le plus coûteux en GPU après les ombres) en
  dépannage supplémentaire sur une machine encore limitée après la procédure Windows ci-dessus.

**Non-régression** : `npx tsc --noEmit` et `npm run build` : 0 erreur. Le nouveau réglage
`platform3dAntialiasEnabled` conserve le comportement par défaut strictement identique à avant
(anticrénelage activé). Le rendu en onglet visible (le cas d'usage normal de jeu) n'est absolument
pas affecté par le nouveau contrôle `frameloop` — celui-ci ne fait la différence QUE lorsque
l'onglet est masqué, un état dans lequel le joueur ne peut de toute façon pas voir/jouer la scène.

### ⚡ Suite 2 : GPU 0 toujours à 100% après la procédure Windows — vérification du réglage + investigation du commit d'origine du signalement

**Nouveau signalement** (captures d'écran à l'appui) : après avoir suivi la procédure Windows
ci-dessus et redémarré complètement le navigateur, le GPU 0 (Intel UHD) reste affiché à ~97% dans le
Gestionnaire des tâches. Le joueur précise n'avoir vu apparaître ce symptôme qu'à partir du commit
`2ee6e47` (boussole N/E/S/O).

**⚠️ Constat important sur la capture d'écran fournie** : la capture des *Paramètres Windows →
Système → Affichage → Graphismes* jointe au signalement montre, pour l'entrée
`Microsoft Edge — msedge.exe`, une **« Préférence GPU » toujours réglée sur « Économie d'énergie
(Intel(R) UHD Graphics) »**, et non « Performances élevées ». Ceci reste donc la cause la PLUS
PROBABLE et la plus actionnable du symptôme rapporté (elle correspond exactement au motif GPU 0 ≈
97-100% / GPU 1 ≈ 8-9% observé de façon constante) : **le réglage n'a probablement pas été
enregistré comme « Performances élevées »**, ou une réinitialisation Windows/mise à jour du pilote
graphique l'a fait revenir à sa valeur par défaut, ou un exécutable Edge différent (canal Beta/Dev/
Canary, ou une deuxième installation) a été modifié par erreur. **Action recommandée avant toute
autre piste** : rouvrir ce même écran, cliquer sur la ligne « Préférence GPU » sous `msedge.exe`,
choisir explicitement « **Performances élevées** » dans le menu déroulant (pas seulement l'ouvrir),
puis fermer complètement puis rouvrir le navigateur.

**Investigation du code au commit `2ee6e47`** (comme demandé, sans rien modifier qui puisse altérer
la fluidité ou la stratégie de jeu) : revue complète du diff de ce commit à la recherche d'un coût de
rendu réellement nouveau et continu.
- La rotation Y de `SynkVoxel` devenue impérative (`groundRef.current.rotation.y = ...` dans
  `useFrame`, à chaque frame) n'introduit **rien de nouveau** : le suivi du relief
  (`groundRef.current.position.y = ...`) modifiait déjà la même transformation à chaque frame
  *avant* ce commit — la charge de recalcul de matrice pour cet objet était donc déjà continue.
- Le minuteur d'inactivité (`setInterval(..., 500)`) est un simple minuteur JS, coût négligeable,
  aucun rendu ni recalcul 3D associé.
- **Élément réellement nouveau et potentiellement significatif** : ce commit introduit le **premier
  et unique `backdrop-blur-sm`** (flou de fond CSS) de tout le fichier `Platform3DWidget.tsx`, sur le
  disque de la boussole — un effet posé en permanence **au-dessus du `<canvas>` WebGL qui rend en
  continu**. Un `backdrop-filter` forcé de ré-échantillonner/flouter une zone qui change à chaque
  frame est un coût de compositing bien documenté sur Chromium (« SaveLayer + blur + composite » à
  chaque frame), et frappe particulièrement les GPU intégrés faibles en compositing. Un test de
  performance Playwright (trace CDP `Tracing.start`/`Tracing.end`, catégories
  `disabled-by-default-devtools.timeline`) comparant le temps `GPUTask`/`CompositeLayers` avec et
  sans la classe n'a montré **aucune différence mesurable** dans cet environnement (le rendu GPU y
  est logiciel/`SwiftShader` en mode headless, ce qui ne reflète pas fidèlement un vrai pilote Intel
  UHD) — l'hypothèse reste donc plausible mais NON confirmée en laboratoire, uniquement par
  raisonnement sur le comportement connu de Chromium.

**Correctif appliqué** (purement cosmétique, zéro risque de régression gameplay/fluidité) : le
`backdrop-blur-sm` du disque de la boussole est retiré et remplacé par un fond opaque légèrement plus
sombre (`bg-slate-900/80` au lieu de `bg-slate-900/60` + flou) — conserve l'esprit « translucide »
sans exécuter de flou, ne peut qu'alléger la charge de compositing, jamais l'alourdir. Vérifié par
Playwright (capture d'écran : disque toujours lisible, aiguille N/E/S/O toujours visible ; 0 erreur
console) + `npx tsc --noEmit` et `npm run build` : 0 erreur.

**Conclusion honnête pour le joueur concerné** : le correctif `powerPreference`/`stencil`/
`frameloop`/`antialias` est confirmé actif en production à chaque étape ; **la cause la plus probable
du symptôme persistant reste le réglage Windows « Préférence GPU » de `msedge.exe`, qui n'affiche pas
« Performances élevées » sur la capture fournie** — à revérifier/re-sélectionner explicitement avant
toute autre hypothèse. Le retrait du flou de la boussole est un allègement complémentaire, sûr et
sans régression, mais ne remplace pas la vérification du réglage Windows ci-dessus.

## 🗺️ Mapmonde : déplacement des PNJ saccadé + filtre d'affichage par entité

**Symptôme signalé** : « dans le widget de la Mapmonde, le déplacement des PNJ (loup-garou, hibou,
chevalier, familiers, dragon rouge, pêcheur Vaimoana) semblent saccader », avec demande d'un filtre
d'affichage spécifique à chacune de ces six entités.

**Cause racine n°1 (saccade/téléportation)** : `lib/roamingActors.ts` fait avancer tous les acteurs
errants par un `setInterval` unique (`stepMs`, défaut 1500ms — voir `getRoamStepMs()`). Les 3 widgets
interpolent visuellement la position entre deux ticks pour éviter un saut brut — mais dans
`WorldMapWidget.tsx`, le bloc de rendu fusionnant `generalFamiliarLiveMarkers` (TOUS les
familiers/dragons errants du catalogue, hors PNJ/Dragon « historiques ») avec les marqueurs
catalogue statiques **n'avait AUCUNE transition CSS** (`transition-all`/`transitionDuration`
absents) : ces marqueurs se **téléportaient instantanément** à chaque tick, d'où la saccade — ce qui
couvre directement le cas « dragon rouge » et tout autre familier errant (`GameCanvas2D.tsx`, lui,
avait déjà cette transition sur l'équivalent de ce bloc : aucune régression à corriger de ce côté).

**Cause racine n°2 (secondaire, plus subtile)** : le bloc `liveActorMarkers` (PNJ/Dragon « historiques »,
faune, PNJ de rencontre persistés, PNJ en approche) disposait déjà d'une transition CSS, mais avec la
courbe d'accélération par défaut (`ease`) plutôt qu'une vitesse constante — un à-coup qui se répète à
chaque tick de 1,5s peut se percevoir comme un « saccadement » rythmique.

**Correctifs** :
- **`lib/roamingActors.ts`** : nouvelle fonction exportée `getRoamTransitionMs()` — retourne
  `Math.round(stepMs * 0.92)` (minimum 200ms). Utilisée UNIQUEMENT comme durée de transition CSS
  (jamais comme base de calcul des ticks eux-mêmes, qui continuent de se produire exactement toutes
  les `getRoamStepMs()` ms — zéro impact sur la logique de jeu/IA de déplacement). Le but : une
  transition qui dure légèrement MOINS longtemps que l'intervalle réel entre deux ticks, pour
  qu'elle soit toujours terminée avant l'arrivée de la position suivante, même en cas de léger
  retard du `setInterval` JS sous-jacent (jitter inévitable sous charge, avec de nombreux minuteurs
  concurrents dans cette application) — élimine un artefact de type « gel puis saut sec ».
- **`WorldMapWidget.tsx`** : le bloc `generalFamiliarLiveMarkers` est désormais rendu séparément
  (plus fusionné avec les marqueurs catalogue statiques) avec `transition-all` +
  `transitionDuration: ${getRoamTransitionMs()}ms` + `transitionTimingFunction: 'linear'`. Le bloc
  `liveActorMarkers` reprend la même durée/courbe (au lieu de `getRoamStepMs()`/courbe par défaut).
  Les marqueurs catalogue réellement statiques (décors, trésors, quêtes…) ne reçoivent PAS de
  transition (leur position ne change jamais, aucun changement de comportement pour eux).

**Nouveau filtre d'affichage « par entité »** (`lib/mapFilters.ts`, `WorldMapWidget.tsx`,
`gameState.ts`, bouton 🎭⚙️ à côté de 🔧 dans la barre de filtres) — répond à « un filtre
spécifique pour chacun : loup-garou, hibou, chevalier, familiers, dragon rouge, pêcheur Vaimoana » :
- **`MapFilterState`** (`lib/mapFilters.ts`) gagne 5 champs (tous rétrocompatibles, défaut
  identique au comportement historique) : `showWildlifeOwl`/`showWildlifeWerewolf`/
  `showWildlifeBoar` (sous-filtres par espèce de faune, actifs uniquement si `showWildlife` l'est
  déjà), `hiddenEntityIds: string[]` (identifiants catalogue — PNJ/familiers nommés masqués
  individuellement) et `hiddenNpcArchetypes: string[]` (clés d'archétype de rencontre masquées,
  ex. `"chevalier"`).
- **`gameState.ts::MapMarker`** gagne 2 champs optionnels : `wildlifeKind` (espèce de faune, pour le
  filtre fin) et `catalogId` (VRAIE identité catalogue d'un marqueur synthétique « en direct » —
  les marqueurs `roaming.npc.live`/`roaming.dragon.live` gardent leur `id` synthétique historique,
  indispensable à `isLiveActorMarkerId()` pour l'exemption du filtre « intelligent », mais portent
  désormais aussi leur vraie identité catalogue via `catalogId` pour le filtrage individuel).
- **`markerMatchesFilters()`** (`lib/mapFilters.ts`) applique ces nouveaux filtres pour `kind ===
  'npc' | 'familiar'` : masque si `catalogId ?? id` figure dans `hiddenEntityIds`, ou si la clé
  d'archétype extraite de `i18nKey` (nouvelle fonction exportée `extractArchetypeKey()`, format
  `npc.archetype.<clé>`) figure dans `hiddenNpcArchetypes`.
- **`WorldMapWidget.tsx`** : nouveau panneau (disclosure, state `entityFilterOpen`) listant — 100%
  dynamique/évolutif, aucune entité codée en dur : (1) les 3 sous-filtres de faune ; (2) la liste
  des PNJ/familiers *actuellement* en vadrouille (PNJ/Dragon « historiques » + tous les familiers
  errants du catalogue), identifiés par leur vraie identité catalogue — couvre directement « dragon
  rouge »/« pêcheur Vaimoana » dès qu'ils sont tirés comme acteur errant ; (3) la liste de TOUS les
  archétypes de rencontre possibles (`NpcEncounterPopup.tsx::ARCHETYPES`, désormais exporté), y
  compris ceux jamais encore croisés dans la session — couvre « chevalier » et les ~14 autres,
  pré-filtrables avant même une première rencontre.

**Vérification Playwright** (session démo anonyme, widget Mapmonde ouvert via le dock d'icônes) :
- Échantillonnage des styles inline des marqueurs familiers : `transitionDuration: "1380ms"`
  (= 1500 × 0,92, confirme `getRoamTransitionMs()`) et `transitionTimingFunction: "linear"` bien
  appliqués — confirme la fin de la téléportation instantanée.
- Panneau 🎭⚙️ : présence confirmée de « Hibou », « Loup-garou », « Chevalier », et de tous les
  familiers/dragons actuellement errants (ex. « Dragon Rouge », « Dragon Blanc »…) et des ~14
  archétypes de rencontre.
- Bascule du filtre « Hibou » : nombre d'éléments `🦉` dans le DOM passe de 22 → 7 (masqué) → 22
  (réaffiché), confirmant un filtrage réel et non cosmétique.
- Bascule du bouton « Chevalier » : changement de classe CSS actif/inactif confirmé (bouton visuel
  cohérent avec l'état du filtre).
- 0 erreur console relevée pendant tout le scénario. `npx tsc --noEmit` et `npm run build` : 0
  erreur.

**Non-régression** : les filtres historiques (`showNpcs`/`showFamiliars`/`showWildlife`/etc.),
le filtre « intelligent » (`declutter`), le gel de proximité, l'anneau clignotant et les libellés
toujours visibles des acteurs « en direct » sont strictement inchangés — les nouveaux champs
`MapFilterState` sont tous rétrocompatibles (fusion `{ ...DEFAULT_MAP_FILTERS, ...JSON.parse(raw) }`
déjà en place pour le localStorage existant). `GameCanvas2D.tsx`/`Platform3DWidget.tsx` non modifiés
(périmètre explicitement limité à la Mapmonde par la demande utilisateur ; `GameCanvas2D.tsx`
n'avait pas le bug de transition manquante et continue de fonctionner à l'identique).


## 🪦 Cimetières, cryptes, morts-vivants & souterrains explorables en 3D

**Demande utilisateur** : ajouter 2 cimetières, ~20 cryptes et ~20 tombes en 3D dispersés sur la
Mapmonde/Plateforme 3D/Plateforme 2D (icônes + filtres dédiés, paramétrables en Administration) ;
faire émerger des tombes des zombies/goules/squelettes considérés comme de nouveaux PNJ à part
entière (déplacement, interactions) ; chaque crypte ouvre sur un souterrain immersif en 3D (torches
vacillantes, chauves-souris, ~20 dalles de couloir) menant à l'une de 3 salles d'arrivée (sommet de
tour de donjon, chambre meublée, ou salle avec un parchemin interactif lisible + narré en voix de
synthèse + ramassable dans la besace, indice de passage secret).

**Modèle de données** (`lib/gameState.ts`) :
- `MapPoiType` gagne `'cemetery' | 'crypt' | 'tomb'`, `MapMarker.wildlifeKind` gagne
  `'zombie' | 'ghoul' | 'skeleton'`, `InventoryItem.category` gagne `'parchment'`.
- `DEFAULT_CEMETERY_POIS` (2), `DEFAULT_CRYPT_POIS` (20), `DEFAULT_TOMB_POIS` (20) : coordonnées
  fixes (même format que `DEFAULT_LAKE_POIS`), fusionnées dans `getAllMapMarkers()` sous la garde
  `RepRules.graveyardEnabled` (même schéma que `defaultLakesEnabled`).
- Nouveaux champs `RepRules` (Administration → section « 🪦 Cimetières & morts-vivants ») :
  `graveyardEnabled`, `undeadEnabled`, `undeadZombieCount`/`undeadGhoulCount`/`undeadSkeletonCount`
  (effectifs par espèce), `cryptTunnelLength` (nombre de dalles, défaut 20),
  `cryptTorchFlickerEnabled`, `cryptBatCount`.
- `markParchmentTaken(address, cryptId)` / `getTakenParchmentIds(address)` /
  `subscribeTakenParchmentIds(address, cb)` : état de ramassage du parchemin PAR JOUEUR (chemin
  Firebase `players/{KEY(address)}/parchments/{cryptId}`), pour que le parchemin ne réapparaisse
  plus sur la table une fois pris par CE joueur, sans affecter les autres joueurs.

**Filtres** (`lib/mapFilters.ts`, `WorldMapWidget.tsx`, `GameCanvas2D.tsx`) : 3 nouvelles catégories
top-niveau (⚰️ Cimetières, 🏛️ Cryptes, 🪦 Tombes) dans `MAP_FILTER_CATEGORIES`, et 3 nouveaux
sous-filtres par espèce de mort-vivant (🧟 Zombies, 👹 Goules, 💀 Squelettes) dans le panneau
« par entité » (🎭⚙️), aux côtés des sous-filtres de faune existants (hibou/loup-garou/sanglier).
`isLiveActorMarkerId()` exempte les préfixes `zombie-`/`ghoul-`/`skeleton-` du filtre « intelligent »
(declutter), comme pour la faune existante.

**Rendu 3D** (`components/Platform3DWidget.tsx::MarkerBlock`, `Platform3DAmbientScene.tsx`) :
- Cimetière : enclos de pierre + 4 pierres tombales à croix. Crypte : mausolée avec archway sombre
  cliquable + colonnes + décor crâne. Tombe : pierre tombale + tertre de terre + `TombSlab` (une
  animation locale one-shot de dalle qui se soulève/pivote, non synchronisée à l'apparition réelle
  des morts-vivants — simplification documentée en commentaire).
- `Zombie3D`/`Ghoul3D`/`Skeleton3D` (nouveaux composants voxel, démarches distinctes : lent/raide
  bras tendus, accroupi/erratique à 4 pattes avec griffes, rigide/saccadé avec cage thoracique) —
  spawnés et déplacés par `lib/roamingActors.ts::ensureWildlifeSpawns()` (paramètres
  `zombieCount`/`ghoulCount`/`skeletonCount` ajoutés en fin de signature), chaque individu étant
  initialement ancré près d'une `DEFAULT_TOMB_POIS[i % length]` (avec repli anti-chevauchement sur
  obstacle). Aucun son d'ambiance dédié (scope volontairement limité, voir `lib/audio.ts` inchangé).
- `worldTerrain.ts::OBSTACLE_POI_TYPES` inclut `cemetery`/`crypt`/`tomb` : les PNJ/faune/familiers
  contournent ces structures comme château/hutte/village (réutilise l'évitement d'obstacles déjà en
  place, voir section « Évitement intelligent des obstacles » plus haut).

**Souterrain de crypte** (`components/CryptTunnelScene.tsx`, nouveau fichier) : vue à la première
personne (pas de modèle Synk visible, pour éviter un couplage circulaire avec `SynkVoxel`), montée
EN REMPLACEMENT de `<Scene>`/`<Platform3DAmbientScene>` dans le même `<Canvas>` de
`Platform3DWidget.tsx` (même principe que `UnderwaterScene` pour la plongée totale), tant que l'état
local `cryptMode` (id de la crypte active) est non nul :
- Le "monde" défile devant une caméra fixe (même philosophie que `Scene()::tiles`) : chaque dalle
  `i` est bâtie à `z = -i·TILE_SIZE`, un groupe racine est translaté selon `displayedProgress`
  (lerp doux vers l'entier `progress`, lui-même piloté par le parent via 2 boutons dédiés HORS
  `<Canvas>`, « ▲ Avancer »/« ▼ Reculer »/« 🚪 Sortir » — AUCUNE réutilisation du dpad/clavier
  existant, pour ne prendre aucun risque sur la navigation déjà en place). Le dpad/la boussole/le
  HUD de marche habituels sont masqués pendant ce mode (mêmes conditions `!cryptMode` que pour
  `!underwaterMode`).
- `Torch` (lumière ponctuelle vacillante + flamme conique, toutes les 3 dalles des deux côtés,
  désactivable via `cryptTorchFlickerEnabled`), `TunnelBat` (vol circulaire + battement d'ailes,
  effectif réglable via `cryptBatCount`).
- `cryptDestinationRoomFor(cryptId)` choisit déterministement (hash de l'id) l'une de 3 salles
  d'arrivée au bout du couloir : `TowerRoom` (plateforme ouverte + créneaux, vue dégagée), `BedroomRoom`
  (lit/table de chevet/armoire), `ParchmentRoom` (table/chaises + parchemin 3D cliquable).
- Le parchemin (`ParchmentRoom`) disparaît si `parchmentTaken` (lu depuis
  `subscribeTakenParchmentIds`) ; son clic ouvre `components/ParchmentPopup.tsx` (nouveau fichier)
  qui affiche un des 6 textes d'indice (`crypt.parchment.clue1..6`, sélection déterministe par
  crypte via le même hash que `cryptDestinationRoomFor`), les lit à voix haute via
  `window.speechSynthesis` (langue de synthèse dérivée de la locale active), et propose
  Prendre/Laisser — « Prendre » appelle `addToInventory` (catégorie `parchment`) PUIS
  `markParchmentTaken`.

**Pop-up d'interaction** (`components/PoiInteractionModal.tsx`) : nouveau composant `CryptBody`,
affiché pour `marker.poiType === 'crypt'` — propose un bouton « 🚪 Entrer dans la crypte »
uniquement si `onRequestEnterCrypt` est fourni (câblé uniquement par `Platform3DWidget.tsx` — la
Plateforme 2D isométrique et la Mapmonde affichent un simple message indiquant que l'entrée du
souterrain n'est possible qu'en Plateforme 3D, cette dernière étant seule capable d'un rendu de
couloir en 3D immersif).

**i18n** : toutes les nouvelles chaînes (filtres, pop-ups, HUD du souterrain, panneau Administration,
6 textes de parchemin, entrée de changelog) traduites dans les 5 langues (fr/en/es/pt/us) — noms
propres des 2 cimetières/20 cryptes/20 tombes volontairement laissés en français dans toutes les
langues (même convention que `DEFAULT_LAKE_POIS`, non traduits non plus).

**Vérification** : `npx tsc --noEmit` et `npm run build` : 0 erreur. Vérification Playwright (session
Démo anonyme) : les 3 nouveaux filtres de catégorie (Cimetières/Cryptes/Tombes) et les 3 nouveaux
sous-filtres de faune (Zombies/Goules/Squelettes) sont bien présents et traduits dans le panneau
Mapmonde ; le widget Plateforme 3D s'ouvre sans erreur console, boussole/HUD/dpad inchangés (aucune
régression) ; une structure sombre (crypte) a été visuellement repérée en marchant vers des
coordonnées proches d'une crypte par défaut (confirmant le rendu `MarkerBlock` + l'évitement
d'obstacles pour la faune alentour). 0 erreur console relevée sur l'ensemble du scénario.

**Simplifications assumées** (documentées ici pour transparence, vu l'ampleur de la demande) :
- Un seul interrupteur `graveyardEnabled` pour l'ensemble cimetières/cryptes/tombes (plutôt que 3
  interrupteurs séparés) + effectifs de morts-vivants par espèce (plutôt que par tombe individuelle).
- Vue de souterrain à la première personne, sans modèle Synk visible (plus immersif pour un couloir
  étroit, évite un couplage circulaire de composants).
- Animation d'ouverture de dalle de tombe purement locale/cosmétique, non synchronisée à l'instant
  réel d'apparition du mort-vivant correspondant.
- 6 textes de parchemin génériques (sélection déterministe par crypte) plutôt que 20 textes uniques.
- Aucun son d'ambiance dédié aux morts-vivants (zombies/goules/squelettes restent silencieux).

## 🕯️ Raffinement du souterrain de crypte : virages, escaliers, porte, caméra verrouillée & isolation du clavier

**Demande utilisateur** : le souterrain (section précédente) était trop simpliste — couloir
rectiligne trop court/sombre, hint HUD hors-sujet affiché à l'intérieur, possibilité de pivoter la
caméra en vue immersive, flèches haut/bas du clavier faisant AUSSI bouger Synk dans le monde réel
(déclenchant à tort le pop-up « Profondeur »), pas d'escalier/porte/salle d'arrivée différenciés, et
cimetière/crypte/tombes jugés trop petits sans croix. Entièrement réécrit dans
`components/CryptTunnelScene.tsx` (remplace l'ancienne approche « monde qui défile devant une
caméra fixe » par un modèle **chemin à virages**) et `components/Platform3DWidget.tsx` :

- **`computeTunnelPath(cryptId)`** : génère déterministement (seed = hash de l'id) une liste de
  `Pose` (position + cap en radians, non enroulé) pour les 40 dalles du couloir (`cryptTunnelLength`,
  paramétrable Administration, 20→40 par défaut) puis les `CRYPT_STAIR_STEPS=6` marches d'escalier
  (montée en Y) jusqu'à une position de porte puis de salle. Des virages de ±90° surviennent tous les
  7 à 11 dalles (jamais dans les 2 premières/dernières avant l'escalier). Convention Three.js
  vérifiée : `dirFor(heading) = (-sin(heading), 0, -cos(heading))`, donc `group.rotation.y = heading`
  oriente naturellement la géométrie locale (torches, chauve-souris, murs) de chaque dalle sans
  transformation manuelle en coordonnées monde.
- **`CryptCamera`** : positionne/oriente la caméra de façon impérative à chaque frame (`useFrame`)
  en interpolant entre les `Pose` successives selon la progression — AUCUNE rotation libre n'est
  possible tant que `doorOpened` est faux (le `<OrbitControls>` n'est monté, à l'intérieur même de
  ce fichier, QUE lorsque `doorOpened === true`, c.-à-d. uniquement dans les salles d'arrivée ;
  retiré du parent `Platform3DWidget.tsx` qui le montait auparavant pour tout le mode crypte).
- **`CryptDoor`** : porte cliquable (garde anti-glissement pointerdown/pointerup, seuil 6 px, même
  motif que le pattern glisser-déposer déjà en place ailleurs), utilisée à la fois en bout de
  couloir (entrée) et dans chaque salle (porte de retour) — toutes deux appellent `onToggleDoor`.
- **Éclairage** : intensité/portée des torches augmentées (1.1→1.7 / 4.5→6.5), lumière ambiante
  0.12→0.32, ajout d'une `hemisphereLight` — souterrain plus visible tout en restant « ténébreux ».
- **Suppression du hint HUD** `game.platform3d.hint` (« Flèches/WASD, clic... ») pendant `cryptMode`
  (gated `!cryptMode`, inchangé en dehors du souterrain).
- **Clavier isolé du monde réel (correctif du bug « Profondeur »)** : l'ancien `useEffect` de
  déplacement clavier du monde extérieur ne se désactivait pas en mode crypte — une flèche pressée
  dans le souterrain faisait AUSSI avancer le vrai Synk dehors (pouvant le faire marcher sur une
  dalle d'eau, déclenchant à tort `EnvStatusPopupLayer` → pop-up « Profondeur »). Corrigé en ajoutant
  `cryptMode` à la condition de sortie anticipée (et aux dépendances) de cet effet. Un **second
  `useEffect` entièrement séparé**, actif uniquement `if (cryptMode)`, gère désormais Flèche Haut/Z/W
  et Flèche Bas/S pour `cryptProgress` sans jamais toucher à la position réelle de Synk — les deux
  mondes (souterrain et extérieur) sont ainsi isolés dans leurs événements, Synk ne reprenant sa
  position/orientation réelles (mise à jour) qu'à la ressortie du souterrain.
- **Escalier → porte → salle** : au bout des 40 dalles, 6 marches montent en Y jusqu'à une porte;
  un clic l'ouvre (son de porte) et révèle l'une de 3 salles (`TowerRoom`/`BedroomRoom`/
  `ParchmentRoom`, choix déterministe inchangé) avec vue libre (`OrbitControls`). Une seconde porte
  dans la salle permet de refermer (`onToggleDoor`) et de redescendre l'escalier en sens inverse par
  Flèche Bas, pour ressortir de la crypte comme avant.
- **HUD contextuel** : le titre/compteur bascule entre phase couloir (`X / 40`), phase escalier
  (`crypt.stairsTitle`, `X / 6`), indice de porte atteinte (`crypt.doorHint` : « Cliquez sur la
  porte pour l'ouvrir ») et phase salle (`crypt.roomTitle`). Le bouton « ▲ Avancer » se désactive une
  fois la porte ouverte ou en fin de parcours ; « ▼ Reculer » devient « 🚪 Refermer la porte »
  (`crypt.closeDoor`) une fois dans la salle.
- **Caméra sauvegardée/restaurée à l'entrée/sortie** : `preCryptCameraRef` capture
  `cameraRef.current.position/quaternion` juste AVANT de basculer `cryptMode` (pendant que
  `CameraBridge` est encore monté) ; le bouton « 🚪 Sortir » restaure ces valeurs sur la caméra
  persistante du `<Canvas>` avant de quitter le mode crypte, pour un retour sans saut de vue.
- **Cimetière/crypte/tombes agrandis + croix** : pierres tombales (~1.35×) et mausolée de crypte
  (~1.3×) agrandis dans `MarkerBlock`, avec une croix ajoutée au-dessus de chaque élément (crypte,
  cimetière, tombe) pour plus de crédibilité visuelle.
- **Son de porte** : `doorCreak` ajouté à `AUDIO_SOURCE_KEYS`/`DEFAULT_AUDIO_SETTINGS`
  (`lib/gameState.ts`), synthétisé dans `lib/audio.ts::playSynth()`, joué via
  `playAmbientSound('doorCreak', ...)` à l'entrée en crypte ; icône 🚪 et libellé traduit ajoutés
  dans `AudioWidget.tsx` et `AudioAdminPanel.tsx` (panneau Administration).

**i18n** : 4 nouvelles clés (`game.platform3d.crypt.stairsTitle/roomTitle/doorHint/closeDoor`)
traduites dans les 5 langues (fr/en/es/pt/us).

## Correctif caméra de sortie de crypte (angle de vue sensible à la direction)

**Symptôme** : à la sortie complète d'un souterrain (crypte), la caméra se retrouvait parfois
collée à l'arrière du bâtiment de la crypte, ou sur un écran noir/très rapproché du casque de Synk,
au lieu de la vue reculée attendue (Synk visible de dos/trois-quarts, bâtiment de la crypte
derrière lui, dégagé).

**Cause racine** : l'ancienne constante `CRYPT_EXIT_CAMERA_POS` (`Platform3DWidget.tsx`) était un
décalage **caméra fixe en coordonnées monde**, qui ne fonctionnait correctement QUE lorsque la
direction de sortie de Synk (`OPPOSITE_DIRECTION[preCryptFacingRef.current]`) valait `'down'` — car
la convention du jeu associe l'angle 0 (`'down'`) au vecteur de visage `(0,0,1)`, qui correspond
justement à la position fixe `(0, 3.2, 5.6)` de l'ancienne caméra. Dès que le joueur était entré
dans la crypte depuis une autre direction (la plupart des cas), la direction de sortie différait de
`'down'`, et la caméra fixe se retrouvait alors **du même côté que le bâtiment** (donc derrière
Synk par rapport à sa nouvelle orientation), provoquant le collage/écran noir observé.

**Correctif** (`Platform3DWidget.tsx`) : remplacement de `CRYPT_EXIT_CAMERA_POS` par une fonction
`cryptExitCameraPosFor(direction: SynkDirection)` qui calcule
`[sin(FACING_ANGLE[direction]) * CRYPT_EXIT_CAMERA_RADIUS, CRYPT_EXIT_CAMERA_HEIGHT,
cos(FACING_ANGLE[direction]) * CRYPT_EXIT_CAMERA_RADIUS]` — réutilisant la même table
`FACING_ANGLE` et les mêmes magnitudes hauteur/rayon (3.2 / 5.6) que l'ancienne constante, mais
généralisées aux 8 directions au lieu d'une seule. `exitCrypt()` calcule désormais `exitFacing`
**une seule fois** puis l'utilise à la fois pour `cryptExitCameraPosFor(exitFacing)` (position/
lookAt de la caméra) et `setFacing(exitFacing)` (orientation de Synk) — les deux étaient auparavant
calculés de façon quelque peu redondante/indépendante, source potentielle d'incohérence.

**Non en cause** (pistes explorées puis écartées après analyse) : le batching React 18 (les mises à
jour d'état d'un `onClick` R3F natif restent batchées comme tout autre callback), la fraîcheur de
`CameraBridge` (l'instance de caméra du `<Canvas>` persiste à travers les bascules de scène), et le
remontage de `<OrbitControls>` de Drei (reconstruit `target`/offset à neuf à chaque montage, sans
report d'un état obsolète).

## Familier caché "Dragon Vert" (surprise, une seule chambre de crypte)

Suite à la demande utilisateur d'ajouter une surprise cachée dans la table de chevet d'**une seule**
chambre de crypte (sans aucune indication en jeu sur laquelle), un familier **Dragon Vert** est
désormais ramassable gratuitement (aucune XP ni objet requis, contrairement au circuit standard
`tameFamiliar`) dans la chambre de `HIDDEN_DRAGON_CRYPT_ID = 'default_crypt_1'`
(`CryptTunnelScene.tsx`) — sur les 20 cryptes fixes (`DEFAULT_CRYPT_POIS`), 7 mènent à une chambre
(`cryptDestinationRoomFor` : ids 1, 4, 7, 11, 14, 17, 20), et `default_crypt_1` a été choisie comme
l'unique emplacement de cette surprise.

- **`lib/gameState.ts`** : `HIDDEN_DRAGON_FAMILIAR_ID = 'dragon.green.hidden'` (id volontairement
  distinct de tout familier dragon du catalogue admin) + 3 fonctions : `isHiddenDragonFamiliarTaken`/
  `subscribeHiddenDragonFamiliarTaken` (lecture/abonnement à `players/{addr}/familiars/{key}`, même
  principe que `getTakenParchmentIds`/`subscribeTakenParchmentIds`) et `claimHiddenDragonFamiliar`
  (octroi direct et idempotent, SANS vérification XP/objet — contrairement à `tameFamiliar` — qui
  écrit à la fois une fiche catalogue `FamiliarDef` minimale sous `catalog/familiars/{key}`, afin que
  le familier s'affiche correctement partout avec nom/icône sans configuration admin préalable, et
  l'enregistrement de possession du joueur). Réutilise la clé i18n déjà existante
  `familiar.dragon_green` (nom déjà traduit dans les 5 langues pour les dragons verts du catalogue
  admin).
- **`CryptTunnelScene.tsx`** : constante `HIDDEN_DRAGON_CRYPT_ID`; `BedroomRoom` reçoit 2 nouvelles
  props optionnelles `hiddenDragonAvailable`/`onHiddenDragonClick` qui rendent la table de chevet
  cliquable — **sans aucun changement visuel** (même géométrie/couleurs que toute autre chambre),
  afin qu'aucune chambre ne se distingue visuellement de celle contenant la surprise.
  `CryptTunnelScene` transmet `onHiddenDragonClick` tel quel à `BedroomRoom`.
- **`HiddenFamiliarPopup.tsx`** (nouveau) : pop-up de ramassage, même structure que
  `ParchmentPopup.tsx` (portail plein écran, clic extérieur = fermer sans ramasser) mais sans
  synthèse vocale, appelant `claimHiddenDragonFamiliar` au clic sur « Adopter ».
- **`Platform3DWidget.tsx`** : état `hiddenDragonTaken` (abonné via `subscribeHiddenDragonFamiliarTaken`)
  et `hiddenFamiliarPopupOpen`; `onHiddenDragonClick` n'est fourni à `<CryptTunnelScene>` QUE si
  `cryptMode === HIDDEN_DRAGON_CRYPT_ID && !hiddenDragonTaken` (sinon `undefined`, la table de
  chevet redevient un meuble inerte une fois le familier ramassé, ou dans toute autre chambre).

**i18n** : 4 nouvelles clés (`crypt.hiddenFamiliar.title/body/take/leave`) traduites dans les 5
langues (fr/en/es/pt/us); réutilise `familiar.dragon_green` existant pour le nom du familier.


**Vérification** : `npx tsc --noEmit` et `npm run build` : 0 erreur. Script autonome dédié validant
`computeTunnelPath` (5 `cryptId` différents) : nombre de poses correct, aucun `NaN`, deltas de cap
toujours 0 ou exactement ±90°, distances conformes à `TILE_SIZE`/`STAIR_DEPTH`, Y constant dans le
couloir puis croissant de façon monotone dans l'escalier — tout conforme. Vérification Playwright
de bout en bout (session Démo anonyme, navigation précise via l'attribut de débogage
`data-synk-pos` exposé par le widget réduit) : entrée en crypte (titre « Souterrain de la crypte »,
compteur `0 / 40`, hint absent) ; tentative de glisser-déposer pour pivoter la caméra SANS AUCUN
effet (caméra verrouillée confirmée) ; progression au clavier jusqu'à l'escalier (`Escalier de la
crypte`, `6 / 6`, hint « Cliquez sur la porte pour l'ouvrir ») ; clic sur la porte → salle
(« Au-delà de la porte », bouton « Refermer la porte ») avec glisser-déposer fonctionnel cette fois
(vue libre confirmée) ; fermeture de la porte puis sortie → HUD/boussole/dpad/hint extérieurs
restaurés à l'identique, caméra sans saut visible. **Aucun pop-up « Profondeur » observé à aucun
moment du scénario** (bug corrigé confirmé) ; position réelle de Synk dans le monde extérieur
strictement inchangée pendant toute la traversée du souterrain (confirmant l'isolation du clavier) ;
0 erreur console relevée sur l'ensemble du scénario.

## 🚫 Synk peut traverser les PNJ/familiers (et eux Synk) + téléportation par clic à désactiver

**Demande utilisateur** : « je peux traverser ce perso et lui également peut me traverser » +
« je ne dois pas pouvoir déplacer ou téléporter Synk [...] avec un clic gauche de la souris [...]
ça serait trop facile ».

- **`lib/roamingActors.ts::isWorldPosBlockedByLivingActor(x, y, allMarkers, actors)`** (nouvelle
  fonction exportée) : jusqu'ici, l'évitement de collision (`isTileBlockedByOtherActor`,
  `isBlockedBySynkProximity`) ne servait QU'à faire éviter les acteurs errants entre eux ou à les
  figer à l'approche de Synk — jamais à bloquer le déplacement de SYNK LUI-MÊME, qui pouvait donc
  toujours traverser n'importe quel PNJ/familier (errant ou encore statique dans son village).
  Cette fonction unique, appelée par les DEUX widgets de déplacement (voir ci-dessous), combine :
  les marqueurs catalogue `npc`/`familiar` pas encore incarnés par un acteur errant, et tous les
  acteurs errants vivants (PNJ, dragon, familiers, faune, rencontres persistées), avec le même rayon
  `ACTOR_COLLISION_RADIUS` que l'évitement mutuel déjà en place — comportement symétrique : ni Synk
  ni un PNJ/familier ne peuvent plus se chevaucher, quel que soit le sens du déplacement.
- **`Platform3DWidget.tsx::move()` / `GameCanvas2D.tsx::move()`** : appellent désormais
  `isWorldPosBlockedByLivingActor` avant d'accepter un déplacement candidat, au même niveau que les
  vérifications d'obstacle terrain existantes (eau/montagne/props) — un mouvement qui finirait sur
  un PNJ/familier est simplement refusé (Synk reste immobile face à lui), sans glissement latéral
  ni téléportation.
- **Téléportation par clic désactivée** dans les 3 widgets (`Platform3DWidget.tsx`,
  `GameCanvas2D.tsx`, `WorldMapWidget.tsx`) : les gestionnaires `onCanvasClick`/`moveSynkTo` (et
  équivalents) qui déplaçaient instantanément Synk à l'endroit cliqué — y compris, bug associé, à
  l'intérieur même d'un décor solide (crypte/maison/château) — ont été entièrement retirés. Seuls
  restent inchangés : le pavé directionnel/clavier (déplacement pas-à-pas normal) et les boutons de
  voyage rapide dédiés de la Mapmonde (`onClickWorld`/`instantTravel`/`onConfirmWalk`, mécanisme
  distinct et volontaire, non concerné par la demande). Le style `cursor-crosshair` qui laissait
  croire que cliquer déplaçait Synk a été retiré de la Mapmonde.

**Vérification** : `npx tsc --noEmit` : 0 erreur. Playwright (session Démo anonyme, Plateforme 3D) :
3 clics gauche sur des zones variées du canvas (gauche/centre/bord) → scène et HUD strictement
identiques avant/après (aucun déplacement), puis un appui-maintien sur le pavé directionnel « Bas »
déplace bien Synk normalement (message de garde-fou « île/Engin requis » déclenché en heurtant une
étendue d'eau — confirmant à la fois que le déplacement volontaire fonctionne et que l'évitement
d'obstacle pour Synk lui-même reste actif) — 0 erreur console.

## 🕯️🏰 Virage à la souris dans le souterrain, tableaux muraux, sommet de donjon explorable & caméra de sortie

**Demande utilisateur (suite du raffinement de crypte)** : couloir en mode tunnel figé avec
possibilité de regarder à 90°/180° par clic (sans jamais pouvoir pivoter librement), tableaux/
portraits accrochés aux murs, torches supplémentaires dans l'escalier et autour de la porte du
donjon, et surtout un **sommet de donjon traversable** (la salle `TowerRoom`, jusqu'ici une simple
vue figée) où Synk réapparaît comme dans le monde réel, peut se déplacer tout autour de la colonne
centrale, observer le plateau de jeu en contrebas façon caméra d'épaule, et ressortir par une porte
dans la colonne pour revenir au souterrain — plus un correctif de la caméra (trop proche de la
tête/casque de Synk) à la sortie de crypte.

- **`turnOffset` (0-3, quart de tour)** : nouvel état `cryptTurn` dans `Platform3DWidget.tsx`, 2
  boutons ↺/↻ dédiés (masqués une fois `cryptDoorOpened`, pour ne pas polluer la vue libre de la
  salle) qui l'incrémentent/décrémentent modulo 4. Transmis en prop à `CryptCamera` (dans
  `CryptTunnelScene.tsx`) qui l'ajoute simplement au cap de la `Pose` courante — la caméra reste
  verrouillée sur le chemin (aucune rotation libre à la souris), mais regarde dans la direction
  choisie par clic, par incréments de 90°. Les boutons « ▲ Avancer »/« ▼ Reculer » et les flèches
  Haut/Bas du clavier tiennent compte de `cryptTurn` (`advanceDir = cryptTurn === 2 ? -1 : 1`) —
  en clair : après un demi-tour (180°), « Avancer » fait progresser `cryptProgress` dans le sens
  opposé, pour que Synk marche TOUJOURS en avant dans la direction où il regarde, jamais en
  reculant à l'écran — corrige au passage le défaut « on ressort du souterrain en marche arrière ».
- **Tableaux muraux (`Painting`, `PaintingKind`)** : un tableau toutes les ~4 dalles (en sautant les
  dalles à torche), alternant les deux murs, cycle déterministe (par crypte) entre 4 motifs
  (tête de monstre, dragon, zombie, portrait énigmatique) — purement décoratif, posé en relief sur
  le mur via `TunnelSegment`.
- **Torches supplémentaires** : escalier (`StairStep` reçoit `torch={i % 2 === 0}`, une marche sur
  deux) et 2 torches flanquant la porte d'entrée du souterrain — en plus des torches de couloir déjà
  en place (réutilise le composant `Torch`, désormais exporté par `CryptTunnelScene.tsx`).
- **Sommet de donjon explorable (`TowerTopScene`, nouveau, dans `Platform3DWidget.tsx`)** : remplace
  la vue figée précédente de `TowerRoom` quand `cryptDestinationRoomFor(cryptId) === 'tower'`
  ET que la porte de la salle est ouverte (`towerTopActive`). Modélisée sur le même principe que
  `UnderwaterScene` (monde de substitution monté dans le même `<Canvas>`) :
  - Plateforme circulaire crénelée, colonne centrale avec une `<CryptDoor>` réutilisée telle quelle
    (câblée sur le même `onToggleDoor`/`setCryptDoorOpened` que la porte de l'escalier — la refermer
    renvoie directement au souterrain, aux marches, sans nouvel état à gérer) ;
  - `SynkVoxel` réapparaît ici visible (contrairement au couloir à la première personne) avec une
    caméra « chase-cam » en retrait (traveling qui suit Synk), pour la perspective de hauteur demandée
    (« voir Synk comme dans le monde réel », « caméra qui bouge avec lui en mode traveling ») ;
    corrige du même coup la caméra « au ras du casque » à la sortie du souterrain (voir plus bas) ;
  - `moveTowerTop()` : déplacement en anneau borné par `TOWER_INNER_RADIUS`(2.0)/
    `TOWER_OUTER_RADIUS`(6.4) autour de la colonne — plutôt qu'un blocage brutal aux limites, la
    position candidate est projetée radialement sur le cercle limite (glissement le long du mur/de
    la colonne, jamais de saut ni de blocage sec) ;
  - « mini-carte aérienne » construite à partir d'une version réduite des `sceneMarkers` existants
    (arbres/huttes/PNJ/faune) pour donner la perspective en hauteur demandée sur le plateau de jeu
    en contrebas, sans dupliquer de `<Scene>`/`<OrbitControls>` imbriqués ;
  - dpad/clavier normaux réactivés dans ce mode (gate `(!cryptMode || towerTopActive)` sur les deux
    effets clavier existants, et sur l'affichage du dpad), la pile de boutons Avancer/Reculer/Sortir
    du couloir est masquée ici (collision d'emplacement à l'écran avec le dpad) et remplacée par un
    petit bouton « 🚪 Sortir » de secours en bas à droite.
- **Caméra de sortie trop proche (correctif)** : nouvelle constante `EXIT_MIN_CAMERA_DISTANCE = 4` ;
  la logique du bouton « 🚪 Sortir » (facteurisée dans une fonction `exitSynk` partagée) calcule la
  distance entre la position caméra sauvegardée avant l'entrée en crypte et `CAMERA_TARGET` — si elle
  est inférieure au seuil (cas d'une caméra restée collée à la tête de Synk), on retombe sur la pose
  par défaut `[0, 3.2, 5.6]` + `lookAt` au lieu de restaurer une vue trop rapprochée.

**Portée** : ces 7 cryptes (sur les 20 par défaut) dont le hash de `cryptDestinationRoomFor` tombe
sur `'tower'` (`default_crypt_3/6/9/10/13/16/19`) mènent TOUTES désormais à un sommet de donjon
explorable — pas un donjon unique câblé en dur — conformément à « tu feras cela pour tous les
châteaux/tourelles/donjons du jeu ».

**i18n** : `game.platform3d.crypt.turnLeft`/`turnRight` ajoutées aux 5 langues (fr/en/es/pt/us).

**Vérification** : `npx tsc --noEmit` : 0 erreur sur l'ensemble du projet. Playwright (session Démo
anonyme) : réutilisation confirmée du bypass de connexion `zc.effectiveSession`, ouverture de la
Plateforme 3D et de la Mapmonde sans erreur console, confirmation que le pavé directionnel déplace
réellement Synk dans le monde (voir section précédente) et que le clic ne téléporte plus. **Limite
assumée et signalée en toute transparence** : le parcours complet jusqu'à l'entrée d'une crypte de
type « tour » (distante de plusieurs dizaines de cases du point d'apparition par défaut, sans
commande de téléportation disponible — désormais désactivée par design) n'a pas pu être rejoué de
bout en bout en direct dans le temps imparti à cette session de vérification ; le code du virage à
la souris, des tableaux/torches et du sommet de donjon repose sur la réutilisation directe de
composants déjà validés en conditions réelles lors du raffinement précédent (`CryptCamera`,
`CryptDoor`, `Torch`, le modèle `UnderwaterScene`), une vérification de type stricte (0 erreur) et
une relecture de code ligne à ligne ; une revérification Playwright ciblée est recommandée dès
qu'un moyen de navigation plus rapide (ex. compte de test positionné près d'une crypte en base)
sera disponible.

## 🏯 Vraies proportions du donjon, vue aérienne réaliste depuis la tourelle, portraits originaux & salles éclairées+Synk visible (suite)

**Demande utilisateur** : remplacer les 4 tableaux muraux génériques du souterrain par des copies
de 12 images jointes (rendus de skins/dragons/sorcier/aventurier) ; donner de « vraies proportions »
au donjon (« pas juste un simple tube fin ») et faire en sorte que la vue depuis le sommet de la
tourelle montre le VRAI plateau de jeu en détail (dalles, PNJ, eau, huttes) plutôt qu'une maquette
simplifiée ; ajouter des torches scintillantes + rendre Synk visible (même traitement que le sommet
du donjon, commit `c10c95e`) dans les salles d'arrivée « chambre » et « table au parchemin ».

**⚠️ À propos des 12 images jointes — non reproduites littéralement** : ces images sont très
probablement des rendus de skins/œuvres tierces protégés par le droit d'auteur (style
NameMC/PlanetMinecraft). Conformément à la politique anti-contrefaçon de cet environnement, elles
n'ont **pas** été copiées pixel pour pixel dans le jeu. À la place, **6 nouveaux archétypes de
portraits 100% originaux** ont été créés en primitives Three.js (même esprit que les 4 kinds
précédents — cadre + toile + silhouette, aucune texture/image externe), reprenant les THÈMES des
images (dragon orangé à cornes, dragon ailé sombre, sorcier encapuchonné, rôdeur/archer, chevalier
casqué, créature bestiale menaçante) sans en copier le contenu visuel exact.

### 1. Portraits muraux — 6 nouveaux archétypes (`CryptTunnelScene.tsx::Painting`/`PaintingKind`)

- `PaintingKind` passe de `'monster' | 'dragon' | 'zombie' | 'weird'` à `'dragonOrange' |
  'dragonWinged' | 'sorcerer' | 'ranger' | 'knight' | 'beast'` — remplace entièrement l'ancien jeu
  de 4 motifs (aucune rétrocompatibilité nécessaire : purement cosmétique, dérivé déterministement
  de `cryptId`/l'index de dalle, jamais persisté en base).
- Chaque archétype ajoute une silhouette/accessoire distinctif superposé au "visage" commun
  (cercle + 2 yeux + bouche) : cornes (dragons), ailes membraneuses (dragon ailé), chapeau conique
  (sorcier), capuche + arc (rôdeur), visière + cimier rouge (chevalier), défenses (bête).
- `paintingByIndex` (cycle déterministe par crypte) mis à jour pour piocher dans ces 6 nouveaux
  motifs au lieu des 4 précédents — même logique de placement (tous les ~4 dalles, jamais sur une
  dalle à torche, alternance de mur).

### 2. Donjon à vraies proportions — tours jumelles (`Platform3DWidget.tsx::PropBlock`, kind `'castle'`)

Remplace l'ancienne silhouette (un socle carré + UNE SEULE tourelle fine centrale) — jugée trop
frêle (« un simple tube fin ») — par un donjon à **deux tours jumelles épaisses**, chacune avec :
- sa propre couronne de créneaux (8 merlons disposés en cercle en haut de chaque tour) ;
- son propre toit conique sombre (bordeaux `#4a1420`) ;
- sa propre poterne (porche d'entrée) sur la façade.
Le tout posé sur un socle commun élargi (`[2.4, 1.6, 1.5]` au lieu de `[1.5, 1.8, 1.5]`) avec ses
propres créneaux de base (8 merlons). **Aucun changement** à l'enveloppe externe (`position`/
`scale`/`onClick` du groupe racine, `CASTLE_SCALE=[1.2,2.0,1.2]` de l'enveloppe interne) : la
collision (1 dalle = 1 obstacle), le clic, et le placement sur la mapmonde restent strictement
identiques — seule la géométrie décorative change. Hauteur finale inchangée dans son ordre de
grandeur (~7,5 unités au lieu de ~6,6, soit ~7x Synk au lieu de ~6,2x).

### 3. Vraie vue aérienne détaillée depuis le sommet du donjon (`Platform3DWidget.tsx::TowerTopScene`)

L'ancienne « mini-carte aérienne » (silhouettes de `sceneMarkers` réduites à de simples cubes
colorés par catégorie — arbre/montagne/eau/PNJ) est remplacée par un **rendu RÉEL** de la grille de
dalles environnante, réduit et projeté en contrebas sous la plateforme du donjon :
- `TowerTopScene` reçoit désormais les mêmes props que `Scene()` pour reconstruire la grille réelle :
  `centerCol`/`centerRow`/`poiPoints` (position du joueur + points d'intérêt) et les réglages
  cosmétiques `objectFlags`/`fireBreathEnabled`/`fireBreathIntervalSec`/`wildlifeAudio`/
  `owlHootEnabled`/`werewolfHowlEnabled` (mêmes valeurs que celles déjà passées à `<Scene>` par le
  composant parent, voir site d'appel `<Canvas>`).
- En interne, un `useMemo` réplique EXACTEMENT le calcul de `tiles` de `Scene()` (même usage de
  `VIEW_RADIUS`/`worldTileAt`/`clamp100`/`WORLD_SIZE`, même garde-fou anti-duplication en bordure de
  carte) puis rend chaque dalle avec les VRAIS composants `TerrainBlock`/`PropBlock` (donc le
  donjon à tours jumelles ci-dessus, les huttes, l'eau, les arbres... apparaissent à l'identique,
  juste miniaturisés) et chaque PNJ/familier avec le vrai `MarkerBlock`, le tout dans un groupe
  mis à l'échelle (`AERIAL_SCALE=0.42`) et abaissé (`AERIAL_Y=14` unités sous la plateforme).
- Tous les clics sur cette grille miniature sont des no-op (`AERIAL_NOOP`) : purement contemplatif,
  comme annoncé par le commentaire déjà présent avant ce correctif (« donne la perspective de
  hauteur sans dupliquer la scène principale ») — **aucun second `<Scene>`/`<OrbitControls>`
  monté**, seulement une réutilisation directe des briques de rendu déjà existantes.

### 4. Torches + Synk visible dans les salles « chambre » et « table au parchemin »

- `BedroomRoom`/`ParchmentRoom` (`CryptTunnelScene.tsx`) reçoivent un nouveau prop
  `torchFlickerEnabled` et posent désormais 2 `<Torch>` scintillantes aux angles du fond de la
  pièce (même composant que le reste du souterrain) en remplacement de l'unique `pointLight`
  statique précédente (conservée, intensité réduite, en appoint).
- **Synk visible** : `CryptTunnelScene` accepte un nouveau prop optionnel `synkSlot?: ReactNode`,
  rendu dans la salle d'arrivée juste devant la porte de retour (à l'écart du lit/de la table/des
  chaises). Ce `ReactNode` (un `<SynkVoxel>` déjà configuré) est fourni par le composant PARENT
  (`Platform3DWidget.tsx`, où `SynkVoxel` est défini) plutôt qu'importé directement dans
  `CryptTunnelScene.tsx` — l'importer ici créerait une dépendance circulaire puisque
  `Platform3DWidget.tsx` importe déjà ce module. Actif uniquement quand la porte est ouverte et que
  la salle n'est pas `'tower'` (déjà traitée séparément par `TowerTopScene`, voir § 3 du
  correctif précédent).

**Vérification** : `npx tsc --noEmit` : 0 erreur. Playwright (session Démo anonyme, bypass
`zc.effectiveSession`) : ouverture du widget Plateforme 3D sans erreur console, déplacement réel de
Synk au pavé directionnel confirmé, nouvelle géométrie du donjon (tours jumelles + 2 porches)
rencontrée et rendue sans erreur en conditions réelles (un donjon a été atteint à pied et observé
sous plusieurs angles de caméra). **Limite assumée** : comme lors du raffinement précédent, le
parcours complet jusqu'à l'intérieur d'une crypte (couloir → salle chambre/parchemin/tour) reste
hors de portée d'une vérification Playwright en direct dans le temps imparti (distance au spawn,
téléportation désactivée par design) — la vue aérienne réaliste, les 6 nouveaux portraits et les
salles chambre/parchemin reposent sur une relecture de code ligne à ligne et la réutilisation
directe de briques (`TerrainBlock`/`PropBlock`/`MarkerBlock`/`Torch`/`SynkVoxel`) déjà validées en
conditions réelles ailleurs dans le jeu.

## 🕯️🚪 Salles chambre/parchemin : 4 torches, déplacement libre de Synk, suppression du bouton « Sortir » (sortie uniquement par la porte, à proximité)

Suite à la demande utilisateur : « Ajoutes deux lampes torches supplémentaires dans les pièces
chambres et pièces avec parchemins. Permet a Synk de se déplacer à l'aide des touches directionnelles
du clavier tout comme quand il est dans le vrai jeu ou sur la tourelle du donjon [...] il pourra
ressortir de la pièce en se mettant devant la porte et en cliquant gauche avec la souris dessus.
Enlève et désactive le bouton Sortir [...] Synk pourra sortir en cliquant avec le bouton gauche de
la souris sur la porte de la crypte [...] il faudra bien sûr pour cela qu'il soit à proximité de la
porte de sortie. »

### 1. Deux torches supplémentaires (4 au total) dans `BedroomRoom`/`ParchmentRoom`

`CryptTunnelScene.tsx` : les deux salles avaient déjà 2 `<Torch>` scintillantes aux angles du FOND
(`z=-1.7`, voir correctif précédent). Deux torches supplémentaires ont été ajoutées symétriquement
aux angles AVANT (`z=+1.7`), de part et d'autre du sol carré `[4,4]`, couvrant ainsi les 4 coins de
chaque pièce — aucun changement de géométrie des meubles (lit/table de chevet/armoire/table/chaises),
simple ajout additif.

### 2. Déplacement libre de Synk dans la salle (clavier/dpad), comme en haut du donjon

Jusqu'ici, une fois la porte franchie (`cryptDoorOpened`), Synk restait figé à une position fixe
(`[0,0,1.3]`) dans la salle d'arrivée ; seule la caméra (`<OrbitControls>`) pouvait orbiter librement
à la souris. Pour répondre à la demande (« permet a Synk de se déplacer [...] tout comme [...] sur
la tourelle du donjon [...] découvrir la pièce et rechercher [...] des objets »), le MÊME principe
que `moveTowerTop`/`towerPos` (Platform3DWidget.tsx) a été répliqué pour les salles chambre/parchemin :

- **`roomTopActive`** (nouveau, calculé comme `towerTopActive` mais pour `cryptRoomType ===
  'bedroom' | 'parchment'`) remplace le gate `towerTopActive` partout où le dpad/clavier doivent
  rester actifs : effet clavier général (flèches/WASD), visibilité du dpad flottant, et
  `dispatchMove` (nouvelle branche `if (roomTopActive) { moveRoom(dx, dy); return; }`).
- **`moveRoom`/`roomPos`** (nouveau, Platform3DWidget.tsx) : mini-monde borné indépendant de
  `worldPos`, exactement comme `moveTowerTop`/`towerPos`, mais la zone navigable est un
  **rectangle** (`ROOM_HALF_X=1.85` en x, `ROOM_MIN_Z=-1.85`/`ROOM_MAX_Z=2.05` en z) correspondant
  au sol carré `[4,4]` des deux salles, plutôt qu'un anneau autour d'une colonne. Réinitialisé à
  `[0, 1.3]` (devant la porte) à chaque nouvelle entrée dans une salle.
- `CryptTunnelScene` reçoit un nouveau prop `roomSynkPos?: {x,z}` qui **remplace** l'ancienne
  position fixe `[0,0,1.3]` du groupe englobant `synkSlot` — piloté par `roomPos` côté parent. Le
  `synkSlot` fourni par `Platform3DWidget.tsx` utilise désormais `facing`/`walking`/`running` RÉELS
  (état partagé avec tout le reste du jeu) plutôt que `facing="down"`/`walking={false}` figés.
- L'ancien effet clavier dédié au couloir (Haut/Bas ⇒ `cryptProgress`) est désormais également coupé
  dès que `roomTopActive` est vrai (comme il l'était déjà pour `towerTopActive`) : ses anciennes
  branches `cryptDoorOpened` (Haut ignoré, Bas referme la porte) deviennent du code mort pour les
  salles chambre/parchemin, remplacées par le déplacement libre ci-dessus.
- `<OrbitControls>` de la salle (`CryptTunnelScene.tsx`) autorise désormais le zoom
  (`enableZoom`, `minDistance=1.8`/`maxDistance=7`, auparavant désactivé) pour que le joueur puisse
  reculer la caméra et garder Synk dans le cadre où qu'il se déplace dans la pièce (`target` reste
  centré sur la salle, suffisant vu sa petite taille une fois le zoom arrière possible).

### 3. Sortie de la salle **uniquement** en cliquant sur la porte, à proximité

`CryptTunnelScene` scinde désormais la porte de retour (salle → escalier) en un nouveau prop
`onLeaveRoom?: () => void`, **distinct** de `onToggleDoor` (qui reste la porte d'ENTRÉE en haut de
l'escalier, inchangée). Côté parent :

```tsx
onLeaveRoom={() => {
  const d = Math.hypot(roomPos.x - ROOM_DOOR_LOCAL.x, roomPos.y - ROOM_DOOR_LOCAL.z);
  if (d <= ROOM_DOOR_PROXIMITY) setCryptDoorOpened(false);
}}
```

`ROOM_DOOR_LOCAL = {x:0, z:2.3}` correspond exactement à la position locale déjà utilisée pour la
porte (`TILE_SIZE * 1.15`) ; `ROOM_DOOR_PROXIMITY = 1.3` exige que Synk se tienne raisonnablement
près d'elle avant que le clic ne produise un effet — répond littéralement à la demande « il faudra
bien sûr pour cela qu'il soit à proximité de la porte de sortie », rendue nécessaire par l'ajout du
déplacement libre (impossible à exploiter auparavant, Synk étant toujours déjà "devant" la porte).

### 4. Suppression du bouton HUD « 🚪 Sortir » — nouvelle porte d'entrée/sortie complète du souterrain

Les deux boutons « 🚪 Sortir » (bas-gauche pour le couloir/escalier, bas-droite pour le sommet du
donjon) ont été **entièrement retirés**, ainsi que la fonction locale `exitSynk` qui les actionnait.
Le bloc de boutons « ▲ Avancer »/« ▼ Reculer » n'est désormais affiché que tant que la porte
d'arrivée n'est PAS franchie (`{!cryptDoorOpened && (...)`) — une fois dans une salle (tour, chambre
ou parchemin), seul le dpad/clavier (déplacement libre) reste actif.

La logique de sortie (anciennement dans `exitSynk`, restauration de la caméra extérieure via
`preCryptCameraRef`/`cameraRef`/`CAMERA_TARGET`/`EXIT_MIN_CAMERA_DISTANCE`) a été **remontée** en un
`useCallback` nommé `exitCrypt`, défini au niveau du composant (après `cameraRef`) pour être
réutilisable par la nouvelle porte d'entrée du souterrain :

```tsx
const ENTRANCE_EXIT_MAX_PROGRESS = 1;
const exitCrypt = useCallback(() => {
  if (cryptProgress > ENTRANCE_EXIT_MAX_PROGRESS) return; // garde-fou de proximité
  // ... restauration de la caméra extérieure (inchangé) ...
  setCryptMode(null);
  setCryptDoorOpened(false);
}, [cryptProgress]);
```

`CryptTunnelScene.tsx` ajoute une **nouvelle porte** (même composant `<CryptDoor>`, avec 2
`<Torch>`), posée directement à l'entrée du couloir (`poses[0]`), tournée à 180° (face à Synk
lorsqu'il a fait demi-tour via les boutons de quart de tour ↺/↻, seul moyen de la voir — la caméra du
couloir ne regarde jamais en arrière sans ce demi-tour, voir § Quart de tour). Son `onClick` est
câblé sur `onExitCrypt={exitCrypt}`, lui-même gardé par `ENTRANCE_EXIT_MAX_PROGRESS` côté parent :
cliquer dessus ne fait donc rien tant que Synk n'est pas revenu tout près de l'entrée
(`cryptProgress <= 1`).

**Parcours de sortie unifié pour les 3 types de salle** (tour/chambre/parchemin) : cliquer sur la
porte de la salle (`onLeaveRoom` pour chambre/parchemin, déjà existant `onToggleDoor` pour la tour,
inchangé — protégé par l'occlusion naturelle de la colonne centrale, voir § 3 du correctif
précédent) ramène dans l'escalier ; Synk redescend/retraverse le couloir (bouton « ▼ Reculer » ou
flèche Bas, en ayant fait demi-tour via ↺/↻ pour marcher en avant) jusqu'à `progress≈0`, où la
nouvelle porte d'entrée permet enfin de sortir entièrement du souterrain — **aucune régression** :
le mécanisme de restauration de caméra (`preCryptCameraRef`) et l'état `cryptMode`/`cryptDoorOpened`
sont identiques à l'ancien bouton « Sortir », seul le déclencheur change (clic sur une porte, à
proximité, plutôt qu'un bouton toujours disponible).

**Vérification** : `npx tsc --noEmit` : 0 erreur (vérifié après chaque lot d'édits). `npm run lint`
indisponible dans ce projet (ESLint non configuré, invite interactive de première config — aucune
régression introduite par ce constat, simple limite de l'outillage local). Playwright (session Démo
anonyme) : widget Plateforme 3D ouvert sans erreur console, dpad fonctionnel. **Limite assumée** :
atteindre physiquement l'intérieur d'une crypte (couloir → escalier → salle) depuis un spawn
éloigné sans téléportation reste hors de portée d'un scénario Playwright complet dans le temps
imparti ; la correction du déplacement en salle/de la porte d'entrée repose sur une relecture de
code ligne à ligne et la réutilisation directe du même mécanisme déjà validé pour `moveTowerTop`/
`towerPos` (tour du donjon, vérifié en conditions réelles lors du correctif précédent).

## 🛋️ Salles chambre/parchemin : meubles-obstacles escaladables, correctif du « replay » de sortie & caméra suiveuse verrouillée

Trois correctifs distincts demandés sur les salles d'arrivée (chambre/parchemin) et le sommet du
donjon, tous **localisés à `CryptTunnelScene.tsx`/`Platform3DWidget.tsx`** — le monde extérieur
(`Scene()`) et son couplage clavier/caméra historique (voir § « Déplacement de Synk en Plateforme
3D — architecture VERROUILLÉE ») restent intouchés.

### 1. Meubles-obstacles + escalade (lit/table de chevet/table grimpables, armoire/chaises solides)

Demande : « il ne faut [...] pas que je passe au travers des objets dans la pièce comme le lit ou
la table de chevet ou la table [...] Néanmoins, je peux grimper sur la table, le lit ou la table de
chevet (mais pas l'armoire) [...] à l'aide de la touche ESPACE et flêche haut du pavé directionnel
[...] comme dans le jeu réel en dehors du souterrain ».

`CryptTunnelScene.tsx` exporte désormais une structure de données dérivée **directement** des
coordonnées des meshes de meubles déjà existants dans `BedroomRoom`/`ParchmentRoom` (aucune
coordonnée inventée) :

```tsx
export interface RoomObstacle { x: number; z: number; halfX: number; halfZ: number; climbable: boolean; topY: number; }
export const BEDROOM_OBSTACLES: RoomObstacle[]; // lit (grimpable), table de chevet (grimpable), armoire (solide)
export const PARCHMENT_OBSTACLES: RoomObstacle[]; // table (grimpable), 2 chaises (solides)
```

Côté `Platform3DWidget.tsx`, `moveRoom` réutilise **exactement** la même mécanique que l'escalade
d'un rocher en extérieur (`jumpHeldRef`, rempli par la touche Espace ou le bouton tactile « Sauter »,
voir `move()`) :

- Un helper pur `isInsideRoomObstacle(x, z, obstacle, pad)` teste l'appartenance à l'empreinte d'un
  meuble, élargie de `SYNK_ROOM_COLLIDE_PAD` (0.22) pour englober l'encombrement de Synk.
- En entrant sur l'empreinte d'un meuble **non grimpable** (armoire, chaises) : mouvement bloqué net,
  comme un mur.
- En entrant sur l'empreinte d'un meuble **grimpable** (lit, table de chevet, table) sans Espace
  maintenu : également bloqué.
- Avec Espace maintenu : l'avancée est autorisée, déclenche le même `jumpTrigger` (arc de saut
  cosmétique déjà utilisé par `SynkVoxel`), et Synk se tient ensuite à la hauteur `topY` du meuble
  (nouveau champ `roomPos.standY`) tant qu'il reste sur son empreinte.
- `roomPos`/`roomPosRef` passent de `{x, y}` à `{x, y, standY}` ; `standY` est transmis **directement
  à la prop `standY` du `<SynkVoxel>`** rendu dans `synkSlot` (et non à un décalage de groupe dans
  `CryptTunnelScene.tsx`) afin de réutiliser le lissage d'élévation déjà existant (`groundYRef`,
  `useFrame` de `SynkVoxel`) — identique visuellement à l'escalade d'un rocher en extérieur, sans
  double décalage ni nouveau code d'animation.

### 2. Correctif du « replay » accéléré à la sortie d'une salle/du donjon

Demande : « il y a comme une version accéléré qui se rejoue de déplacement depuis la porte d'entrée
de la crypte jusqu'a la porte de la pèce, supprime ce playback ».

Cause racine : `CryptCamera` n'est monté QUE tant que `!doorOpened` (`{!doorOpened &&
<CryptCamera .../>}`). À chaque fermeture de porte (retour à la salle → couloir), une **toute
nouvelle instance** de `CryptCamera` était créée, avec `const displayedRef = useRef(0)` — son ref de
lissage caméra repartait donc TOUJOURS de 0, provoquant un lerp accéléré rejouant tout le couloir
depuis l'entrée jusqu'à la position réelle de `progress`, à chaque sortie de salle.

Correctif (une ligne) : `useRef(0)` → `useRef(progress)`. L'animation de glisse fluide pendant un
déplacement réel (Avancer/Reculer) est inchangée (`progress` varie toujours graduellement d'une
frame à l'autre) ; seul le faux rejeu complet du couloir à chaque remontage disparaît.

### 3. Caméra suiveuse au-dessus de Synk + verrouillage de rotation (anti-désynchronisation clavier)

Demande : « met en place une caméra qui suit Synk et se positionne au dessus de lui [...] fait en
sorte que les touches de direction reste les même car quand j'utilise la vue en perspective/caméra
à la souris [...] les directions au clavier [...] ne sont plus les mêmes ».

Cause racine : les touches de direction en salle/tour restent **volontairement** mappées en dur sur
les axes du MONDE (dx/dz), jamais relatives à la caméra (voir § architecture verrouillée extérieure
— 5 tentatives précédentes de direction relative-caméra avaient provoqué des boucles de rétroaction
avec une caméra qui se repositionnait elle-même selon la direction de déplacement). Tant que
`<OrbitControls>` autorisait la rotation libre à la souris (`enableRotate` par défaut `true`), faire
pivoter la caméra à la souris désynchronisait ce qui est visuellement « en haut/avant » à l'écran
par rapport au mapping clavier fixe sur le monde.

Correctifs distincts salle vs tour (différence **volontaire**, pas un oubli) :

- **Salles chambre/parchemin** (`CryptTunnelScene.tsx`) : nouveau composant `RoomFollowCamera({
  anchorRef, controlsRef })` — lit la position RÉELLE de Synk dans le MONDE via
  `anchorRef.current.getWorldPosition()` à chaque frame (plutôt qu'un recalcul trigonométrique
  manuel de `roomSynkPos` par la rotation `lastHeading` du groupe de la salle, source d'erreurs de
  signe), positionne la caméra « au-dessus et en retrait » au premier frame, puis pilote
  `controlsRef.current.target` en continu. `<OrbitControls enableRotate={false}>` : rotation
  **entièrement verrouillée** (seul le zoom reste actif) — aucune fonctionnalité de regard
  haut/bas n'a jamais été demandée dans ces salles, verrouillage total donc sans régression.
- **Sommet du donjon** (`Platform3DWidget.tsx::TowerTopScene`) : UNIQUEMENT l'azimut est verrouillé
  (`minAzimuthAngle={0}` / `maxAzimuthAngle={0}`), l'angle polaire (vertical) reste **libre** — car
  une demande précédente explicitement livrée demandait à Synk de pouvoir « lever comme baisser le
  regard » en haut du donjon ; verrouiller toute rotation aurait silencieusement supprimé cette
  fonctionnalité déjà livrée. Nouveau composant `TowerCameraInit({ target })` : positionne la
  caméra une seule fois au montage (azimut 0, cohérent avec le verrouillage), avant que le
  verrouillage ne prenne effet durablement.

**Vérification** : `npx tsc --noEmit -p tsconfig.json` : 0 erreur après l'ensemble des correctifs.
Playwright (session Démo anonyme) : page `/game` chargée, onboarding ignoré (bouton « Passer »),
widget Plateforme 3D ouvert — **0 erreur console** dans les trois cas. **Limite assumée** (identique
aux correctifs précédents sur ces salles) : atteindre une crypte/salle/sommet de donjon réel en jeu
depuis un spawn éloigné, sans téléportation par clic (désormais désactivée, voir § précédent), reste
hors de portée d'un scénario Playwright complet dans le temps imparti — la correction repose sur une
relecture de code ligne à ligne, la réutilisation directe de mécaniques déjà validées ailleurs
(escalade de rocher, `getWorldPosition`, azimut de `OrbitControls`), et la vérification TypeScript
stricte de l'ensemble des types/props modifiés.

## 🧭 Orientation de Synk à la sortie d'une salle/du donjon et de la crypte (ne plus faire face à la porte)

Demande : « quand je sors d'une pièce, donjon, il faudrait que Synk soit orienté vers la direction
de la sortie [...] face à l'escalier et non [...] face à la porte qu'il vient d'ouvrir [...] quand
il sort de la crypte [...] il faut que Synk soit face à la sortie et pas nez collé contre la porte
[...] il ne faut pas zoomer sur Synk mais le voir de la même manière que quand il est rentré dans la
crypte mais [...] à l'inverse de la porte [...] donner réellement l'impression qu'il sort de la
crypte et pas qu'il a l'intention à nouveau d'y rentrer ».

Deux correctifs distincts (même philosophie : **retourner l'orientation de 180° à la sortie**,
jamais modifier la logique de déplacement elle-même) :

### 1. Sortie d'une salle (chambre/parchemin) ou du sommet du donjon → retour au couloir/escalier

Réutilise **exactement** le mécanisme déjà existant de demi-tour manuel dans le couloir (`cryptTurn`
0 à 3 quarts de tour, boutons ↺/↻, voir § Virage à la souris dans le souterrain) : fermer la porte
de la salle (`onLeaveRoom`) ou celle du donjon (`onToggleDoor` de `TowerTopScene`, qui n'est QUE
jamais appelé en sortie puisque `towerTopActive` implique déjà `cryptDoorOpened===true`) appelle
désormais `setCryptTurn(2)` en plus de `setCryptDoorOpened(false)` — un demi-tour (180°)
**automatique**, qui faisait auparavant devoir être déclenché manuellement par le joueur avec les
boutons ↺/↻. `CryptCamera` applique `camera.rotation` directement (`heading + turnOffset * π/2`,
sans lissage sur l'angle, seulement sur la position) : le retournement est donc instantané dès la
fermeture de la porte, et « Avancer » (déjà basculé sur `advanceDir=-1` quand `cryptTurn===2`, voir
§ Quart de tour) fait immédiatement marcher Synk droit vers la sortie plutôt que vers le fond du
souterrain qu'il vient de quitter.

### 2. Sortie COMPLÈTE de la crypte (`exitCrypt`) → retour au monde extérieur

Deux problèmes corrigés simultanément :

- **Facing retourné à 180°** : nouvelle ref `preCryptFacingRef`, capturant `facing` au moment précis
  de `onRequestEnterCrypt` (direction vers laquelle Synk marchait pour atteindre la porte). Un
  nouveau dictionnaire `OPPOSITE_DIRECTION` (8 valeurs, simple inversion de paires haut/bas,
  gauche/droite, diagonales) retourne cette direction à l'exécution d'`exitCrypt` :
  `setFacing(OPPOSITE_DIRECTION[preCryptFacingRef.current])`. Aucun calcul d'angle flottant,
  toujours une des 8 directions valides de `FACING_ANGLE`.
- **Caméra qui zoomait sur le casque** : l'ancien mécanisme restaurait la caméra EXACTE sauvegardée
  juste avant l'entrée (`preCryptCameraRef`, avec un seuil `EXIT_MIN_CAMERA_DISTANCE` de repli vers
  une pose par défaut si jugée « trop proche ») — ce seuil s'est révélé insuffisant dans certains
  cas rapportés (le joueur zoome généralement de près pour cliquer précisément sur la petite porte
  d'entrée juste avant que cette caméra ne soit capturée). **Simplifié** : `exitCrypt` utilise
  désormais INCONDITIONNELLEMENT la pose par défaut `CRYPT_EXIT_CAMERA_POS = [0, 3.2, 5.6]`
  (identique à la vue d'ouverture du widget), quelle que soit la caméra avant l'entrée — élimine le
  problème à la racine plutôt que de le contourner par seuil. `preCryptCameraRef` (devenu inutile) a
  été retiré.

**Non-régression** : aucune des deux logiques de déplacement (`dispatchMove`/`move`/`moveRoom`/
`moveTowerTop`, répertoire MONDE FIXE) n'est touchée — seuls `facing`/`cryptTurn` (purement
cosmétiques, pilotant la rotation visuelle de la caméra/du modèle) sont modifiés, et uniquement au
moment précis d'une sortie (jamais pendant un déplacement normal). Le quart de tour manuel (↺/↻)
reste disponible et fonctionne identiquement à avant (le joueur peut toujours se retourner pour
regarder un tableau, par exemple) : le nouveau comportement ne fait qu'ÉVITER d'avoir à le déclencher
manuellement après une sortie.

**Vérification** : `npx tsc --noEmit -p tsconfig.json` : 0 erreur. Playwright (session Démo
anonyme) : page `/game`, onboarding ignoré, widget Plateforme 3D ouvert — 0 erreur console. **Limite
assumée** (identique aux correctifs précédents) : simuler un aller-retour complet jusqu'à une
crypte/salle réelle depuis un spawn éloigné reste hors de portée d'un scénario Playwright automatisé
dans le temps imparti ; la correction repose sur la réutilisation directe du mécanisme `cryptTurn`
déjà validé pour le demi-tour manuel, et sur une relecture de code ligne à ligne de `exitCrypt`/
`onLeaveRoom`/`onToggleDoor`.

## 🎥 Correctif DÉFINITIF de la caméra de sortie de souterrain (condition de course + garde par raycast)

Malgré PLUSIEURS correctifs précédents (pose fixe `CRYPT_EXIT_CAMERA_POS`, puis angle de caméra
sensible à la direction — voir les deux sections précédentes), le bug persistait à l'identique
(écran collé au décor/quasi noir) pour certaines directions de sortie. L'investigation approfondie
de cette itération a mis au jour la VRAIE cause racine, qui invalide les hypothèses précédentes.

**Cause racine n°1 — condition de course React/R3F** : `exitCrypt()` fixait
`cameraRef.current.position`/`.lookAt()` de façon SYNCHRONE, dans le même tick que
`setCryptMode(null)`. Mais `CryptTunnelScene.tsx::CryptCamera` (son propre `useFrame`, actif tant
que `!doorOpened` — donc systématiquement vrai à l'entrée du souterrain) ÉCRASAIT la position de la
caméra À CHAQUE frame tant que React n'avait pas réellement démonté `<CryptTunnelScene>`. Le
commit React (mise à jour du DOM/arbre R3F) n'étant pas synchronisé avec `requestAnimationFrame`,
au moins une frame supplémentaire pouvait s'écouler après l'appel à `exitCrypt()` pendant laquelle
`CryptCamera` reprenait la main et réécrivait la position manuelle — une vraie condition de course,
invisible en lecture de code statique.

**Correctif n°1** : `exitCrypt()` ne touche plus JAMAIS directement la caméra. Il stocke
`{angle, radius}` dans une ref (`pendingExitCameraRef`) et incrémente un compteur
(`exitCamRequestId`), consommés par un NOUVEAU composant `CryptExitCameraGuard` monté DANS
`<Canvas>`, uniquement dans la branche "monde extérieur" (à côté de `<CameraBridge>`). Comme ce
composant n'existe que lorsque `<CryptTunnelScene>` a RÉELLEMENT été démonté (même commit React,
ordre garanti : les effets de nettoyage du sous-arbre retiré s'exécutent avant les effets de montage
du nouveau sous-arbre), la course est structurellement impossible.

**Cause racine n°2 — clipping dans le décor** : même la course corrigée, une position de caméra à
rayon fixe (ou validée par une simple sonde de case `worldTileAt`/`isObstacleAt`) pouvait encore
visuellement s'enfoncer dans un arbre ou un autre élément de décor, car le rendu 3D d'un arbre
déborde largement de sa case d'ancrage — une sonde par hash de case est un indicateur insuffisant.

**Correctif n°2** : remplacement de la sonde par case par un VRAI test de visibilité
`THREE.Raycaster` (`CryptExitCameraGuard`, utilisant `useThree()`/`useFrame()`) : un rayon est lancé
depuis `CAMERA_TARGET` (Synk, `[0, 0.85, 0]`) vers la position de caméra candidate
(`raycaster.near = 0.6` pour ignorer la géométrie de Synk lui-même, `raycaster.far = distance - 0.3`
comme marge avant d'atteindre la caméra) ; si un maillage de la scène est touché, le rayon de la
caméra est augmenté de 1 (jusqu'à `+10` par rapport au rayon initial) et le test est rejoué — robuste
quel que soit l'emplacement du décor, car il teste la géométrie RÉELLEMENT rendue plutôt qu'une
heuristique par case.

**Non-régression** : la piste "le prop `camera` de `<Canvas>` réinitialise la caméra à chaque
rendu" a été explorée puis ÉCARTÉE après lecture du code source `@react-three/fiber` (comparaison
`shallowLoose` sur les valeurs, pas sur la référence — un littéral JSX constant ne redéclenche donc
jamais `applyProps` après le montage initial). Aucune des logiques de déplacement
(`dispatchMove`/`move`/`moveRoom`/`moveTowerTop`) n'est touchée.

**Vérification** : `npx tsc --noEmit -p tsconfig.json` : 0 erreur. Playwright (harnais de
reproduction temporaire, entièrement retiré après validation — voir
`web/src/lib/undergroundActive.ts` pour un exemple du registre partagé réutilisé ensuite) : les 4
directions cardinales de sortie (haut/bas/gauche/droite) produisent désormais une vue extérieure
dégagée, non collée au décor, avec Synk visible de dos/trois-quarts — conforme à la demande
utilisateur. Aucun fichier de scaffolding temporaire (`tmp-*.js`/`tmp-dbg-*.png`) n'a été laissé dans
le dépôt.

## 🤫 Suspension des pop-up de rencontre PNJ pendant l'exploration souterraine

Demande utilisateur : « désactive ou arrête d'afficher les pop-up de quêtes (combats, quêtes, troc,
discussion, etc...) quand je suis dans un souterrain ou que je rentre dans une crypte ou que je suis
dans une pièce (chambre, pièce avec parchemin) ou quand je suis en haut d'un Donjon [...] réactive le
pop-up une fois à l'extérieur [...] je ne rencontre pas de PNJ à l'intérieur du souterrain ».

**Problème** : le planificateur "battement de cœur" de rencontres PNJ aléatoires
(`NpcEncounterPopup.tsx`, `setInterval` 15s) ne connaît pas l'état interne (privé) de
`Platform3DWidget.tsx::cryptMode` (non-`null` dans les trois cas : couloir de crypte, salle
chambre/parchemin, sommet de donjon) — les deux composants n'ont jamais eu besoin de communiquer
jusqu'ici, aucun canal n'existait pour ce cas précis.

**Solution** : nouveau registre partagé à portée module `web/src/lib/undergroundActive.ts` (même
pattern, déjà éprouvé, que `platform3dActive.ts` utilisé pour l'arbitrage clavier 3D/2D — pas de
Context React nécessaire, les deux composants sont montés dans le même arbre `/game`) :
- `setUndergroundActive(v)` / `isUndergroundActive()` : lecture/écriture simple.
- `subscribeUndergroundActive(cb)` : notifie immédiatement à l'abonnement, puis à chaque
  changement (contrairement à un simple polling, permet une réaction immédiate).

`Platform3DWidget.tsx` appelle `setUndergroundActive(cryptMode !== null)` dans un `useEffect` calé
sur `cryptMode` (réinitialisé à `false` au démontage du widget, pour ne jamais laisser les
rencontres suspendues si le widget est replié en pleine exploration souterraine).

`NpcEncounterPopup.tsx` s'abonne via `subscribeUndergroundActive` : (a) le battement de cœur
(`tick()`) lit un ref `undergroundRef` (jamais en dépendance d'effet, même principe que
`currentRef`/`seasonRef` déjà en place) et ignore tout nouveau tirage tant que `true` — SANS
consommer le quota journalier ni avancer l'horodatage "prochain tirage", qui reste donc valable à la
sortie ; (b) dès que le registre bascule à `true`, toute rencontre déjà affichée (combat en cours,
dialogue, troc, quête en cours d'acceptation) est immédiatement fermée via `close()`.

**Non-régression** : aucune autre popup (`PoiInteractionModal`, interaction POI au clic) n'est
concernée — elle ne peut de toute façon pas se déclencher en vue souterraine puisque les marqueurs
POI du monde extérieur ne sont pas rendus dans `<CryptTunnelScene>`. Le widget "Lancer de dés"
(`DiceRollWidget`, grisé pendant un combat via `onCombatActiveChange`) n'est pas affecté : un combat
déjà en cours à l'instant où le joueur entre sous terre est fermé par `close()`, qui réinitialise
aussi `onCombatActiveChange?.(false)` (filet de sécurité déjà existant au démontage).

**Vérification** : `npx tsc --noEmit -p tsconfig.json` : 0 erreur. Playwright (session Démo anonyme,
page `/game`) : 0 erreur console après chargement. **Limite assumée** : la fenêtre de tirage
aléatoire des rencontres PNJ (1 à 25 minutes) rend impraticable un scénario Playwright automatisé
couvrant le tirage réel en conditions de production dans le temps imparti — la correction s'appuie
sur une relecture de code ligne à ligne du planificateur et la réutilisation d'un pattern de registre
partagé déjà validé en production (`platform3dActive.ts`).

## 🌀 Portes des étoiles verticales + console d'activation (XP, objet, animation de composition)

Demande utilisateur : « transforme tous les anneaux violets (portes des étoiles) en porte de étoiles
verticales affublés tout autour de l'anneau de signes cabalistiques [...] une seconde roue crantée
verticale à l'intérieur du 1er anneau [...] tu créeras à côté de l'anneau une console ou pupitre [...]
Synk devra l'actionner en se plaçant a côté et s'il possède l'expérience et un objet spécial [...] il
actionnera le mécanisme de la porte des étoiles qui fera tourner la roue crantée [...] alors que le
1er anneau restera [im]mobile, cette action sera une animation qui durera 10-15 secondes
(paramétrables dans le menu Administration) ».

**Avant** : les portails (dalle `kind === 'portal'` dans `PropBlock`, et marqueur monde `isWorld` dans
`MarkerBlock`) étaient de simples anneaux (`THREE.TorusGeometry`) posés à plat au sol, tournant et
flottant en continu (`useFrame` bob/spin partagé), et déclenchaient le voyage immédiatement au clic
sur l'anneau lui-même — aucune notion de coût, de condition, ni de mise en scène.

**Après — `StargatePortal` (nouveau composant partagé, `Platform3DWidget.tsx`)** :
- **Anneau extérieur FIXE** : tore vertical (orientation par défaut de `TorusGeometry`, donc *aucune*
  rotation appliquée — contrairement à l'ancien anneau à plat qui portait `rotation={[Math.PI/2,0,0]}`),
  portant 9 chevrons (cône métallique sombre + pointe sphérique rouge lumineuse, assez contrastés
  pour rester identifiables sur le fond mauve, cf. captures de test isolé) répartis uniformément —
  jamais animé, qu'une composition soit en cours ou non.
- **Anneau de glyphes INTÉRIEUR** : texture procédurale généré UNE SEULE FOIS pour tout le jeu
  (singleton module `getGlyphRingTexture()`, canvas 512×64 avec 16 glyphes Unicode à motif
  cabalistique en répétition `RepeatWrapping`) — ne tourne QUE pendant une activation
  (`useFrame` calcule `progress = (Date.now()-activationStartedAt)/activationDurationMs` et applique
  3 tours complets sur la durée), reste statique le reste du temps (plus de spin continu permanent,
  cohérent avec la consigne « le 1er anneau restera immobile » et avec l'historique de cette session
  sur la saturation GPU — un seul texture objet partagé par instance, zéro coût de génération
  supplémentaire par portail).
- **Horizon des événements** (disque central) : sa couleur s'interpole vers un cyan lumineux pendant
  la composition, puis refond vers le mauve sombre d'origine une fois terminée (confirmé visuellement
  sur le harnais de test isolé, captures avant/pendant/après composition).
- **Console/pupitre d'activation** : nouveau sous-groupe (pieds, deux poignées recourbées, cristal
  rouge pulsant) positionné à côté de l'anneau (`[radius+0.45, 0, radius*0.55]`) — SEUL élément
  cliquable du portail désormais (l'anneau/les chevrons/l'horizon absorbent le clic sans effet via
  `stopPropagation`, pour ne pas laisser le clic traverser vers le sol comme avant la désactivation
  de la téléportation par clic).

**Conditions d'activation (`requestStargateActivation`, `Platform3DWidget`)** : vérification
SYNCHRONE (XP déjà reçu en prop pré-calculée `playerXp`, inventaire déjà souscrit en state local —
pas d'appel asynchrone nécessaire) :
1. `playerXp < stargateXpRequired` (défaut 50) → bannière `stargate.feedback.xpMissing`.
2. Si `stargateRequiresItem` (défaut `true`) et l'objet `stargateRequiredItemId` (défaut
   `stargate_crystal`, nouvel objet trésor ajouté à `DEFAULT_SHOP`) absent de l'inventaire →
   bannière `stargate.feedback.itemMissing` (nom de l'objet résolu via `DEFAULT_SHOP`).
3. Sinon : démarre l'animation (`stargateActivationDurationSec`, défaut 12s, borné 10-15s côté
   Administration) ; **un seul portail peut composer à la fois dans tout le jeu** (clé
   `tile-${wc}-${wr}` ou `world-${marker.id}` mémorisée dans `stargateActivation.key`, toute nouvelle
   demande est ignorée tant qu'une composition est en cours, qu'il s'agisse du même portail ou d'un
   autre) — garantit que les AUTRES portails visibles à l'écran restent visuellement figés.
4. À la fin de l'animation (`onActivationComplete`), le callback de voyage d'origine
   (`onPortalTileClick`/`onMarkerClick`, inchangé) est invoqué via `setTimeout(cb, 0)`.

**Administration** : 4 nouveaux champs `RepRules` (`RepRulesPanel.tsx`, section « 🌀 Porte des
étoiles ») : `stargateActivationDurationSec`, `stargateXpRequired`, `stargateRequiresItem`
(case à cocher), `stargateRequiredItemId` — suit le pattern `mapFields` déjà en place pour les autres
sections du panneau.

**i18n** : 6 clés `admin.repRules.stargate*` (libellés/descriptions du panneau Administration) + 3
clés `stargate.feedback.*`/`stargate.activating` (bannières in-game), dans les 5 langues du jeu
(fr/en/es/pt/us).

**Non-régression** : le clic direct sur l'anneau/les chevrons est désormais un no-op volontaire — ne
change rien au comportement déjà en place pour les autres marqueurs/dalles (clic sur une case ou un
marqueur quelconque ne téléporte toujours pas Synk, cf. section précédente « téléportation par clic à
désactiver »). Les callbacks de voyage d'origine (`onPortalTileClick`, `onMarkerClick`) ne sont ni
renommés ni modifiés, seulement appelés plus tard (après la console + l'animation au lieu
d'immédiatement au clic sur l'anneau) — aucune régression sur la logique de téléportation
inter-mondes elle-même.

**Vérification** : `npx tsc --noEmit -p tsconfig.json` : 0 erreur. Harnais de test isolé temporaire
(`/stargate-test`, composant `StargatePortal` seul dans un `<Canvas>` nu + bouton « Activer », détruit
après usage) : confirme visuellement l'anneau vertical, les 9 chevrons, la texture de glyphes sur
l'anneau intérieur, la rotation pendant la composition (captures avant/pendant/après), et la console
avec son cristal. Playwright en jeu réel (`/game`, session Démo) : 0 erreur console, portail bien
rendu en anneau vertical dans le widget Plateforme 3D, aucune régression visible sur le reste de
l'interface (statistiques, alimentation, pavé directionnel).

## 🪙 Porte des étoiles infranchissable, couleur cuivre & popup XP/objet uniformisé

Demande utilisateur : « Fait en sorte que je ne puisse pas passer a travers la porte des étoiles ou
de la console/pupitre qui doivent être gérer comme un obstacle. D'ailleurs a l'avenir, tout nouveaux
objets que j'ajoute dans le jeu doit être considéré comme un obstacle. De plus, change la couleur de
l'anneau violet et met une couleur cuivre [...]. De plus, affiche le popup de cette manière et comme
tous les autres [...] et non pas un message comme cela [bandeau en pilule]. »

**1. Obstacle** : la porte des étoiles a DEUX formes de rendu distinctes selon son origine (voir
section précédente) — chacune a nécessité son propre correctif, sans dupliquer la logique de
collision 3 vues (2D/3D/mapmonde n'affecte que 2D+3D, la mapmonde ne gérant pas le déplacement de
Synk) :
- **Portail décoratif posé sur une dalle** (`tile.prop === 'portal'`, généré aléatoirement par
  `worldTileAt`) : couvert par le registre existant `Platform3DObjectFlags`
  (`gameState.ts::DEFAULT_PLATFORM3D_OBJECT_FLAGS['prop:portal']`), dont le défaut passe de
  `obstacle: false` à `obstacle: true` — la console (décalée de moins d'une demi-tuile par rapport à
  l'anneau, voir `TILE_SIZE=2`) reste dans l'emprise de la MÊME dalle et est donc couverte par le
  même blocage, sans changement supplémentaire.
- **Portail flottant inter-mondes** (`kind:'world'`, marqueur catalogue admin, PAS rattaché à une
  dalle de `worldTileAt`) : jusqu'ici AUCUN mécanisme ne le bloquait (seul
  `isWorldPosBlockedByLivingActor` existait, réservé aux PNJ/familiers/faune vivants). Nouvelle
  fonction jumelle `lib/roamingActors.ts::isWorldPosBlockedByStaticMarker(x, y, allMarkers)` :
  parcourt un ensemble `STATIC_OBSTACLE_MARKER_KINDS` (actuellement `{'world'}`, mais conçu comme
  point d'extension pour tout futur marqueur STATIQUE bloquant) et bloque dans le même rayon
  `ACTOR_COLLISION_RADIUS` (0,85, identique aux acteurs vivants) que l'anneau ET sa console. Appelée
  au MÊME point que `isWorldPosBlockedByLivingActor`, dans `Platform3DWidget.tsx::move()` ET
  `GameCanvas2D.tsx::move()` (parité 3D/2D déjà exigée pour cette famille de corrections).
- **Convention actée pour l'avenir** (commentaire ajouté sur `Platform3DObjectKind` dans
  `gameState.ts`) : tout nouveau type de décor/prop 3D doit désormais porter `obstacle: true` par
  défaut, sauf justification explicite documentée de laisser Synk le traverser.
- Vérifié par script `tsx` autonome (hors Playwright, fonctions pures sans dépendance React/Three) :
  `prop:portal` → `obstacle === true` ; `isWorldPosBlockedByStaticMarker` bloque à la position exacte
  du marqueur ET à proximité de l'offset console, ne bloque PAS à distance, et ne bloque PAS un
  marqueur `'npc'` (non-régression confirmée sur les acteurs vivants, logique inchangée).

**2. Couleur cuivre** : `PROP_COLOR.portal` passe de `#7c3aed` (mauve) à `#b5712b` (cuivre/bronze) ;
même couleur appliquée au portail flottant (`MarkerBlock::isWorld`, auparavant codée en dur
`#8b5cf6`) et au paramètre par défaut `color` de `StargatePortal`. L'horizon des événements (disque
central) passe du mauve sombre (`#1e1035`/`#4c1d95`) à un cuivre très sombre (`#120d05`/`#1c1206`) au
repos — le bleu cyan (`#38bdf8`) pendant la composition reste inchangé (fidèle au halo bleuté d'une
vraie porte des étoiles en fonctionnement). Vérifié visuellement sur un harnais de test isolé
temporaire (composant seul, détruit après usage).

**3. Popup uniformisé** : l'ancien bandeau en pilule (`fixed inset-x-0 bottom-6 [...] rounded-full`)
qui se superposait au pavé directionnel est remplacé par un popup centré strictement identique à
`PoiInteractionModal.tsx` (fond `bg-slate-900`, bordure `border-2 border-cyan-500 rounded-xl`,
en-tête icône+titre+croix de fermeture, corps du message, bouton `Fermer` pleine largeur) — rendu via
`createPortal(..., document.body)` comme les autres popups du jeu (`HiddenFamiliarPopup`,
`PoiInteractionModal`) pour un empilement (z-index) cohérent au-dessus du widget flottant. Ne se
ferme plus automatiquement après 4s (retiré) : reste affiché jusqu'à fermeture explicite (croix,
bouton Fermer, ou clic en dehors), comme toutes les autres popups de rencontre/verrouillage du jeu.
Nouvelle clé i18n `stargate.feedback.title` (titre fixe du popup, 5 langues) ; les clés
`stargate.feedback.xpMissing`/`itemMissing` existantes sont réutilisées telles quelles comme corps du
message.

**Non-régression** : aucun changement sur `requestStargateActivation`/`completeStargateActivation`
(conditions XP/objet, garde "une seule composition à la fois", callback de voyage) — uniquement la
PRÉSENTATION du message d'échec et le comportement de blocage physique de l'anneau/console. Le
bandeau de compte à rebours pendant une composition en cours (`stargateActivation`, position haute)
n'est pas concerné, conservé à l'identique. `npx tsc --noEmit` : 0 erreur. Playwright (`/game`,
session Démo) : 0 erreur console, anneau rendu en cuivre à l'écran, aucune régression visible sur le
reste de l'interface.

### 🔎 Correctif complémentaire : la bascule de code seule ne suffisait pas (donnée persistée en base)

Demande utilisateur (suite au correctif ci-dessus) : « il semblerait que je peux encore traverser
le portail et la console/pupitre [...] cette nouvelle porte des étoiles doit aussi être mise en
place pour tous les portails (portail posé au sol, portail flottant inter-mondes, ...) ».

**Cause racine identifiée** : `DEFAULT_PLATFORM3D_OBJECT_FLAGS['prop:portal'].obstacle` avait bien
été basculé à `true` dans le code (voir section précédente), mais `mergeRepRules()`
(`gameState.ts`) donne TOUJOURS priorité à la valeur **sauvegardée en base Firebase**
(`catalog/repRules/platform3dObjectFlags/prop:portal`) sur le défaut du code dès qu'une entrée y
existe déjà — comportement voulu pour un registre admin-paramétrable (un réglage explicite de
l'admin ne doit jamais être silencieusement écrasé par un futur défaut de code). Le panneau
Administration (`RepRulesPanel.tsx::save()`) réécrit l'intégralité de `platform3dObjectFlags` dès
qu'un admin clique une seule fois sur "Enregistrer" (même pour un tout autre réglage) : ce projet
ayant déjà été sauvegardé au moins une fois AVANT l'introduction du correctif précédent, la base
contenait encore `prop:portal.obstacle: false` — une valeur explicite qui masquait indéfiniment le
nouveau défaut du code, sans qu'aucune relecture du code ne puisse jamais le détecter (bug invisible
en lecture de code seule, uniquement visible en inspectant la donnée réellement persistée).

**Correctif appliqué** : migration ponctuelle de la donnée en base (mise à jour ciblée du seul champ
`obstacle` de `prop:portal`, sans toucher aux autres réglages déjà personnalisés par l'admin,
`climbable`/`water`/`scale` ni aucun autre type d'objet) — `obstacle` passe de `false` à `true` dans
`catalog/repRules/platform3dObjectFlags/prop:portal`. Vérifié par lecture avant/après directement en
base : `{"climbable":false,"obstacle":false,"scale":1,"water":false}` →
`{"climbable":false,"obstacle":true,"scale":1,"water":false}`.

**Portée élargie à "tous les portails"** (2e partie de la demande) : `worldTerrain.ts::isObstacleAt`
— fonction PARTAGÉE par `GameCanvas2D.tsx` (Plateforme 2D isométrique) et
`roamingActors.ts::isTileBlockedForRoaming` (évitement par les PNJ/familiers/faune errants), mais
jusqu'ici limitée à `tile.prop === 'hut' | 'castle'` — couvre désormais aussi
`tile.prop === 'portal'`. Avant ce complément, le portail posé au sol restait traversable en 2D (et
ignoré par l'évitement des PNJ/faune errants), alors que la Plateforme 3D le bloquait déjà via le
registre `platform3dTileFlags` : asymétrie désormais résolue, les DEUX variantes du portail (posé au
sol via `tile.prop==='portal'`, flottant inter-mondes via le marqueur catalogue `kind:'world'` et
`isWorldPosBlockedByStaticMarker`) sont maintenant bloquantes de façon identique dans les 3 vues
(3D, 2D isométrique, et pour l'évitement des PNJ/familiers/faune errants sur la mapmonde).

**Non-régression** : le changement sur `isObstacleAt` n'affecte QUE les cases portant
`tile.prop === 'portal'` (généré aléatoirement à ~1% des tuiles, voir `worldTerrain.ts`) — aucun
autre type de décor/terrain n'est concerné ; `hut`/`castle` restent inchangés. La migration de
donnée ne touche qu'un seul champ booléen d'une seule entrée du registre, tous les autres réglages
admin (y compris ceux déjà personnalisés pour d'autres types d'objets) restent strictement
identiques. Vérifié : `npx tsc --noEmit` (0 erreur), script `tsx` autonome confirmant
`isObstacleAt({prop:'portal'})===true` tout en laissant `tree`/`null` inchangés, Playwright sur
`/game` (0 erreur console, aucune régression visible).

### ✅ Vérification : les DEUX variantes du portail utilisent bien le nouveau design vertical

Question utilisateur (suite aux 2 correctifs ci-dessus) : « as-tu aussi remplacé l'ancien portail
avec ce nouveau portail vertical/glyphe/roues crantées + pupitre/console ? »

Confirmé par relecture de code ET vérification visuelle Playwright (téléportation de Synk en jeu
réel à côté du portail flottant catalogue `world_zephyria` [mapX:10, mapY:80], capture d'écran) :
- Le portail **posé au sol** (`PropBlock`, `tile.prop === 'portal'`, généré aléatoirement par
  `worldTileAt`) et le portail **flottant inter-mondes** (`MarkerBlock`, `kind:'world'`, catalogue
  admin `catalog/worldDefs`) appellent tous les deux la MÊME fonction `StargatePortal` (voir
  `Platform3DWidget.tsx`) — aucun ancien rendu "anneau plat" résiduel nulle part dans le widget
  Plateforme 3D. Seuls diffèrent le `radius` (0.62 posé au sol vs 0.3 flottant, proportionné à son
  contexte) et l'ancrage (`anchorY` sur une dalle vs flottant à hauteur fixe) — la silhouette
  (porte verticale + chevrons + roue de glyphes cabalistiques + console/pupitre adjacente), la
  couleur cuivre et le comportement d'obstacle sont strictement identiques pour les deux variantes.
- Un registre `MARKER_COLOR.world = '#8b5cf6'` (mauve) subsiste dans le code comme simple entrée de
  légende générique, mais est mort pour ce kind précis : la branche `isWorld` de `MarkerBlock`
  retourne avant d'atteindre ce code, avec sa propre couleur cuivre `#b5712b` codée en dur — aucun
  impact visuel, laissé en l'état (nettoyage cosmétique non prioritaire, aucune régression).

### 🪑 Correctif : la console/pupitre d'activation était toujours traversable (décalage géométrique)

Demande utilisateur : « Apparemment il y a toujours un bug car je peux encore traverser le portail
et la console/pupitre [...] Place aussi la console en obstacle, tu ne l'as pas fait. Corrige ce
bug. » — malgré le correctif précédent (anneau + console rendus bloquants), une capture d'écran a
montré Synk capable de se tenir juste derrière/à côté de la console (ses jambes visibles de l'autre
côté du meuble).

**Cause racine** : `StargatePortal` (voir `Platform3DWidget.tsx`) positionne la console à un
décalage 3D LOCAL FIXE par rapport au centre de l'anneau : `position={[radius + 0.45, 0,
radius * 0.55]}`. Or 1 dalle de la mapmonde = 1 unité Three.js (aucun facteur `TILE_SIZE`, voir la
boucle `tiles` dans `Scene` : `x: dx, z: dz` passés tels quels) — donc une demi-dalle ne vaut que
`0.5` unité. Pour le portail **posé au sol** (`radius = 0.62`), le décalage vaut `(1.07, 0.34)`
unités, soit **plus d'une demi-dalle** : la console déborde dans la dalle VOISINE (`(wc+1, wr)`),
qui n'était jamais marquée comme obstacle (seule la dalle exacte `tile.prop === 'portal'` l'était).
Pour le portail **flottant inter-mondes** (`radius = 0.3` fixe, jamais mis à l'échelle), le décalage
vaut `(0.75, 0.165)` — la distance au CENTRE DE L'ANNEAU d'une dalle entière voisine (`1.0`) dépasse
`ACTOR_COLLISION_RADIUS` (`0.85`), donc cette dalle n'était pas bloquée par la seule vérification de
proximité à l'anneau, alors qu'elle se trouve à peine `~0.30` unité de la console elle-même.

**Correctif** (deux mécanismes distincts, chacun idiomatique à sa représentation) :
- **Portail posé au sol** (grille de dalles) : nouvelle fonction `isPortalConsoleTileAt()` dans
  `worldTerrain.ts`, qui teste si la dalle `(wc,wr)` correspond à la dalle `(wc-1, wr)` (constantes
  `PORTAL_CONSOLE_OFFSET_COLS=1`, `PORTAL_CONSOLE_OFFSET_ROWS=0`, dérivées de la géométrie ci-dessus
  pour l'échelle par défaut) portant `tile.prop === 'portal'` — si oui, `isObstacleAt()` renvoie
  `true` pour cette dalle VOISINE aussi, en plus de la dalle du portail lui-même. Point d'extension
  unique et partagé (2D isométrique, Plateforme 3D via son appel existant à `isObstacleAt`, et
  évitement des PNJ/familiers/faune errants), exactement comme pour le correctif précédent.
- **Portail flottant inter-mondes** (position continue) : `isWorldPosBlockedByStaticMarker()` dans
  `roamingActors.ts` teste désormais un SECOND point de proximité (même rayon
  `ACTOR_COLLISION_RADIUS`) centré sur `marker.(x,y) + WORLD_PORTAL_CONSOLE_OFFSET` (constante
  `{dx:0.75, dy:0.165}`, dérivée de la même géométrie), en plus du point d'origine (le centre de
  l'anneau, déjà vérifié auparavant).

**Non-régression** : changements strictement ADDITIFS (une nouvelle condition `||` dans chaque
fonction) — aucune dalle/position auparavant bloquée ne redevient franchissable, seules de
nouvelles positions deviennent bloquées. Vérifié : `npx tsc --noEmit` (0 erreur) ; Playwright sur
`/game` en conditions réelles (session Démo anonyme, téléportation de Synk via écriture directe
`players/{addr}/mapPos`) — AVANT le correctif (`git stash` temporaire des 2 fichiers modifiés) :
déplacement vers la dalle où déborde la console du portail flottant RÉUSSIT (bug reproduit) ; APRÈS
restauration du correctif : le MÊME déplacement est bloqué (position inchangée), tandis qu'un
déplacement de contrôle vers une direction sans rapport reste libre. Même constat pour le portail
posé au sol (dalle voisine bloquée, déplacement de contrôle libre).

## 🔺 Cristal de la Porte des Étoiles : trésor + quête, prix boutique paramétrable, nombre de portails fixe

Demande utilisateur : « Peux-tu me dire si l'objet "Cristal de la Porte des Étoiles" existe dans la
liste des trésors [...] car je ne le trouve pas dans le menu Administration [...] Créer le trésor
"Cristal de la Porte des Étoiles" et associe-le à une nouvelle quête pour le gagner [...] Ajoutes
également l'objet [...] dans la boutique mais à 1000000 de coins du jeu (montant paramétrable) [...]
disperses seulement 20 Portes des étoiles dans l'intégralité du jeu [...] rends paramétrable le
nombre de Portes des étoiles à afficher ». Trois sous-demandes indépendantes.

### 1. Trésor + quête (visibles en Administration)

`stargate_crystal` existait déjà dans `DEFAULT_SHOP` (catégorie `'treasure'`, requis par
`RepRules.stargateRequiredItemId` pour actionner une console) mais n'avait **jamais** été enregistré
comme `TreasureDef` (`catalog/treasureDefs`, la source de données de la rubrique "Trésors" du menu
Administration) ni comme récompense d'une `QuestDef` — d'où l'impossibilité de le trouver dans
Administration malgré sa présence en boutique.

Ajout via script de migration one-shot `scripts/seedStargateCrystalQuestTreasure.mjs` (même
technique que `seedInvisibilityQuest.mjs` : `.env.local` parsé manuellement, `signInAnonymously`,
écriture directe `firebase/database`) :
- **Trésor** `treasure.stargate_crystal` (`xpRequired: 2600`, `xpReward: 150`, `itemReward:
  {itemId:'stargate_crystal', qty:1, category:'treasure'}`) — coffre ouvrable une fois le seuil
  d'XP atteint, comme tout autre trésor.
- **Quête** `quest.stargate_crystal` (« 🌀 L'Énigme du Voyageur Immobile », classique — PAS
  `npcGiver`, donc visible directement dans "Quêtes à énigmes" dès `xpRequired: 2200` atteint,
  réponse `"cristal"`), avec le MÊME `itemReward` — deux voies indépendantes pour obtenir l'objet,
  en plus de l'achat en boutique.

Les deux apparaissent IMMÉDIATEMENT dans le menu Administration (rubriques "Quêtes existantes"/
"Trésors existants" de `app/admin/page.tsx`, qui listent respectivement `getQuestDefs()`/
`getTreasureDefs()` sans filtrage) sans aucune modification de code nécessaire pour l'affichage de
base. `TreasureRow`/`QuestRow` affichent désormais en plus un badge `🎁 {itemReward.name} ×{qty}`
(lecture seule — l'édition de `itemReward` reste réservée au script/à Firebase, comme avant ;
`save()` des deux lignes préservait déjà `itemReward` tel quel lors de toute autre modification,
donc aucune régression possible sur les entrées existantes qui en avaient déjà un, ex. la Cape
d'invisibilité).

### 2. Prix boutique paramétrable (1 000 000 pièces par défaut)

`DEFAULT_SHOP['stargate_crystal'].priceGame` passe de `12000` à `1000000`. Plutôt que d'introduire
un nouveau champ `RepRules` dupliquant cette valeur (risque de désynchronisation avec le catalogue
boutique, seule source de vérité lue par `ShopPanel.tsx`), `RepRulesPanel.tsx` (section « 🌀 Porte
des étoiles ») charge l'item `stargate_crystal` via `getShopCatalog()` et expose un champ numérique
dédié + bouton d'enregistrement qui appelle `setShopItem({...item, priceGame})` — écriture
DIRECTEMENT dans `catalog/shop/stargate_crystal`, indépendante du bouton "Enregistrer" global du
reste du formulaire RepRules (chemins Firebase différents).

### 3. Nombre de Portes des étoiles FIXE et paramétrable (`RepRules.stargateCount`, défaut 20)

**Avant** : `worldTileAt()` (`worldTerrain.ts`) tirait un portail par un jet PROBABILISTE
indépendant à CHAQUE dalle (`hashRand(wc, wr, 4) < 0.01`, ~1 % de chance par dalle admissible) — sur
un monde de 101×101 dalles, cela produisait un nombre de portails bien plus élevé que prévu et
variable, sans aucun moyen de le borner (capture utilisateur : bien trop de portails visibles).

**Après** : nouvel algorithme dans `worldTerrain.ts` — `configureStargates({count})` pousse un
nombre cible `stargatePortalCount` (module-scope, défaut 20) ; `stargateTileKeys()` calcule un
ensemble d'EXACTEMENT `count` positions `(wc,wr)` UNIQUES, dérivées par `hashRand(i, 0, salt)` d'un
indice `i = 0..N-1` (PAS de `wc`/`wr` : stable quel que soit `N`), mémoïsé (invalidé seulement si
`count` change). `worldTileAt()` teste l'appartenance à cet ensemble **avant** les jets
arbre/bâtisse (et non après, comme un essai initial l'avait fait — un arbre ou une hutte pouvait
sinon occuper par hasard une des positions tirées et réduire silencieusement le compte réel en
dessous de la valeur configurée, bug détecté par un test autonome : 19 portails trouvés au lieu de
20 attendus, corrigé en donnant la priorité au portail).

Poussé vers ce registre par les 3 widgets (`GameCanvas2D.tsx`/`Platform3DWidget.tsx`/
`WorldMapWidget.tsx`) dans un nouveau `useEffect(() => configureStargates({count: rules.
stargateCount}), [rules])`, exactement comme `configureRoaming()` existant (idempotent, dernier
appelant gagne, valeurs identiques car toutes issues du même `RepRules`) — garantit que les 3 vues
(Mapmonde/Plateforme 2D isométrique/Plateforme 3D) affichent TOUJOURS le même ensemble de portails,
puisqu'elles appellent toutes `worldTileAt()` avec le même état module.

Nouveau champ `RepRules.stargateCount` (défaut `20`), exposé dans `RepRulesPanel.tsx` (section
« 🌀 Porte des étoiles », ajouté à `stargateFields` — suit le pattern générique déjà en place, aucun
code de rendu spécifique nécessaire).

**Vérifié** : `npx tsc --noEmit` (0 erreur) ; script autonome transpilant `worldTerrain.ts` et
balayant la grille 101×101 complète pour plusieurs valeurs de `count` (20, 1, 0, 35, 20 à nouveau
après retour en arrière) — nombre de portails trouvés strictement égal à `count` à chaque fois,
y compris les cas limites (`0`, `1`) et le changement de valeur (invalidation du cache) ; lecture
Firebase confirmant la persistance correcte du trésor/de la quête créés. `npm run dev` + Playwright
confirmant l'absence d'erreur console au chargement (page d'accueil et `/admin`, ce dernier
correctement protégé par la vérification propriétaire du contrat — accès refusé sans portefeuille
connecté, comportement attendu et inchangé).

**Non-régression** : `DEFAULT_SHOP`/`RepRules`/`worldTerrain.ts` modifiés de façon strictement
additive (nouveau champ, nouvelle fonction, même signature publique de `worldTileAt`/`isObstacleAt`
inchangée) ; aucun appelant existant n'a dû être adapté au-delà de l'ajout du `useEffect`
`configureStargates` dans les 3 widgets (suit littéralement le patron `configureRoaming` déjà
éprouvé) ; aucune donnée existante (quêtes/trésors déjà créés) n'est modifiée par le script de
migration (clés Firebase nouvelles, `treasure.stargate_crystal`/`quest.stargate_crystal`).

## 🌀 Porte des étoiles agrandie (2x Synk) + placement restreint aux dalles prairie/sentier

Demande utilisateur : « Cette Porte des étoiles est trop petite [...] il faut l'agrandir de 2 fois
la taille de Synk et tu feras cela pour toutes les Portes des étoiles dans le jeu. De plus, Les
Portes des étoiles et les consoles ne doivent pas être sur une dalle d'eau mais elles doivent être
sur une dalle prairie (d'herbe) ou de terre ». Deux correctifs indépendants dans `worldTerrain.ts`.

### 1. Rayon de référence unifié et agrandi (`STARGATE_RING_RADIUS`)

Nouvelle constante exportée `STARGATE_RING_RADIUS = 1.0` (`worldTerrain.ts`), remplaçant les DEUX
rayons historiques divergents : `0.62` pour le portail posé au sol (`PropBlock::kind==='portal'`,
multipliable par le `scale` admin-paramétrable `DEFAULT_PLATFORM3D_OBJECT_FLAGS['prop:portal']
.scale`, défaut 1 inchangé) et `0.3` pour le portail flottant inter-mondes (`MarkerBlock::isWorld`,
jamais mis à l'échelle). Diamètre résultant 2.0 unités ≈ 2x la hauteur de Synk (~1,1-1,2 unité, voir
SynkVoxel/SYNK_GROUND_OFFSET). Centralisée dans `worldTerrain.ts` (et non `Platform3DWidget.tsx`)
pour rester importable par `roamingActors.ts` sans dépendance circulaire (les deux fichiers
importent déjà `worldTerrain.ts`).

`anchorY` du ground-portal n'est plus surchargé en dur (ancien `anchorY={1.1}`, qui figeait la
hauteur indépendamment du rayon) : les deux variantes utilisent désormais le même défaut de
`StargatePortal` (`anchorY ?? radius + 0.1`), qui place toujours le bas de l'anneau 0.1 unité
au-dessus de son origine locale quel que soit le rayon — plus cohérent et sans cas particulier.

**Obstacles recalculés** (la console d'activation déborde proportionnellement plus loin avec un
anneau plus grand) :
- `PORTAL_CONSOLE_OFFSET_COLS`/`_ROWS` (ground-portal, grille de dalles) : `(radius+0.45,
  radius*0.55)` passe de `(1.07, 0.34) → arrondi (1, 0)` à `(1.45, 0.55) → arrondi (1, 1)` —
  la console bloque désormais la dalle DIAGONALE voisine (colonne+1, ligne+1) au lieu de la dalle
  directement adjacente (colonne+1, ligne+0).
- `WORLD_PORTAL_CONSOLE_OFFSET` (portail flottant, roamingActors.ts) recalculé à partir de la même
  constante `STARGATE_RING_RADIUS` plutôt que d'une valeur codée en dur.
- Nouveau `WORLD_PORTAL_RING_BLOCK_RADIUS = STARGATE_RING_RADIUS + 0.1` : l'ancien rayon de blocage
  de l'anneau flottant réutilisait `ACTOR_COLLISION_RADIUS` (0.85, pensé pour l'espacement entre
  acteurs vivants) — désormais INSUFFISANT puisque l'anneau s'étend visuellement sur 1.0 unité
  depuis son centre. `ACTOR_COLLISION_RADIUS` reste utilisé tel quel pour le point de blocage de la
  console (petite, son rayon propre n'a pas changé).

### 2. Placement restreint aux dalles `'grass'`/`'path'` (jamais eau/sable/rocher)

`stargateTileKeys()` tirait auparavant `stargatePortalCount` positions `(wc, wr)` SANS tenir compte
du terrain qui y serait généré — capture utilisateur montrant un portail + sa console posés en
pleine zone d'eau. Nouvelle fonction interne `terrainOnlyAt(wc, wr, poiPoints)` : réplique
EXACTEMENT la logique de biais de POI + clusters ambiants de `worldTileAt` (même ordre de
conditions) mais s'arrête avant altitude/profondeur/prop — gardée séparée de `worldTileAt` (plutôt
que factorisée en un appel mutuel) pour éviter toute dépendance circulaire (`worldTileAt` appelle
`stargateTileKeys()` qui appellerait alors indirectement `worldTileAt` si ce n'était pas dupliqué).

Chaque candidat `(wc, wr)` tiré est désormais validé en DEUX temps avant d'être retenu :
1. Son propre terrain doit être `'grass'` ou `'path'` (jamais `'water'`/`'sand'`/`'rock'`).
2. La dalle où déborde sa console (`wc + PORTAL_CONSOLE_OFFSET_COLS, wr + PORTAL_CONSOLE_OFFSET_
   ROWS`) doit ELLE AUSSI être `'grass'` ou `'path'`.

Un candidat rejeté est simplement ignoré (incrémente l'indice `i`, tire le suivant) — le nombre
FINAL de portails reste garanti égal à `stargatePortalCount` tant que la carte contient assez de
dalles admissibles (`guardMax` relevé à `count*400+2000`, contre `count*100+500` avant, pour
absorber le taux de rejet supplémentaire). Le cache `stargateKeysCache` est désormais invalidé non
seulement sur changement de `count` mais aussi de référence `poiPoints` (nouveau candidat admin de
POI pouvant changer le terrain à une position déjà choisie).

**Vérifié** : `npx tsc --noEmit` (0 erreur) ; script autonome transpilant `worldTerrain.ts`
(`typescript.transpileModule`) balayant la grille 101×101 complète pour plusieurs configurations de
POI, dont un scénario DÉLIBÉRÉMENT extrême (océan de rayon 48 + lac de rayon 12 couvrant la quasi-
totalité de la carte) : `count` toujours atteint EXACTEMENT (20/20, 1/1, 0/0, 35/35) et **zéro**
portail/console sur une dalle d'eau dans tous les cas, y compris le scénario extrême ; un second
passage confirme que terrain du portail ET de sa console valent systématiquement `'grass'` (jamais
`'sand'`/`'rock'`) même avec des POI montagne/plage/océan simultanés. `npm run dev` + Playwright :
page d'accueil chargée sans erreur console/page après les changements.

**Non-régression** : `STARGATE_RING_RADIUS` ne change que la valeur de `radius` passée à
`StargatePortal` (prop déjà paramétrée, aucune signature modifiée) ; le mécanisme de rejet de
`stargateTileKeys()` est strictement plus restrictif que l'ancien (un sur-ensemble de candidats
valides avant reste valide après SAUF ceux sur eau/sable/rocher, qui étaient justement le bug
signalé) ; `isObstacleAt`/`isWorldPosBlockedByStaticMarker` gardent la même signature publique,
seules leurs constantes internes changent.

## Son d'activation de la Porte des étoiles (clé audio `stargate`)

Demande utilisateur : « Joue un son à l'activation de la Porte des étoiles et ajoute le son dans le
widget des sons audio. » Intégration au module audio existant (voir section « Module Audio des
créatures 3D » plus haut) plutôt qu'un mécanisme ad hoc, en suivant EXACTEMENT le précédent
`doorCreak` (son ponctuel déclenché par une action de jeu, et non une ambiance continue/bouclée).

### 1. Nouvelle clé `'stargate'` dans le catalogue central (`gameState.ts`)

Ajoutée à `AudioSourceKey` (union), `AUDIO_SOURCE_KEYS` (tableau) et `DEFAULT_AUDIO_SETTINGS`
(`{ enabled: true, volume: 70 }` — volume par défaut plus élevé que les sons d'ambiance animalière
car il s'agit d'un événement ponctuel et marquant, pas d'un bruit de fond). Comme `AudioWidget.tsx`
(widget joueur) et `AudioAdminPanel.tsx` (panneau Administration > Audio) itèrent tous deux sur
`AUDIO_SOURCE_KEYS`/`DEFAULT_AUDIO_SETTINGS` SANS logique spécifique par clé au-delà d'icône/libellé,
la nouvelle clé apparaît automatiquement dans les deux surfaces une fois ces deux maps locales
(`SOURCE_ICON`/`SOURCE_LABEL`) complétées (icône 🌀, libellé « Porte des étoiles (verrouillage des
chevrons + vortex, activation) ») — aucune autre modification de ces deux composants.

### 2. Synthèse Web Audio (`lib/audio.ts::playSynth`, case `'stargate'`)

Trois « verrouillages » métalliques montants (onde carrée, fréquence croissante par palier, courts
et rapprochés — évoque l'enclenchement successif des chevrons), puis un souffle d'énergie montant
(onde en dents de scie 90→520 Hz sur 1,1 s) immédiatement suivi d'un harmonique montant (onde
sinusoïdale 520→880 Hz) et d'un bruit blanc filtré (`noiseBurst`) superposés au souffle — pour
évoquer l'ouverture du vortex plutôt qu'un simple bip. Reste 100% synthétisé par défaut (aucun
fichier audio tiers embarqué, conformément au principe déjà en place pour tous les autres sons) ;
l'admin peut comme pour les autres clés fournir une URL personnalisée dans Administration > Audio
qui remplacera alors ce son synthétisé.

### 3. Point de déclenchement (`Platform3DWidget.tsx::requestStargateActivation`)

Le son est joué via `playAmbientSound('stargate', wildlifeAudio)` au moment précis où la validation
(XP suffisant + objet requis `stargate_crystal` en inventaire) RÉUSSIT et où l'état
`stargateActivation` est posé (déclenchant réellement l'animation de composition de l'anneau de
glyphes) — PAS sur un clic refusé (XP/objet manquant), qui affiche uniquement le popup de feedback
existant sans jouer de son. Un seul point d'appel couvre les DEUX variantes de portail (portail posé
au sol via `PropBlock` et portail flottant inter-mondes via `MarkerBlock`) car elles partagent
toutes deux le même composant `StargatePortal` et appellent la même fonction `onRequestStargate
Activation` du composant parent — aucune duplication nécessaire. `wildlifeAudio` (réglages admin via
`useAdminAudioSettings()`) était déjà dans le scope du composant parent (utilisé pour `doorCreak`) ;
ajouté aux dépendances du `useCallback`.

**Vérifié** : `npx tsc --noEmit` (0 erreur, la clé `'stargate'` est couverte par le `switch` de
`playSynth` sans cas manquant) ; `npm run dev` + Playwright (`chromium`, écoute `pageerror`/
`console.error`) sur `/game` : aucune erreur après chargement. La lecture RÉELLE du son ne peut pas
être vérifiée de façon fiable en Playwright headless (le `AudioContext` Web Audio exige un geste
utilisateur réel pour se débloquer, voir `unlockAudioOnFirstGesture()`) — vérification limitée à la
relecture de code, à l'exhaustivité du typage et à l'absence d'erreur console/page.

**Non-régression** : aucune signature de fonction existante modifiée (seul le corps interne de
`requestStargateActivation` gagne un appel supplémentaire, et sa liste de dépendances `useCallback`
est mise à jour en conséquence) ; `AUDIO_SOURCE_KEYS`/`DEFAULT_AUDIO_SETTINGS` restent un sur-
ensemble strict de l'existant (ajout en fin de liste, aucune clé existante modifiée) ; les sons
`doorCreak` et les ambiances animalières sont inchangés.

