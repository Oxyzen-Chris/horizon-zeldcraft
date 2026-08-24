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
- **i18n** : `next-intl` — fichiers `web/src/i18n/messages/{fr,en,es,pt}.json` (1269 clés x 4 langues)
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
