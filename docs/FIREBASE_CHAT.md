# 💬 Chat temps réel — Setup Firebase

Le chat d'équipe (multi-joueurs) utilise **Firebase Realtime Database** pour livrer les messages en moins de 500 ms.
Si Firebase n'est pas configuré, l'UI bascule automatiquement sur un fallback **on-chain** (transaction pour chaque message — lent et payant).

## 1. Créer le projet Firebase (gratuit)

1. Va sur https://console.firebase.google.com/ → **Ajouter un projet** (`horizon-zeldcraft`)
2. Désactive Google Analytics (facultatif)
3. Dans le menu de gauche : **Build → Realtime Database** → **Créer une base de données**
   - Emplacement : `europe-west1` (ou proche de tes joueurs)
   - Règles de sécurité : **Mode test** pour démarrer

4. Menu **Project settings** (roue crantée) → onglet **General** → **Vos applications** → icône `</>` (Web)
   - Nom : `horizon-web`
   - Copie les valeurs `apiKey`, `authDomain`, `databaseURL`, `projectId`, `appId`

## 2. Renseigner les variables d'environnement

Dans `web/.env.local` (et sur Vercel → Settings → Environment Variables) :

```env
NEXT_PUBLIC_FIREBASE_API_KEY=AIza…
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=horizon-zeldcraft.firebaseapp.com
NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://horizon-zeldcraft-default-rtdb.europe-west1.firebasedatabase.app
NEXT_PUBLIC_FIREBASE_PROJECT_ID=horizon-zeldcraft
NEXT_PUBLIC_FIREBASE_APP_ID=1:1234567890:web:abcdef
```

## 3. Règles de sécurité (production)

En mode test, la base est ouverte pendant 30 jours. Pour la production, remplace par des règles limitant l'accès par équipe :

```json
{
  "rules": {
    "chats": {
      "$roomKey": {
        ".read": true,
        ".write": true,
        ".indexOn": ["ts"],
        "$msgId": {
          ".validate": "newData.hasChildren(['sender','message','ts']) && newData.child('message').isString() && newData.child('message').val().length <= 280"
        }
      }
    }
  }
}
```

Version durcie (recommandée) : ajoute Firebase Anonymous Auth + rate limiting côté client, ou passe par un Cloud Function qui vérifie la signature wallet avant écriture.

## 4. Architecture

- Un « salon » = clé `chats/{contractAddress}_{teamId}`
- Chaque message = `{ sender: 0x…, message: "…", ts: <server_timestamp> }`
- Le composant `TeamsPanel` écoute via `onValue(query(…, orderByChild('ts'), limitToLast(50)))`
- Latence typique : **< 500 ms** en Europe

## 5. Coûts

Le plan gratuit **Spark** de Firebase couvre :
- 100 connexions simultanées
- 1 Go de stockage
- 10 Go de bande passante / mois

Largement suffisant pour la phase MVP. Passe au plan **Blaze** (pay-as-you-go) si tu dépasses.
