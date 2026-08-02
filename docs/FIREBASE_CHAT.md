# 💬 Firebase Realtime Database — Setup complet

Firebase RTDB porte **toutes les données off-chain** du jeu pour éviter le gas inutile :
chat temps réel, joueurs, encounters PNJ, quêtes résolues, historique tx, catalogue admin.

Si Firebase n'est pas configuré, le chat bascule automatiquement sur un fallback **on-chain**
(transaction pour chaque message — lent et payant) et les autres fonctions off-chain sont désactivées.

## 🚨 Règle d'or : garder les règles de sécurité en phase avec le code

**Chaque fois qu'un nouveau chemin `players/*`, `catalog/*`, `chatIndex/*` ou autre est écrit
par le code, les règles Firebase RTDB DOIVENT être mises à jour.**

- Après merge d'une PR qui ajoute un chemin, republier les règles ci-dessous dans la console
  Firebase → **Publier**.
- Vérifier ensuite qu'un `accept()` de popup NPC ou un envoi de chat ne remonte pas d'erreur
  `PERMISSION_DENIED` dans la console browser.

Chemins RTDB utilisés par l'application (à jour au 2026-08) :

| Chemin RTDB                             | Écrit par                                     | Lu par                                  |
| --------------------------------------- | --------------------------------------------- | --------------------------------------- |
| `chats/{contract}_{teamId}/{msgId}`     | `TeamsPanel` (envoi message)                  | `TeamsPanel`, `ChatHistoryPanel`        |
| `chatIndex/{contract}/{roomKey}`        | `TeamsPanel` (à chaque message)               | `ChatHistoryPanel` (dropdown salons)    |
| `players/{addr}`                        | `applyEffect`, `getOrCreatePlayer`, `topupWallet`, `updatePlayer` | `PlayerStats`, `Scoreboard`, popups, tous les widgets de stats |
| `players/{addr}/inventory/{itemId}`     | `addToInventory`, `removeFromInventory`       | `InventoryWidget`, `InventoryPanel`, popup vol PNJ hostile |
| `players/{addr}/equipment/{slot}`       | `equipItem`, `unequipSlot`                    | `EquipmentWidget` (durabilité conservée au ré-équipement) |
| `players/{addr}/equipmentGraveyard/{ts}` | `applyEquipmentWear` (objet cassé à 0% usure) | `getEquipmentGraveyard` → `ProgressWidget` (thème « Cimetière des équipements ») |
| `players/{addr}/itemsEverOwned/{itemId}` | `addToInventory` (marqueur permanent, jamais supprimé) | `getPlayerProgressLedger` → `ProgressWidget`, admin `PlayerStats` (« État d'avancement / inventaire ») |
| `players/{addr}/familiars/{id}`         | `tameFamiliar`                                | `FamiliarsList` (statut apprivoisé), `ProgressWidget` |
| `players/{addr}/npcsMet/{id}`           | `markNpcMet`                                  | `ProgressWidget` (thème « PNJ rencontrés ») |
| `players/{addr}/treasuresFound/{id}`    | `markTreasureFound`                           | `ProgressWidget` (thème trésors)        |
| `players/{addr}/worldsUnlocked/{id}`    | `unlockWorldForPlayer`                        | `ProgressWidget` (thème mondes), `WorldMapWidget` |
| `players/{addr}/unlockedQuests/{id}`    | `unlockQuestForPlayer`                        | `KingdomQuestsWidget`, `QuestList`      |
| `players/{addr}/mapPos`                 | `setPlayerMapPos`                             | `subscribePlayerMapPos` (sync `WorldMapWidget` ↔ `GameCanvas2D`) |
| `players/{addr}/mapPoisVisited/{id}`    | `visitMapPoi`                                 | `WorldMapWidget`, `PoiInteractionModal` |
| `players/{addr}/zorghonEncounter`       | logique de déplacement aléatoire Zorghon      | `GameCanvas2D`, `WorldMapWidget` (position PocaPoka/El Pipo) |
| `players/{addr}/dailyLuck/{day}`        | jet de destin quotidien                       | `DiceRollWidget`                        |
| `players/{addr}/encounters/{ts}`        | `logEncounter` (popup NPC)                    | `EncountersPanel`, admin PlayerStats    |
| `players/{addr}/quests/{questId}`       | `markQuestSolved`, `submitQuestAnswerOffchain`, `web/scripts/backfillLegacyQuests.mjs` | `QuestList` (statut résolu + réponse) |
| `players/{addr}/txs/{ts}`               | `logTx` (mint, feed, buy, quest, topup)        | admin PlayerStats + facture PDF         |
| `playerIndex/{addr}`                    | `getOrCreatePlayer`                           | admin `listPlayers`, Scoreboard         |
| `catalog/repRules`                      | admin `RepRulesPanel` (~20 sous-sections : combat, humeur, équipement, huttes, sommeil, oxygène, fatigue, altitude, profondeur, îles, pop-up profondeur/altitude, Royaume, Zorghon, onboarding, widget « État d'avancement »…) | tous les widgets/mécaniques de jeu (calcul en direct) |
| `catalog/topupPresets`                  | admin `TopupPresetsPanel`                     | `WalletPanel`/`WalletTopupPopup` (choix montants) |
| `catalog/shopItems`                     | admin `ShopPanel`                             | `Shop` (achats)                         |
| `catalog/familiars/{id}`                | admin `FamiliarsAdminPanel`, `web/scripts/migrateFamiliarsToFirebase.mjs` | `FamiliarsList` (catalogue, 100% hors-chaîne) |
| `catalog/equipment/{id}`                | admin `EquipmentAdminPanel`, `web/scripts/seedEquipmentCatalog.mjs` | `Shop`, `EquipmentWidget` (armes/protections/habits/gants/bottes…) |
| `catalog/food/{id}`                     | admin `FoodAdminPanel`                        | `Shop`, nourrissage de Synk             |
| `catalog/potionsSpells/{id}`            | admin `PotionsSpellsAdminPanel`               | `Shop` (potions, super-fioles, sortilèges) |
| `catalog/mapFilterDefaults`             | admin `MapFiltersAdminPanel`                  | `WorldMapWidget`, `GameCanvas2D` (filtres par défaut au 1er chargement) |
| `catalog/mapNavigationSettings`         | admin `MapNavigationAdminPanel`               | `WorldMapWidget` (zoom min/max/pas, pan clic droit) |
| `catalog/chatScripts/{id}`              | admin `ChatScriptsAdminPanel`                 | `NpcEncounterPopup` (dialogues PNJ à réactions) |
| `catalog/customWidgets/{id}`            | admin `CustomWidgetsAdminPanel`                | `CustomWidgetsRenderer` (widgets flottants dynamiques) |
| `catalog/contentPacks/{id}`             | admin `ContentPacksAdminPanel`                | `isContentPackVisible()` (visibilité DLC/saisons narratives) |
| `catalog/seasonState`                   | admin rubrique « Saisons » (`getSeasonState`/`setSeasonState`) | calcul saison auto (calendrier réel) ou forcée, météo, humeur |
| `catalog/moonState`                     | admin rubrique « Pleine lune » (override par mois) | `isFullMoonOnDate`, `nextFullMoonDateFromState`, quêtes `fullMoonOnly` |
| `catalog/riddleAnswers/{questId}`       | `web/scripts/seedRiddleAnswers.mjs`, `web/scripts/backfillLegacyQuests.mjs` | scripts de migration (repli réponse legacy) |
| `catalog/quests/{questId}`              | admin (panneau « Ajouter une quête »), `migrateQuestsToFirebase.mjs`, `seedKingdomQuests.mjs` (400 quêtes), `seedIslandQuests.mjs` (archipel/îles sauvages), `seedNpcRiddleQuests.mjs` (PNJ) | `QuestList`, `KingdomQuestsWidget` (catalogue complet, 100% hors-chaîne) |
| `players/{addr}/analytics/lastActiveDay`, `/sessionDays/{day}` | `markPlayerActiveToday` (appelé par `getOrCreatePlayer`) | `getDauSeries`, `getRetentionEstimate` (DAU/rétention) |
| `players/{addr}/analytics/widgetUsage/{widgetId}` | `trackWidgetUsage` (via `useDraggableWidget`, ouverture/fermeture de widget) | `AiGameplayIntelligencePanel` (temps passé par widget, par joueur) |
| `players/{addr}/analytics/questFunnel/{id}/{event}` | `trackQuestFunnelEvent` (appelé par `submitQuestAnswerOffchain`) | `AiGameplayIntelligencePanel` (entonnoir de quêtes) |
| `players/{addr}/analytics/faintEvents/{ts}`         | `trackFaintEvent` (`GameCanvas2D`, évanouissement oxygène/fatigue) | `getFaintHeatmap`, `getFaintCauseBreakdown`, score de décrochage |
| `catalog/analytics/dauGlobal/{day}`                  | `markPlayerActiveToday` (`runTransaction`, compteur global) | `getDauSeries` (graphique 14 jours) |
| `catalog/analytics/widgetUsageGlobal/{widgetId}`     | `trackWidgetUsage` (`runTransaction`, agrégat global) | `AiGameplayIntelligencePanel` (temps par widget, tous joueurs) |
| `catalog/analytics/questFunnelGlobal/{id}/{event}`   | `trackQuestFunnelEvent` (`runTransaction`, agrégat global) | `AiGameplayIntelligencePanel` (entonnoir de quêtes global) |
| `catalog/analytics/mapHeatmapGlobal/{map}/{gridKey}` | `trackMapHeatmap` (appelé par `setPlayerMapPos`, `runTransaction`) | `getMapHeatmap` → `AiGameplayIntelligencePanel` (carte de chaleur) |
| `catalog/analytics/faintHeatmapGlobal/{map}/{gridKey}`, `/faintCauseGlobal/{cause}` | `trackFaintEvent` (`runTransaction`) | `getFaintHeatmap`, `getFaintCauseBreakdown` |
| `catalog/aiAnalyticsSettings`            | admin `AiGameplayIntelligencePanel` (rubrique Paramètres) | toutes les fonctions `analytics*`/`trackX` (activation, taille de maille, fenêtre de rétention, fournisseur IA) |
| `catalog/aiInsightsCache`                | `AiGameplayIntelligencePanel` (bouton « Générer une analyse », résultat de `/api/ai/insights`) | `AiGameplayIntelligencePanel` (affichage + anti-spam) |

## 1. Créer le projet Firebase (gratuit)

1. https://console.firebase.google.com/ → **Ajouter un projet** (`horizon-zeldcraft`)
2. Désactive Google Analytics (facultatif)
3. Menu de gauche : **Build → Realtime Database** → **Créer une base de données**
   - Emplacement : `europe-west1` (ou proche de tes joueurs)
   - Règles de sécurité : **Mode test** pour démarrer
4. **Project settings** (⚙️) → **General** → **Vos applications** → icône `</>` (Web) → nom `horizon-web`
   → copie `apiKey`, `authDomain`, `databaseURL`, `projectId`, `appId`.

## 2. Renseigner les variables d'environnement

Dans `web/.env.local` (et sur Vercel → Settings → Environment Variables — voir `DEPLOYMENT.md` pour la liste complète) :

```env
NEXT_PUBLIC_FIREBASE_API_KEY=AIza…
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=horizon-zeldcraft.firebaseapp.com
NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://horizon-zeldcraft-default-rtdb.europe-west1.firebasedatabase.app
NEXT_PUBLIC_FIREBASE_PROJECT_ID=horizon-zeldcraft
NEXT_PUBLIC_FIREBASE_APP_ID=1:1234567890:web:abcdef
```

## 3. Activer l'authentification anonyme (OBLIGATOIRE avec les règles ci-dessous)

1. Console Firebase → **Build → Authentication**
2. Onglet **Sign-in method** → **Anonyme** → **Activer** → **Enregistrer**

Chaque visiteur reçoit un `uid` anonyme au premier chargement (via `ensureAnonSignIn()` dans
`web/src/lib/firebase.ts`). Ce `uid` est vérifié par les règles pour toutes les écritures.

## 4. Règles de sécurité — VERSION ACTUELLEMENT PUBLIÉE (production)

**Copie-colle EXACTEMENT** ce bloc dans Firebase Console → Build → Realtime Database →
**Règles** → **Publier**. Cette version couvre tous les chemins listés au § « Règle d'or ».

```json
{
  "rules": {
    "chats": {
      "$roomKey": {
        ".read":  "auth != null",
        ".write": "auth != null",
        ".indexOn": ["ts"],
        "$msgId": {
          ".validate": "newData.hasChildren(['uid','sender','message','ts']) && newData.child('uid').val() === auth.uid && newData.child('sender').isString() && newData.child('sender').val().matches(/^0x[a-fA-F0-9]{40}$/) && newData.child('message').isString() && newData.child('message').val().length > 0 && newData.child('message').val().length <= 500"
        }
      }
    },
    "chatIndex": {
      ".read":  "auth != null",
      "$contract": {
        ".read":  "auth != null",
        "$roomKey": {
          ".write": "auth != null",
          ".validate": "newData.hasChildren(['lastTs'])"
        }
      }
    },
    "players": {
      ".read":  true,
      "$addr": {
        ".read":  true,
        ".write": "auth != null"
      }
    },
    "playerIndex": {
      ".read":  true,
      ".write": "auth != null"
    },
    "catalog": {
      ".read":  true,
      ".write": "auth != null"
    }
  }
}
```

Clique **Publier**.

> ⚠️ Le noeud `chatIndex` est **indispensable** pour que le menu Admin → « Historique des chats » puisse
> lister les salons. Sans lui la dropdown reste vide car Firebase RTDB n'autorise pas la lecture d'un
> parent (`/chats`) quand seuls les enfants ont `.read`.

> ℹ️ **Tous les nouveaux chemins ajoutés depuis 2026-07** (équipement, cimetière des équipements,
> familiers, quêtes archipel/îles/Royaume, DLC, saisons/météo/lune, filtres carte, scripts de
> dialogue PNJ, widgets personnalisés, **Intelligence IA GamePlay** : `players/{addr}/analytics/*`,
> `catalog/analytics*`, `catalog/aiAnalyticsSettings`, `catalog/aiInsightsCache`…) sont déjà couverts
> par les règles génériques `players/$addr` et `catalog` ci-dessus, car ce sont tous de simples
> sous-chemins de ces deux arbres. **Aucune republication des règles n'est nécessaire pour ces
> fonctionnalités** — seul un nouveau chemin racine (hors
> `chats`/`chatIndex`/`players`/`playerIndex`/`catalog`) demanderait une mise à jour du JSON ci-dessus.

### Ce que ces règles verrouillent

| Règle | Effet |
|---|---|
| `chats.*.read/write: auth != null` | Seuls les utilisateurs authentifiés (anonymes) peuvent lire/écrire — bloque les scrapers |
| `newData.child('uid').val() === auth.uid` | **Anti-spoofing** : impossible de poster au nom d'un autre `uid` |
| `sender.matches(/^0x[a-fA-F0-9]{40}$/)` | `sender` doit être une adresse Ethereum valide (empêche `sender="admin"`) |
| `message.length > 0 && ≤ 500` | Pas de message vide, pas de flood 10 Mo |
| `players/$addr.write: auth != null` | Seul un utilisateur authentifié peut modifier un joueur |
| `players.*.read: true`, `playerIndex.read: true` | Nécessaire pour le scoreboard public et l'admin (dropdown joueurs) |
| `catalog.write: auth != null` | Seule la console admin (utilisateur auth) peut modifier prix/règles/presets |

### Rate limiting côté client

Déjà implémenté dans `TeamsPanel.tsx` : **1 message maximum toutes les 2 secondes** par utilisateur.
Si l'utilisateur essaie plus vite, l'UI affiche `⏳ Attends Xs`.

### Roadmap durcissement (v2)

- Cloud Function `verifyWalletSignature` : signer un message côté client, la function écrit le
  mapping `auth.uid → 0xaddr` dans une custom claim, puis les règles vérifient
  `auth.token.wallet === newData.child('sender').val()`.
- Restreindre `catalog.write` à `auth.token.admin === true` (custom claim posée manuellement pour
  le owner du contrat).
- Ajouter `.validate` sur `players/*` pour whitelist les champs autorisés.

## 5. Architecture

- Un « salon » = clé `chats/{contractAddress}_{teamId}`
- Chaque message = `{ uid: auth.uid, sender: 0x…, message: "…", ts: <server_timestamp> }`
- Le composant `TeamsPanel` écoute via `onValue(query(…, orderByChild('ts'), limitToLast(50)))`
- Latence typique : **< 500 ms** en Europe

## 6. Coûts

Le plan gratuit **Spark** de Firebase couvre :
- 100 connexions simultanées
- 1 Go de stockage
- 10 Go de bande passante / mois

Largement suffisant pour la phase MVP. Passe au plan **Blaze** (pay-as-you-go) si tu dépasses.

## 7. Checklist post-déploiement code

À faire **à chaque merge** touchant `web/src/lib/gameState.ts`, `web/src/lib/firebase.ts`,
`TeamsPanel.tsx`, `NpcEncounterPopup.tsx`, ou tout panneau d'administration :

- [ ] Lister les nouveaux chemins RTDB écrits par le code
- [ ] Vérifier qu'ils sont couverts par les règles ci-dessus (arbre `chats` / `chatIndex` / `players` / `playerIndex` / `catalog`)
- [ ] Si nouveau chemin racine → ajouter au tableau du § 🚨 et au bloc JSON du § 4
- [ ] Republier les règles dans Firebase Console → **Publier**
- [ ] Tester : accept/refuse popup NPC, envoi chat, top-up wallet, quête résolue → aucun `PERMISSION_DENIED` en console browser
