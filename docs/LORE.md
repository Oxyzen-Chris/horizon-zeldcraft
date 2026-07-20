# 🗡️ Lore : Synk & l'univers Horizon ZeldCraft

## Synk

**Synk** est un jeune héros humain, dans l'esprit de Link (*The Legend of Zelda: Breath of the
Wild* / *Tears of the Kingdom*), habillé façon Minecraft (pixel-art, silhouette en blocs). Il
débute son épopée en simple aventurier et grandit, combat après combat, quête après quête, en
guerrier aguerri, mage et dresseur de dragons, dans l'univers **Zeldcraftia**, coincé entre le
Nether de Minecraft, Hyrule et Azeroth.

### Stades d'évolution

Les 5 stades de progression on-chain (calculés depuis l'XP cumulée, voir
`HorizonZeldCraft.sol#_stageFromLevel`) sont conservés à l'identique — seul l'habillage narratif
change pour coller à l'histoire de Synk :

| Stade                        | Niveau requis | Description                                                              |
| ----------------------------- | ------------- | ------------------------------------------------------------------------ |
| 🗡️ Jeune Adulte               | 0             | Synk quitte son village avec une tunique simple, sans arme               |
| 🛡️ Adulte Novice              | 5             | Premiers combats, une épée en main, encore peu de pouvoir                |
| ⚔️ Adulte Aguerri              | 20            | Expérience de combat, un bouclier, premiers réflexes de guerrier         |
| 🔥 Adulte Puissant             | 50            | Dons de magicien révélés (cape, aura magique), combattant redoutable     |
| 🐲 Maître Dresseur de Dragons  | 100           | Plein pouvoir, couronne de maître, dragons apprivoisés à ses côtés       |

### Stats

- **HP** : Points de vie (max 100 + bonus stade)
- **Faim** : Diminue avec le temps → si 0, Synk tombe malade
- **Bonheur** : Diminue si non nourri → affecte les gains XP
- **XP** : Gagné en nourrissant, faisant des quêtes (plafond d'affichage paramétrable, voir
  `RepRules.xpCap`, 100 000 par défaut)
- **Niveau** : Calculé depuis XP

## Familiers

Au fil de son épopée, Synk rencontre des compagnons chimériques — dragons, elfes des forêts,
créatures magiques — qui deviennent ses **Familiers**. Le catalogue est 100% hors-chaîne
(Firebase, paramétrable par l'admin) : chaque Familier définit un **XP requis** et, pour certains,
un **objet rare optionnel** à posséder dans la besace (consommé lors de l'apprivoisement). La
rencontre se présente comme une quête à accomplir dans la rubrique « Familiers ».

Premier Familier de Synk : un **Dragon d'Or** (🐲), débloqué dès **5000 XP** cumulés à condition
de posséder l'objet rare **« Écaille de Sémaphore Écarlate »** (en vente dans la boutique).

Lore draconique (inspirée de la mythologie classique façon Donjons & Dragons) :

- **Dragons chromatiques** (malveillants) : Rouge (feu), Noir (acide/marais), Vert (gaz
  toxique/ruse), Bleu (foudre/désert)
- **Dragons métalliques** (bienveillants) : **Or** (feu, noble, métamorphe — le plus protecteur),
  Argent (froid, sage), Bronze (foudre, côtier), Cuivre (acide), Airain (feu, désert)

Le Dragon d'Or, réputé le plus noble des dragons métalliques, est choisi comme premier familier par
défaut de Synk. D'autres familiers (elfes des forêts, autres couleurs de dragons…) pourront être
ajoutés par l'admin au fil des saisons.

## Univers

### Les 4 Royaumes (déblocables)

1. **La Forêt de Zephyria** *(départ)* — inspiration BOTW, monstres faibles
2. **Les Grottes de Nether-Cristal** — inspiration Minecraft Dungeons, donjons
3. **Le Sanctuaire d'Azerothyl** — inspiration WoW, boss épiques
4. **Le Nexus Temporel** — inspiration Stargate/wormholes, endgame

### Cycle des saisons

Le jeu suit un cycle saisonnier réel (Printemps, Été, Automne, Hiver) qui influe sur :
- Les skins saisonniers de Synk
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
