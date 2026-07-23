# Travailler sur ce dépôt

Ce fichier est chargé automatiquement. Il est court à dessein : il dit ce qu'il faut savoir avant
d'écrire une ligne, et renvoie au reste.

**Avant toute chose, lis [`GUIDE_IA.md`](GUIDE_IA.md)** — la méthode de travail imposée ici. Chaque
règle y est adossée à une erreur réellement commise sur ce projet et à ce qu'elle a coûté. Puis
[`docs/README.md`](docs/README.md), qui dit pour chacun des 28 documents s'il est à jour, s'il
s'agit d'un plan, ou s'il est **historique et ne doit pas être appliqué** — deux documents de
sécurité décrivent un modèle supprimé, les suivre réintroduirait une faille.

## Le projet

API de traçabilité agroalimentaire « de la ferme au rayon », multi-tenant, conforme GS1/EPCIS :
réception → transformation → expédition, surveillance de la chaîne du froid par capteurs, et rappel
produit propagé à toute la descendance d'un lot. Chaque écriture sensible est scellée dans un
journal WORM chaîné par hash, par organisation.

Node · Express 4 · TypeScript strict · Prisma/PostgreSQL (état métier) · Mongoose/MongoDB
(télémétrie seule, **obligatoire au démarrage**) · Better-Auth · VineJS · Vitest.

## Architecture

**Monolithe modulaire en couches** — pas hexagonal : les services appellent Prisma directement, il
n'y a ni port, ni adaptateur, ni repository, et il n'est pas prévu d'en introduire.

```
src/modules/<domaine>/[<sous-domaine>/]
  routes/       <nom>.routes.ts        URLs, méthodes, gardes. Chaque fichier crée son Router().
  controllers/  <nom>.controller.ts    Ultra-minimalistes : lire, appeler le service, répondre.
  services/     <nom>.service.ts       100 % de la logique métier, aucun import d'Express.
  middlewares/  validate<X>.middleware.ts + <x>.schema.ts (VineJS)
src/shared/     transverse uniquement (utils, middlewares, configs, constantes)
```

Tests **colocalisés** : `feature.service.test.ts` à côté de `feature.service.ts`.

## Les règles dures

1. **Le tenant vient de la session, jamais du corps.** `req.activeOrgId` est passé explicitement au
   service et filtre chaque requête Prisma. Attention : `where: { organization_id: undefined }` ne
   filtre **rien** — une garde oubliée sert tous les tenants sans lever d'erreur.
2. **L'auteur d'une écriture vient de la session** (`resolveWritingActor`). Aucun payload n'expose
   de champ d'auteur : ce qui n'existe pas ne se falsifie pas.
3. **Toute écriture touchant l'audit passe par `retryableTransaction`**, avec
   `auditService.logAction(payload, tx)` **dans la même transaction**. Jamais `prisma.$transaction`
   nu, jamais `prisma.audit_Log.create`.
4. **Toute entrée est validée par VineJS** dans un middleware dédié, schéma en `*.schema.ts`,
   messages en **français**. Bornes obligatoires : pas de `limit` ni de tableau sans plafond.
5. **Jamais `any`, jamais `@ts-ignore`.** Dans les tests, exception explicite par
   `eslint-disable-next-line`.
6. **Erreurs orientées champ** : `throw new APIError(status, { error: [{ field, message }] })`
   depuis le service. Aucun `try/catch` en contrôleur — `catchAsync` couvre tout.
7. **Migrations versionnées** : `npx prisma migrate dev --name <desc>`. **Jamais `db push`**, malgré
   le script `npm run push` encore présent.
8. **Ne lance jamais Prettier** : il n'est branché ni au hook ni à la CI. Le lancer reformaterait
   des milliers de lignes.
9. **Commentaires rares**, en français : le *pourquoi* non évident, jamais le *quoi*.
10. **Identifiants en anglais, commentaires en français.** Une fonction ou une variable ne se nomme
    jamais en français (`attendreVisibilite`, `contexteAppelant`, `statutRestaure` sont des fautes).
    **Seule exception** : les champs du domaine persisté (`quantite_actuelle`, `unite_code`,
    `statut`, `lot_number`…), qui viennent du schéma Prisma et ne se renomment pas.
11. **Teste avec le rôle le plus faible** qui devrait être refusé. Le compte `owner` du seed masque
    tous les 403.

## La méthode

Analyser avant de coder → écrire le test et **le regarder échouer** → coder → **faire réfuter son
propre diff** par un relecteur dont le seul but est de trouver le bug → **vérifier par mutation**
(casser la garde, exiger qu'un test rougisse) → apporter une **preuve réelle** (réponse HTTP, ligne
en base, écran) → seulement ensuite, la PR.

Deux pièges qui ont coûté cher ici, et qui reviennent :

- **Un test de schéma ne prouve pas le câblage.** Plusieurs défauts venaient d'une garde écrite mais
  jamais branchée sur la route. Ajoute un test de **route**.
- **`git status` avant de commiter.** Des fichiers non suivis ont déjà été oubliés dans des PR.

Et une discipline : **dire ce qu'on n'a pas vérifié**. N'affirme jamais une complétude sans
inventaire fermé.

## Git et livraison

- **`develop` est le tronc et la base de toutes les PR. `main` est la production : on n'y touche
  pas.** Les deux sont protégées ; le check requis s'appelle `Code Quality & Tests`.
- Branches `type/sujet-court` : `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `test/`, `perf/`,
  `security/`, `ci/`.
- **Commits conventionnels, en français, sans accents** : `type(scope): résumé impératif`. Un seul
  sujet, pas d'emoji, pas de ton dramatique. Le contexte va dans le corps, terminé par `Closes #N`.
- **Une PR = un sujet**, et on ne l'ouvre que **lorsqu'elle est prête à merger** : une PR ouverte
  est mergée, et les commits poussés après deviennent orphelins.
- **Corps de PR court** : pourquoi, ce qui change, une ligne sécurité, une ligne vérifications. Pas
  de récit de la démarche.
- **S'assigner l'issue avant de coder** (`gh issue edit <n> --add-assignee PaulDelamare`) :
  plusieurs personnes travaillent en parallèle.
- **Ne merge jamais toi-même.** Laisse la PR ouverte.

## Interdits

- **Ne parle jamais de jury, d'oral, de soutenance, de correcteur ou de qui évaluera le projet** —
  ni dans le code, ni dans un commentaire, ni dans un commit, ni dans une PR. Justifie par la
  conséquence technique ou métier. Seule exception : `docs/20_DOSSIER_SOUTENANCE.md`, dont c'est
  l'objet.
- **N'ouvre pas d'issue** sans nécessité : on ferme le backlog, une trouvaille mineure se note dans
  la PR.
- **Ne supprime jamais un fichier non suivi par git** sans demander.
- **Pas de suringénierie** : la solution la plus simple qui traite la cause — mais jamais une
  rustine sur un défaut de conception.

## Commandes

```bash
npm run dev              # serveur de développement (tsx watch)
npm test                 # suite Vitest
npm run test:coverage    # + couverture (plancher CI : 70 %)
npm run lint
npx tsc -p tsconfig.check.json
npm run build

npx prisma migrate dev --name <desc>
npx prisma db seed && npm run seed:demo   # les DEUX sont nécessaires pour une démonstration
npm run e2e:quarantine | e2e:recall | e2e:epcis | e2e:iot-alert | e2e:connectors | e2e:audit-verify
```

Les scénarios `e2e:*` exigent PostgreSQL, MongoDB et un `.env` renseigné. Sans base, la validation
se limite à lint + typage + build + tests unitaires : **dis-le** plutôt que de laisser croire à une
preuve.
