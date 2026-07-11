# 21 — Workflow Git & gouvernance du dépôt

> Objectif : un dépôt **professionnel, protégé et reproductible**. Ce document décrit la
> stratégie de branches, les conventions, et les **règles de protection** à appliquer sur GitHub.
> Il vaut aussi comme support pour la partie « méthode de travail » de la soutenance.

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
`type/scope-court` — types : `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `test/`, `perf/`.
Exemples : `feat/audit-verify-button`, `fix/invitation-and-ratelimit`.

### Commits — Conventionnels
`type(scope): résumé impératif` — ex. `feat(iot): excursion → quarantaine`. Corps optionnel pour le *pourquoi*.
Les hooks husky/lint-staged formatent et lintent au commit.

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

## 3. Règles de protection à appliquer sur GitHub (admin)

`Settings → Branches → Add branch ruleset` (ou « Add rule ») sur le tronc (`develop` API, `main` front) :

| Règle | Valeur | Pourquoi |
|---|---|---|
| **Require a pull request before merging** | ✅ activé | interdit le push direct sur le tronc |
| → Required approvals | **0** (voir note) | l'auteur ne peut pas s'auto-approuver ; à 1, le mainteneur solo serait bloqué |
| **Require status checks to pass** | ✅ activé | la CI doit être verte avant merge |
| → Checks requis (API) | `quality-gates`, `ci` | jobs de `.github/workflows/*.yml` |
| → Checks requis (front) | `lint`, `check`, `unit-tests`, `build`, `e2e` | jobs de `ci.yml` |
| **Require branches to be up to date before merging** | ✅ activé | **empêche de merger une branche périmée** (bug vécu) |
| **Require conversation resolution** | ✅ activé | pas de commentaire de revue laissé en suspens |
| **Do not allow force pushes** | ✅ activé | protège l'historique |
| **Do not allow deletions** | ✅ activé | on ne supprime pas le tronc |
| **Require linear history** | optionnel | historique plus lisible (impose squash/rebase) |

**Note sur les approbations** : à 3 personnes avec un mainteneur qui fusionne, exiger **1 approbation**
bloque l'auteur (GitHub interdit l'auto-approbation). Deux options professionnelles :
- **0 approbation** + CI obligatoire : la CI est le garde-fou (choix pragmatique retenu).
- **1 approbation** dès qu'un binôme relit systématiquement les PR de l'autre (idéal si l'équipe s'y tient).

## 4. Fichiers de gouvernance du dépôt

- `.github/PULL_REQUEST_TEMPLATE.md` — gabarit de PR (pourquoi / contenu / vérifications).
- `.github/CODEOWNERS` — relecteurs assignés automatiquement.
- `.github/workflows/*.yml` — pipelines CI (lint, typecheck, tests, build, e2e).

## 5. À faire aussi côté dépôt (Settings)

- **General → Pull Requests** : cocher *Automatically delete head branches* (nettoyage auto après merge).
- **Choisir** *Squash and merge* (ou *Merge commit*) de façon cohérente entre les deux repos.
- Répliquer `.github/CODEOWNERS` + `PULL_REQUEST_TEMPLATE.md` sur le repo **front** (mêmes fichiers).
