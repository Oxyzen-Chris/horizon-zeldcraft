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

## 🔜 Phase 2 — Auth sociale & UX

- [ ] Web3Auth ou Privy pour login Gmail/X/Discord/Apple/Github
- [ ] Animations Framer Motion sur Synk
- [ ] Notifications push (Expo Notifications) : "Synk a faim !"
- [ ] Système d'amis / classement (au-delà du `/scoreboard` actuel)
- [ ] Deploy Instagram + kit contenu 30 posts (voir `docs/DEPLOYMENT.md` § Réseaux sociaux)
- [ ] Premier DLC / saison narrative post-Zorghon (utilisant l'architecture Content Packs livrée)

## 🎮 Phase 3 — Moteur de jeu

- [ ] Choix moteur : **Godot 4** (recommandé, gratuit, léger) vs Unity vs Unreal
- [ ] SDK Web3 pour Godot (via GDNative → ethers)
- [ ] Widget « Plateforme 3D » — les données altitude/profondeur sont déjà structurées dans le
      modèle de tuile (`worldTerrain.ts`) pour être consommées sans réécriture (voir
      `docs/ARCHITECTURE.md` § Modèle de terrain)
- [ ] Prototype donjon 1 (Forêt de Zephyria) : déplacement, combat, loot
- [ ] Sync inventaire on-chain ↔ jeu
- [ ] Boss & PNJ scriptés (au-delà des scripts de dialogue textuels actuels)
- [ ] Multi-joueur (Nakama server)

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
