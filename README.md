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

## 📚 Documentation

- [Architecture](./docs/ARCHITECTURE.md)
- [Déploiement](./docs/DEPLOYMENT.md)
- [Lore & univers Voxlyn](./docs/LORE.md)
- [Roadmap Phases 2/3/4](./docs/ROADMAP.md)

## 📸 Communauté

Instagram : `@horizon.zeldcraft` *(à créer manuellement — voir docs/ROADMAP.md)*

## 📄 Licence

MIT © 2026 — Horizon ZeldCraft
