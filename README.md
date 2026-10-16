# Tunfcb — API

API Express + MongoDB de l'application mobile et du tableau de bord.

## Démarrer

```bash
cp .env.example .env      # puis renseigner les secrets
npm install
npm run dev               # http://localhost:4000/api/health
```

Au premier démarrage, l'API crée le super administrateur (`SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD`),
les règles du jeu par défaut, 7 missions et 35 questions de quiz.

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Serveur avec rechargement |
| `npm run build && npm start` | Production |
| `npm run typecheck` | Vérification TypeScript |
| `npm run seed:demo` | Ajoute 40 supporters de démo avec 30 jours d'activité |
| `npm run seed:demo -- --clear` | Supprime toutes les données de démo |

## Organisation

`src/modules/<domaine>/` : modèle Mongoose, schémas Zod, service, contrôleur, routes.

- **auth** — inscription / connexion des supporters (JWT 30 j), parrainage
- **admins** — connexion au dashboard (JWT séparé), gestion des administrateurs
- **users** — profil mobile, gestion admin (recherche, suspension, ajustement de points…)
- **points** — grand livre : chaque gain/dépense est une transaction (`awardPoints`)
- **leaderboard** — classements jour / semaine / mois / année (somme des transactions) et général (XP)
- **games** — quiz du jour, roue, pronostics (synchro ESPN), pubs récompensées, bonus quotidien, missions
- **settings** — économie du jeu (niveaux, récompenses, roue…) modifiable depuis le dashboard
- **notifications**, **stats**

## Règles importantes

- **Solde** (BP dépensables) et **XP** (gains nets, détermine le niveau) sont distincts.
- Les « jours » (quiz, bonus, classements) suivent `APP_TIMEZONE` (Africa/Tunis).
- Les gains sont protégés contre le double clic par des mises à jour MongoDB atomiques.
- Les pronostics sont ouverts 21 jours avant le match, fermés au coup d'envoi et réglés
  automatiquement avec le score ESPN (`PREDICTIONS_SYNC_MINUTES`).
- Pubs récompensées : en production, brancher la vérification serveur AdMob (SSV).
