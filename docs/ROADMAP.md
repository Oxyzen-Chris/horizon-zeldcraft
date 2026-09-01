# 🗺️ Roadmap

## ✅ Phase 1 — MVP (livré)

- [x] Smart contract Solidity (ERC-721, staking feed, catalogue, quêtes)
- [x] Tests Hardhat
- [x] Front Next.js + wagmi + RainbowKit
- [x] Sélecteur Sepolia/Mainnet
- [x] i18n FR/EN/ES/PT (couverture complète, y compris tout le contenu procédural — voir
      `docs/ARCHITECTURE.md` § Traductions)
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
- [x] Accès Démo & paiement fiat sans portefeuille crypto (comptes e-mail/Google, coins par
      CB/PayPal/Apple Pay/Google Pay), e-mails automatiques (bienvenue, rapports, annonces),
      timer de session Démo paramétrable (durée globale + override par joueur, réactivable,
      appliqué en temps réel) — voir `docs/DEMO_FIAT.md` et `docs/EMAIL_NOTIFICATIONS.md`
- [x] Synk plus vivant en Plateforme 3D : pupilles + clignement des yeux périodique, activable et
      réglable dans `Administration > Paramétrage de Synk`
- [x] Widgets flottants : correctifs d'empilement/focus (une fenêtre active ne passe plus sous une
      autre, plus de vol de focus par le bouton de fermeture) et de positionnement (le widget
      « Lancer de dés » restait ancré au bas de la page) ; renommage « ZeldCraft Quests »
- [x] **Dé d'Action D&D** (nouveau) : lors de chaque combat PNJ obligatoire, tirage 50/50
      (paramétrable) entre le jet 2d20 classique et un dé d'action tétraédrique — Fuir (Flight),
      Combattre (Fight), Figer (Freeze) ou Négocier (Fawn), chacun avec ses propres gains/pertes
      de vie/XP/force ou objets (dont un objet Ultra rare gagnable 1×/jour). Entièrement
      paramétrable dans `Administration > Barème & règles` (activation, % de chance, type de dé
      d4→d100 avec les vrais noms de polyèdres, gains par face)
- [x] **Plateforme 3D — réalisme du décor/équipement** : sol texturé proceduralement (herbe/sable/
      sentier/roche, généré et mis en cache par type de terrain, zéro coût de performance
      supplémentaire par tuile), arbres/décor redimensionnés pour rester nettement plus grands que
      Synk (silhouettes distinctes tronc+double feuillage/baobab/palmier/bambou/hutte/château/
      portail), échelle paramétrable objet par objet dans `Administration > Barème & règles > 🧱
      Objets & décor 3D`. Équipement reconstruit en formes reconnaissables (épée lame+garde+
      poignée+pommeau, arc bois+corde+gemme, bouclier disque+bordure+umbo, casque dôme+cerclage,
      amulette chaînette+gemme facettée) avec la couleur de rareté en simple accent plutôt qu'en
      teinte uniforme. Grotte (POI Nether-Cristal) rendue en arche rocheuse + cristaux, quêtes en
      parchemin roulé flottant. Corrigé au passage : un plantage (`<coneGeometry rotation-y>` mal
      placé) et une erreur JS répétée à chaque frame de marche dans la caméra suiveuse
      (`OrbitControls._sphericalDelta` non exposé par la version de `three-stdlib` installée)
- [x] **Caméra suiveuse Plateforme 3D — vrai correctif (déplacement erratique, tête « à l'envers »
      après une réorientation manuelle à la souris)** : le garde-fou posé lors du correctif
      précédent (`&& controls._sphericalDelta`) empêchait bien le plantage JS, mais l'écriture dans
      ce champ ne faisait STRICTEMENT rien d'autre — `_sphericalDelta` n'existe pas sur l'objet
      public de la version de `three-stdlib` installée. La caméra suiveuse ne « rattrapait » donc
      plus jamais Synk après une orbite manuelle, ce qui se traduisait par un Synk vu de face/profil
      au lieu de dos (perçu comme « la tête tournée à l'inverse ») et une sensation de déplacement
      erratique dès que la vue avait été réorientée à la souris. Réécrit pour ne s'appuyer que sur
      l'API publique de `OrbitControls` (`controls.object.position`, `controls.target`,
      `controls.update()`) : à chaque frame de marche, le vecteur caméra→cible est tourné autour de
      l'axe Y d'un petit pas vers l'angle cible (`FACING_ANGLE[facing] + π`), sans jamais toucher à
      un champ interne. Vérifié via Playwright (log de l'angle azimutal réel de la caméra) : après
      une orbite manuelle, la caméra reconverge désormais bien vers la position « derrière Synk » en
      ~10 frames (~0,15 s)
- [x] **Plateforme 3D — réalisme des marqueurs de carte (PNJ/familiers/trésors/mondes/bâtisses)** :
      les marqueurs `MapMarker` (PNJ, familiers, trésors, portails de mondes, Zorghon, captifs, et
      les POI « bâtiment » — hutte/taverne/étable/village) affichaient tous, jusqu'ici, le même
      gemme octaédrique générique flottant, y compris des éléments explicitement nommés dans le jeu
      (ex. « Hôtel du Repos du Voyageur », « Dragon Vert ») — perçu par le joueur comme « l'hôtel
      ressemble à un losange blanc », « le Dragon Vert ressemble à un anneau ». Chaque `kind`/
      `poiType` a désormais sa propre silhouette reconnaissable dans `Platform3DWidget.tsx::
      MarkerBlock` : bâtiments (hutte/taverne/étable/village) → même chaumière que le décor
      `PropBlock`, fixe au sol ; familiers → `DragonMarker` (corps/cou/tête cornue/queue/ailes),
      coloré automatiquement selon l'id/libellé catalogue (`familiarDragonColor` — vert/rouge/or/
      noir/bleu/blanc/argent/bronze), puisque tout le catalogue de familiers du jeu est composé de
      dragons ; PNJ → silhouette encapuchonnée (robe + tête + bâton + orbe) ; trésor → coffre cerclé
      d'or ; monde/portail → anneau lumineux type porte des étoiles ; Zorghon → silhouette cornue
      sombre ; captif → silhouette liée. Tout `kind`/`poiType` non couvert (plaine, forêt, montagne,
      lac, chemin, pont, plage, cascade, mer/océan/étang/île) conserve EXACTEMENT le gemme précédent
      — zéro régression sur ces marqueurs décoratifs de terrain
- [x] **Combinaisons de Potions (Élixirs)** : nouveau mécanisme de fabrication dans le widget
      « Sac / Besace » (`InventoryWidget.tsx`, onglet Potions & Sortilèges) — combine plusieurs
      potions/sortilèges possédés en un Élixir surpuissant (Invulnérabilité de Vie 24h, Force
      Titanesque ×2 pendant 30min, Souffle Éternel/oxygène plein 30min, Vigueur Sans Fin/fatigue
      pleine 10min, Festin Royal/faim pleine instantané, ou une arme unique « Épée Divine de
      Lumière » non disponible en boutique). Pop-up clignotant en haut de l'écran avec sablier ⏳
      animé et décompte live (`ActiveElixirsBanner.tsx`) tant qu'un effet temporisé est actif.
      Entièrement paramétrable dans `Administration > Combinaisons de Potions / Élixirs`
      (`PotionComboAdminPanel.tsx` : ingrédients, type d'effet, durée, multiplicateur de Force,
      objet unique offert). Boucliers vie/oxygène/fatigue branchés au point d'entrée centralisé
      `applyEffect()` (zéro fichier tiers à modifier pour que l'invulnérabilité bloque les dégâts
      partout : combats PNJ, noyade, altitude). Vérifié par Playwright (session Démo anonyme, seed
      des 6 recettes, combinaison de chacune, vérification des messages de succès, de la
      consommation exacte des ingrédients et de l'affichage simultané des 4 cartes temporisées) —
      aucune régression sur les flux « Utiliser »/« Équiper » existants

### 🎥 Historique — mise à l'échelle réaliste + PNJ voxel + suite du réalisme des trésors

- **Mise à l'échelle réaliste des dragons/familiers et des PNJ** : le registre admin existant
  `Platform3DObjectKind`/`PLATFORM3D_OBJECT_KINDS`/`DEFAULT_PLATFORM3D_OBJECT_FLAGS`
  (`gameState.ts`) a été étendu avec deux nouvelles entrées `marker:npc` (échelle 1.6) et
  `marker:familiar` (échelle 2.4), réutilisant le même tableau d'administration que les objets de
  décor (`Administration > Widgets personnalisés`), sans nouvelle UI dédiée. Le panneau
  `RepRulesPanel.tsx` masque désormais les cases obstacle/escaladable/aquatique (affiche « — ») pour
  ces deux lignes « marqueur », ces attributs n'ayant pas de sens pour un PNJ/familier flottant.
  Techniquement, ce facteur d'échelle n'est appliqué qu'au groupe `bobRef` (la créature qui flotte),
  jamais au socle au sol, pour éviter d'agrandir la dalle de sol sous le marqueur.
- **PNJ rendus avec le même système voxel Minecraft que Synk** : nouvelle fonction
  `npcAppearance(id, name)` (choix de couleurs/couvre-chef par mots-clés — Thrall → peau verte
  d'orc, princesse Zelda → couronne, Steve → bleu classique Minecraft, marchand → robe marron
  encapuchonnée, PNJ « dragon » → teinte rougeâtre, générique en repli) et nouveau composant
  `NpcVoxel` (même anatomie par blocs que `SynkVoxel` — tête/torse/bras/jambes — simplifiée, sans
  équipement, avec une légère animation d'balancement de tête/bras au repos), remplaçant l'ancienne
  silhouette encapuchonnée générique (robe + tête + bâton + orbe).
- **Suite de la passe de réalisme des trésors** : nouveau classificateur `treasureCategory(id, name)`
  (18 catégories par mots-clés : épée, dague, hache, pioche, arc, bouclier, armure, casque, bottes,
  gantelet, amulette, potion, livre/parchemin, bâton, bourse de pièces, champignon, pomme, œuf,
  vaisseau volant, coffre en repli) et nouveau composant `TreasureIcon` rendant un maillage distinct
  et réaliste par catégorie, remplaçant le coffre générique unique utilisé jusqu'ici pour la
  quasi-totalité du catalogue de trésors (~46 objets), y compris les objets explicitement cités par
  le porteur du projet (Champignon Luminescent, Pomme Dorée Enchantée).
- **Vérifié par Playwright** : connexion démo → Plateforme 3D → exploration à pied dans le monde
  généré ; plusieurs PNJ rencontrés affichent bien la silhouette voxel façon Minecraft (variantes de
  couleurs selon le PNJ), plusieurs trésors affichent des formes distinctes (parchemin roulé,
  gemme/losange, bourse de pièces...) au lieu du coffre systématique, et un familier/dragon rouge
  rencontré au loin apparaît nettement plus imposant qu'un marqueur de carte classique, distinct des
  anneaux de portail de mondes (qui, eux, restent intentionnellement des anneaux). `npx tsc --noEmit`
  et `npm run build` passent sans erreur ; aucune régression observée sur le rendu du décor/textures
  ni sur les déplacements de Synk (travail des sessions précédentes intact)

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
  positionné la caméra manuellement, créant une double mise à jour concurrente. « Corrigé » (à
  tort, voir ci-dessous) en n'injectant qu'une petite impulsion dans
  `controls._sphericalDelta.theta` (le mécanisme interne qu'utilise déjà OrbitControls pour un
  glissé de souris), sans jamais toucher à `object.position` ni appeler `update()` soi-même.
- **Course impossible en maintenant une touche / Synk marchait sur place après une rotation
  manuelle de la caméra** : la caméra suiveuse remontait l'angle RÉEL (encore en cours de rotation)
  au module de résolution de direction (`rotateInputByCameraYaw`), qui pouvait alors échantillonner
  une valeur transitoire/instable au moment d'un nouvel appui clavier, résolvant parfois une
  direction bloquée. Corrigé en ne remontant, PENDANT que la caméra suiveuse est engagée, que sa
  cible analytique stable (`FACING_ANGLE[facing] + π`) plutôt que l'angle réel en transition —
  l'angle réel reste utilisé normalement dès que Synk est à l'arrêt (orbite libre inchangée).
- **Correctif ci-dessus en réalité un no-op silencieux (root cause trouvée ensuite)** :
  `controls._sphericalDelta` n'existe pas sur l'objet public de la version de `three-stdlib`
  installée — l'écriture y échouait silencieusement à CHAQUE frame de marche depuis le début (le
  garde-fou n'a fait que masquer le plantage JS qui en résultait, sans jamais restaurer le
  recentrage). La caméra suiveuse n'a donc jamais réellement suivi Synk après une orbite manuelle,
  ce qui se traduisait par un Synk vu de face/profil au lieu de dos et un ressenti de déplacement
  erratique. Réécrit en ne s'appuyant que sur l'API publique (`controls.object.position`,
  `controls.target`, `controls.update()`) : rotation du vecteur caméra→cible autour de l'axe Y d'un
  petit pas par frame vers l'angle cible — vérifié via Playwright (angle azimutal réel de la caméra
  journalisé image par image) : reconvergence en ~10 frames après une orbite manuelle.
- **Régression : Synk tourne sur lui-même au lieu de se déplacer, « bonds erratiques » visibles
  dans les deux widgets (3D et 2D isométrique)** : le correctif précédent (caméra suiveuse
  repositionnant réellement la caméra) a réintroduit, sous une forme différente, exactement le
  risque de boucle de rétroaction que la version « cible analytique stable » visait à éviter. En
  détail, remonter la cible analytique (`FACING_ANGLE[facing] + π`) PENDANT la marche crée une
  boucle fermée : cette cible dépend de `facing`, lui-même calculé à partir de
  `cameraYawRef.current`... alimenté par cette même cible. Chaque appui successif dans la « même »
  direction (ex. Gauche répété) tournait donc la direction résolue d'un cran de plus à chaque
  frappe (confirmé par logs Playwright : yaw dérivant de 0 → -0.83 → -1.69 → -2.51 rad par appui).
  Remonter à la place l'angle RÉEL en continu (y compris pendant la marche) n'a PAS suffi non plus :
  cet angle réel évolue lui-même en fonction de `facing` pendant que la caméra suiveuse tourne, donc
  un nouvel appui rapproché pouvait encore échantillonner un angle transitoire. **Correctif
  définitif (double verrou)** : (1) `cameraYawRef` (donc la résolution de direction) n'est plus
  JAMAIS mise à jour pendant qu'une session de marche est active (`chasing === true`) — elle reste
  gelée à sa dernière valeur connue pour toute la durée de la marche, même faite de plusieurs appuis
  rapprochés ; (2) au moment précis où Synk s'arrête de marcher, la caméra est instantanément
  « snappée » (sans à-coup perceptible, il ne reste jamais qu'une fraction de rotation) sur la cible
  EXACTE (`FACING_ANGLE[facing] + π`) avant de geler `cameraYawRef` sur cette valeur exacte — ce qui
  garantit que le référentiel gelé pour la prochaine session de marche correspond TOUJOURS
  précisément à « pile derrière Synk », sans plus aucune dérive possible d'une marche à l'autre.
  Vérifié par Playwright (rejeu de 5 appuis rapprochés puis de maintiens de 2 s dans les 4
  directions) : la valeur de `cameraYawRef` reste désormais parfaitement stable/quantifiée au sein
  d'une même marche, et la direction résolue (`rotateInputByCameraYaw`) ne dérive plus jamais.

**Résultat validé à l'époque (Playwright + relecture manuelle)** : Synk grimpe correctement sur les
blocs de montagne avec Espace + direction Haut, l'orbite libre à la souris au repos fonctionne
normalement, et le déplacement clavier/pavé directionnel (appuis rapprochés et maintiens, dans les
4 directions) semblait stable et déterministe. **Cette conclusion s'est révélée incomplète** — voir
l'entrée suivante pour la véritable cause racine, découverte lors d'un signalement ultérieur.

### 🎥 Historique — bug résiduel : va-et-vient / « carré qui s'élargit » sur appuis répétés (cause racine réelle)

Malgré le double verrou ci-dessus, le déplacement restait erratique sur des appuis **répétés et
brefs** (relâchement puis nouvelle pression de la même touche) — le cas d'usage le plus courant en
pratique (peu de joueurs maintiennent une touche en continu sur plusieurs secondes). Symptômes
reproduits et confirmés via Playwright (frappes de 120 ms suivies de 180 ms de relâchement,
répétées 10 fois) :
- Touche Bas répétée : Synk avance d'une case puis recule d'une case, en boucle sans jamais
  progresser (« bouton qui inverse le sens du prochain déplacement »).
- Touches Gauche/Droite répétées : la direction résolue dérivait à chaque frappe, produisant un
  déplacement en carré qui s'élargit progressivement.

**Cause racine réelle** : au moment précis où `chasing` passe de `true` à `false` (Synk vient de
s'arrêter de marcher), le code « snappe » la caméra sur la cible analytique
`FACING_ANGLE[facing] + π` (pile derrière Synk) — ce qui est correct visuellement — **mais
remontait ensuite cet angle « artefact du recentrage » à `cameraYawRef` via `onCameraYaw`, exactement
comme un angle d'orbite libre choisi par le joueur**. Or cet angle est mathématiquement dérivé de
`facing`, qui a lui-même été calculé à partir de la valeur PRÉCÉDENTE de `cameraYawRef` : réinjecter
cette valeur ferme la boucle de rétroaction. Concrètement, pour une marche vers le bas (`facing:
'down'`, angle 0), le snap fixe `cameraYawRef` à π ; au prochain appui sur la même touche Bas (brute
`dx:0, dy:1`), `rotateInputByCameraYaw(0, 1, π)` recalcule alors une direction MONDE inversée
(`dx:0, dy:-1`, soit « Haut ») — confirmé image par image via Playwright (`cameraYawRef` passant de
`0` à `π` après le premier pas, puis la même touche Bas redonnant `dir:'up'` au second appui).

**Correctif** : dissocier complètement le recentrage cosmétique de la caméra suiveuse (visuel
uniquement, pour montrer le dos de Synk pendant qu'il marche) du référentiel utilisé pour
interpréter les touches (`cameraYawRef`). Ce dernier ne doit refléter QUE l'orientation choisie
librement par le joueur à la souris au repos — jamais l'angle du « snap » automatique. Techniquement
: la frame de transition où le snap est effectué n'appelle plus `onCameraYaw(...)` ; celui-ci ne
reprend qu'aux frames suivantes, véritablement au repos (aucune marche en cours), qui reflètent une
éventuelle réorientation manuelle de la caméra par le joueur — pas l'artefact du recentrage.

**Résultat validé (Playwright, cette fois avec traçage image par image confirmé)** :
- 10 appuis brefs répétés sur Bas → 10 résultats identiques (`dir:'down'`), plus aucune inversion.
- 10 appuis brefs répétés sur Gauche → 10 résultats identiques et stables, plus aucune dérive/carré.
- Maintien continu de 3 s (avant/après un changement de cadre caméra en cours de maintien) → aucune
  régression, le cache d'entrée (`lastRawDirRef`/`lastRotatedDirRef`) continue de verrouiller la
  direction résolue pour toute la durée d'un maintien, comme avant.

Cette version (skip de `onCameraYaw` sur la frame de snap dans `Platform3DWidget.tsx`) est
désormais la référence à ne plus modifier sans rejouer intégralement ce scénario de test Playwright
(appuis brefs répétés dans les 4 directions + maintiens + orbite souris manuelle au repos).

### 🎥 Historique — abandon complet de la caméra-relative/chase-cam au profit d'un déplacement monde fixe

Malgré les correctifs successifs ci-dessus (verrous de recentrage, skip de `onCameraYaw` sur la
frame de snap, cache de direction verrouillée pendant un maintien...), le déplacement restait encore
erratique en usage réel : appuyer sur Bas faisait avancer puis reculer Synk en boucle sans jamais
progresser, Gauche/Droite le faisaient tourner sur lui-même comme si c'était la caméra qui bougeait,
et le glissé-souris (censé seulement orbiter autour de Synk) tantôt éloignait la caméra, tantôt
déplaçait Synk. **Cinq tentatives de correctif successives** avaient toutes fini par réintroduire une
boucle de rétroaction entre l'angle de la caméra (recalculé automatiquement par la « chase cam » pour
suivre Synk de dos pendant la marche) et la direction résolue à partir des touches (calculée en
fonction de cet angle) — la caméra suiveuse et le déplacement relatif à la caméra se nourrissaient
mutuellement de leurs propres artefacts, quel que soit le nombre de garde-fous ajoutés.

**Décision** : supprimer intégralement la caméra-relative et la caméra suiveuse plutôt que de
continuer à les corriger. Le déplacement est désormais **en repère MONDE FIXE**, strictement
identique et indépendant de l'orientation de la caméra — Haut = nord (`dy:-1`), Bas = sud (`dy:+1`),
Gauche = ouest (`dx:-1`), Droite = est (`dx:+1`) — exactement comme la Plateforme 2D isométrique
(`GameCanvas2D.tsx`), qui n'avait jamais souffert de ce bug. La caméra 3D (`OrbitControls`) n'est
plus JAMAIS repositionnée par le code : elle reste une orbite 100 % libre pilotée uniquement par la
souris du joueur, ce qui élimine structurellement toute possibilité de boucle de rétroaction
caméra↔déplacement (il n'existe plus aucune dépendance entre les deux). Les réglages Administration
`platform3dCameraRelativeMovement` et `platform3dChaseCameraEnabled` (devenus sans objet) ont été
retirés du modèle de données, du panneau d'administration et des 4 fichiers de traduction.

**Second bug distinct corrigé dans la foulée** : les gestionnaires `onClick` de React Three Fiber
posés sur chaque tuile/marqueur (déplacement au clic, interaction PNJ/portail/hutte...) ne
distinguent pas nativement un glissé (orbite à la souris) d'un simple clic — un glissé qui se
termine par hasard au-dessus d'une tuile pouvait donc À LA FOIS faire orbiter la caméra ET déclencher
un déplacement/une interaction non voulus. Ajout d'un seuil de distance en pixels (6 px) entre
`pointerdown` et les `pointermove` suivants sur le canevas : si le curseur a parcouru plus que ce
seuil, le geste est considéré comme un glissé et les 4 gestionnaires de clic concernés
(`onMarkerClick3D`, `onPortalTileClick3D`, `onHutTileClick3D`, `onTileClick`) l'ignorent
explicitement — un vrai clic net (aucun mouvement notable entre `pointerdown` et `pointerup`) continue
de fonctionner normalement.

**Troisième bug (découvert pendant la vérification Playwright de ce correctif, indépendant de la
caméra)** : lors du passage marche → course (après `movementRunHoldThresholdMs`, 1,5 s par défaut),
l'ancienne cadence de marche (`movementWalkStepMs`, 220 ms) est coupée pile au moment où la nouvelle
cadence de course (`movementRunStepMs`, 110 ms) démarre — mais celle-ci ne produit son premier pas
qu'après un délai supplémentaire, créant un trou de cadence pouvant dépasser le délai d'inactivité
(`WALK_STOP_DELAY_MS`, 220 ms) qui repasse `isRunning`/`isWalking` à `false` pour détecter un
relâchement de touche. Ce trou déclenchait donc ce reset alors que la touche restait pourtant
maintenue, remettant `isRunning` à `false` quelques dizaines de ms à peine après être passé à `true`
— et plus rien ne le repassait à `true` ensuite (cette transition n'est notifiée qu'une seule fois par
maintien). Corrigé dans `useHoldMovement.ts` en déclenchant un pas immédiat pile au moment de la
bascule marche→course (avant de démarrer le nouvel intervalle), qui comble exactement ce trou —
partagé par la Plateforme 2D isométrique et la Plateforme 3D, aucune duplication de logique.

**Vérifié via Playwright** (scénario automatisé rejoué sur les 3 correctifs ensemble) :
- 12 appuis brefs (3 cycles Haut/Bas/Gauche/Droite) → déplacement d'exactement 1 case, dans le bon
  sens à chaque fois, aucune inversion ni dérive.
- Maintien > 1,5 s dans chacune des 4 directions → bascule en course confirmée (`isRunning` passe à
  `true` et y **reste** en continu jusqu'au relâchement réel de la touche, sans plus jamais
  re-basculer à `false` entre-temps).
- Glissé-souris (clic gauche maintenu + déplacement de la souris sur le canevas 3D) → la position de
  Synk ne change JAMAIS, y compris quand le glissé se termine au-dessus d'une tuile/d'un marqueur.
- Un clic simple et net (sans glissé) sur une tuile → continue de déclencher normalement le
  déplacement/l'approche (aucune régression du clic-pour-approcher).

Cette architecture simplifiée (déplacement monde fixe + orbite libre pure + garde-fou anti-glissé +
pas immédiat à la bascule course) est désormais la référence à ne plus modifier sans rejouer
intégralement ce scénario Playwright.

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

### 🔒 Historique — audit complet des traductions (« Quests » restaient en français)

Signalement : certaines quêtes (Quests) restaient affichées en français malgré un changement de
langue vers EN. Investigation complète (pas seulement le cas signalé) :

- **Cause** : `localizeName()` (voir `docs/ARCHITECTURE.md` § Traductions) retombe intentionnellement
  sur le libellé français stocké en base quand la clé i18n est absente de la langue active — le vrai
  bug était l'absence totale de traductions générées pour 5 catégories de contenu procédural,
  jamais un défaut du mécanisme de bascule de langue lui-même.
- **506 entrées corrigées** : 400 Quêtes du Royaume, 50 Énigmes des Îles, 1 quête rare
  d'invisibilité, 40 trésors supplémentaires, 15 PNJ indigènes des îles (ces derniers n'avaient même
  pas de champ `i18nKey`). Détail technique complet, scripts créés (`genKingdomQuestI18n.mjs`,
  `genIslandQuestI18n.mjs`, `genMiscI18n.mjs`) et convention de traduction (réponses/noms propres
  invariants par langue) : voir `docs/ARCHITECTURE.md` § Traductions.
- **Vérification en 3 étapes indépendantes** : validation JSON statique des 4 fichiers de langue,
  script de vérification croisée lisant les données **réelles** Firebase (`catalog/quests`,
  `catalog/treasureDefs`, `catalog/npcDefs`) contre les 4 fichiers de traduction (506/506 entrées
  conformes), puis test Playwright bout-en-bout (connexion anonyme, résolution de 2 énigmes,
  bascule EN, vérification DOM sans résidu français ni erreur console, retour FR sans résidu
  anglais). Aucune régression détectée.
- **Limitation assumée, non corrigée** : le champ `dialog` (texte d'ambiance libre) des PNJ et les
  scripts de dialogue personnalisés créés depuis l'Administration restent en français quelle que
  soit la langue — texte narratif libre, non structuré, hors quêtes/objets, sans impact sur la
  jouabilité.

**Correctif complémentaire (catégorie oubliée du même audit)** : après ce premier correctif,
l'utilisateur a signalé que les **noms de chapitre/région** du Royaume (« Grottes de Kragmoor »,
« Terres Calcinées »...) restaient en français dans le widget "Kingdom Quests" — une catégorie
distincte des 400 quêtes elles-mêmes (`KINGDOM_CHAPTERS` dans `gameState.ts`, clés
`kingdom.chapter.1`–`.40`, jamais traduites). Corrigé avec un nouveau script permanent
`genKingdomChapterI18n.mjs`, qui a aussi révélé un second bug distinct : le widget "ZeldCraft
Quests" (sous-groupes de la progression Royaume dans `ProgressLedgerView.tsx`) affichait ces mêmes
noms en clair sans jamais appeler `localizeName()` — corrigé en ajoutant un `i18nKey` optionnel à
`ProgressSubgroup`. Revérifié via Playwright en EN/ES/PT sur les 2 widgets concernés, sans
régression ni résidu français. Détail technique complet : `docs/ARCHITECTURE.md` § Traductions.

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
  - [x] **Clignement des yeux** : deux petites billes blanches (pupilles) incrustées dans les yeux
        de Synk qui se ferment puis se rouvrent brièvement, à intervalle moyen randomisé (évite un
        clignotement mécanique), pour rendre le personnage plus vivant — purement cosmétique,
        activable/désactivable et fréquence réglable dans
        `Administration > Barème & règles > "🧝 Paramétrage de Synk"`
        (`RepRules.synkEyeBlinkEnabled/synkEyeBlinkIntervalSec`).
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
- [x] **Réalisme 3D — suite demandée** :
  - [x] Redimensionner les dragons (familiers/`DragonMarker`) et tous les autres PNJ (Thrall, Chef
        de la Horde, etc.) pour qu'ils soient visiblement PLUS GRANDS que Synk (taille réelle d'un
        dragon/PNJ adulte), au lieu de l'échelle actuelle proche de celle des marqueurs de carte.
  - [x] Faire rendre TOUS les PNJ avec le MÊME système voxel Minecraft que Synk (`SynkVoxel`) au
        lieu de la silhouette encapuchonnée générique (robe + tête + bâton + orbe) actuelle.
  - [x] Poursuivre la passe de réalisme/texture pour les objets nommés du catalogue encore rendus
        comme des coffres génériques (ex. Champignon Luminescent → vrai champignon texturé, Pomme
        Dorée Enchantée → vraie pomme texturée) et le décor spécifique (landes cendrées d'Ember,
        etc.), en recensant tous les objets via les widgets Boutique/Inventaire/Quêtes/ZeldCraft
        Quests.
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

## 💰 Phase 6 — Financement, sponsoring & communication

Contexte : le jeu tourne aujourd'hui sur des offres gratuites (Vercel Hobby, Firebase Spark,
Resend sandbox). Pour passer en production réelle (Mainnet, vrais joueurs, volumétrie), certains
de ces services devront passer en offre payante, et le contrat Ethereum devra être audité/déployé
en vrai ETH (frais de gas non négligeables). Cette phase prépare le financement de cette
transition via du sponsoring communautaire, sans lever de fonds classique (pas de société, pas
d'investisseurs — un modèle "tip / sponsor / early supporter").

### Documents produits

- 📄 `Horizon_ZeldCraft_Financement_Communication.docx` (racine du repo) : pitch vulgarisé du
  jeu pour un public non-technique, modèle de coûts détaillé, paliers de sponsoring/récompenses,
  plan de communication Instagram, argumentaire de financement.
- 📁 `docs/marketing/` : captures d'écran réelles du jeu (Playwright), une courte vidéo teaser
  (`teaser-fr.mp4`, montage à partir de vraies captures + texte, pas de CGI), et un calendrier
  de publication Instagram prêt à l'emploi (`instagram-content-plan.md`).
- `.github/FUNDING.yml` : active le bouton "Sponsor" sur la page GitHub du repo
  (⚠️ identifiants placeholders à remplacer par de vrais comptes une fois créés).

### Plateformes retenues (et pourquoi)

- **GitHub Sponsors** — gratuit, directement intégré au repo existant, aucun frais de plateforme,
  crédible pour un projet open-source technique.
- **Ko-fi** — création de compte en quelques minutes, aucune commission Ko-fi sur les dons
  (seuls les frais Stripe/PayPal standards s'appliquent), gère à la fois les dons ponctuels et
  les paliers d'abonnement mensuel ("membership") avec récompenses (skins exclusifs, badge
  fondateur, mentions au générique) — le canal recommandé en priorité pour démarrer vite.
- **Open Collective** — gestion transparente et publique des dépenses (chaque euro reçu/dépensé
  est visible), ce qui renforce la confiance pour un projet qui demande de l'aide pour payer de
  l'infra (Vercel/Resend/gas). Bon complément à Ko-fi une fois la communauté un peu développée.
- **Gitcoin Grants** (option à moyen terme) — écosystème web3/Ethereum natif, financement
  participatif avec matching de fonds (quadratic funding), en phase avec le positionnement du
  jeu ; nécessite de candidater lors d'un round ouvert (calendrier variable), donc traité comme
  une piste à activer plus tard plutôt qu'un canal immédiat.
- Kickstarter / Indiegogo écartés pour le financement récurrent : pensés pour des campagnes
  ponctuelles avec contreparties physiques/livrables figés, mal adaptés à un modèle de
  refacturation de coûts d'infra récurrents, et souvent restrictifs sur les récompenses liées à
  la cryptomonnaie.

### Modèle de coûts (à détailler et ajuster dans le document Word)

- Infra : Vercel (Hobby → Pro si trafic), Firebase (Spark → Blaze), Resend (Free → payant après
  domaine vérifié), nom de domaine, RPC (Alchemy/Infura si dépassement du tier gratuit).
- Blockchain : gas de déploiement/mise à jour du contrat sur Mainnet, audit de sécurité avant
  passage en production réelle.
- Développement & support : temps de maintenance, évolutions, support joueurs.

### À faire

- [ ] Créer réellement les comptes Ko-fi, GitHub Sponsors, Open Collective (identité/paiement du
      propriétaire du jeu requis — ne peut pas être automatisé) puis mettre à jour
      `.github/FUNDING.yml` avec les vrais identifiants.
- [ ] Publier les premiers posts Instagram (@horizon.zeldcraft) à partir de
      `docs/marketing/instagram-content-plan.md` (publication manuelle, connexion au compte
      personnel requise).
- [ ] Étudier une candidature à un round Gitcoin Grants une fois la communauté amorcée.
- [ ] Envisager (hors budget gratuit) un vrai pipeline d'animation 3D (ex. Blender) si le budget
      le permet, pour des cinématiques plus ambitieuses que le montage à partir de captures réelles
      livré dans cette phase.
