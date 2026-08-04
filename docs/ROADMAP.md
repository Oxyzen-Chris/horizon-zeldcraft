# 🗺️ Roadmap

## ✅ Phase 1 — MVP (livré)

- [x] Smart contract Solidity (ERC-721, staking feed, catalogue, quêtes)
- [x] Tests Hardhat
- [x] Front Next.js + wagmi + RainbowKit
- [x] Sélecteur Sepolia/Mainnet
- [x] i18n FR/EN/ES/PT (1269 clés × 4 langues)
- [x] Admin panel
- [x] Mobile Expo (dashboard basique)
- [x] Skins pixel-art Synk (5 stades, façon Link/Minecraft)
- [x] Documentation

## ✅ Phase 1.5 — Écosystème off-chain & narratif (livré)

Le cœur de jeu a considérablement grandi au-delà du MVP initial, entièrement hors-chaîne
(Firebase RTDB), sans jamais redéployer le smart contract :

- [x] Migration on-chain → off-chain de tout le contenu de jeu (0 gas pour créer/résoudre une quête,
      ajouter un PNJ, un familier, une arme…)
- [x] **Trame narrative principale** : Zorghon le Maléfique, PocaPoka, El Pipo, 5 Fragments du
      Sceau Runique, 40 chapitres × 10 quêtes = **400 Quêtes du Royaume**
- [x] Quêtes classiques, PNJ (intermédiaires), archipel, îles sauvages, pleine lune (40/400)
- [x] Système de familiers (Dragon d'Or + catalogue admin) et selles/chevauchée
- [x] Catalogue Équipement étendu (armes, protections, casques/bandanas/habits/gants/bottes… —
      60+60 nouveaux articles, inspirés Tolkien/WoW/Zelda/Minecraft)
- [x] Usure des équipements persistante (durabilité conservée au déséquipement) + auto-déséquipement
      à 0% + **Cimetière des équipements**
- [x] Catalogue Nourriture, catalogue Potions & Sortilèges (dont super-fioles de stats)
- [x] Boutique (achat/vente) + widget flottant dédié
- [x] Mapmonde étendue : mers/océans/lacs/rivières, îles/archipels, engins de transport (radeaux,
      bateaux, galions, cerfs-volants…) requis pour y accéder
- [x] Dalles de montagne (altitude 0–6000 m) et dalles d'eau (profondeur) avec raréfaction de
      l'air/drain d'oxygène et de fatigue accentué en altitude/profondeur
- [x] Pop-up clignotant non bloquant profondeur/altitude (paramétrable admin : position, texte)
- [x] Articulation visuelle de Synk en 8 directions (dont diagonales) dans la Plateforme 2D
- [x] Cycle de saisons (calendrier réel) + météo cohérente + impact sur le bonheur
- [x] Système de pleine lune (calendrier réel + override admin par mois)
- [x] Système d'encounters PNJ avec scripts de dialogue à réactions (paramétrables admin)
- [x] Widget « Quêtes du Royaume », widget « Aides » (onboarding rejouable), widget « État
      d'avancement / inventaire » (ledger dépliable, 17 thèmes)
- [x] Onboarding en 3 écrans ludiques (bienvenue/stades, lore & quêtes, guide des widgets)
- [x] Widgets personnalisés créables sans redéploiement (`CustomWidgetsAdminPanel`)
- [x] Filtres et réglages de navigation Mapmonde paramétrables admin
- [x] Architecture DLC / Packs de contenu pour les futures saisons narratives (post-Zorghon)
- [x] Statistiques par joueur fiables dans `/admin` (correction bug XP désynchronisé) + facture
      PDF avec historique de transactions on-chain
- [x] Barème de reconnaissance entièrement paramétrable (~20 sous-sections)
- [x] Infrastructure widgets flottants unifiée : drag/collapse fiable (plus de ré-ouverture
      accidentelle au glissé), clic droit → recentrage à l'écran
- [x] **Intelligence IA GamePlay** (`/admin`) : analyse évolutive du comportement des joueurs
      (DAU/rétention 7j-30j, temps passé par widget, entonnoir de quêtes, heatmaps de zones
      visitées et d'évanouissements, score de risque de décrochage par joueur, signaux de
      monétisation et de rencontres PNJ) + assistant IA gratuit (Google Gemini) pour générer
      analyses et recommandations — base de données pour orienter les futures évolutions du jeu
      et concevoir de nouveaux services

## ⚠️ Dette technique connue — redéploiement du smart contract à prévoir

- **Bug de cooldown des repas on-chain partagé entre les 4 types** (`feed()` dans
  `HorizonZeldCraft.sol`) : le contrat actuellement déployé sur **Sepolia** utilise un unique
  horodatage `Voxlyn.lastFedAt` partagé par les repas journalier/hebdomadaire/mensuel/annuel à la
  fois pour le calcul de la faim ET pour le cooldown de chaque bouton. Résultat : nourrir Synk avec
  un « repas journalier » réinitialise ce même horodatage et bloque à tort, temporairement, le
  « festin hebdomadaire » (et de la même façon le « banquet mensuel »/« rituel annuel »).
  - **Correctif déjà écrit et testé** dans le code source : ajout d'un mapping dédié
    `mapping(uint256 => mapping(FeedType => uint64)) public lastFedAtByType;`, utilisé uniquement
    pour le cooldown de chaque type de repas ; `Voxlyn.lastFedAt` continue de servir uniquement au
    calcul de la faim (`currentHunger()`), ce qui est correct et inchangé. 2 tests de non-régression
    ajoutés dans `contracts/test/HorizonZeldCraft.test.ts` (12/12 tests passent).
  - **Non déployé sur Sepolia pour le moment** : le contrat n'est pas upgradable (pas de proxy/UUPS),
    donc appliquer ce correctif nécessite un **redéploiement complet à une nouvelle adresse**, ce
    qui réinitialiserait le(s) Voxlyn déjà mintés (xp/niveau/stade/faim) ainsi que les équipes
    on-chain existantes. Décision prise avec le porteur du projet : **redéploiement différé** pour
    ne pas perdre la progression en cours.
  - **Mesure de contournement en place immédiatement** : les 4 boutons de repas on-chain sont
    désormais **masqués et désactivés par défaut** dans le jeu (`RepRules.onchainFeedButtonsEnabled`,
    défaut `false` — voir `Administration > Widgets personnalisés`, section « Repas on-chain de
    Synk »), avec un message expliquant que le nourrissage/soin de Synk reste possible via la
    Boutique (achats hors-chaîne, sans le bug). L'admin peut réactiver ces boutons malgré le bug
    connu depuis ce même panneau s'il le souhaite.
  - **Procédure de redéploiement** (à faire quand la remise à zéro de la progression sera acceptable,
    par exemple au lancement d'une nouvelle saison narrative) :
    1. `cd contracts && npx hardhat run scripts/deploy.ts --network sepolia` (les fonctions
       `addQuest`/`addNpc`/`addTreasure`/`addWorld`/`addCatalogItem` du script de seed sont
       aujourd'hui des chemins morts côté front — tout ce contenu vit dans Firebase — donc leur
       réexécution au déploiement est sans risque mais optionnelle/skippable).
    2. Mettre à jour `NEXT_PUBLIC_CONTRACT_ADDRESS_SEPOLIA` dans `web/.env.local` **et** dans les
       variables d'environnement du projet Vercel (Production + Preview).
    3. Vérifier le contrat sur Etherscan (`npx hardhat verify --network sepolia <adresse> ...`).
    4. Repasser `RepRules.onchainFeedButtonsEnabled` à `true` depuis `Administration > Widgets
       personnalisés` une fois la nouvelle adresse en production.
    5. Communiquer aux joueurs (Instagram, in-game) la réinitialisation de leur Voxlyn on-chain
       avant de redéployer.

## 🔜 Phase 2 — Moteur de jeu

> **Réordonnancée avant l'ex-Phase 2 "Auth sociale & UX"** (devenue Phase 3, voir juste après) à la
> demande du porteur du projet, pour prioriser la Plateforme 3D et l'écosystème de jeu avant les
> évolutions d'authentification/UX.

- [x] **Choix moteur : Three.js / React Three Fiber** (et non un moteur Godot/Unity/Unreal séparé)
      pour le widget « Plateforme 3D » ci-dessous — décision technique prise avec le porteur du
      projet : un vrai projet Godot 4 est une application autonome (éditeur GDScript, pipeline
      d'export WebGL/wasm, pont JS↔Godot) qui ne peut pas fonctionner comme un widget React
      synchronisé en temps réel avec l'état de jeu existant (Firebase RTDB, `players/{addr}/mapPos`)
      sans une réécriture majeure et déconnectée du reste de l'app Next.js. Three.js/React Three
      Fiber s'intègre nativement comme composant React (`Platform3DWidget.tsx`), sans pipeline de
      build externe, disponible immédiatement sur web ET mobile (navigateur Expo Go/WebView).
      **Godot 4 reste documenté ci-dessous comme portage natif optionnel et futur**, hors périmètre
      du widget web actuel (à envisager uniquement si un besoin de performances/portabilité native
      (store mobile, console) apparaît).
- [ ] *(Optionnel, futur)* SDK Web3 pour un éventuel portage natif **Godot 4** (via GDNative → ethers)
      si un jeu natif distinct (store mobile/PC) est un jour lancé en parallèle du widget web.
- [x] Widget « Plateforme 3D » (`web/src/components/Platform3DWidget.tsx`) — rendu 3D façon
      Minecraft (voxels/blocs) de Synk et de tout son univers (PNJ, familiers, monstres, Zorghon/
      PocaPoka/El Pipo, huttes, eau, montagnes, trésors, décor), réutilisant tel quel le modèle de
      tuile (`worldTerrain.ts`, altitude/profondeur — voir `docs/ARCHITECTURE.md` § Modèle de
      terrain) et le catalogue de marqueurs (`getAllMapMarkers`), synchronisé EN TEMPS RÉEL (même
      `players/{addr}/mapPos`) avec la Plateforme 2D isométrique et la Mapmonde. Déplacements au
      clavier (flèches/WASD), à la souris (clic sur une case, glisser pour orbiter la caméra) et au
      pavé directionnel virtuel — même logique que la Plateforme 2D isométrique. Mécanique de
      nage/immersion (profondeur, dalles d'eau) purement visuelle : la décroissance/récupération
      d'oxygène et de fatigue reste intégralement pilotée par `GameCanvas2D.tsx` (toujours monté),
      ce widget n'étant qu'une vue et un canal de déplacement supplémentaires — zéro nouvelle
      mécanique, zéro risque de double-décompte. Activable/désactivable dans
      `Administration > Widgets personnalisés` (`RepRules.platform3dWidgetEnabled`).
- [ ] Prototype donjon 1 (Forêt de Zephyria) : déplacement, combat, loot (au-delà de l'exploration
      libre déjà couverte par le widget « Plateforme 3D »)
- [ ] Sync inventaire on-chain ↔ jeu
- [ ] Boss & PNJ scriptés en 3D (au-delà des scripts de dialogue textuels actuels et de la
      matérialisation statique déjà en place dans le widget « Plateforme 3D »)
- [ ] Multi-joueur (Nakama server)

## 🔜 Phase 3 — Auth sociale & UX

- [ ] Web3Auth ou Privy pour login Gmail/X/Discord/Apple/Github
- [ ] Animations Framer Motion sur Synk
- [ ] Notifications push (Expo Notifications) : "Synk a faim !"
- [ ] Système d'amis / classement (au-delà du `/scoreboard` actuel)
- [ ] Deploy Instagram + kit contenu 30 posts (voir `docs/DEPLOYMENT.md` § Réseaux sociaux)
- [ ] Premier DLC / saison narrative post-Zorghon (utilisant l'architecture Content Packs livrée)

## 💳 Phase 4 — Paiements fiat

- [ ] Intégration Stripe (CB, Apple Pay)
- [ ] PayPal SDK
- [ ] On-ramp crypto (MoonPay, Ramp)
- [ ] KYC si volume > 1000€ (conformité MiCA UE)

## 🌐 Phase 5 — Scale

- [ ] Migration UUPS proxy (upgradeabilité)
- [ ] L2 : Base ou Arbitrum pour gas réduits
- [ ] DAO governance (token $VOX)
- [ ] Marketplace secondaire pour skins/items
