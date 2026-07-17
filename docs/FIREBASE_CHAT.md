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

## 3. Activer l'authentification anonyme (OBLIGATOIRE avec les règles ci-dessous)

1. Console Firebase → **Build → Authentication**
2. Onglet **Sign-in method** → clique **Anonyme** → **Activer** → **Enregistrer**

Chaque visiteur se voit attribuer un `uid` unique dès l'ouverture du chat, stocké dans son navigateur (localStorage). Les règles Firebase vérifieront qu'aucun message n'est écrit sans authentification.

## 4. Règles de sécurité durcies (production, à copier-coller)

Menu **Build → Realtime Database → Règles** :

```json
{
  "rules": {
    "chats": {
      "$roomKey": {
        ".read":  "auth != null",
        ".indexOn": ["ts"],
        "$msgId": {
          ".write":    "auth != null && !data.exists()",
          ".validate": "newData.hasChildren(['uid','sender','message','ts']) && newData.child('uid').val() === auth.uid && newData.child('sender').isString() && newData.child('sender').val().matches(/^0x[a-fA-F0-9]{40}$/) && newData.child('message').isString() && newData.child('message').val().length > 0 && newData.child('message').val().length <= 280"
        }
      }
    }
  }
}
```

Clique **Publier**.

### Ce que ces règles verrouillent

| Règle | Effet |
|---|---|
| `.read: auth != null` | Seuls les utilisateurs authentifiés (anonymes) peuvent lire — bloque les scrapers non-auth |
| `.write: auth != null && !data.exists()` | Nouveaux messages OK, mais **impossible d'éditer ou supprimer** un message existant |
| `newData.child('uid').val() === auth.uid` | **Anti-spoofing** : impossible de poster au nom d'un autre `uid` |
| `sender.matches(/^0x[a-fA-F0-9]{40}$/)` | Le champ `sender` doit être une adresse Ethereum valide (empêche `sender="admin"`) |
| `message.length > 0 && ≤ 280` | Pas de message vide, pas de flood 10 Mo |
| Chemin `/chats/$roomKey/$msgId` uniquement | Aucune écriture possible hors `chats/*` |

### Rate limiting côté client

Déjà implémenté dans `TeamsPanel.tsx` : **1 message maximum toutes les 2 secondes** par utilisateur. Si l'utilisateur essaie plus vite, l'UI affiche `⏳ Attends Xs`.

## 5. Architecture

- Un « salon » = clé `chats/{contractAddress}_{teamId}`
- Chaque message = `{ sender: 0x…, message: "…", ts: <server_timestamp> }`
- Le composant `TeamsPanel` écoute via `onValue(query(…, orderByChild('ts'), limitToLast(50)))`
- Latence typique : **< 500 ms** en Europe

## 6. Coûts

Le plan gratuit **Spark** de Firebase couvre :
- 100 connexions simultanées
- 1 Go de stockage
- 10 Go de bande passante / mois

Largement suffisant pour la phase MVP. Passe au plan **Blaze** (pay-as-you-go) si tu dépasses.
