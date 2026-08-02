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

### Variables d'environnement `contracts/.env` (jamais commit — jamais sur Vercel)

| Variable            | Requise | Description                                                                 |
| ------------------- | :---:  | --------------------------------------------------------------------------- |
| `PRIVATE_KEY`       | ✅     | Clé privée du wallet déployeur (0x + 64 hex). Doit avoir de l'ETH Sepolia/Mainnet. |
| `ALCHEMY_KEY`       | ✅     | Clé Alchemy pour les RPC Sepolia/Mainnet côté Hardhat                        |
| `ETHERSCAN_KEY`     | ✅     | Clé Etherscan V2 pour `hardhat verify`                                      |
| `TREASURY_ADDRESS`  | ✅     | Adresse qui recevra les paiements du jeu (mint Synk, achats, sorts…)      |

⚠️ **Ne mets jamais** ces variables dans Vercel — elles servent uniquement au poste de dev/CI pour compiler et déployer les contrats.

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

Créer un projet Vercel, importer le dossier `web/`, et configurer **toutes** les variables d'environnement ci-dessous.

### 2bis. Peupler le contenu de jeu (Firebase, une seule fois par projet Firebase)

La quasi-totalité du contenu de jeu (quêtes, PNJ, familiers, équipement…) vit dans Firebase RTDB
(voir `docs/FIREBASE_CHAT.md`) et doit être injectée via les scripts de `web/scripts/` après avoir
renseigné `web/.env.local` (clés Firebase — voir `FIREBASE_CHAT.md` § 2) :

```bash
cd web
node scripts/migrateQuestsToFirebase.mjs            # quêtes classiques historiques
node scripts/migrateNpcsTreasuresWorldsToFirebase.mjs # PNJ, trésors, mondes historiques
node scripts/seedRiddleAnswers.mjs                    # réponses d'énigmes (hash keccak256)
node scripts/seedNpcRiddleQuests.mjs                  # 20 quêtes PNJ (intermédiaires)
node scripts/seedIslandGeography.mjs                  # géographie des îles/archipel
node scripts/seedIslandQuests.mjs                     # 50 quêtes archipel / îles sauvages
node scripts/seedKingdomQuests.mjs                    # 400 Quêtes du Royaume (40 chapitres, Zorghon)
node scripts/seedConvergenceFragments.mjs             # 5 Fragments du Sceau Runique
node scripts/seedEquipmentCatalog.mjs                 # catalogue armes & protections (120+ articles)
node scripts/migrateFamiliarsToFirebase.mjs           # catalogue Familiers (Dragon d'Or…)
node scripts/seedMapToFirebase.mjs                    # carte + points d'intérêt
node scripts/seedMoreMapPois.mjs                      # POI additionnels
node scripts/seedInvisibilityQuest.mjs                # quête spéciale sortilège d'invisibilité
node scripts/tagSeasonalRiddleQuests.mjs              # tag saisonnier sur certaines énigmes
node scripts/backfillLegacyQuests.mjs                 # rattrapage joueurs existants (si migration tardive)
```

> Chaque script est idempotent (upsert par id) — relancer un script déjà exécuté ne duplique rien.
> L'ordre ci-dessus respecte les dépendances (ex : les quêtes archipel référencent la géographie des
> îles déjà seedée). Tout nouveau contenu ajouté ensuite peut se faire **directement depuis
> `/admin`**, sans script.

### Variables d'environnement Vercel (liste complète — Production + Preview + Development)

| Variable                                    | Requise | Exemple / Source                                                                   |
| ------------------------------------------- | :---:  | ---------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_CONTRACT_ADDRESS_SEPOLIA`      | ✅     | `0xAbC…` — sortie de `npx hardhat run scripts/deploy.ts --network sepolia`         |
| `NEXT_PUBLIC_CONTRACT_ADDRESS_MAINNET`      | ⚠️     | `0xDeF…` — laisse vide tant que tu n'as pas déployé sur Mainnet                    |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`      | ✅     | https://cloud.walletconnect.com → Projects → Create                                |
| `NEXT_PUBLIC_ALCHEMY_KEY`                   | ✅     | https://dashboard.alchemy.com → Apps → View Key (utilisé par les RPC Sepolia/Mainnet)|
| `NEXT_PUBLIC_ETHERSCAN_KEY`                 | ✅     | https://etherscan.io/apis → Add (V2 unifiée Sepolia+Mainnet). Sans elle, l'historique on-chain + les frais gas dans la facture PDF ne s'affichent pas. |
| `NEXT_PUBLIC_FIREBASE_API_KEY`              | ✅     | Firebase Console → ⚙️ Project settings → General → SDK snippet                     |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`          | ✅     | ex. `horizon-zeldcraft.firebaseapp.com`                                             |
| `NEXT_PUBLIC_FIREBASE_DATABASE_URL`         | ✅     | ex. `https://horizon-zeldcraft-default-rtdb.europe-west1.firebasedatabase.app`     |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID`           | ✅     | ex. `horizon-zeldcraft`                                                             |
| `NEXT_PUBLIC_FIREBASE_APP_ID`               | ✅     | ex. `1:1234567890:web:abcdef`                                                       |
| `GEMINI_API_KEY`                            | ⚠️     | Optionnelle — active l'assistant IA du menu Admin « Intelligence IA GamePlay ». **Clé serveur uniquement** (pas de préfixe `NEXT_PUBLIC_`, jamais exposée au navigateur). Génère-la gratuitement sur https://aistudio.google.com/app/apikey (Google Gemini, quota gratuit sans carte bancaire). Sans elle, le bouton « Générer une analyse » répond simplement « non configuré » — le reste du panneau (statistiques, heatmaps, entonnoir de quêtes…) fonctionne normalement. |

> Toutes les clés préfixées `NEXT_PUBLIC_` sont exposées côté navigateur — n'y mets **jamais** de secret sensible (clé privée, mot de passe). Les clés Firebase Web SDK sont publiques par design ; la sécurité repose sur les **règles Firebase RTDB** (voir `FIREBASE_CHAT.md`). `GEMINI_API_KEY` n'a volontairement **pas** le préfixe `NEXT_PUBLIC_` : elle n'est lue que côté serveur dans `web/src/app/api/ai/insights/route.ts`.

### Redéploiement après changement de variable

Vercel ne recompile pas automatiquement quand tu modifies une variable. Après avoir mis à jour une clé :

1. Vercel Dashboard → projet → **Deployments** → dernier déploiement Production → menu ⋯ → **Redeploy** (décoche « Use existing Build Cache »).
2. Ou pousse un commit vide : `git commit --allow-empty -m "chore: bump env" && git push`.

### Après un redéploiement de smart contract

Quand tu relances `npx hardhat run scripts/deploy.ts --network sepolia` (nouvelle adresse) :

1. Mets à jour `NEXT_PUBLIC_CONTRACT_ADDRESS_SEPOLIA` sur Vercel.
2. Redeploy Vercel (voir ci-dessus).
3. L'historique Firebase (joueurs, chats, encounters, quêtes résolues) est **conservé** — il est indexé par adresse wallet, pas par adresse contrat.

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
2. Bio suggérée : *"🗡️ Accompagne Synk on-chain. Tamagotchi Web3 inspiré Zelda × Minecraft × WoW."*
3. Publier les skins générés dans `web/public/skins/` comme premiers posts
