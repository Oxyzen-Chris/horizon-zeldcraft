# 🚀 Guide de déploiement

## 1. Smart Contract

### Prérequis

- Node.js ≥ 20
- Un wallet avec ETH Sepolia (faucet : https://sepoliafaucet.com)
- Une clé API Alchemy ou Infura
- Une clé API Etherscan (pour la vérification)

### Étapes

```bash
cd contracts
npm install
cp .env.example .env
# Renseigner : PRIVATE_KEY, ALCHEMY_KEY, ETHERSCAN_KEY, TREASURY_ADDRESS
npx hardhat compile
npx hardhat test
npx hardhat run scripts/deploy.ts --network sepolia
# → note l'adresse déployée
npx hardhat verify --network sepolia <ADRESSE> <TREASURY_ADDRESS>
```

### Déploiement Mainnet

⚠️ **Attention** : coûte du vrai ETH (~0.02–0.05 ETH selon le gas)

```bash
npx hardhat run scripts/deploy.ts --network mainnet
```

## 2. Web (Vercel)

```bash
cd web
npm install
```

Créer un projet Vercel, importer le dossier `web/`, et configurer ces variables d'environnement :

| Variable                                    | Exemple                                    |
| ------------------------------------------- | ------------------------------------------ |
| `NEXT_PUBLIC_CONTRACT_ADDRESS_SEPOLIA`      | `0xAbC...`                                 |
| `NEXT_PUBLIC_CONTRACT_ADDRESS_MAINNET`      | `0xDeF...`                                 |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`      | (créer sur https://cloud.walletconnect.com)|
| `NEXT_PUBLIC_ALCHEMY_KEY`                   | ta clé Alchemy                             |

Puis : **Deploy**.

## 3. Mobile (Expo Go)

```bash
cd mobile
npm install
npx expo login   # créer un compte si besoin
npx expo start   # scan du QR code depuis Expo Go
```

Pour publier : `eas build --platform ios/android` (nécessite compte Expo EAS).

## 4. Réseaux sociaux

À faire manuellement :

1. Créer compte Instagram `@horizon.zeldcraft`
2. Bio suggérée : *"🐉 Nourris ton Voxlyn on-chain. Tamagotchi Web3 inspiré Zelda × Minecraft × WoW."*
3. Publier les skins générés dans `web/public/skins/` comme premiers posts
