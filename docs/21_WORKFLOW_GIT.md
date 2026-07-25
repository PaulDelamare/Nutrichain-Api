# 21 — Workflow Git & gouvernance du dépôt

> Objectif : un dépôt **professionnel, protégé et reproductible**. Ce document décrit la
> stratégie de branches, les conventions, et les **règles de protection** à appliquer sur GitHub.

## 1. Stratégie de branches — GitHub Flow adapté

On suit un **GitHub Flow** simple (adapté à une équipe réduite) :

- **Tronc d'intégration** : `develop` (API) / `main` (front). Toujours dans un état déployable.
- **Branches de travail** : une par sujet, courte de vie, partant du tronc à jour.
- **Fusion** : uniquement par **Pull Request** relue et **CI verte**. Jamais de push direct sur le tronc.
- **Après merge** : la branche est supprimée (auto).

```
develop ─────●─────────●───────────●──────>  (toujours vert, protégé)
              \         \           /
   feat/x      ●──●──●   \         /
   fix/y                  ●──●────●
```

### Nommage des branches
`type/scope-court` — types : `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `test/`, `perf/`,
`security/`, `ci/`.
Exemples : `feat/audit-verify-button`, `fix/invitation-and-ratelimit`.

### Commits — Conventionnels
`type(scope): résumé impératif` — ex. `feat(iot): excursion → quarantaine`. Corps optionnel pour le *pourquoi*.
`security(scope):` est un type à part entière, utilisé pour tout correctif de cloisonnement ou d'accès.
Le hook husky/lint-staged lance **`eslint --fix` seul** : il ne formate pas (Prettier n'est branché
ni sur le hook ni sur la CI), ne compile pas et ne joue pas les tests.

### Règle d'or
**1 PR = 1 sujet.** Une PR petite et ciblée se relit vite et casse rarement. On ne cumule pas
plusieurs fonctionnalités sur une même branche.

## 2. Cycle d'une contribution

1. `git checkout develop && git pull` (partir du tronc **à jour**).
2. `git checkout -b feat/mon-sujet`.
3. Développer en commits atomiques (TDD si pertinent).
4. `git push -u origin feat/mon-sujet` puis ouvrir la PR (le template se remplit).
5. La **CI tourne**, un relecteur approuve → **merge** → branche supprimée.
6. Chacun re-`pull` le tronc.

⚠️ **Toujours mettre sa branche à jour avec le tronc avant le merge** (bouton « Update branch »
ou `git merge origin/develop`). C'est ce qui évite de merger du code périmé ou de perdre un commit.

## 3. Règles de protection sur GitHub (admin)

**État au 22/07/2026 : `main` et `develop` sont protégées côté API.** Ce tableau décrit la
configuration réellement en place, vérifiable par
`gh api repos/:owner/:repo/branches/develop/protection`.

Rappel du rôle des deux troncs : **`develop` est la préproduction et la base de TOUTES les PR** —
c'est là qu'on travaille et qu'on merge. **`main` est la production : on n'y touche pas.** Sa
protection est là par principe, pas pour encadrer un flux de release actif.

| Règle | Valeur | Pourquoi |
|---|---|---|
| **Require a pull request before merging** | ✅ activé | interdit le push direct sur le tronc |
| → Required approvals | **0** (voir note) | l'auteur ne peut pas s'auto-approuver ; à 1, le mainteneur solo serait bloqué |
| **Require status checks to pass** | ✅ activé | la CI doit être verte avant merge |
| → Check requis (API) | **`Code Quality & Tests`** | voir l'avertissement ci-dessous |
| → Checks requis (front) | `lint`, `check`, `unit-tests`, `build`, `e2e` | jobs de `ci.yml` |
| **Require branches to be up to date before merging** | ✅ activé | **empêche de merger une branche périmée** (bug vécu) |
| **Do not allow force pushes** | ✅ activé | protège l'historique |
| **Do not allow deletions** | ✅ activé | on ne supprime pas le tronc |
| **Include administrators** | ❌ désactivé | le mainteneur garde une sortie de secours en cas d'incident |
| **Require linear history** | ❌ désactivé | la mise à jour de branche se fait par merge ; l'historique n'est pas linéaire |

> ⚠️ **Un check requis se nomme d'après le `name:` AFFICHÉ du job, pas son identifiant.** Le job
> `quality-gates` de `ci.yml` s'affiche `Code Quality & Tests` : c'est cette chaîne exacte qu'il faut
> inscrire. Écrire `quality-gates` désigne un check qui ne remontera jamais — et **toute PR resterait
> bloquée en attente**. Même piège avec le job `cd` de `api-ci.yml` : déclenché en `workflow_run`
> après coup, il ne produit **aucun** check sur une PR ; il ne doit donc jamais être exigé.

**Note sur les approbations** : à 3 personnes avec un mainteneur qui fusionne, exiger **1 approbation**
bloque l'auteur (GitHub interdit l'auto-approbation). Deux options professionnelles :
- **0 approbation** + CI obligatoire : la CI est le garde-fou (choix pragmatique retenu).
- **1 approbation** dès qu'un binôme relit systématiquement les PR de l'autre (idéal si l'équipe s'y tient).

## 4. Fichiers de gouvernance du dépôt

- `.github/PULL_REQUEST_TEMPLATE.md` — gabarit de PR (pourquoi / contenu / vérifications).
- `.github/CODEOWNERS` — relecteurs assignés automatiquement.
- `.github/workflows/*.yml` — `ci.yml` (lint, typecheck, build, tests + couverture) et `api-ci.yml` (publication de l'image, en aval). **Aucun e2e en CI** : les scripts `e2e:*` se lancent à la main contre une base réelle.

## 5. À faire aussi côté dépôt (Settings)

- **General → Pull Requests** : cocher *Automatically delete head branches* (nettoyage auto après merge).
- **Choisir** *Squash and merge* (ou *Merge commit*) de façon cohérente entre les deux repos.
- Répliquer `.github/CODEOWNERS` + `PULL_REQUEST_TEMPLATE.md` sur le repo **front** (mêmes fichiers).
