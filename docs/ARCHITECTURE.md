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
- `/admin` — panneau owner (25 rubriques - voir § Menu Administration)
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

## Modèle de terrain (Mapmonde / Plateforme 2D)

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

Cette structure est volontairement pensée pour être réutilisable telle quelle par un futur widget
« Plateforme 3D » (même donnée altitude/profondeur, sans réécriture - voir `docs/ROADMAP.md`).

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
