# 🗡️ Horizon ZeldCraft — Synk

> Un Tamagotchi Web3 crypté sur la blockchain Ethereum. Nourris ton **Synk** (jeune héros façon Link, en pixel-art) chaque jour, semaine, mois et année pour le faire évoluer, débloquer des sorts, skins, familiers, mondes et quêtes épiques inspirés de **Minecraft Dungeons**, **The Legend of Zelda: BOTW/TOTK** et **World of Warcraft**.

![status](https://img.shields.io/badge/status-v3.3%20%E2%80%94%20Comptes%20s%C3%A9curis%C3%A9s%20%26%20e--mails-blue) ![license](https://img.shields.io/badge/license-MIT-green) ![solidity](https://img.shields.io/badge/solidity-0.8.24-orange) ![nextjs](https://img.shields.io/badge/Next.js-14-black)

## 📦 Monorepo

| Dossier       | Description                                                              |
| ------------- | ------------------------------------------------------------------------ |
| `contracts/`  | Smart contracts Solidity (Hardhat) — Sepolia + Mainnet                   |
| `web/`        | Front Next.js 14 + wagmi v2 + RainbowKit (déployable Vercel)             |
| `mobile/`     | App React Native / Expo (publiable Expo Go)                              |
| `docs/`       | Documentation technique, lore, roadmap                                   |

## 🚀 Quick start

```bash
# 1. Smart contract
cd contracts
npm install
npx hardhat compile
npx hardhat test
npx hardhat run scripts/deploy.ts --network sepolia

# 2. Web app
cd ../web
npm install
cp .env.local.example .env.local  # renseigner NEXT_PUBLIC_CONTRACT_ADDRESS_SEPOLIA etc.
npm run dev

# 3. Mobile (Expo Go)
cd ../mobile
npm install
npx expo start
```

## 🌐 Réseaux supportés

- **Sepolia** (testnet) — pour jouer gratuitement avec des faucets ETH
- **Ethereum Mainnet** — pour la version production avec vrais ETH

L'utilisateur choisit le réseau au moment de la connexion.

## 🌍 Langues

FR • EN • ES • PT (via `next-intl`, fichiers JSON versionnés dans `web/src/i18n/messages/`)

## 🧬 Architecture on-chain / off-chain (v3.1)

Pour minimiser les frais de gas et les appels au wallet, **seules les opérations monétaires** passent par le smart contract Ethereum. Toutes les autres données de jeu vivent dans **Firebase Realtime Database** (plan gratuit Spark : 1 Go stockage + 10 Go BW/mois — largement suffisant pour le MVP).

| Donnée                                    | Stockage                | Pourquoi                             |
| ----------------------------------------- | ----------------------- | ------------------------------------ |
| Création du Synk (mint)                   | 🔗 On-chain (payable)   | Preuve de propriété NFT              |
| Nourrissage journalier/hebdo/mensuel/annuel | 🔗 On-chain (payable)   | Micro-paiements ETH → trésorerie     |
| Achats catalogue « premium »              | 🔗 On-chain (payable)   | Vraies transactions ETH              |
| Faim, vie, bonheur (temps réel)           | 🔥 Firebase             | Décroissance temporelle sans gas     |
| Inventaire (fruits, potions, armes)       | 🔥 Firebase             | Micro-échanges sans gas              |
| Portefeuille de jeu + Reconnaissance      | 🔥 Firebase             | Compteurs off-chain                  |
| Force, Sortilèges (compétences)           | 🔥 Firebase             | Progression continue                 |
| Rencontres PNJ popup (3–10×/jour)         | 🔥 Firebase             | Simple journal                       |
| Historique de chat multi-joueurs          | 🔥 Firebase             | WhatsApp-like, latence <500 ms       |
| Log des transactions (facturation)        | 🔥 Firebase             | Base pour PDF invoice                |
| Réponses d'énigmes révélées               | 🔥 Firebase             | Persiste au redéploiement            |
| Familiers (catalogue + possession) + selles | 🔥 Firebase           | Rencontres chimériques, 0 gas        |
| Équipement (armes, protections, habits…) + usure/cimetière | 🔥 Firebase | Durabilité persistante, 0 gas |
| Nourriture, Potions & Sortilèges (catalogues) | 🔥 Firebase          | Éditables en direct par l'admin      |
| Quêtes du Royaume (400), archipel, îles sauvages, pleine lune | 🔥 Firebase | Fil narratif Zorghon/PocaPoka/El Pipo, 0 gas |
| Saisons, météo, pleine lune (calendrier réel) | 🔥 Firebase          | Calcul auto + override admin         |
| Scripts de dialogue PNJ, widgets personnalisés, DLC/Packs de contenu | 🔥 Firebase | Extensible sans redéploiement |
| Altitude (montagne) / profondeur (eau), oxygène, fatigue | 🔥 Firebase       | Mécaniques de survie temps réel      |
| État d'avancement / inventaire (ledger complet) | 🔥 Firebase         | Historique possession, 17 thèmes     |

**Garantie de persistance :** les données Firebase sont indexées par **adresse wallet**, jamais par adresse de contrat. Redéployer le smart contract ne perd rien du parcours joueur (stats, inventaire, chat, transactions).

## 🎮 Fonctionnalités v3.3

### Trame narrative
- 👹 **Zorghon le Maléfique** a enlevé la princesse **PocaPoka** et son lutin des sables **El Pipo** — objectif final du jeu
- 💠 **5 Fragments du Sceau Runique** (reliques protégées contre la perte lors d'un évanouissement) déverrouillant la quête finale
- 👑 **40 chapitres × 10 quêtes = 400 Quêtes du Royaume**, dont 40 exclusives à la **pleine lune** (calendrier réel)
- 📜 Quêtes classiques, ❓ quêtes PNJ (intermédiaires), 🏝️ quêtes d'archipel, 🌴 quêtes d'îles sauvages — toutes contribuent au déblocage séquentiel des Quêtes du Royaume
- 🎬 **Onboarding en 3 écrans** ludiques (bienvenue & stades de Synk, lore & mécaniques, guide des widgets) + widget **« Aides »** disponible à tout moment

### Écran de jeu — 15 fenêtres flottantes déplaçables
- 🗡️ Création de Synk (~15–20 € en ETH, paramétrable admin)
- 🍖 Nourrissage journalier / hebdo / mensuel / annuel avec cooldowns **indépendants par type** et compte-à-rebours — rubrique masquable par l'admin, boutons on-chain désactivables séparément (voir Bugs corrigés)
- 💰 **Rechargement du portefeuille** (nouveau) : fenêtre flottante dédiée à l'achat de monnaie de jeu contre ETH (mêmes presets/trésorerie que la rubrique « Portefeuille » fixe), déplaçable/réductible comme tous les autres widgets, avec en complément un **paiement fiat** (CB/PayPal/Apple Pay/Google Pay, voir ci-dessous) accessible à tous les comptes
- 🎟️💳 **Accès Démo & paiement fiat, sans portefeuille crypto** (nouveau — voir `docs/DEMO_FIAT.md`) : deux boutons sur la page d'accueil, à côté de la connexion wallet classique — « 🎟️ Accès Démo » (connexion Google avec validation admin dans une file d'attente dédiée, ou mode 100% anonyme instantané, tous deux plafonnés en connexions simultanées) et « 💳 Jouer sans portefeuille » (Google ou e-mail, accès immédiat, rechargement des coins par CB/PayPal/Apple Pay/Google Pay). Identité virtuelle transparente pour tous les widgets de jeu (`useEffectiveAccount()`) — **zéro changement pour les joueurs crypto existants**
- ✉️🔑 **Compte e-mail/mot de passe sécurisé + e-mails automatiques** (nouveau — voir `docs/EMAIL_NOTIFICATIONS.md`) : flux explicite Se connecter/Créer un compte pour « Jouer sans portefeuille », e-mail de bienvenue, rapport de progression immédiat ou **programmé** (quotidien/hebdo/mensuel/annuel), message personnalisé ou diffusion de masse (maintenance…), bandeau d'annonce en direct in-game (ciblé ou global), et **reset de mot de passe** admin-forcé (mot de passe fort généré, envoyé par e-mail) ou en libre-service depuis le jeu (bouton à côté de l'adresse virtuelle) — tout paramétrable dans `Administration > Barème & règles`
- 📊 **Statistiques** : XP · Vie · Faim · Bonheur · Force · Sortilèges · **Oxygène** · **Fatigue** · Portefeuille · Reconnaissance
- 🌤️ Météo dynamique cohérente avec le **cycle des 4 saisons** (calendrier réel), impact sur le bonheur
- 🌕 Pleine lune (calendrier réel + override admin) débloquant des quêtes spéciales
- 🎲 **Lancer de dés** : jet de destin quotidien + résolution des combats PNJ (bonus/malus), avec depuis peu un tirage 50/50 (paramétrable) à chaque combat entre le jet 2d20 classique et le **Dé d'Action D&D** (tétraèdre à 4 faces) : Fuir (Flight), Combattre (Fight), Figer (Freeze) ou Négocier (Fawn), chaque face ayant ses propres gains/pertes de vie, XP, force ou objets — admin : activable, % de chance, types de dés d4 à d100 (vrais noms de polyèdres), gains par face et objet Ultra rare (1×/jour)
- ⚔️ **Équipement Synk** : slots drag & drop, retrait vers la besace, usure persistante (conservée au déséquipement/ré-équipement), auto-déséquipement à 0% + **Cimetière des équipements**, police adaptative avec info-bulle pour les noms longs (ex. « Thunderfury »)
- 🎒 **Sac / Besace** synchronisée avec l'équipement · **⚗️ Combinaisons de Potions (Élixirs)** : combine plusieurs potions/sortilèges possédés (recette fixe) pour obtenir un Élixir surpuissant — Invulnérabilité de Vie 24h, Force Titanesque ×2 pendant 30 min, Souffle Éternel (oxygène plein 30 min), Vigueur Sans Fin (fatigue pleine 10 min), Festin Royal (faim pleine instantané), ou l'Épée Divine de Lumière (arme unique non disponible en boutique) — pop-up clignotant en haut de l'écran avec sablier ⏳ animé et décompte live tant qu'un effet temporisé est actif, entièrement paramétrable dans `Administration > Combinaisons de Potions / Élixirs`
- 🛒 **Boutique des terres de ZeldCraft** : armes, protections, casques/habits/gants/bottes (120+ articles inspirés Tolkien/WoW/Zelda/Minecraft), nourriture, potions & sortilèges, engins, trésors, selles
- 🗺️ **Mapmonde** zoomable avec filtres par catégorie, mers/océans/îles/archipels, pop-up profondeur/altitude clignotant
- 🧍 **Plateforme 2D isométrique** : déplacement et articulation de Synk en **8 directions**, dalles d'eau (profondeur) et de montagne (altitude 0–6000 m) avec raréfaction de l'air, mécaniques d'oxygène/fatigue
- 🧊 **Plateforme 3D** (Phase 2 Roadmap, désormais mature) : rendu 3D **réaliste** façon Minecraft Dungeons/Zelda de Synk — **détaillé et articulé** (yeux avec **pupilles et clignement des yeux périodique paramétrable**, nez, bouche, oreilles, cheveux/casque, bras et jambes qui se balancent naturellement en marche/course) avec **l'équipement réellement porté visible sur le modèle** — épée (lame/garde/poignée/pommeau assemblés), arc (bois + corde tendue + gemme), bouclier (disque + bordure + umbo), casque (dôme + cerclage + nasal), amulette (chaînette + gemme facettée) — chaque pièce reconnaissable avec la couleur de rareté en simple ACCENT (et non plus en teinte uniforme façon « donut »/« losange ») — et de tout son univers (PNJ, familiers, Zorghon/PocaPoka/El Pipo, huttes, arbres, montagnes, lacs, trésors), synchronisé en temps réel avec la Plateforme 2D isométrique et la Mapmonde. **Décor et sol texturés** (herbe/sable/sentier/roche générés proceduralement, mis en cache par type — zéro impact perf) et **redimensionnés de façon réaliste** (arbres ~2× la taille de Synk avec double étage de feuillage, baobab/palmier/bambou/hutte/château/portail chacun avec une silhouette distincte), le tout **paramétrable objet par objet** (échelle admin, voir `Administration > Barème & règles > 🧱 Objets & décor 3D`). Points d'intérêt réalistes : une **grotte** (`poiType: 'cave'`, lore Nether-Cristal) s'affiche désormais comme une arche rocheuse avec bouche sombre et cristaux, et une **quête** comme un **parchemin roulé flottant** (plus un gemme générique). **Déplacement en repère MONDE FIXE** (Haut/Bas/Gauche/Droite = nord/sud/ouest/est, strictement indépendant de l'orientation de la caméra, identique à la Plateforme 2D — architecture verrouillée, voir § ci-dessous) avec **maintien 1,5 s (réglable) pour passer de la marche à la course**, identique clavier/pavé virtuel/souris et partagé avec la Plateforme 2D. **Arbres, rochers et PNJ = obstacles** (paramétrable objet par objet dans Administration), clic gauche (net, sans glissé) pour interagir comme en 2D. **Escalade Espace + direction Haut** : saut arqué sur un bloc de montagne en face puis marche sur le relief, avec limites de dénivelé configurables (dégâts mineurs ou chute mortelle + réanimation automatique). **Immersion sur dalle d'eau** (mi-torse) ou **plongée totale** (clic droit) dans un monde sous-marin dédié avec poissons/créatures marines, une dizaine de lacs/bassins ajoutés à la carte. **Caméra 100% orbite libre à la souris** (jamais repositionnée automatiquement par le code, aucun conflit possible avec le déplacement). Fenêtre redimensionnable jusqu'au plein écran — activable/désactivable ainsi que chacune de ces mécaniques dans `Administration > Widgets personnalisés` (le clignement des yeux se règle dans `Administration > Paramétrage de Synk`)
- 🐲 **Familiers** (Dragon d'Or…) et selles pour les chevaucher
- 👑 Widget **« Quêtes du Royaume »** : suivi des 400 quêtes/40 chapitres
- 🧭 Widget **« ZeldCraft Quests »** : récapitulatif dépliable par thème de **toutes** les quêtes du jeu en un seul endroit — PNJ rencontrés, quêtes classiques, quêtes PNJ, quêtes d'archipel, quêtes d'îles sauvages, Quêtes du Royaume
- 📖 Widget **« État d'avancement / inventaire »** : ledger dépliable en **17 thèmes** (armes, protections, nourriture, potions, engins, trésors, selles, familiers, mondes, PNJ rencontrés, cimetière des équipements, quêtes classiques/PNJ/archipel/îles sauvages/Royaume) avec icônes ✅/❌ — corrigé pour refléter fidèlement la besace, l'équipement actif et les familiers apprivoisés
- 👥 Équipe multi-joueurs avec chat temps réel (Firebase RTDB)
- 🎮 Widgets personnalisés créés par l'admin, rendus dynamiquement — chacun **activable/désactivable individuellement** depuis Administration
- 🖱️ Toutes les fenêtres : glisser sans (ré)ouvrir accidentellement, clic droit → recentrage à l'écran, z-order/focus fiabilisé (une fenêtre active ne passe plus sous une autre par erreur)
- ⚙️ Bouton « Administration » visible si le wallet connecté est owner du contrat

### Panneau d'administration (owner only) — sommaire vertical + 30 rubriques
- 🗂️ **Sommaire vertical** de navigation rapide entre toutes les rubriques (ancre `#admin-sec-xxx`)
- 💰 Solde trésorerie + solde contrat (temps réel)
- 📊 **Statistiques par joueur** fiables (correction du bug XP désynchronisé), incluant désormais le **temps total de jeu** et le **temps de jeu sur 24 h glissantes** (suivi paramétrable) + génération de **factures PDF** (jsPDF, historique on-chain + liens Etherscan)
- ⭐ **Barème de reconnaissance** (~20 sous-sections : combat, humeur/météo/saisons, équipement, huttes, sommeil, oxygène, fatigue, altitude, profondeur, îles, pop-up profondeur/altitude, Royaume, Zorghon, onboarding, widget « État d'avancement »…), incluant désormais la **cadence de déplacement** (intervalle marche/course + seuil de maintien avant de courir, 1,5 s par défaut, partagé Plateforme 2D/3D), la **Plateforme 3D** (équipement visible sur Synk, saut/escalade, seuils de dégâts/mort par chute en cubes, redimensionnement, monde sous-marin, et un tableau de flags par objet — obstacle/escaladable/aquatique/**échelle**/**décor 3D** — pour tout décor du jeu), le **Dé d'Action D&D** (activation, % de chance face au 2d20 classique, type de dé d4→d100, gains par face, objet Ultra rare) ainsi que l'**Accès Démo & paiement fiat** (activation, plafonds de connexions simultanées, portefeuille virtuel de départ, moyens de paiement fiat activables individuellement, mode simulation)
- 👁️ **Paramétrage de Synk** : activation et fréquence du clignement des yeux (pupilles) de Synk en Plateforme 3D
- 💳 Presets de rechargement wallet · 💳 Presets de paiement fiat (CB/PayPal/Apple Pay/Google Pay) · 🎟️ **Demandes d'accès Démo** (file d'attente valider/rejeter) · 🐲 Catalogue Familiers · ⚔️ Catalogue Équipement · 🍖 Catalogue Nourriture · 🧪 Catalogue Potions & Sortilèges · ⚗️ **Combinaisons de Potions / Élixirs** (`PotionComboAdminPanel.tsx` : ingrédients dynamiques, type d'effet, durée, multiplicateur de Force, objet unique offert)
- 🗺️ Filtres Mapmonde par défaut · 🧭 Navigation Mapmonde (zoom/pan) · 💬 Scripts de dialogue PNJ · 🧩 **Widgets personnalisés** (créés par l'admin **et** activation/désactivation des widgets flottants existants du jeu) · 📦 DLC / Packs de contenu (saisons narratives)
- 🧙 Ajouter quêtes énigmes / PNJ / trésors / mondes / points d'intérêt carte
- ⚔️ Difficulté globale · 🌤️ Météo forcée · 🍂 Saisons · 🌕 Pleine lune · 🧙 Fréquence PNJ · 💰 Prix de nourrissage · ⏱️ **Cooldowns de nourrissage** (par type + interrupteur d'affichage de la rubrique « Nourrir Synk » + interrupteur des boutons on-chain)
- 💬 **Historique chat** avec dropdown de tous les salons
- 🤖 **Intelligence IA GamePlay** : DAU/rétention 7j-30j, temps passé par widget, entonnoir de quêtes, **carte des zones fréquentées avec noms de lore** (« Prairie des 3 Cerfs », « Abreuvoir originel de Perrughias »…) et heatmaps d'évanouissements, **suivi ciblé par joueur activable/désactivable individuellement**, score de risque de décrochage, signaux de monétisation & rencontres PNJ, et un **assistant IA 100% gratuit avec repli automatique multi-fournisseur** (Google Gemini → Groq → Cerebras → OpenRouter, tous gratuits) qui génère analyses et recommandations
- ⏸️ Pause/Unpause + retrait de fonds · ↩️ Bouton « Retour au jeu »

## 🐛 Bugs corrigés (historique)

| Bug                                                        | Solution                                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| MetaMask « transaction va probablement échouer » sur feed  | Ajout de `setFeedCooldown` on-chain + cooldowns réglables admin                                   |
| Énigme retourne « RP » / « Gas limit too high »            | `normalizeAnswer()` (NFD, lowercase, trim) côté client ET script deploy + `simulateContract` preflight avant `writeContract` |
| Prix/cooldown dropdown admin ne se rafraîchit pas          | `useReadContract` sur l'index sélectionné + `useEffect` peuplant l'input à chaque changement      |
| Chat sans identification                                   | Pseudo obligatoire (par défaut = nom de Synk), banner d'alerte tant qu'il n'est pas saisi       |
| Perte de données au redéploiement de contrat               | Migration off-chain vers Firebase RTDB (clé = adresse wallet)                                     |
| Expo SDK 51 incompatible Expo Go                           | Bumped mobile app to SDK 54                                                                       |
| Fatigue ne diminuait pas en maintenant les touches de déplacement | Correction du timer de drain de fatigue dans `GameCanvas2D.tsx` (accumulation du temps maintenu) |
| XP « Statistiques par joueur » (admin) désynchronisée de l'XP en jeu | Lecture harmonisée sur la même source Firebase (`players/{addr}`) au lieu d'un calcul on-chain obsolète |
| Objets de la besace (armes/protections/potions/nourriture/engins/selles/familiers) absents du widget « État d'avancement / inventaire » | `getPlayerProgressLedger()` interroge désormais aussi `itemsEverOwned`, l'équipement actif et les familiers apprivoisés, pas seulement l'inventaire courant |
| Impossible de retirer un équipement (croix rouge) dans « Équipement Synk » | Handler de clic mal attaché après la migration du drag-and-drop — recâblé sur l'événement natif du slot |
| Police trop grande débordant du compartiment équipement (ex. « Thunderfury ») | Taille de police adaptative + troncature avec info-bulle (titre complet au survol) |
| Usure d'une arme réinitialisée au déséquipement/ré-équipement | Durabilité désormais persistée dans `players/{addr}/equipment/{slot}` et restaurée telle quelle |
| Glisser un widget flottant l'ouvrait toujours accidentellement | `useDraggableWidget.ts` : distinction fiable clic/glissé via un `movedRef` (ref, pas state) |
| Widget « Quêtes du Royaume » affichant 0% pour des quêtes déjà réussies | Lecture de la progression harmonisée sur la même clé Firebase que celle utilisée pour l'écrire |
| Nourrir Synk en journalier bloquait à tort le festin hebdomadaire (et le banquet mensuel / rituel annuel) | Cooldown on-chain désormais suivi **par type de repas** (`lastFedAtByType`) au lieu d'un unique horodatage partagé — correctif prêt, en attente de redéploiement du contrat Sepolia (voir docs/ROADMAP.md) ; boutons on-chain masqués par défaut en attendant, nourrissage possible via la Boutique |
| Plateforme 3D : Synk bloqué/« mort par chute » en posant le premier pied sur une dalle de montagne alors qu'il était au sol | `worldTerrain.ts` attribue le terrain de chaque dalle sans lissage avec ses voisines (herbe pouvant jouxter une dalle de très haute altitude) — les dégâts/mort de chute ne se calculent désormais qu'entre deux dalles **toutes deux** de type montagne, jamais sur le premier pas sol → montagne |
| Plateforme 3D : jambes/pieds de Synk invisibles, arbres traversables, doublons de tuiles en bordure | Décalage de sol ajouté au modèle 3D, système de **flags par objet** (obstacle/escaladable/aquatique) appliqué aux arbres/rochers/PNJ, correction du calcul de bordure de tuiles |
| Plateforme 3D : la course ne se déclenchait jamais en maintenant une touche/le pavé virtuel | `useHoldMovement.ts` mémoïsé pour éviter que l'effet clavier ne le recrée (et n'annule le minuteur de course) à chaque rendu ; `setPointerCapture`/`preventDefault` sur le pavé virtuel pour éviter un relâchement prématuré |
| Plateforme 3D/2D : déplacement erratique (diagonales/allers-retours parasites) en maintenant une touche | Direction monde figée pour toute la durée d'un maintien (ré-échantillonnage de l'angle caméra uniquement sur un changement réel de touche, pas à chaque tick) |
| Plateforme 3D : caméra suiveuse instable (rotation erratique, bloquait tout déplacement) | `OrbitControls` (drei) appelle déjà `update()` à chaque frame — la caméra suiveuse n'injecte plus qu'une impulsion dans `controls._sphericalDelta.theta` au lieu de repositionner la caméra et rappeler `update()` elle-même |
| Plateforme 3D : course impossible / Synk marchait sur place après une rotation manuelle de la caméra | La caméra suiveuse remontait l'angle réel encore en transition à la résolution de direction (`rotateInputByCameraYaw`), créant une boucle de rétroaction — elle remonte désormais sa cible analytique stable (`facing + π`) pendant la marche, l'angle réel dès que Synk est à l'arrêt |
| Plateforme 3D : second pop-up « Synk se noie » affiché en haut d'une montagne (épuisement, pas noyade) | Le pop-up de noyade ne s'affiche désormais que si Synk est réellement dans l'eau |
| Plateforme 3D : plantage (`ErrorBoundary`) à l'affichage d'une hutte, tout le widget devenait noir | Une rotation placée par erreur sur `<coneGeometry rotation-y>` (une géométrie n'a pas de `rotation`) au lieu du `<mesh>` parent — déplacée sur le mesh |
| Plateforme 3D : erreur JS répétée à chaque frame de marche (« Cannot read properties of undefined (reading 'theta') »), badge « 1 error » affiché en jeu | La version de `three-stdlib` installée n'expose plus `_sphericalDelta` comme champ public sur `OrbitControls` (variable interne à la fermeture du constructeur) — écriture protégée par une garde défensive, sans régression sur le reste de la caméra suiveuse |
| Plateforme 3D : déplacement TOUJOURS erratique malgré tous les correctifs ci-dessus (va-et-vient, rotation sur place, glissé-souris qui déplaçait Synk au lieu d'orbiter, course qui ne s'affichait jamais) — **5 tentatives de correctif infructueuses** | ✅ **Correctif définitif (verrouillé, voir docs/ARCHITECTURE.md § Déplacement Plateforme 3D)** : suppression **intégrale** de la caméra-relative et de la caméra suiveuse (chase-cam) — déplacement désormais en **repère MONDE FIXE**, strictement identique à la Plateforme 2D, **caméra 100% orbite libre** jamais repositionnée par le code (élimine structurellement toute boucle de rétroaction) ; garde-fou anti-glissé (seuil 6px) pour empêcher un glissé-souris de déclencher un clic-déplacement ; correctif du trou de cadence marche→course dans `useHoldMovement.ts` qui empêchait l'affichage stable de la course. Vérifié exhaustivement par Playwright (12 appuis directionnels, maintien >1,5s dans les 4 directions, glissé-souris, clic simple) |
| Suppression d'un compte joueur (admin) laissait le compte Firebase Auth orphelin — impossible de le recréer avec la même adresse e-mail | `deletePlayerAccount()`/`deleteAllPlayers()` suppriment désormais aussi l'utilisateur Firebase Auth (`api/admin/delete-account`, `uid` ou `email`) |
| Déploiements Vercel figés sur un ancien commit malgré `git push` répétés et clics sur « Redeploy » | Cron des rapports programmés passé de toutes les heures à une fois par jour — le plan Vercel Hobby limite les Cron Jobs à 1×/jour, un cron plus fréquent faisait échouer tout déploiement à la dernière étape (voir `docs/EMAIL_NOTIFICATIONS.md`) |
| Reset de mot de passe/suppression de compte : page d'erreur générique 500 au lieu d'un message clair | `jose@6` (ESM pur) incompatible avec `jwks-rsa@4` (dépendance de `firebase-admin`) faisait planter le chargement du module — épinglage ciblé de `jose@5` via `overrides` npm dans l'arbre de `jwks-rsa` uniquement |
| Widget « Lancer de dés » mal positionné (tombait en bas de la très longue page /game, dépendant du scroll) après ouverture/fermeture ou rechargement | Le bouton réduit portait à la fois les classes Tailwind `fixed` **et** `relative` — `relative` gagnait le conflit de spécificité CSS et le widget retombait dans le flux normal du document ; classe redondante supprimée + `useDraggableWidget.ts` re-clampe désormais la position à la taille réellement rendue (`getBoundingClientRect`) à chaque ouverture/fermeture et redimensionnement de fenêtre |
| Fenêtres widget qui passent sous une autre malgré le focus, ou icônes réduites qui se posent au-dessus d'une fenêtre ouverte ayant le focus | Deux bugs cumulés : (1) `onPointerDownCapture` posé sur tout le conteneur du widget interceptait le clic sur le bouton de fermeture (✕) en phase de capture *avant* qu'il n'atteigne le bouton, remontant à tort le widget qu'on venait de fermer ; (2) le callback `onExpand` (`bringToFront`) était appelé en effet de bord *impur* dans le updater fonctionnel de `setCollapsed`, doublé par le Strict Mode de React 18 en dev, consommant deux crans de z-index par ouverture — corrigés respectivement par un garde `data-widget-close` dans `handleWidgetPointerDownCapture()` (appliqué aux 16 fenêtres flottantes) et par le déplacement de l'appel dans un `useEffect` dédié à la transition réelle `collapsed:true→false` |
| Dé d'Action D&D (Flight/Fight/Freeze/Fawn) : le mécanisme classique semblait favorisé au lieu d'un tirage 50/50 lors des combats PNJ | Bug de course : la décision du mécanisme (classique vs Dé d'Action) était posée dans un `useEffect` (asynchrone, après le rendu), laissant un court instant où le bouton classique restait affiché **et cliquable** avant l'application de la décision réelle — remplacé par `useLayoutEffect` (appliqué avant le paint du navigateur) ; confirmé ~50/50 via Playwright sur plusieurs séries de combats forcés |

## 📚 Documentation

- [Architecture](./docs/ARCHITECTURE.md)
- [Déploiement + variables d'environnement Vercel/contrats](./docs/DEPLOYMENT.md)
- [Firebase (chat + off-chain) + **règles de sécurité RTDB à jour**](./docs/FIREBASE_CHAT.md) ← **à republier à chaque merge touchant les chemins RTDB**
- [Lore & univers Synk](./docs/LORE.md)
- [Accès Démo & Paiement fiat (sans portefeuille crypto)](./docs/DEMO_FIAT.md)
- [E-mails automatiques & annonces en direct (comptes sécurisés, rapports, reset mot de passe)](./docs/EMAIL_NOTIFICATIONS.md)
- [Roadmap Phases 2/3/4](./docs/ROADMAP.md)

## 📸 Communauté

Instagram : `@horizon.zeldcraft` *(à créer manuellement — voir docs/ROADMAP.md)*

## 📄 Licence

MIT © 2026 — Horizon ZeldCraft
