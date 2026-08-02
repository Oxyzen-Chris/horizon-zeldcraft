# 🗡️ Horizon ZeldCraft — Synk

> Un Tamagotchi Web3 crypté sur la blockchain Ethereum. Nourris ton **Synk** (jeune héros façon Link, en pixel-art) chaque jour, semaine, mois et année pour le faire évoluer, débloquer des sorts, skins, familiers, mondes et quêtes épiques inspirés de **Minecraft Dungeons**, **The Legend of Zelda: BOTW/TOTK** et **World of Warcraft**.

![status](https://img.shields.io/badge/status-v3.0%20%E2%80%94%20%C3%89cosyst%C3%A8me%20narratif-blue) ![license](https://img.shields.io/badge/license-MIT-green) ![solidity](https://img.shields.io/badge/solidity-0.8.24-orange) ![nextjs](https://img.shields.io/badge/Next.js-14-black)

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

## 🧬 Architecture on-chain / off-chain (v3.0)

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

## 🎮 Fonctionnalités v3.0

### Trame narrative
- 👹 **Zorghon le Maléfique** a enlevé la princesse **PocaPoka** et son lutin des sables **El Pipo** — objectif final du jeu
- 💠 **5 Fragments du Sceau Runique** (reliques protégées contre la perte lors d'un évanouissement) déverrouillant la quête finale
- 👑 **40 chapitres × 10 quêtes = 400 Quêtes du Royaume**, dont 40 exclusives à la **pleine lune** (calendrier réel)
- 📜 Quêtes classiques, ❓ quêtes PNJ (intermédiaires), 🏝️ quêtes d'archipel, 🌴 quêtes d'îles sauvages — toutes contribuent au déblocage séquentiel des Quêtes du Royaume
- 🎬 **Onboarding en 3 écrans** ludiques (bienvenue & stades de Synk, lore & mécaniques, guide des widgets) + widget **« Aides »** disponible à tout moment

### Écran de jeu — 12 fenêtres flottantes déplaçables
- 🗡️ Création de Synk (~15–20 € en ETH, paramétrable admin)
- 🍖 Nourrissage journalier / hebdo / mensuel / annuel avec cooldowns et compte-à-rebours
- 📊 **Statistiques** : XP · Vie · Faim · Bonheur · Force · Sortilèges · **Oxygène** · **Fatigue** · Portefeuille · Reconnaissance
- 🌤️ Météo dynamique cohérente avec le **cycle des 4 saisons** (calendrier réel), impact sur le bonheur
- 🌕 Pleine lune (calendrier réel + override admin) débloquant des quêtes spéciales
- 🎲 **Lancer de dés** : jet de destin quotidien + résolution des combats PNJ (bonus/malus)
- ⚔️ **Équipement Synk** : slots drag & drop, usure persistante, auto-déséquipement à 0% + Cimetière des équipements
- 🎒 **Sac / Besace** synchronisée avec l'équipement
- 🛒 **Boutique des terres de ZeldCraft** : armes, protections, casques/habits/gants/bottes (120+ articles inspirés Tolkien/WoW/Zelda/Minecraft), nourriture, potions & sortilèges, engins, trésors, selles
- 🗺️ **Mapmonde** zoomable avec filtres par catégorie, mers/océans/îles/archipels, pop-up profondeur/altitude clignotant
- 🧍 **Plateforme 2D isométrique** : déplacement et articulation de Synk en **8 directions**, dalles d'eau (profondeur) et de montagne (altitude 0–6000 m) avec raréfaction de l'air, mécaniques d'oxygène/fatigue
- 🐲 **Familiers** (Dragon d'Or…) et selles pour les chevaucher
- 👑 Widget **« Quêtes du Royaume »** : suivi des 400 quêtes/40 chapitres
- 📖 Widget **« État d'avancement / inventaire »** : ledger dépliable en **17 thèmes** (armes, protections, nourriture, potions, engins, trésors, selles, familiers, mondes, PNJ rencontrés, cimetière des équipements, quêtes classiques/PNJ/archipel/îles sauvages/Royaume) avec icônes ✅/❌
- 👥 Équipe multi-joueurs avec chat temps réel (Firebase RTDB)
- 🎮 Widgets personnalisés créés par l'admin, rendus dynamiquement
- 🖱️ Toutes les fenêtres : glisser sans (ré)ouvrir accidentellement, clic droit → recentrage à l'écran
- ⚙️ Bouton « Administration » visible si le wallet connecté est owner du contrat

### Panneau d'administration (owner only) — 26 rubriques
- 💰 Solde trésorerie + solde contrat (temps réel)
- 📊 **Statistiques par joueur** fiables (correction du bug XP désynchronisé) + génération de **factures PDF** (jsPDF, historique on-chain + liens Etherscan)
- ⭐ **Barème de reconnaissance** (~20 sous-sections : combat, humeur/météo/saisons, équipement, huttes, sommeil, oxygène, fatigue, altitude, profondeur, îles, pop-up profondeur/altitude, Royaume, Zorghon, onboarding, widget « État d'avancement »…)
- 💳 Presets de rechargement wallet · 🐲 Catalogue Familiers · ⚔️ Catalogue Équipement · 🍖 Catalogue Nourriture · 🧪 Catalogue Potions & Sortilèges
- 🗺️ Filtres Mapmonde par défaut · 🧭 Navigation Mapmonde (zoom/pan) · 💬 Scripts de dialogue PNJ · 🧩 Widgets personnalisés · 📦 DLC / Packs de contenu (saisons narratives)
- 🧙 Ajouter quêtes énigmes / PNJ / trésors / mondes / points d'intérêt carte
- ⚔️ Difficulté globale · 🌤️ Météo forcée · 🍂 Saisons · 🌕 Pleine lune · 🧙 Fréquence PNJ · 💰 Prix/cooldowns de nourrissage
- 💬 **Historique chat** avec dropdown de tous les salons
- 🤖 **Intelligence IA GamePlay** : DAU/rétention 7j-30j, temps passé par widget, entonnoir de quêtes, heatmaps de zones visitées/évanouissements, score de risque de décrochage par joueur, signaux de monétisation & rencontres PNJ, et un **assistant IA 100% gratuit** (Google Gemini) qui génère analyses et recommandations
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

## 📚 Documentation

- [Architecture](./docs/ARCHITECTURE.md)
- [Déploiement + variables d'environnement Vercel/contrats](./docs/DEPLOYMENT.md)
- [Firebase (chat + off-chain) + **règles de sécurité RTDB à jour**](./docs/FIREBASE_CHAT.md) ← **à republier à chaque merge touchant les chemins RTDB**
- [Lore & univers Synk](./docs/LORE.md)
- [Roadmap Phases 2/3/4](./docs/ROADMAP.md)

## 📸 Communauté

Instagram : `@horizon.zeldcraft` *(à créer manuellement — voir docs/ROADMAP.md)*

## 📄 Licence

MIT © 2026 — Horizon ZeldCraft
