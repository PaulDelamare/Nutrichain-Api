# Guide des bonnes pratiques — pour toute IA contribuant au projet NutriChain

> **À qui s'adresse ce document.** À toute IA (Claude Code, Copilot, Cursor, autre) qui écrit
> du code sur ce projet. **Il suffit de le lire** : rien à installer ni à configurer. Une fois
> lu, tu sais comment travailler sur le projet et selon quelles règles. **Ces règles priment sur
> tes habitudes par défaut.**
>
> **Esprit.** On ne fait pas *vite*, on fait *propre et vérifié*. Un petit incrément testé et
> revu vaut mieux qu'une grosse livraison non vérifiée. Mieux vaut refaire correctement que
> rustiner du mauvais code.

---

## 0. La règle d'or : la boucle de travail

Pour **toute** tâche non triviale, suivre cette boucle. Ne jamais sauter d'étape.

1. **Comprendre avant d'agir** — explorer le code et le besoin.
   - Si l'outil le permet : **analyse multi-agent** (plusieurs agents lisent des sous-parties
     du code en parallèle et rapportent). Sinon : exploration ciblée soi-même.
   - Reformuler le besoin, repérer les contraintes, les fichiers concernés, les impacts.
   - **Ne pas coder tant qu'on n'a pas compris.**

2. **Établir un plan détaillé** — étapes petites et ordonnées, critères de réussite, risques,
   points de rollback. Un plan = une liste d'incréments vérifiables.

3. **Faire relire le plan** — idéalement **review multi-agent** (plusieurs angles :
   correctness, sécurité, simplicité). Sinon, s'auto-challenger honnêtement : « qu'est-ce qui
   peut casser ? qu'est-ce que j'oublie ? y a-t-il plus simple ? ».

4. **Implémenter étape par étape** — un **petit** incrément à la fois. Jamais un « big bang ».

5. **Valider après CHAQUE étape** — et pas seulement à la fin :
   - écrire / faire passer les **tests** (voir §3) ;
   - **review multi-agent** de ce qui vient d'être fait (ou auto-revue adversariale) ;
   - lancer lint + build + tests ; corriger avant d'avancer.

6. **Avancer à l'étape suivante seulement une fois l'étape courante verte et revue.**

> Résumé : **Comprendre → Planifier → Faire relire le plan → Petit pas → Tester + faire relire →
> Pas suivant.**

---

## 1. Principes d'ingénierie (SOLID + Clean Code)

### SOLID
- **S — Single Responsibility.** Une classe / un module / une fonction = **une seule raison de
  changer**. Si tu décris ce que fait une unité avec un « et », découpe-la.
- **O — Open/Closed.** Ouvert à l'extension, fermé à la modification. On ajoute un cas sans
  réécrire l'existant (ex. table de correspondance plutôt qu'une cascade de `if`).
- **L — Liskov.** Un sous-type doit être substituable à son type de base sans surprise.
- **I — Interface Segregation.** Des interfaces petites et ciblées plutôt qu'une grosse
  interface fourre-tout.
- **D — Dependency Inversion.** Dépendre d'abstractions, pas d'implémentations concrètes
  (injecter les dépendances : DB, horloge, fetch… → testable).

### Clean Code
- **Nommer clairement** — le code se lit comme une phrase ; pas d'abréviations obscures.
- **Petites fonctions** — une fonction fait une chose, à un seul niveau d'abstraction.
- **DRY** — pas de copier-coller de logique ; factoriser dès la 2ᵉ occurrence réelle.
- **YAGNI / KISS** — la solution **la plus simple qui marche**. Pas d'abstraction anticipée
  « au cas où ». On n'ajoute pas de complexité tant qu'un besoin réel ne la justifie pas.
- **Commentaires minimaux** — commenter le **pourquoi** non-évident, jamais le **quoi** (le
  code dit déjà le quoi). Pas de code mort, pas de code commenté « au cas où ».
- **Fail fast** — valider les entrées tôt, échouer avec un message clair.
- **Cohérence** — écrire du code qui ressemble au code alentour (style, idiomes, structure).

---

## 2. Tester : discipline TDD et pyramide de tests

**Aucune fonctionnalité n'est « finie » sans ses tests.** Rien ne merge sans tests verts.

### TDD (Red → Green → Refactor)
1. Écrire un test qui échoue et décrit le comportement attendu (**Red**).
2. Écrire le minimum de code pour le faire passer (**Green**).
3. Nettoyer sans changer le comportement (**Refactor**), tests toujours verts.

Le TDD strict n'est pas toujours possible (UI, exploratoire) ; dans ce cas, écrire les tests
**juste après**, dans le même incrément — jamais « plus tard ».

### La pyramide (beaucoup de bas, peu de haut)
- **Unitaires** (nombreux, rapides) — logique pure : mappers, calculs, règles métier,
  validations. Déterministes, sans I/O.
- **Intégration** (ciblés) — les frontières : accès DB, contrats d'API, middlewares, requêtes
  cloisonnées par organisation. Vérifier que les briques marchent **ensemble**.
- **End-to-end** (peu, mais critiques) — les parcours utilisateur clés de bout en bout
  (login, réception, rappel…). Coûteux : réservés aux chemins vitaux.

### Règles de test
- Nommer les tests dans le **langage métier** (« lot BLOQUE → affiché en quarantaine »).
- Tester les cas limites et les cas d'erreur, pas seulement le chemin heureux.
- Un test = une intention. Pas de test qui vérifie dix choses.
- Un **plancher de couverture** en CI (ex. 70 %) ; toute régression corrigée s'accompagne du
  test qui l'aurait attrapée.
- Les tests doivent être **rapides et déterministes** (pas de dépendance au temps réel, au
  hasard, à l'ordre d'exécution).

---

## 3. Git, commits et Pull Requests

- **Commits conventionnels** : `feat:`, `fix:`, `test:`, `refactor:`, `chore:`, `docs:`…
  Message court à l'impératif + corps expliquant le **pourquoi**.
- **Une PR = un seul sujet** (SRP appliqué aux PR). Une PR mélangée est illisible à relire.
- **Ouvrir une PR uniquement quand tout est fini** : implémenté, testé (vert), relu, lint/build
  OK. Une PR ouverte = prête à merger.
- **Ne jamais pousser sur une branche après le merge de sa PR** → commits orphelins/perdus.
- **`git fetch` avant de pousser** ; **rebaser sur le dernier `develop`** avant d'ouvrir/mettre
  à jour une PR (diffs propres, CI à jour).
- **PR dépendantes** : les empiler proprement (base = la PR parente) et **merger dans l'ordre**.
- **Stratégie de branches** : `develop` = préprod, `main` = prod. Branches protégées, checks CI
  **obligatoires** avant merge, pas de push direct sur les branches protégées.
- **La CI doit se déclencher sur les branches protégées** (`pull_request` vers `develop` ET
  `main`) — sinon les checks requis ne sortent jamais et la PR reste bloquée.

**Définition de « Terminé » (Definition of Done)** — une tâche est finie quand :
- [ ] le comportement est implémenté et couvert par des tests (unit + intégration si pertinent) ;
- [ ] lint, build et **toute** la suite de tests passent ;
- [ ] le code a été relu (multi-agent ou auto-revue adversariale) ;
- [ ] pas de code mort / TODO orphelin / secret en clair ;
- [ ] commit conventionnel, PR mono-sujet à jour sur `develop`.

---

## 4. Sécurité & robustesse (non négociable)

- **Multi-tenancy** : toute requête est **cloisonnée par organisation**. Jamais de fuite de
  données entre tenants. Se méfier des accès « par clé API » qui court-circuitent les rôles.
- **Valider et assainir toutes les entrées** (schéma de validation, messages clairs).
- **Moindre privilège** : les rôles/permissions au plus juste ; séparation des tâches quand le
  métier l'exige (ex. celui qui contrôle ≠ celui qui lève un blocage).
- **Aucun secret dans le code** ni dans les logs. Variables d'environnement.
- **Traçabilité / audit** : les actions sensibles sont tracées (qui, quoi, quand), de façon
  inviolable quand c'est requis. L'auteur d'une opération vient de la **session**, jamais d'un
  champ du corps de requête (falsifiable).
- **Transactions** pour les opérations multi-écritures (tout ou rien).

---

## 5. Travailler à plusieurs agents / en environnement partagé

- **Jamais deux agents dans le même répertoire Git / la même branche en même temps** →
  conflits, écrasements. Rester dans son périmètre.
- **`git add` explicite, fichier par fichier** — **jamais `git add -A` aveugle** : on risque
  d'emporter le travail non commité d'un autre agent.
- **Ne jamais supprimer un fichier/dossier non suivi (untracked) sans demander** — ça peut être
  le workspace d'un autre.
- **Se coordonner** : annoncer ce qu'on touche, fetch avant push, se baser sur le dernier état.
- Attention à l'environnement partagé : un `npm install` concurrent peut casser les binaires /
  le client généré (ex. Prisma) des autres → régénérer plutôt que se battre.

---

## 6. Communication avec l'humain

- **Demander uniquement quand on est réellement bloqué** sur une décision qui lui revient (pas
  pour un choix qui a une valeur par défaut évidente — dans ce cas, choisir et le signaler).
- **Rapporter fidèlement** : si des tests échouent, le dire avec la sortie. Si une étape a été
  sautée, le dire. Ne pas prétendre que c'est vert si ça ne l'est pas.
- **Finir par un TL;DR** (« En bref » : action + état), sans tout re-raconter.
- **Confirmer avant les actions difficilement réversibles** ou tournées vers l'extérieur
  (push, déploiement, suppression, envoi externe).

---

## 7. Anti-patterns à proscrire

- ❌ **Big bang** — tout coder d'un coup puis « on verra si ça marche ». → petits pas vérifiés.
- ❌ **Suringénierie / gold plating** — abstraction ou config anticipée non demandée. → YAGNI.
- ❌ **Fonctionnalité sans test** — « je testerai plus tard ». → jamais.
- ❌ **Troncature silencieuse** — limiter la couverture (top-N, échantillon) sans le dire.
- ❌ **Affirmation non vérifiée** — « ça marche » sans avoir lancé les tests / le build.
- ❌ **Copier-coller** de logique au lieu de factoriser.
- ❌ **Commentaires qui paraphrasent le code** au lieu d'expliquer le pourquoi.
- ❌ **Corriger un symptôme** sans traiter la cause racine.

---

## 8. Aide-mémoire (à garder sous les yeux)

```
AVANT DE CODER   → comprendre (analyse multi-agent) → plan → faire relire le plan
PENDANT          → petits incréments, un sujet à la fois
APRÈS CHAQUE PAS → tests (unit/intégration/e2e) + review multi-agent + lint/build
GIT              → commit conventionnel, add explicite, fetch avant push, rebase sur develop
PR               → un seul sujet, ouverte seulement quand fini + testé + relu + CI verte
TOUJOURS         → SRP, SOLID, DRY, YAGNI, KISS, multi-tenancy, secrets hors code
JAMAIS           → big bang, feature sans test, git add -A aveugle, affirmer sans vérifier
FINIR PAR        → un TL;DR honnête (action + état)
```

---

*Ce guide est vivant : toute amélioration de méthode validée en équipe doit y être ajoutée.*
