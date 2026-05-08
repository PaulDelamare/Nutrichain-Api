# Bonnes Pratiques et Architecture de l'API (Nutrichain)

Ce document centralise les règles d'architecture, de développement et de "Clean Code" qui doivent être rigoureusement appliquées sur l'ensemble du projet Nutrichain.

## 1. Architecture et "Clean Code"

### Séparation des Préoccupations (SoC - Separation of Concerns)
L'architecture de l'API est construite en couches strictes :
- **Routes (`src/Routes/`)** : Se limitent à définir les points d'entrée (URLs) et les méthodes HTTP (GET, POST, etc.).
- **Contrôleurs (`src/Controllers/`)** : Doivent être **ultra-minimalistes**. Leur seul rôle est de récupérer les données (body, params), d'appeler le Service correspondant, et de renvoyer la réponse HTTP (via l'utilitaire `returnSuccess`).
- **Services (`src/Services/`)** : Contiennent **100% de la logique métier**. Ils sont agnostiques du protocole HTTP.
- **Base de données (Prisma)** : Les appels à la base de données se font dans les services ou dans des "Repositories" si la logique est complexe.

### Le Principe DRY (Don't Repeat Yourself)
- Toute logique répétée (formatage, gestion d'erreurs) doit être extraite dans des **fonctions utilitaires pures** (`src/Utils/`) ou des **Middlewares/Hooks**.
- **Wrapper Async** : Les contrôleurs doivent être encapsulés dans un middleware (ex: `catchAsync`) pour éviter la répétition infernale des blocs `try/catch`. Toute erreur est automatiquement redirigée vers le `errorHandler` global.

## 2. Validation et Sécurité ("Fail Fast")

- **Validation stricte (VineJS)** : Toutes les données entrantes (Body, Query, Params) doivent être validées avec **VineJS** avant même d'atteindre la logique métier. En cas de données invalides, l'API rejette immédiatement la requête (Erreur 400).
- **Principe du Moindre Privilège** : Le système ABAC assure que chaque route vérifie rigoureusement les droits via des middlewares dédiés (ex: `requirePermission()`), eux-mêmes centralisés et réutilisables.

## 3. TypeScript Stratégique

- **Interdiction du `any`** : L'utilisation du type `any` est **strictement interdite**. Tous les retours de fonctions, paramètres et variables doivent être fortement typés.
- **Génériques (`<T>`)** : Utilisation maximale des types génériques pour les utilitaires et les réponses, afin de garantir une auto-complétion parfaite sans dupliquer le code.

## 4. Base de Données (Prisma)

- **Transactions (`$transaction`)** : Toute opération modifiant plusieurs tables simultanément (ex: créer un produit ET générer son lot) DOIT être encapsulée dans une transaction Prisma. En cas d'erreur sur une étape, tout est annulé (Rollback).
- **Optimisation des Requêtes (N+1)** : Utilisation réfléchie des clauses `include` et `select` dans Prisma pour récupérer les relations en une seule passe, au lieu de boucler pour refaire des requêtes.

## 5. Tests et Qualité

- **Co-location des tests** : Les fichiers de tests (Vitest) sont placés juste à côté des fichiers qu'ils testent (ex: `auth.service.test.ts` à côté de `auth.service.ts`) pour éviter un dossier `tests/` monolithique.
- **Mocking Ciblé** : Les tests unitaires des Services doivent simuler (mocker) les appels Prisma pour s'exécuter instantanément et indépendamment de l'état réel de la base de données. L'intégration base de données se teste séparément.