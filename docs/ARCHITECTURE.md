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

