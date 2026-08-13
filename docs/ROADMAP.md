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

### 🎥 Historique — stabilisation des déplacements & de la caméra en Plateforme 3D

Plusieurs itérations ont été nécessaires pour fiabiliser complètement le déplacement/la caméra du
widget « Plateforme 3D » (et par ricochet la Plateforme 2D isométrique, qui partage le même moteur
de déplacement `useHoldMovement.ts`) :

- **Faux blocage d'escalade / mort par chute alors que Synk était au sol** : `worldTerrain.ts`
  attribue le type de terrain de chaque dalle indépendamment (pas de lissage avec les dalles
  voisines), si bien qu'une dalle d'herbe pouvait jouxter directement une dalle de montagne de très
  haute altitude. Corrigé en ne calculant un dénivelé (et donc des dégâts/mort de chute) qu'entre
  deux dalles **toutes deux** de type montagne (jamais sur le tout premier pas sol → montagne, qui
  reste gratuit mais toujours soumis au saut + `climbable`).
- **Caméra suiveuse instable (rotation erratique, immobilisait Synk)** : `@react-three/drei`
  `<OrbitControls enableDamping>` appelle déjà `controls.update()` automatiquement à chaque frame ;
  une première version de la caméra suiveuse appelait `update()` une seconde fois après avoir
  positionné la caméra manuellement, créant une double mise à jour concurrente. Corrigé en
  n'injectant qu'une petite impulsion dans `controls._sphericalDelta.theta` (le mécanisme interne
  qu'utilise déjà OrbitControls pour un glissé de souris), sans jamais toucher à `object.position`
  ni appeler `update()` soi-même.
- **Course impossible en maintenant une touche / Synk marchait sur place après une rotation
  manuelle de la caméra** : la caméra suiveuse remontait l'angle RÉEL (encore en cours de rotation)
  au module de résolution de direction (`rotateInputByCameraYaw`), qui pouvait alors échantillonner
  une valeur transitoire/instable au moment d'un nouvel appui clavier, résolvant parfois une
  direction bloquée. Corrigé en ne remontant, PENDANT que la caméra suiveuse est engagée, que sa
  cible analytique stable (`FACING_ANGLE[facing] + π`) plutôt que l'angle réel en transition —
  l'angle réel reste utilisé normalement dès que Synk est à l'arrêt (orbite libre inchangée).

**Résultat validé par le porteur du projet** : Synk grimpe désormais correctement sur les blocs de
montagne avec Espace + direction Haut, y compris caméra suiveuse active. Cette configuration
(`Scene`'s `useFrame` dans `Platform3DWidget.tsx`) est la référence à ne plus modifier sans une
raison impérieuse, pour éviter de réintroduire l'une de ces régressions.

### 🚑 Historique — déploiement Vercel figé sur un ancien commit (« Redeploy » trompeur)

Après l'ajout des e-mails automatiques (§ Phase 4), plusieurs `git push` successifs semblaient ne
jamais atteindre la production, malgré de multiples clics sur « Redeploy » dans le dashboard
Vercel :

- **Cause racine** : `web/vercel.json` déclarait un cron **horaire** (`0 * * * *`) pour
  `/api/email/cron-reports`, or le plan Vercel **Hobby limite les Cron Jobs à 1 exécution par
  jour**. Le *build* réussissait toujours, mais le déploiement échouait silencieusement à la toute
  dernière étape (« Deploying outputs... »).
- **Pourquoi « Redeploy » semblait « marcher »** : ce bouton **rejoue le dernier build réussi**
  (donc un commit ANTÉRIEUR au cron cassé) — il ne récupère jamais le `main` courant. D'où
  l'illusion d'un déploiement qui « fonctionne » mais n'affiche jamais les derniers commits.
- **Diagnostic utilisé** : comparer via `curl` une route connue récente entre attendu et
  production (404 = route absente = build antérieur à son commit d'introduction) ; `vercel logs`
  pour voir l'erreur exacte de la dernière tentative de déploiement Git.
- **Correctif** : cron repassé à une fois par jour (`0 8 * * *`) — voir `docs/EMAIL_NOTIFICATIONS.md`
  § Piège de déploiement. Depuis ce correctif, un simple `git push` suffit à nouveau pour déployer
  automatiquement (retour à la convention normale du projet — ne pas cumuler `git push` et
  `vercel --prod` manuel en usage courant, uniquement en cas de nouveau blocage à diagnostiquer).

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
  - [x] **Synk détaillé et articulé** : yeux, nez, bouche, oreilles, cheveux/casque, torse, deux bras
        et deux jambes qui se balancent naturellement en marche/course, plus l'équipement
        RÉELLEMENT porté (voir `EquipmentWidget.tsx`) rendu en 3D sur le modèle — épée/arc dans le
        dos, flèches en carquois, bouclier, casque/bonnet, amulette, ceinture, chausses, bottes,
        gants — désactivable (`RepRules.platform3dEquipmentRenderEnabled`).
  - [x] **Maintien = marche, maintien prolongé (1,5 s, réglable) = course**, identique clavier/
        pavé virtuel/souris et partagé avec la Plateforme 2D isométrique (`useHoldMovement.ts`,
        `RepRules.movementWalkStepMs/movementRunStepMs/movementRunHoldThresholdMs`).
  - [x] **Obstacles & flags par objet paramétrables admin** : arbres, rochers, PNJ et tout autre
        décor peuvent être marqués individuellement « obstacle » (bloque le passage, clic gauche
        pour interagir comme en 2D), « escaladable » ou « aquatique » depuis
        `Administration > Widgets personnalisés` (`RepRules.platform3dObjectFlags`).
  - [x] **Escalade par cubes avec Espace + direction** : saut arqué sur un bloc de montagne en face
        puis marche sur le relief (hauteur suivie dynamiquement), descente libre ; limites de
        dénivelé configurables déclenchant dégâts mineurs ou chute mortelle avec réanimation
        automatique (`RepRules.platform3dCubeHeightM/platform3dFallDamage*/platform3dFallDeath*`).
  - [x] **Immersion & monde sous-marin** : mi-torse automatique sur une dalle d'eau, menu clic droit
        pour plonger entièrement et explorer un monde sous-marin dédié (poissons/créatures marines
        générés, nage libre bornée), dont une dizaine de lacs/bassins ajoutés à la carte pour
        varier les zones de baignade (`RepRules.platform3dUnderwater*`).
  - [x] **Caméra suiveuse (« chase cam »)** : se replace en douceur derrière Synk dans son sens de
        déplacement pendant la marche/course (même si le joueur a réorbité manuellement à la
        souris), sans jamais entrer en conflit avec l'orbite libre au repos ni avec la résolution de
        direction du déplacement relatif à la caméra — activable/désactivable
        (`RepRules.platform3dChaseCameraEnabled`).
  - [x] **Fenêtre redimensionnable jusqu'au plein écran** (`RepRules.platform3dResizableEnabled`).
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

- [x] **Paiement fiat sans intégration Stripe/PayPal réelle (mode simulation)** : boutons CB/PayPal/
      Apple Pay/Google Pay disponibles dès aujourd'hui dans le widget « Rechargement du
      portefeuille » et la page Portefeuille, pour TOUS les comptes (portefeuille crypto, Démo,
      Fiat) — voir `docs/DEMO_FIAT.md`. Crédite instantanément la monnaie de jeu hors-chaîne
      (`RepRules.fiatSimulationMode`, `true` par défaut), sans gas ni portefeuille requis.
      Bascule 1 pour 1 vers un vrai Stripe Checkout Session (carte + PayPal + Apple Pay + Google Pay
      en une seule intégration) une fois les clés API fournies, sans changement d'UI/de logique
      métier côté joueur (`useFiatTopup.ts`).
- [x] **Accès Démo / compte sans portefeuille crypto** (voir `docs/DEMO_FIAT.md`) : nouveau bouton
      « 🎟️ Accès Démo » et bouton « 💳 Jouer sans portefeuille » (Google ou e-mail/mot de passe,
      accès **immédiat sans validation admin préalable** — journalisé a posteriori dans
      `Administration > Demandes d'accès Démo`, avec pause/suppression de compte possibles) sur la
      page d'accueil, à côté du `<ConnectButton />` RainbowKit existant.
      Identité virtuelle dérivée d'un UID Firebase Auth (`deriveVirtualAddress`), portée par un
      nouveau hook `useEffectiveAccount()` qui bascule transparemment tous les widgets de jeu entre
      portefeuille réel et session Démo/Fiat — **zéro changement de comportement pour les joueurs
      crypto existants**. Plafonds de connexions simultanées paramétrables admin
      (`RepRules.demoMaxConcurrentSessions` = 90, `demoAnonymousMaxConcurrentSessions` = 40, en
      lien avec la limite de 100 connexions du plan gratuit Firebase), portefeuille virtuel de
      départ paramétrable (`RepRules.demoInitialCoins` = 4000 coins).
- [x] **Correctifs post-lancement Démo/Fiat** (voir `docs/DEMO_FIAT.md` § Correctifs) : gel/lenteur
      extrême en mode Démo corrigé (boucle infinie Firebase due à une dépendance instable dans
      `game/page.tsx`) ; nouveau menu de déconnexion pour les sessions Démo/Fiat
      (`EffectiveAccountBadge.tsx`) ; nettoyage automatique d'une session Démo/Fiat oubliée dès la
      connexion d'un vrai portefeuille (évite qu'une ancienne session ne bloque le retour à l'écran
      de choix) ; ordre d'authentification corrigé dans `startAnonymousDemo()`. Validé par des
      scénarios Playwright (chargement, réactivité, déconnexion, non-régression).
- [x] **Compte e-mail/mot de passe sécurisé + e-mails automatiques + annonces en direct** (voir
      `docs/EMAIL_NOTIFICATIONS.md`) : flux explicite « Se connecter » / « Créer un compte » avec
      confirmation de mot de passe pour « Jouer sans portefeuille » ; e-mail de bienvenue (Resend,
      sans jamais divulguer le mot de passe) ; rapport de progression joueur envoyable
      immédiatement ou **programmé** (quotidien/hebdomadaire/mensuel/annuel, cron Vercel) depuis
      `Administration > Statistiques par joueur` ; message personnalisé ou envoi de masse à tous
      les joueurs (ex. maintenance) ; bandeau d'annonce en direct in-game (ciblé ou global). Tout
      paramétrable dans `Administration > Barème & règles` (section « ✉️ E-mails automatiques »).
- [x] **Reset de mot de passe (admin-forcé + auto-service joueur)** (voir
      `docs/EMAIL_NOTIFICATIONS.md` § Reset mot de passe) : bouton admin « 🔑 Reset mot de passe »
      dans `Statistiques par joueur > Zone de danger` (mot de passe fort 12 caractères généré,
      affiché en clair une seule fois, envoyé par e-mail) ; bouton en jeu à côté de l'adresse
      virtuelle pour un changement volontaire par le joueur (confirmation + e-mail de sécurité sans
      divulguer le mot de passe) ; compteur `passwordResetCount` partagé et affiché dans les
      statistiques.
- [x] **Correctifs post-lancement — suppression de compte & stabilité des déploiements** (voir
      `docs/EMAIL_NOTIFICATIONS.md` § Suppression complète / § Piège de déploiement) :
      `deletePlayerAccount()`/`deleteAllPlayers()` suppriment désormais aussi le compte **Firebase
      Auth** sous-jacent (plus de compte « orphelin » bloquant la recréation avec la même adresse
      e-mail) ; `getOrCreatePlayer()` rétro-complète `authMethod`/`uid`/`email` sur les comptes
      existants qui en étaient dépourvus ; nouvelle route `POST /api/admin/delete-account` (`uid`
      **ou** `email`, pour rattraper les comptes déjà orphelins) ; `firebaseAdmin.ts` sécurisé
      contre un crash au chargement du module (`try/catch` autour de l'initialisation + dépendance
      `jose`/`jwks-rsa` épinglée via `overrides` npm, voir `docs/EMAIL_NOTIFICATIONS.md`) ; cron
      des rapports programmés repassé à une fois par jour (`0 8 * * *`, le plan Vercel Hobby
      limitant les Cron Jobs à 1×/jour — un cron plus fréquent faisait échouer silencieusement
      **tout** déploiement Git, le bouton « Redeploy » masquant le problème en rejouant un ancien
      build réussi).
- [x] **Correctifs post-lancement — réactivation Démo, fausse erreur de suppression, annonces en
      direct, message Resend clair** (voir `docs/EMAIL_NOTIFICATIONS.md`) : `logAccountAccess()`
      préservait mal `demoSessionStartedAt` (un joueur réactivé par l'admin restait bloqué
      « session expirée ») ; `deletePlayerAccount()`/`deleteAllPlayers()` isolent désormais le
      nettoyage best-effort de `announcements/*` (règles RTDB manquantes, ajoutées à
      `docs/FIREBASE_CHAT.md`) pour ne plus jamais afficher de fausse erreur de suppression ;
      widget de compte à rebours Démo repositionné en haut à droite ; erreur Resend 403 (mode test)
      désormais détectée et explicitée dans l'admin.
- [x] **Durée max de session Démo personnalisable PAR JOUEUR** (voir `docs/DEMO_FIAT.md` § Durée
      max de session Démo) : `Administration > Statistiques par joueur > 🎟️ Compte Démo / sans
      portefeuille` permet désormais de fixer une durée en heures propre à un joueur donné
      (`demoAccessRequests/{uid}.maxDurationMinOverride`), prioritaire sur la valeur globale
      (`RepRules.demoSessionMaxDurationMin`, 2h par défaut) — bouton de réinitialisation pour
      revenir à la valeur globale à tout moment.
- [ ] **⚠️ Vérifier un domaine sur Resend — INDISPENSABLE avant tout passage en production**
      (voir `docs/EMAIL_NOTIFICATIONS.md` § Mode test Resend) : tant qu'aucun domaine n'est
      vérifié, Resend reste en **mode test** et n'autorise l'envoi QUE vers l'adresse e-mail du
      compte Resend lui-même — e-mail de bienvenue, rapports, messages personnalisés, envois de
      masse et annonces échouent en 403 vers toute autre adresse (ex. joueurs réels). Étapes :
      1. Acheter un nom de domaine (OVH, Gandi, Namecheap, Cloudflare Registrar — quelques €/an).
      2. [resend.com/domains](https://resend.com/domains) → **Add Domain** (idéalement un
         sous-domaine type `mail.horizon-zeldcraft.fr`, recommandé par Resend pour isoler la
         réputation d'envoi).
      3. Ajouter les enregistrements DNS (TXT SPF/DKIM, parfois MX) fournis par Resend chez le
         registrar, puis cliquer **Verify DNS** une fois propagés (jusqu'à 48h, souvent < 1h).
      4. Mettre à jour `RESEND_FROM_EMAIL` sur Vercel avec une adresse du domaine vérifié
         (ex. `jeu@mail.horizon-zeldcraft.fr`) et redéployer manuellement.
      **Bloquant pour la production réelle (Mainnet + vrais joueurs)** tant que non fait.
- [ ] Intégration Stripe réelle (CB, Apple Pay) — clés API + `api/payments/checkout/route.ts`
- [ ] PayPal SDK réel (au-delà du mode simulation déjà livré)
- [ ] On-ramp crypto (MoonPay, Ramp)
- [ ] KYC si volume > 1000€ (conformité MiCA UE)

## 🌐 Phase 5 — Scale

- [ ] Migration UUPS proxy (upgradeabilité)
- [ ] L2 : Base ou Arbitrum pour gas réduits
- [ ] DAO governance (token $VOX)
- [ ] Marketplace secondaire pour skins/items
