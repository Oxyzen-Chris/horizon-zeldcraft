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

### Selles et chevauchée

Certains objets de la besace sont des **selles** (catégorie `saddle`), qui permettent à Synk de
chevaucher un familier déjà apprivoisé (le slot d'équipement « selle » exige que le familier
correspondant soit actif). Chevaucher accélère les déplacements et peut offrir des bonus de combat
selon le familier monté.

## Articulation de Synk et déplacement

Dans la « Plateforme 2D isométrique », Synk s'anime naturellement selon sa direction de
déplacement : **8 directions** sont gérées (haut, bas, gauche, droite, et les 4 diagonales
haut/bas-gauche/droite), avec une articulation visuelle des jambes, bras, torse, dos et tête
cohérente avec la perspective isométrique. Ce mécanisme est activable/désactivable dans le menu
Administration (`Synk : animation des membres`).

## Équipement, usure et Cimetière des équipements

Chaque arme, protection, amulette, bouclier, flèches, habit ou paire de gants équipée s'**use**
progressivement au fil des combats (pourcentage de durabilité). Ce niveau d'usure est **conservé**
même si le joueur déséquipe l'objet pour le ranger dans sa besace puis le rééquipe plus tard.
Quand la durabilité atteint 0 %, Synk est **automatiquement déséquipé** (avec un pop-up
d'avertissement) et l'objet, trop abîmé pour être réutilisé, n'est **pas** remis dans la besace :
il rejoint le **« Cimetière des équipements »**, une nouvelle catégorie du widget « État
d'avancement / inventaire » qui garde la trace de tout ce que Synk a usé jusqu'à la casse. Sans
équipement, Synk combat à mains nues avec un malus au jet de dés.

## Rencontres PNJ et scripts de dialogue

Chaque PNJ rencontré (popup aléatoire ou PNJ fixe d'archipel/île) peut porter un **script de
dialogue** entièrement paramétrable en Administration : une réplique d'ouverture et jusqu'à 5
réactions possibles (oui / non / je ne sais pas / continuer / indice supplémentaire), chacune
pouvant octroyer XP, réputation, révéler un indice de quête ou enchaîner vers un autre script.
Cela permet à l'administrateur d'ajouter de nouveaux PNJ « parlants » sans toucher au code.

## Architecture extensible : DLC / saisons narratives

Au-delà de la défaite de Zorghon, l'univers de Zeldcraftia est prévu pour grandir via des
**Packs de contenu** (DLC) : chaque pack est un simple interrupteur (`id`, `nom`, `actif`) créé
dans le menu Administration, sans donnée de jeu propre. De nouvelles quêtes, PNJ, mondes ou objets
sont ensuite « tagués » avec l'identifiant du pack ; tant que le pack n'est pas actif, son contenu
reste invisible pour les joueurs — ce qui permet de préparer une saison narrative entière à
l'avance et de l'activer d'un clic, sans jamais casser le contenu déjà en place.

## Le grand méchant : Zorghon le Maléfique

**Zorghon** est le sorcier maléfique qui a enlevé **PocaPoka**, princesse de Zeldcraftia, et son
fidèle lutin des sables **El Pipo**. Toute la trame narrative principale du jeu — les **400 Quêtes
du Royaume** — consiste à traquer Zorghon, le vaincre, et délivrer PocaPoka et El Pipo. Zorghon
n'est pas statique : quand Synk s'approche trop des deux captifs, Zorghon les déplace ailleurs sur
la carte (probabilité/fréquence paramétrable en Administration, rubrique « Zorghon »), rendant la
traque progressive et rejouable.

### Les 5 Fragments du Sceau Runique

Cinq reliques de quête — les **Fragments du Sceau Runique** — sont disséminées dans le monde au
fil de la progression (une par grande étape). Elles sont **protégées contre la perte aléatoire**
lors d'un évanouissement de Synk (contrairement au reste de la besace, voir plus bas). Réunir les
5 fragments déverrouille la **quête finale du Chapitre 40**, l'affrontement décisif contre Zorghon.

### Les 40 chapitres / 400 Quêtes du Royaume

Le fil principal se compose de **40 chapitres de 10 énigmes chacun** (400 quêtes au total,
`kingdomOrder` 1 à 400 dans `catalog/quests`), débloquées progressivement à mesure que le joueur
résout des quêtes intermédiaires (seuil configurable `RepRules.kingdomMinIntermediateSolved`).
40 de ces 400 quêtes (une par chapitre) sont marquées **« pleine lune uniquement »**
(`fullMoonOnly`) et n'apparaissent que le jour de pleine lune du calendrier réel — voir § Pleine
lune. Le suivi de la progression est visible dans le widget flottant **« Quêtes du Royaume »**.

## Les différentes familles de quêtes

| Catégorie                | Déclenchement                                            | Thème dans « État d'avancement / inventaire » |
| ------------------------ | --------------------------------------------------------- | ---------------------------------------------- |
| **Classiques**           | Toujours disponibles, résolues librement                  | 📜 Quêtes classiques                            |
| **PNJ (intermédiaires)** | Données par un PNJ rencontré (`npcGiver`)                  | ❓ Quêtes PNJ                                    |
| **Archipel**             | Sur l'archipel de 3 îles, PNJ indigènes                    | 🏝️ Quêtes archipel                              |
| **Îles sauvages**        | Sur les îles isolées (moyenne/grande), créatures étranges  | 🌴 Quêtes îles sauvages                         |
| **Du Royaume**           | 400 quêtes, 40 chapitres, fil narratif Zorghon              | 👑 Quêtes du Royaume                            |
| **Pleine lune**          | Sous-catégorie du Royaume, un jour de pleine lune réel      | (badge 🌕 dans le widget « Quêtes du Royaume »)  |

Chaque famille de quêtes intermédiaires (classiques + PNJ + archipel + îles sauvages), une fois
résolue en nombre suffisant, contribue au déblocage séquentiel des Quêtes du Royaume.

## Univers

### Les 4 Royaumes (déblocables)

1. **La Forêt de Zephyria** *(départ)* — inspiration BOTW, monstres faibles
2. **Les Grottes de Nether-Cristal** — inspiration Minecraft Dungeons, donjons
3. **Le Sanctuaire d'Azerothyl** — inspiration WoW, boss épiques
4. **Le Nexus Temporel** — inspiration Stargate/wormholes, endgame

### Îles et archipels

Au-delà des 4 Royaumes continentaux, la Mapmonde s'étend sur des **mers, océans, lacs, rivières**
et plusieurs **îles** : 1-2 presque-îles, un **archipel de 3 îles** (petite/moyenne/grande) et une
île moyenne au sud, une grande île à l'est — peuplées de bambous, baobabs, palmiers et PNJ
indigènes qui donnent les quêtes d'archipel/îles sauvages. L'accès à une île nécessite de posséder
un **engin** (radeau, radeau de fortune, bateau, galion, galère, engin volant, cerf-volant, kayak,
canoë — catégorie `vehicle`), obtenable par achat, quête ou trophée de Quête du Royaume
(paramétrable via `RepRules.islandVehicleRequired`).

### Montagnes, altitude et raréfaction de l'air

Les dalles de montagne/roche possèdent une **altitude** générée de façon déterministe
(`worldTerrain.ts`, 0 à 6000 m, en chaînes progressives). Plus Synk grimpe haut, plus **l'air se
raréfie** : au-delà d'un seuil configurable, le drain d'oxygène et de fatigue s'accentue
progressivement jusqu'à un facteur minimal atteint au sommet (6000 m). La neige reste possible en
haute altitude (> 2000 m) même hors hiver, par cohérence climatique.

### Eau, profondeur et oxygène

Les dalles d'eau (mers, océans, lacs, étangs, ruisseaux) possèdent une **profondeur** (`depthM`) et
un type (`waterKind`). Comme en montagne, la profondeur accentue le drain d'oxygène au-delà d'un
seuil paramétrable. Un **pop-up clignotant non bloquant**, paramétrable en Administration (activé/
désactivé, position à l'écran, texte), affiche en temps réel la profondeur ou l'altitude à laquelle
se trouve Synk dans les widgets « Plateforme 2D isométrique » et « Mapmonde ».

### Cycle des saisons et météo

Le jeu suit un cycle saisonnier basé sur le **calendrier réel** (hémisphère nord) : mars-mai
Printemps, juin-août Été, septembre-novembre Automne, décembre-février Hiver. La météo du jour
(☀️🌥️🌧️⛈️❄️) est cohérente avec la saison (été → plutôt soleil/orage, hiver → neige possible,
printemps/automne → pluie/nuages) et influe sur le **bonheur** de Synk (bonus/malus paramétrables
par type de météo dans le Barème de reconnaissance). Un mode manuel (admin) permet de forcer une
saison/météo précise pour des événements spéciaux.

### Pleine lune

La pleine lune du mois est calculée à partir d'un vrai cycle lunaire (date la plus proche du 15 du
mois) mais reste **ajustable manuellement par chapitre/mois** dans le menu Administration (« Pleine
lune ») pour caler des événements. Certaines Quêtes du Royaume (une par chapitre, 40 au total) ne
sont visibles/résolvables que ce jour précis — le widget affiche un calendrier des prochaines
pleines lunes.

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
