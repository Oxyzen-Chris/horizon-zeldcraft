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
  LOCALES (`npcLocal`/`dragonLocal`, clampées via `clampCoord` comme n'importe quelle autre tuile
  du viewport) ; `Platform3DWidget.tsx` soustrait directement `centerCol`/`centerRow` de Synk,
  exactement comme pour tout marqueur catalogue statique (voir `sceneMarkers`).
- **Cadence/amplitude d'errance INCHANGÉES** par rapport à l'ancienne implémentation locale de
  `GameCanvas2D.tsx` (4000 ms, ±1 case aléatoire par axe) — zéro régression sur le comportement 2D
  déjà en place. L'intervalle de mouvement démarre au premier widget abonné et s'arrête au dernier
  (`subscribeRoamingActors`/`useRoamingActors`), jamais de minuteur qui tourne dans le vide.
- **Mécanisme d'« attache » (`TETHER_X=5`/`TETHER_Y=4`)** : chaque widget signale la position
  mapmonde courante de Synk via `reportSynkWorldPos(x, y)` (depuis son effet `worldPos` existant) ;
  l'errance reste clampée dans cette fenêtre autour de la dernière position connue de Synk — reproduit
  l'effet de bord qu'avait l'ancien viewport local de `GameCanvas2D.tsx` (les acteurs ne pouvaient pas
  s'éloigner de la caméra centrée sur Synk), sans quoi rien n'empêcherait une dérive indéfinie hors
  de vue en coordonnées mapmonde globales.
- **Identité catalogue idempotente** (`ensureRoamingIdentities(markers)`, appelée par les DEUX
  widgets dès que leur propre `markers` est chargé) : le premier appelant gagne (`if (!state.npcMarkerId)`),
  garantissant que 2D et 3D affichent toujours le même PNJ/Dragon nommé, quel que soit l'ordre de
  montage des deux widgets.

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
