# Standards Techniques (Nutrichain API)

> **Note 22/07/2026** : ce document décrit désormais **l'état réel du code**, y compris ses trous (pas d'utilitaire de pagination partagé, hook de pré-commit réduit à ESLint). Les sections §2 et §3 avaient été implémentées lors de la session de durcissement — voir `13_SESSION_HARDENING_2026-05-27.md`.

Au-delà de l'architecture "Clean Code", l'API respecte les piliers suivants pour garantir qu'elle est "Prête pour la Production" (Production-ready).

## 1. Documentation Automatique (Swagger / OpenAPI)

**Choix retenu : `swagger-jsdoc`, annotations `@swagger` au-dessus des routes.** La cible initiale
(générer l'OpenAPI depuis les schémas VineJS, descriptions déportées dans `src/Docs/`) n'a pas été
retenue : elle n'a jamais été implémentée, `src/Docs/` n'existe pas, et un schéma de validation ne
porte ni les codes de réponse ni les exemples.

- La doc vit **à côté de la route qu'elle décrit**, dans `<module>/routes/*.routes.ts` : 20 blocs
  `@swagger` répartis dans 11 fichiers, agrégés par glob (`shared/configs/swagger.config.ts`).
- Elle est servie sur `/api-docs`.
- **Limite connue** : la couverture est partielle — toutes les routes ne sont pas annotées, et rien
  ne le vérifie automatiquement.

## 2. L'Observabilité (Traçabilité des requêtes)

La journalisation des logs utilise l'utilitaire interne (basé sur `winston` et `winston-daily-rotate-file`). Pour passer à un niveau industriel :
- **Request ID (UUID)** : Un identifiant unique est assigné à chaque requête HTTP entrante.
- Cet ID est injecté dans tous les logs (Info, Error, Crit) générés pendant le cycle de vie de la requête. Cela permet en cas de crash de filtrer instantanément dans les fichiers ou sur un outil externe le parcours exact de la requête défectueuse.

## 3. Validation des Variables d'Environnement (Fail Fast Démarrage)

- Le serveur ne doit **pas** démarrer s'il manque une variable critique.
- Au lancement, `assertEnv()` (`shared/configs/env.validator.ts`) s'exécute **avant l'import de
  l'application et des clients de base** : elle lève, et le `catch` de `server.ts` journalise en
  `[CRIT]` puis arrête le processus (exit 1) en listant les variables manquantes. Rien de métier
  n'est chargé tant que l'environnement n'est pas complet.
- Les huit variables exigées : `DATABASE_URL`, `API_KEY`, `IOT_API_KEY`, `API_KEY_ORG_ID`,
  `API_URL`, `FRONTEND_URL`, `MONGO_URI`, `BETTER_AUTH_SECRET`. (Il n'y a pas de `JWT_SECRET` :
  l'authentification passe par Better-Auth, en sessions, pas en JWT.)
- `API_KEY` identifie l'application appelante et **n'autorise rien** ; `IOT_API_KEY` est un vrai
  secret : une trame de télémétrie met des lots en quarantaine, elle décide au lieu de décrire.

## 4. Standardisation des Listes (Collections)

Toutes les routes retournant des listes (Utilisateurs, Lots, Produits) doivent respecter un format universel adapté aux volumes industriels :
- **Pagination systématique** (`?page=1&limit=...`). Vu la volumétrie (millions de lots, palettes entières), le **plafond** de `limit` est calibré à **500** pour les imports/exports massifs. Le **défaut** est laissé à l'appréciation de l'endpoint : **20** pour les restitutions consultées à l'écran (ex: `GET /api/traceability/events`, `listReceipts`), 500 pour les flux bulk. Toute valeur `limit` est bornée à `[1, 500]` et validée côté entrée (VineJS).
- **Structure JSON retournée** : `sendSuccess` (`shared/utils/returnSuccess/`) enveloppe toute
  réponse en `{ status, message, data }`, mais **ne pagine pas**. Il n'existe aujourd'hui **aucun
  utilitaire de pagination partagé** : chaque endpoint paginé construit son propre `{ data, meta }`.
  C'est un écart assumé et non résorbé — pas une fonction à appeler.

> **État réel du plafond** : appliqué partout, par un schéma VineJS de query. Les plafonds vivent
> dans `shared/constants/pagination.constants.ts` — valeur unique, parce qu'un plafond recopié à
> cinq endroits est cinq occasions d'en oublier un, ce qui est précisément ce qui s'était produit.
>
> `page` est borné **des deux côtés** : `skip = (page - 1) * limit`, donc un numéro de page
> démesuré produit un `skip` que la base refuse — le même 500 que `page=0`, de l'autre côté de
> l'axe. `page` et `limit` sont en outre exigés **entiers** : une demi-page rendait la pagination
> non déterministe.

## 5. CI/CD et Processus Git

- **Husky et lint-staged sont en place** (`.husky/pre-commit`), mais leur portée est volontairement
  étroite : le hook lance **uniquement `eslint --fix`** sur les fichiers indexés. Il ne compile pas,
  ne joue pas les tests et **n'exécute pas Prettier**. La barrière réelle est la CI, pas le hook —
  un commit local peut donc passer alors que la CI échouera.
- **Conventional Commits** : Maintenir un historique Git propre (`feat:`, `fix:`, `refactor:`).
