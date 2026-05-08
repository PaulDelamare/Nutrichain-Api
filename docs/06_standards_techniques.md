# Standards Techniques (Nutrichain API)

Au-delà de l'architecture "Clean Code", l'API respecte les piliers suivants pour garantir qu'elle est "Prête pour la Production" (Production-ready).

## 1. Documentation Automatique (Swagger / OpenAPI)

Interdiction absolue de polluer le code (Routes ou Contrôleurs) avec des dizaines de lignes de commentaires `/* #swagger... */`. Le code doit rester visuellement propre.
- **Stratégie "Docs as Code"** : Utiliser nos schémas de validation (VineJS) comme source de vérité. Les schémas de validation seront traduits programmatiquement en documentation OpenAPI, garantissant que la doc est toujours synchronisée avec le code.
- **Centralisation** : S'il faut ajouter des descriptions manuelles, elles seront stockées dans des fichiers séparés (ex: `src/Docs/`) et non au-dessus des fonctions métiers. L'URL finale (ex: `/api-docs`) s'auto-générera proprement.

## 2. L'Observabilité (Traçabilité des requêtes)

La journalisation des logs utilise l'utilitaire interne (basé sur `winston` et `winston-daily-rotate-file`). Pour passer à un niveau industriel :
- **Request ID (UUID)** : Un identifiant unique est assigné à chaque requête HTTP entrante.
- Cet ID est injecté dans tous les logs (Info, Error, Crit) générés pendant le cycle de vie de la requête. Cela permet en cas de crash de filtrer instantanément dans les fichiers ou sur un outil externe le parcours exact de la requête défectueuse.

## 3. Validation des Variables d'Environnement (Fail Fast Démarrage)

- Le serveur ne doit **pas** démarrer s'il manque une variable critique.
- Au lancement (`server.ts`), le fichier `.env` est validé via le validateur global de l'application (ex: VineJS). S'il manque `DATABASE_URL` ou `JWT_SECRET`, une erreur critique "CRIT" est générée et le processus s'arrête (Exit Code 1) avec un message clair.

## 4. Standardisation des Listes (Collections)

Toutes les routes retournant des listes (Utilisateurs, Lots, Produits) doivent respecter un format universel adapté aux volumes industriels :
- **Pagination systématique** (`?page=1&limit=500`). Vu la volumétrie (millions de lots, palettes entières), la limite par défaut/minimale est calibrée à 500 pour éviter d'inonder le réseau avec des milliers de petites requêtes.
- **Structure JSON retournée** standardisée au travers d'un utilitaire (ex: `returnPaginatedSuccess`), qui retourne à la fois les données et les "méta" (total de pages, nombre d'éléments restants).

## 5. CI/CD et Processus Git

- **Pistes d'amélioration futures** : Mise en place de `Husky` et `lint-staged` pour interdire les commits si l'application ne compile pas, si les tests échouent ou si ESLint remonte des avertissements.
- **Conventional Commits** : Maintenir un historique Git propre (`feat:`, `fix:`, `refactor:`).
