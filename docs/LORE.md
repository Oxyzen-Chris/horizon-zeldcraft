# 🐉 Lore : Voxlyn & l'univers Horizon ZeldCraft

## Le Voxlyn

**Voxlyn** (prononcé *"vok-slinn"*) est un petit dragonneau cristallin natif du plan éthéré **Zeldcraftia**, coincé entre le Nether de Minecraft, Hyrule et Azeroth. Ses écailles pixelisées reflètent la lumière comme des voxels magiques.

### Stades d'évolution

| Stade         | Niveau requis | Description                                                              |
| ------------- | ------------- | ------------------------------------------------------------------------ |
| 🥚 Œuf         | 0             | Un œuf de cristal, tiède au toucher                                       |
| 🐣 Éclos       | 5             | Un bébé dragonneau qui piaille et suit le joueur                          |
| 🦎 Juvénile    | 20            | Apprend son premier sort, ses ailes poussent                             |
| 🐉 Adulte      | 50            | Peut voler, cracher du feu cristallin, ouvrir des portails               |
| 👑 Ancien      | 100           | Maître des éléments, débloque le mode Raid multi-joueur                  |

### Stats

- **HP** : Points de vie (max 100 + bonus stade)
- **Faim** : Diminue avec le temps → si 0, le Voxlyn tombe malade
- **Bonheur** : Diminue si non nourri → affecte les gains XP
- **XP** : Gagné en nourrissant, faisant des quêtes
- **Niveau** : Calculé depuis XP

## Univers

### Les 4 Royaumes (déblocables)

1. **La Forêt de Zephyria** *(départ)* — inspiration BOTW, monstres faibles
2. **Les Grottes de Nether-Cristal** — inspiration Minecraft Dungeons, donjons
3. **Le Sanctuaire d'Azerothyl** — inspiration WoW, boss épiques
4. **Le Nexus Temporel** — inspiration Stargate/wormholes, endgame

### Cycle des saisons

Le jeu suit un cycle saisonnier réel (Printemps, Été, Automne, Hiver) qui influe sur :
- Les skins saisonniers de Voxlyn
- Les événements et quêtes disponibles
- Les tarifs de certaines potions

### Mécanique de nourrissage (Staking)

| Fréquence   | ETH minimum (Mainnet) | ETH Sepolia | Récompense XP |
| ----------- | --------------------- | ----------- | ------------- |
| Journalier  | 0.0001                | 0.001       | +10 XP        |
| Hebdomadaire| 0.0005                | 0.005       | +80 XP        |
| Mensuel     | 0.002                 | 0.02        | +400 XP       |
| Annuel      | 0.02                  | 0.2         | +6000 XP      |

*Les ETH stakés vont vers l'adresse trésorerie (`treasury`) définie par l'owner du contrat.*

### PNJ, sorts, potions, portails

Chaque item est un `bytes32` ID stocké on-chain avec un prix en wei. L'owner peut en ajouter dynamiquement via le panneau admin (voir `HorizonZeldCraft.sol#addCatalogItem`).

## Inspirations visuelles

- **Minecraft Dungeons** — voxels stylisés, éclairage volumétrique
  - [Article Unreal Engine](https://www.unrealengine.com/spotlights/how-a-small-team-at-mojang-studios-made-minecraft-dungeons-in-unreal-engine?lang=fr)
- **BOTW / TOTK** — palette pastel, sanctuaires, énigmes
- **WoW** — épique, high-fantasy, dragons ancestraux
