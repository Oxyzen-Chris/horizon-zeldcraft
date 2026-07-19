# 🐉 Horizon ZeldCraft — Voxlyn

> Un Tamagotchi Web3 crypté sur la blockchain Ethereum. Nourris ton **Voxlyn** (petit dragonneau cristallin) chaque jour, semaine, mois et année pour le faire évoluer, débloquer des sorts, skins, mondes et quêtes épiques inspirés de **Minecraft Dungeons**, **The Legend of Zelda: BOTW/TOTK** et **World of Warcraft**.

![status](https://img.shields.io/badge/status-MVP%20Phase%201-blue) ![license](https://img.shields.io/badge/license-MIT-green) ![solidity](https://img.shields.io/badge/solidity-0.8.24-orange) ![nextjs](https://img.shields.io/badge/Next.js-14-black)

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

## 🧬 Architecture on-chain / off-chain (v2.2)

Pour minimiser les frais de gas et les appels au wallet, **seules les opérations monétaires** passent par le smart contract Ethereum. Toutes les autres données de jeu vivent dans **Firebase Realtime Database** (plan gratuit Spark : 1 Go stockage + 10 Go BW/mois — largement suffisant pour le MVP).

| Donnée                                    | Stockage                | Pourquoi                             |
| ----------------------------------------- | ----------------------- | ------------------------------------ |
| Création du Voxlyn (mint)                 | 🔗 On-chain (payable)   | Preuve de propriété NFT              |
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

**Garantie de persistance :** les données Firebase sont indexées par **adresse wallet**, jamais par adresse de contrat. Redéployer le smart contract ne perd rien du parcours joueur (stats, inventaire, chat, transactions).

## 🎮 Fonctionnalités v2.2

### Écran de jeu
- 🥚 Mint du Voxlyn (~15–20 € en ETH, paramétrable admin)
- 🍖 Nourrissage journalier / hebdo / mensuel / annuel avec cooldowns et compte-à-rebours
- 📊 Stats : XP · Vie · Faim · Bonheur · **Force** · **Sortilèges** · **Portefeuille** · **Reconnaissance**
- 🌤️ Météo dynamique (☀️🌥️🌧️⛈️🌙❄️ — 3×/jour aléatoire, forçable admin)
- 📜 Quêtes à énigmes (accents ignorés, réponse révélée une fois résolue)
- 🧙 Rencontres PNJ « fixes » (3–10/jour)
- 💎 Trésors + 🗺️ Mondes à débloquer
- 👥 Équipe multi-joueurs avec chat temps réel (Firebase RTDB)
- 🎒 **Inventaire** (sac / besace)
- 🛒 **Boutique** achat/vente (avec engins mécaniques pour mondes gated)
- 💬 Chat WhatsApp-like : reply, edit, delete, pseudo obligatoire
- 🎲 **Popup PNJ aléatoires** (3–5×/jour) : marchands, sorciers, voleurs, chevaliers… avec skill/force/alignement (gentil/méchant/inconnu), offre (troc/quête/combat/discussion), accept/refuse
- ⚙️ Bouton « Administration » visible si le wallet connecté est owner du contrat

### Panneau d'administration (owner only)
- 💰 Solde trésorerie + solde contrat (temps réel)
- 📊 **Statistiques par joueur** : dropdown de tous les joueurs enregistrés, stats on-chain (quêtes/PNJ/trésors/mondes) + stats off-chain (force/spells/rep/wallet)
- 📄 **Génération de factures PDF** par joueur (jsPDF) — en-tête = contrat + wallet joueur + réseau, tableau des transactions on-chain avec liens Etherscan
- 💬 **Historique chat** avec dropdown de tous les salons
- 🎮 Modifier prix + cooldowns de nourrissage (bug de rafraîchissement corrigé)
- ⚔️ Difficulté globale + météo forcée + fréquence PNJ (1–10/jour)
- 🧙 Ajouter/gérer quêtes énigmes, PNJ, trésors, mondes, items catalogue
- ⏸️ Pause/Unpause + retrait de fonds
- ↩️ Bouton « Retour au jeu »

## 🐛 Bugs corrigés (historique)

| Bug                                                        | Solution                                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| MetaMask « transaction va probablement échouer » sur feed  | Ajout de `setFeedCooldown` on-chain + cooldowns réglables admin                                   |
| Énigme retourne « RP » / « Gas limit too high »            | `normalizeAnswer()` (NFD, lowercase, trim) côté client ET script deploy + `simulateContract` preflight avant `writeContract` |
| Prix/cooldown dropdown admin ne se rafraîchit pas          | `useReadContract` sur l'index sélectionné + `useEffect` peuplant l'input à chaque changement      |
| Chat sans identification                                   | Pseudo obligatoire (par défaut = nom du Voxlyn), banner d'alerte tant qu'il n'est pas saisi       |
| Perte de données au redéploiement de contrat               | Migration off-chain vers Firebase RTDB (clé = adresse wallet)                                     |
| Expo SDK 51 incompatible Expo Go                           | Bumped mobile app to SDK 54                                                                       |

## 📚 Documentation

- [Architecture](./docs/ARCHITECTURE.md)
- [Déploiement](./docs/DEPLOYMENT.md)
- [Lore & univers Voxlyn](./docs/LORE.md)
- [Roadmap Phases 2/3/4](./docs/ROADMAP.md)

## 📸 Communauté

Instagram : `@horizon.zeldcraft` *(à créer manuellement — voir docs/ROADMAP.md)*

## 📄 Licence

MIT © 2026 — Horizon ZeldCraft
