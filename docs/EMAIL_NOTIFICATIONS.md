# ✉️📢 E-mails automatiques & annonces en direct

Cette fonctionnalité ajoute un système complet d'e-mails transactionnels pour les comptes
« Jouer sans portefeuille » (voir `docs/DEMO_FIAT.md`), ainsi qu'un bandeau d'annonce en direct
dans le jeu — le tout paramétrable depuis `Administration > Barème & règles` (section « ✉️ E-mails
automatiques ») et `Administration > Statistiques par joueur` (sous-panneau `PlayerEmailPanel`).

## 🧭 Vue d'ensemble

| Besoin | Composant / route |
|---|---|
| Créer un compte sécurisé par e-mail/mot de passe (au lieu d'une connexion Google) | `NoWalletAccessPanel.tsx` + `lib/firebase.ts` |
| E-mail de bienvenue à la création de compte | `api/email/send` (`kind: 'welcome'`) |
| Rapport de progression immédiat (bouton admin) | `api/email/send` (`kind: 'report'`) |
| Rapport de progression **programmé** (récurrent) | `api/email/cron-reports` (Vercel Cron, voir `vercel.json`) |
| Message personnalisé à un joueur ou à tous (maintenance, actu…) | `api/email/send` (`kind: 'broadcast'`) |
| Bandeau « annonce en direct » in-game (ciblé ou global) | `gameState.ts` (`*Announcement*`) + `AnnouncementBanner.tsx` |
| Reset mot de passe forcé par l'admin | `api/admin/reset-password` + `api/email/send` (`kind: 'password-reset'`) |
| Changement de mot de passe volontaire par le joueur | `PasswordResetModal.tsx` + `lib/firebase.ts::selfUpdatePassword` + `api/email/send` (`kind: 'password-changed'`) |

Fournisseur d'envoi : **[Resend](https://resend.com)**, via son API REST directement (`fetch`),
sans SDK npm — même logique que `api/ai/insights/route.ts` pour les fournisseurs IA : on garde le
projet léger et on évite une dépendance supplémentaire pour un simple appel HTTP JSON.

## 🔐 Compte e-mail/mot de passe sécurisé (« Jouer sans portefeuille »)

Avant cette évolution, `signInWithEmail()` tentait silencieusement une connexion puis, en cas
d'échec, créait un compte — ambigu et sans confirmation de mot de passe. Remplacé par un flux
explicite dans `NoWalletAccessPanel.tsx` :

- Deux modes clairs, choisis par le joueur via deux boutons : **« Se connecter »** vs
  **« Créer un compte »**.
- En mode création : champ « Confirmer le mot de passe », comparé côté client avant tout appel
  Firebase (`home.fiat.passwordMismatch` si différent).
- Validation du format d'e-mail côté client via `isValidEmailFormat()` (regex `@` + domaine +
  suffixe) avant tout appel réseau.
- `lib/firebase.ts` expose désormais :
  - `signInWithEmailLogin(email, password)` — connexion pure, ne crée jamais de compte.
  - `createAccountWithEmail(email, password)` — création pure, échoue explicitement si le compte
    existe déjà (`auth/email-already-in-use`).
  - `describeEmailAuthErrorKey(errorCode)` — traduit les codes d'erreur Firebase Auth
    (`auth/invalid-email`, `auth/email-already-in-use`, `auth/weak-password`,
    `auth/wrong-password`, `auth/user-not-found`, …) vers une clé i18n (`home.fiat.emailError*`)
    affichée dans les 4 langues.
- Un compte déjà créé se reconnecte simplement avec son e-mail + mot de passe : sa progression
  (`players/{addr}`, adresse virtuelle dérivée de son UID Firebase) est retrouvée normalement, sans
  rien recréer.

**Aucun mot de passe n'est jamais envoyé par e-mail lors de la création de compte** (ni en clair,
ni haché) — l'e-mail de bienvenue confirme uniquement la création du compte. La seule exception est
le reset de mot de passe forcé par l'admin (voir § « 🔑 Reset mot de passe » ci-dessous), qui
communique intentionnellement le nouveau mot de passe en clair au joueur pour qu'il puisse se
reconnecter.

## 🔑 Reset mot de passe (admin-forcé + auto-service joueur)

Deux flux distincts, réservés aux comptes « Jouer sans portefeuille » créés par e-mail/mot de passe
(`PlayerState.authMethod === 'email'` — absent/`'google'` pour les comptes liés à Google, qui n'ont
pas de mot de passe Firebase à réinitialiser).

### 1. Reset forcé par l'admin (`Administration > Statistiques par joueur > Zone de danger`)

Bouton « 🔑 Reset mot de passe », visible uniquement si le joueur sélectionné a
`authMethod === 'email'` :

```
PlayerStats.tsx → POST /api/admin/reset-password { uid } → { ok, newPassword }
```

- Le SDK Auth **client** ne peut modifier que le mot de passe de l'utilisateur *actuellement
  connecté* — impossible de réinitialiser le compte d'un *autre* joueur depuis le navigateur admin.
  La route utilise donc le **Firebase Admin SDK** (`firebase-admin`, `lib/firebaseAdmin.ts`), qui
  nécessite ses propres identifiants serveur : `FIREBASE_ADMIN_CLIENT_EMAIL` +
  `FIREBASE_ADMIN_PRIVATE_KEY` (voir `docs/DEPLOYMENT.md`), distincts du `FIREBASE_DB_SECRET` déjà
  utilisé pour les rapports programmés (celui-ci n'a aucun droit sur Firebase Auth).
- `generateStrongPassword(12)` génère un mot de passe aléatoire cryptographiquement sûr (12
  caractères : au moins une majuscule, une minuscule, un chiffre, un caractère spécial, mélangés),
  en excluant les caractères visuellement ambigus (`I`, `l`, `O`, `0`, `1`) pour rester lisible une
  fois affiché/copié.
- Le mot de passe généré est renvoyé **une seule fois** dans la réponse de l'API et affiché en clair
  dans le panneau admin (zone de danger) — **jamais persisté en base** (ni RTDB ni ailleurs) : une
  fois la page rechargée ou l'admin reparti, il n'est plus récupérable et il faut regénérer un
  nouveau mot de passe si besoin.
- Un e-mail (`kind: 'password-reset'`, `buildPasswordResetEmail`) est envoyé au joueur avec son
  nouveau mot de passe en clair, pour qu'il puisse se reconnecter.
- `PlayerState.passwordResetCount` (compteur partagé avec le flux ci-dessous) et
  `lastPasswordResetAt` sont incrémentés/mis à jour et affichés dans les statistiques du joueur.
- Si les identifiants Admin SDK ne sont pas configurés, la route répond `501` et le panneau affiche
  un message explicite invitant à consulter `docs/DEPLOYMENT.md` — aucune autre fonctionnalité du
  jeu n'est affectée (dégradation gracieuse, comme pour les autres clés optionnelles du projet).

### 2. Changement volontaire par le joueur (bouton à côté de l'adresse virtuelle en jeu)

Nouveau bouton « 🔑 Reset mot de passe » dans le menu déroulant de `EffectiveAccountBadge.tsx`
(visible uniquement pour un compte fiat par e-mail), ouvrant `PasswordResetModal.tsx` :

- 100% côté client via `lib/firebase.ts::selfUpdatePassword()` (`updatePassword()` du SDK Auth sur
  l'utilisateur courant — aucun besoin du SDK Admin ici).
- Demande le nouveau mot de passe + sa confirmation. Si Firebase exige une reconnexion récente
  (`auth/requires-recent-login`, opération sensible), la pop-up affiche automatiquement un champ
  « mot de passe actuel » et retente avec `reauthenticateWithCredential`.
- Envoie un e-mail de confirmation (`kind: 'password-changed'`, `buildPasswordChangedEmail`) — **ne
  révèle jamais le nouveau mot de passe** (le joueur vient de le choisir lui-même), juste une alerte
  de sécurité confirmant le changement.
- Incrémente le même compteur `passwordResetCount` que le flux admin (« nombre de fois où le mot de
  passe a été changé », peu importe qui a déclenché le changement).

## 📨 E-mail de bienvenue

Déclenché une seule fois, juste après une création de compte réussie via
`createAccountWithEmail()` (jamais lors d'une simple connexion) :

```
NoWalletAccessPanel.tsx → POST /api/email/send { kind: 'welcome', to, locale, bannerImageUrl }
```

- Appel **best-effort et non bloquant** : si l'envoi échoue (Resend non configuré, erreur réseau…),
  le joueur accède quand même immédiatement au jeu — l'e-mail n'est qu'une confirmation, jamais une
  condition d'accès.
- Contrôlé par `RepRules.welcomeEmailEnabled` (défaut `true`) et globalement par
  `RepRules.emailNotificationsEnabled` (défaut `true`, coupe-circuit général pour tous les envois).
- Le template (`lib/email/templates.ts::buildWelcomeEmail`) inclut un bandeau décoratif (image
  configurable via `RepRules.emailBannerImageUrl`, ou à défaut une bannière emoji auto-générée) et
  un texte de bienvenue traduit en fr/en/es/pt.

## 📊 Rapport de progression joueur (immédiat + programmé)

Depuis `Administration > Statistiques par joueur`, en sélectionnant un joueur, le sous-panneau
`PlayerEmailPanel` propose :

### Envoi immédiat
Bouton « Envoyer un rapport maintenant » → `POST /api/email/send { kind: 'report', to, locale,
stats, customMessage?, customImageUrl? }`. Les statistiques (`ReportStats`, calculées dans
`PlayerStats.tsx`) unifient :
- **Comptes portefeuille** : niveau/XP/stade lus depuis le tuple Voxlyn on-chain
  (`voxlyn[7]`=level, `voxlyn[3]`+`xpBonus`=xp, `voxlyn[8]`=stageIndex).
- **Comptes Démo/Fiat** : `computeOffchainStageLevel(xpBonus)` (même formule que le smart
  contract, voir `docs/DEMO_FIAT.md` § simulation hors-chaîne).
- Dans les deux cas : quêtes résolues et PNJ rencontrés via les compteurs Firebase
  (`activity.questsSolved`, `npcsMetFb`) — une synthèse « suffisamment fidèle » pour un e-mail, pas
  nécessairement identique aux compteurs on-chain affichés ailleurs dans le tableau admin.

### Programmation récurrente
Case à cocher « Activer », date de début (calendrier), cycle (quotidien / hebdomadaire avec choix
des jours / mensuel avec jour du mois / annuel), message et image personnalisés optionnels →
enregistré dans `PlayerState.scheduledReport` (`gameState.ts::setPlayerScheduledReport`).

Un **Vercel Cron** (`web/vercel.json`, `0 * * * *` = toutes les heures) appelle
`GET/POST /api/email/cron-reports`, qui :
1. Lit tous les joueurs via l'API REST Realtime Database + un **secret de base de données legacy**
   (`FIREBASE_DB_SECRET`) — voir `lib/email/firebaseAdminRest.ts` — car un job cron n'a pas de
   session navigateur pour utiliser le SDK client Firebase comme le reste du jeu.
2. Pour chaque joueur avec `scheduledReport.enabled = true`, teste `isDue()` : fenêtre tolérante
   (~23h daily/weekly, ~27j monthly, ~300j yearly) car le cron ne tourne qu'une fois par heure, afin
   de ne jamais rater un envoi à cause d'un léger décalage.
3. Envoie le rapport puis écrit `scheduledReport.lastSentAt` (anti-doublon dans la même période).

Protégée par `CRON_SECRET` optionnel — Vercel Cron envoie automatiquement l'en-tête
`Authorization: Bearer <CRON_SECRET>` sur les requêtes planifiées dès que cette variable est
définie. Sans elle, l'endpoint reste appelable sans protection (acceptable : il n'envoie que des
rapports déjà programmés par l'admin, aucune donnée sensible n'est exposée dans la réponse), mais
sa configuration est recommandée en production.

## 📣 Message personnalisé & envoi de masse

Toujours dans `PlayerEmailPanel` : une zone de texte + URL d'image optionnelle, envoyable :
- **À un joueur précis** (celui sélectionné dans la liste déroulante).
- **À tous les joueurs ayant un e-mail enregistré** (`kind: 'broadcast'`, avec une **confirmation
  obligatoire** avant l'envoi — utile par ex. pour prévenir d'une migration d'infra/maintenance qui
  rendra le jeu inaccessible quelques jours). L'envoi de masse utilise `sendEmailBatch()`
  (`lib/email/resend.ts`) : lots de 5 destinataires avec ~600 ms de pause entre chaque lot, pour ne
  pas saturer le rate-limit Resend (~2 req/s sur le plan gratuit).

## 📢 Bandeau d'annonce en direct (in-game)

En complément (ou alternative plus rapide) à un envoi d'e-mail, l'admin peut publier une annonce
qui apparaît **immédiatement** dans le jeu, en haut de l'écran, pour les joueurs déjà connectés :

- **Annonce ciblée** — un seul joueur (son adresse wallet ou virtuelle) :
  `setPlayerAnnouncement(address, message, imageUrl?)` / `clearPlayerAnnouncement(address)`.
- **Annonce globale** — tous les joueurs connectés :
  `setGlobalAnnouncement(message, imageUrl?)` / `clearGlobalAnnouncement()`.
- Stockage RTDB : `announcements/global` et `announcements/targeted/{addr}`.
- `AnnouncementBanner.tsx` (monté dans `game/page.tsx`) s'abonne via `subscribeAnnouncements()`
  (fusionne l'annonce ciblée et l'annonce globale, ciblée affichée en premier), affiche un bandeau
  animé, fermable individuellement par le joueur (mémorisé par `createdAt` dans `sessionStorage` —
  fermer une annonce ne la fait pas réapparaître en boucle, mais une **nouvelle** annonce publiée
  par l'admin réapparaîtra bien).
- Nettoyage automatique : `deletePlayerAccount()` supprime aussi l'annonce ciblée du joueur ;
  `deleteAllPlayers()` supprime l'intégralité de l'arbre `announcements`.

## ⚙️ Réglages admin (Administration > Barème & règles > ✉️ E-mails automatiques)

| Réglage | Défaut | Effet |
|---|---|---|
| `emailNotificationsEnabled` | `true` | Coupe-circuit général : si `false`, aucun e-mail n'est envoyé (bienvenue, rapport, annonce) |
| `welcomeEmailEnabled` | `true` | Active/désactive spécifiquement l'e-mail de bienvenue à la création de compte |
| `emailFromName` | `Horizon ZeldCraft` | Nom d'expéditeur affiché dans le client mail du destinataire |
| `emailBannerImageUrl` | *(vide)* | URL d'image utilisée en bandeau décoratif dans tous les e-mails ; à défaut, bannière emoji générée automatiquement |

## 🔧 Configuration requise (variables d'environnement serveur, Vercel)

Toutes ajoutées à `docs/DEPLOYMENT.md` (tableau des variables d'environnement) :

| Variable | Requise pour | Où l'obtenir |
|---|---|---|
| `RESEND_API_KEY` | Tout envoi d'e-mail (bienvenue/rapport/annonce) | [resend.com/api-keys](https://resend.com/api-keys) — gratuit jusqu'à 3000 e-mails/mois |
| `RESEND_FROM_EMAIL` | Adresse d'expédition | Domaine vérifié dans Resend, ou `onboarding@resend.dev` en attendant |
| `RESEND_FROM_NAME` | Nom d'expéditeur (fallback si `emailFromName` non défini en base) | Libre |
| `FIREBASE_DB_SECRET` | Rapports **programmés** uniquement (cron) | Console Firebase → Paramètres du projet → Comptes de service → onglet « Legacy » (Database secrets) |
| `CRON_SECRET` | Sécurisation optionnelle de `/api/email/cron-reports` | Valeur aléatoire de ton choix |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Reset mot de passe **forcé par l'admin** uniquement (§ ci-dessus) | Console Firebase → Comptes de service → « Générer une nouvelle clé privée » → champ `client_email` |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Reset mot de passe **forcé par l'admin** uniquement (§ ci-dessus) | Même fichier JSON que ci-dessus → champ `private_key` |

Si `RESEND_API_KEY` est absent : les routes `/api/email/*` répondent explicitement en **501**
(plutôt que de planter) et un avertissement (⚠️) s'affiche dans le panneau Administration —
même convention que `NEXT_PUBLIC_ETHERSCAN_KEY`/`GEMINI_API_KEY` absents ailleurs dans le projet.
Si `FIREBASE_DB_SECRET` est absent : seuls les rapports **programmés** (cron) sont indisponibles ;
l'envoi immédiat, l'e-mail de bienvenue et les annonces continuent de fonctionner normalement (ils
passent par le SDK client Firebase, pas par le secret de base de données).

**Après tout ajout/modification de ces variables sur Vercel, un redéploiement manuel est requis**
(Vercel ne redéploie pas automatiquement sur un simple changement de variable d'environnement).

## 🌍 Langues

Chaque joueur a désormais un champ `PlayerState.lang` (`'fr' | 'en' | 'es' | 'pt'`), capturé une
seule fois à la création de son compte (`locale` actif de l'app via `useI18n()`), utilisé pour
choisir la langue de ses e-mails (bienvenue, rapport programmé). Les templates d'e-mails
(`lib/email/templates.ts`) embarquent leur propre dictionnaire fr/en/es/pt, volontairement
découplé du système i18n client (`lib/i18n`) car ils s'exécutent côté serveur, sans accès au
contexte React de l'app.

## 🔒 Sécurité & conventions suivies

- Comme toutes les autres routes API du projet (voir `api/ai/insights/route.ts`), les routes
  `/api/email/*` ne font **aucune vérification serveur de rôle admin** — le menu Administration
  est déjà protégé côté client par `isOwner` (`app/admin/page.tsx`). Seule une validation basique
  des entrées (format e-mail, champs requis) est effectuée serveur.
- Le secret de base de données Firebase (`FIREBASE_DB_SECRET`) n'est utilisé **que** par le job
  cron (aucune route appelée depuis le navigateur n'y a accès) — toutes les autres opérations
  passent par le SDK client Firebase déjà authentifié (`ensureAnonSignIn()`).
- Toutes les écritures RTDB liées à ces fonctionnalités (`getOrCreatePlayer`,
  `setPlayerScheduledReport`, annonces) suivent la convention existante du projet : jamais
  d'assignation directe de `undefined` (spread conditionnel des champs optionnels), pour éviter les
  erreurs Firebase « Reference.set failed: value argument contains undefined ».

## ⚠️ Points d'attention pour la suite

- **Règles de sécurité RTDB** (non versionnées dans ce repo, gérées via la Console Firebase) : il
  faut vérifier que les chemins `announcements/*` et `players/{addr}/scheduledReport` autorisent
  bien la lecture/écriture attendues (lecture publique pour `announcements` afin que
  `AnnouncementBanner` fonctionne aussi en session Démo/anonyme ; écriture réservée — au moins en
  convention côté client — aux actions du menu Administration). Voir `docs/FIREBASE_CHAT.md` pour
  le modèle de règles déjà en place sur les autres chemins du projet.
- **Domaine d'expédition Resend non vérifié** : tant qu'aucun domaine personnalisé n'est vérifié
  dans Resend, `RESEND_FROM_EMAIL` doit rester `onboarding@resend.dev` (limite : n'envoie qu'à
  l'adresse du compte Resend en mode test/sandbox tant que le domaine n'est pas vérifié) — vérifier
  un domaine réel avant un lancement public pour envoyer aux vrais joueurs.
- Voir `docs/ROADMAP.md` pour le suivi de cette fonctionnalité dans la feuille de route globale.
