# Bonnes Pratiques et Architecture de l'API (Nutrichain)

Ce document centralise les règles d'architecture, de développement et de "Clean Code" qui doivent être rigoureusement appliquées sur l'ensemble du projet Nutrichain.

## 1. Architecture et "Clean Code"

### Séparation des Préoccupations (SoC - Separation of Concerns)
L'API est un **monolithe modulaire** : les couches sont découpées **par domaine métier**, dans
`src/modules/<domaine>/[<sous-domaine>/]`, et non en dossiers techniques globaux. Un module expose
généralement `routes/`, `controllers/`, `services/`, plus ce qui lui est propre (`middlewares/`,
`constants/`, `schemas/`, `models/`, `jobs/`, `types/`, `utils/`) — on ne crée un sous-dossier que
s'il a un contenu. `core`, minuscule, reste volontairement à plat. Le transverse vit dans
`src/shared/`.

- **Routes (`<module>/routes/<nom>.routes.ts`)** : URLs, méthodes HTTP et gardes. Chaque fichier crée
  son propre `Router()` et l'exporte par défaut ; `src/app.ts` les monte sur `/api` (à une exception
  près : les routes d'invitation sont montées en cascade par `auth.routes.ts`).
- **Contrôleurs (`<module>/controllers/<nom>.controller.ts`)** : **ultra-minimalistes**. Ils lisent
  body/params/`req.activeOrgId`, appellent le service, et répondent via `sendSuccess`.
- **Services (`<module>/services/<nom>.service.ts`)** : **100% de la logique métier**, agnostiques du
  protocole HTTP.
- **Base de données (Prisma)** : appelée **directement depuis les services**. Il n'existe **pas** de
  couche Repository, et il n'est pas prévu d'en introduire une : elle n'ajouterait qu'une
  indirection sur un client déjà typé.

### Le Principe DRY (Don't Repeat Yourself)
- Toute logique répétée (formatage, gestion d'erreurs) doit être extraite dans des **fonctions utilitaires pures** (`src/shared/utils/`) ou des **Middlewares**.
- **Wrapper Async** : Les contrôleurs doivent être encapsulés dans un middleware (ex: `catchAsync`) pour éviter la répétition infernale des blocs `try/catch`. Toute erreur est automatiquement redirigée vers le `errorHandler` global.

## 2. Validation et Sécurité ("Fail Fast")

- **Validation stricte (VineJS)** : Toutes les données entrantes (Body, Query, Params) doivent être validées avec **VineJS** avant même d'atteindre la logique métier. En cas de données invalides, l'API rejette immédiatement la requête (Erreur 400).
- **Principe du Moindre Privilège** : le contrôle d'accès implémenté est un **RBAC**, pas un ABAC.
  Chaque route porte sa garde, dans la très grande majorité des cas `sessionAuth(ROLES)` ou
  `requireAuth` + `requireOrgRole(ROLES)` ; deux voies dérogent avec leur propre mécanisme, la
  télémétrie des capteurs (`machineAuth`) et l'administration de plateforme
  (`requirePlatformAdmin`). Le vocabulaire de rôles a une source unique,
  `identity/constants/roles.constants.ts` (`ALL_ROLES`, `WRITE_ROLES`, `QUALITY_ROLES`,
  `ADMIN_ROLES`, `PERSONAL_DATA_ROLES`) ; quelques modules en dérivent un alias local
  (`SYNC_WRITE_ROLES`, `CATALOG_READ_ROLES`…) — ce sont des sous-ensembles de ces cinq-là, pas un
  second vocabulaire. Il n'existe
  **pas** de `requirePermission()` : l'ABAC décrit dans `02_roles_et_permissions.md` est une cible
  de conception, non implémentée.
- **Cloisonnement** : l'organisation vient de la session (`req.activeOrgId`), jamais du corps de la
  requête, et elle est passée explicitement à chaque service. `where: { organization_id: undefined }`
  ne filtre rien en Prisma : une garde oubliée expose tous les tenants sans lever d'erreur.

## 3. TypeScript Stratégique

- **Interdiction du `any`** : L'utilisation du type `any` est **strictement interdite**. Tous les retours de fonctions, paramètres et variables doivent être fortement typés.
- **Génériques (`<T>`)** : Utilisation maximale des types génériques pour les utilitaires et les réponses, afin de garantir une auto-complétion parfaite sans dupliquer le code.

## 4. Base de Données (Prisma)

- **Transactions** : toute opération modifiant plusieurs tables simultanément (ex : créer une
  réception ET son lot ET la ligne d'audit) DOIT être encapsulée dans une transaction. En cas
  d'erreur sur une étape, tout est annulé (rollback).
- **`retryableTransaction`, pas `$transaction` nu** : dès qu'une écriture touche la chaîne d'audit,
  on passe par `retryableTransaction` (`shared/utils/db/withWriteConflictRetry.ts`), qui rejoue
  l'opération sur conflit d'écriture. Sans lui, deux écritures concurrentes se soldent par un 500 :
  un conflit de sérialisation levé par une requête brute remonte en `P2010` porteur du SQLSTATE
  `40001`, et non en `P2034`. Ne jamais y enfermer d'effet de bord non transactionnel (envoi de mail)
  : le retry le rejouerait. Les seuls `$transaction` bruts restants sont des **lectures** : comptage + page dans le même
  instantané, simulation de rappel (`simulateRecall`, qui n'écrit rien) et job de vérification de
  chaîne. Aucune écriture n'en utilise.
- **Optimisation des Requêtes (N+1)** : Utilisation réfléchie des clauses `include` et `select` dans Prisma pour récupérer les relations en une seule passe, au lieu de boucler pour refaire des requêtes.

## 5. Tests et Qualité

- **Co-location des tests** : Les fichiers de tests (Vitest) sont placés juste à côté des fichiers qu'ils testent (ex: `auth.service.test.ts` à côté de `auth.service.ts`) pour éviter un dossier `tests/` monolithique.
- **Mocking Ciblé** : Les tests unitaires des Services doivent simuler (mocker) les appels Prisma pour s'exécuter instantanément et indépendamment de l'état réel de la base de données. L'intégration base de données se teste séparément.