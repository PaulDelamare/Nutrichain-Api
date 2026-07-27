# NutriChain API

API REST B2B/B2C de **traçabilité agroalimentaire « de la ferme au rayon »**, conforme aux standards **GS1/EPCIS**, avec **surveillance de la chaîne du froid** (IoT) et **rappel produit rapide** (< 15 min décision → notification).

> Monolithe modulaire multi-tenant (SaaS), orienté conformité réglementaire (HACCP / ISO 22000) et intégrité d'audit (WORM).

**État** : `develop` — build TypeScript strict ✅ · ESLint ✅ · **870 tests verts** (Vitest, 88,86 % de couverture de lignes) · migrations Prisma versionnées.

---

## Sommaire

- [Le projet](#le-projet)
- [Objectifs SMART & statut](#objectifs-smart--statut)
- [Architecture](#architecture)
- [Démarrage rapide](#démarrage-rapide)
- [Tests](#tests)
- [Sécurité & conformité](#sécurité--conformité)
- [Limitations connues](#limitations-connues)
- [Documentation détaillée](#documentation-détaillée)
- [Licence](#licence)

---

## Le projet

NutriChain répond à trois besoins critiques du secteur agroalimentaire :

1. **Traçabilité complète des lots** — réception → transformation → expédition, avec généalogie ascendante/descendante (recursive CTE Postgres) et événements **EPCIS** aux identifiants GS1 stricts (numéro de lot court AI 10, URN **LGTIN**, **AggregationEvent SSCC** à l'expédition, étiquette **GS1 Digital Link**).
2. **Chaîne du froid en temps réel** — ingestion de télémétrie IoT, détection d'excursion de température sur fenêtre glissante, alertes.
3. **Rappel produit rapide** — blocage atomique d'un lot **et de toute sa descendance**, notification automatique des clients impactés (objectif < 15 min ; mesuré ~21 ms sur 4645 nœuds).

Le tout est **cloisonné par organisation** (multi-tenancy strict) et **auditable** (journal WORM chaîné par hash).

---

## Objectifs SMART & statut

| Échéance | Objectif | Statut | Où |
|---|---|---|---|
| 01/03 | Sécurisation : auth + MFA + contrôle d'accès | ⚠️ partiel — Better-Auth (sessions, organisations) et RBAC 5 rôles opérationnels ; **MFA non exposée** et *ABAC reporté* | `modules/identity` |
| 10/03 | CI/CD industrielle | ✅ Pipelines GitHub Actions | `.github/workflows/` |
| 15/03 | Alerte chaîne du froid < 30 s p95 | ✅ Détection d'excursion + alertes | `modules/iot`, `modules/alerts` |
| 10/06 | Mobile : scan rapide, mode offline | ✅ Sync offline-first idempotente | `modules/sync` |
| 20/06 | Traçabilité EPCIS conforme GS1 (MVP) | ✅ Object/Transformation/AggregationEvents en URN LGTIN/SSCC + endpoint `/events` | `modules/traceability` |
| 22/06 | Rappel produit complet < 15 min | ✅ Blocage descendance set-based + notif clients | `modules/traceability/.../recall.service.ts` |
| 30/09 | Connecteurs ERP/WMS + auditabilité WORM | ✅ Import CSV produits/clients + export EPCIS ; audit WORM hash-chain | `modules/connectors`, `shared/utils/audit` |

---

## Architecture

**Monolithe modulaire** : un module par domaine métier, séparation stricte des couches (routes → contrôleur → service). Ce n'est pas une architecture hexagonale : les services appellent Prisma directement, sans port ni adaptateur.

- **Routes** : URLs + méthodes HTTP uniquement.
- **Controllers** : ultra-minimalistes (extraire → appeler le service → répondre).
- **Services** : 100 % de la logique métier, agnostiques HTTP.

### Modules (`src/modules/`)

| Module | Rôle |
|---|---|
| `identity` | Authentification (Better-Auth), organisations, invitations, rôles |
| `logistics` | Réceptions, lots (batches), expéditions, étiquettes GS1 |
| `traceability` | Transformations, généalogie, rappels, catalogue, événements EPCIS |
| `iot` | Ingestion télémétrie, détection d'excursion de température |
| `alerts` | Cycle de vie des alertes (création, résolution) |
| `sync` | Synchronisation mobile offline-first (idempotente) |
| `connectors` | Connecteurs ERP/WMS : import CSV, export EPCIS |
| `organization` | Membres, matériel, lieux, et les restitutions transverses consommées par le front (alertes, expéditions, journal d'audit, lots en quarantaine) |
| `platform` | Administration de la plateforme (hors organisation) |
| `auditIntegrity` | Vérification de la chaîne d'audit WORM (job planifié) |
| `core` | Health checks, endpoints utilitaires |

Le code transverse (utilitaires, middlewares, configs, constantes, types) vit dans `src/shared/`.

### Stack

- **Runtime** : Node.js + TypeScript (mode strict, `tsx`)
- **HTTP** : Express 4, Helmet, CORS, compression, rate-limit
- **Données** : PostgreSQL via **Prisma** (tout l'état métier) + MongoDB via **Mongoose** (télémétrie IoT en série temporelle uniquement ; les logs applicatifs vont dans des fichiers Winston)
- **Auth** : **Better-Auth** (sessions, multi-organisations), MFA TOTP livrée end-to-end (front +
  mobile web). Le reste du cœur Better-Auth (gestion de session, changement d'email/mot de passe)
  reste fermé par allowlist car il contournerait le RBAC et l'audit — motif détaillé dans
  `docs/20_PRESENTATION_PROJET.md` §7.
- **Validation** : **VineJS** (messages en français)
- **Tests** : **Vitest** + Supertest
- **Observabilité** : Winston (logs rotatifs)

---

## Démarrage rapide

### Prérequis

- Node.js ≥ 20, npm
- PostgreSQL (base `nutrichain`)
- MongoDB (télémétrie des capteurs)

### Installation

```bash
npm install
cp .env.example .env      # puis renseigner les variables ci-dessous
```

Variables d'environnement requises (validées au démarrage — *fail-fast*) :

| Variable | Description |
|---|---|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL |
| `MONGO_URI` | Chaîne de connexion MongoDB (télémétrie IoT) |
| `BETTER_AUTH_SECRET` | Secret Better-Auth (≥ 32 caractères) |
| `API_KEY` | Clé qui identifie l'application appelante (mobile, front). **Publique** : elle n'autorise aucune action |
| `IOT_API_KEY` | Secret des capteurs, **valeur différente d'`API_KEY`**. N'ouvre l'ingestion que si une passerelle la porte en base (`npm run iot:gateway`) |
| `API_KEY_ORG_ID` | `Organization.id` lié à la clé API (mode M2M). **Ne pas laisser vide** (validation fail-fast) ; défaut du seed : `usine-laitiere-paris` |
| `API_URL` | URL publique de l'API |
| `FRONTEND_URL` | URL du frontend (liens cliquables dans les emails) |

### Base de données & seed

```bash
npx prisma migrate deploy   # applique les migrations versionnées (non destructif)
npx prisma db seed          # socle : organisation, comptes par rôle, catalogue, fournisseur, client
npm run seed:demo           # jeu de démonstration : sites, capteurs, alerte froid, quarantaine,
                            # transformations, expéditions
```

**Les deux sont nécessaires pour une démonstration.** Le socle seul laisse Traçabilité, Chaîne du
froid, Rappels et Généalogie **vides** : ce sont les écrans que verrait quiconque s'arrête au
premier seed.

Les deux sont **rejouables** : les relancer rétablit l'état de démonstration sans rien dupliquer.

#### Comptes de démonstration

Tous avec le mot de passe **`NutriChain!2026`**, dans l'organisation « Usine Laitière de Paris ».

| Email | Rôle | Peut, ne peut pas |
| --- | --- | --- |
| `admin@nutrichain.local` | `owner` | tout |
| `admin.demo@nutrichain.local` | `admin` | tout le métier + gestion de l'organisation |
| `quality@nutrichain.local` | `quality` | décisions qualité (levée de quarantaine, rappel) — **pas** de réception |
| `operator@nutrichain.local` | `operator` | terrain (réception, transformation, expédition) — **pas** de décision qualité |
| `viewer@nutrichain.local` | `viewer` | lecture seule |

> Se connecter en `owner` **masque tous les 403** : il a tous les droits. Pour vérifier qu'une garde
> tient réellement, rejouer le parcours avec le rôle le plus faible qui devrait être refusé.

En plus de ces comptes rattachés à l'organisation de démo, le seed crée aussi
**`platform@nutrichain.local`** (même mot de passe), un compte **hors de toute organisation** —
personnel de la plateforme, pas un rôle métier. Le seed refuse de tourner si `NODE_ENV=production`.

> ⚠️ Les migrations sont **versionnées** (`prisma/migrations/`). Toute évolution de schéma passe par une nouvelle migration — **jamais `db push`**.

### Lancer

```bash
npm run dev      # serveur de développement (tsx watch)
npm run build    # compilation TypeScript (tsc)
npm run lint     # ESLint
```

### Ou tout lancer avec Docker

```bash
docker compose --env-file .env.demo up --build   # PostgreSQL + MongoDB + seed, puis l'API (port 3000)
```

`--env-file .env.demo` n'est pas une formalité : les trois secrets (`BETTER_AUTH_SECRET`, `API_KEY`,
`IOT_API_KEY`) n'ont **aucune valeur de repli**. Sans ce fichier, `docker compose` refuse de démarrer
et dit laquelle manque, au lieu de démarrer en silence avec un secret publié dans ce dépôt (#248).

Pour un déploiement réel, fournissez vos propres valeurs — `openssl rand -base64 32` — dans un `.env`
qui n'est pas versionné. L'API refuse de démarrer si elle détecte une valeur de démonstration sans le
drapeau `ALLOW_DEMO_SECRETS=1` que pose `.env.demo` : un `cp .env.example .env` laissé en l'état
échoue donc au boot avec un message explicite, au lieu de tourner avec des marqueurs.

> ⚠️ Cette pile est un **outil de démonstration locale**, pas un modèle de déploiement : elle seede
> des comptes à mot de passe public et ses secrets de démonstration sont publiés dans `.env.demo`.
> L'image applicative déclare `NODE_ENV=production` (`Dockerfile`), mais le compose le renverse
> explicitement en `development` pour toute la pile : une base peuplée de comptes connus ne doit pas
> se présenter comme une production. Un test verrouille cette ligne
> (`src/shared/configs/env.docker.test.ts`). Ne l'exposez pas hors de votre poste.
>
> Conséquence à connaître : hors production, `http://localhost:4173` (vite preview) est ajouté aux
> origines de confiance CORS et Better-Auth (`trustedOrigins.config.ts`). Pratique pour exercer le
> front buildé contre cette pile, mais c'est bien une origine de plus qu'en production.

Les valeurs par défaut suffisent pour une démo locale (surchargées par votre `.env` s'il existe).

Le volume `pgdata` **survit à `docker compose down`** : une base déjà seedée conserve ses comptes et
ses données, y compris ceux d'une démonstration précédente. Les deux seeds étant rejouables, c'est
sans conséquence au quotidien ; pour repartir d'une base réellement vierge (`-v` détruit aussi
`mongodata`, donc la télémétrie) :

```bash
docker compose down -v && docker compose up --build
```

Un service `seed` one-shot applique les migrations puis les **deux** seeds (socle + démonstration)
avant que l'API ne démarre : après `git clone`, `cp .env.example .env`, `docker compose up --build`,
la connexion fonctionne avec les comptes ci-dessus, écrans peuplés.

Ce service est bâti sur l'étape `builder` du Dockerfile — la seule à embarquer `tsx`, absent de
l'image de production (`npm ci --omit=dev`), sans lequel `prisma db seed` échouait.

Le seed depuis l'hôte reste possible si besoin (PostgreSQL est exposé sur le port 5433) :

```bash
# bash / zsh
export DATABASE_URL="postgresql://nutrichain:nutrichain@localhost:5433/nutrichain?schema=public"
npx prisma db seed && npm run seed:demo
```

```powershell
# PowerShell (Windows) — la syntaxe VAR=... npx ne fonctionne pas ici
$env:DATABASE_URL = "postgresql://nutrichain:nutrichain@localhost:5433/nutrichain?schema=public"
npx prisma db seed; npm run seed:demo
```

Si l'ingestion IoT doit fonctionner dans le conteneur, enregistrer aussi la passerelle :
`npm run iot:gateway -- --org usine-laitiere-paris --cle "$IOT_API_KEY"`.

---

## Tests

```bash
npm run unit:test            # suite unitaire + intégration (Vitest)
npm run test:coverage        # couverture de code (plancher CI : 70 % — mesurée à 86 % lignes / 90 % branches)
```

> Périmètre de couverture : la logique applicative (`src/**`), hors bootstrap serveur,
> déclarations de types, templates d'e-mails et config Swagger (cf. `vitest.config.mjs`).

Scénarios end-to-end contre une base réelle (nécessitent PostgreSQL + seed) :

```bash
npm run e2e:quarantine       # quarantaine HACCP d'un lot non-conforme (réception → blocage → levée)
npm run e2e:recall           # rappel produit + expéditions impactées (< 15 min)
npm run e2e:epcis            # événements EPCIS réception/expédition
npm run e2e:iot-alert        # alerte chaîne du froid
npm run e2e:connectors       # import/export connecteurs ERP
npm run e2e:security         # garde-fous multi-tenant
npm run e2e:sync             # synchronisation mobile offline idempotente
npm run e2e:alert-resolve    # cycle de vie des alertes
npm run e2e:audit-verify     # intégrité de la chaîne d'audit WORM
```

---

## Sécurité & conformité

### Modèle d'authentification : une clé identifie, une session autorise

C'est la règle qui gouverne toutes les routes, et elle tient en une phrase :

> **Une clé API identifie une APPLICATION. Seule une session AUTORISE une action.**

| Middleware | Pour qui | Ce qu'il permet |
| --- | --- | --- |
| `sessionAuth(roles)` | tout le métier | Un utilisateur **authentifié**, dont le rôle est **toujours** évalué. |
| `machineAuth()` | les capteurs IoT | Déposer une mesure, avec la clé d'une **passerelle enregistrée** (`IotGateway`), qui porte son organisation. |

**Deux clés, deux natures** :

- `API_KEY` — **publique par construction** : elle est compilée dans le bundle de l'application
  mobile (`EXPO_PUBLIC_API_KEY`), donc extractible par quiconque l'installe. Elle n'ouvre que les
  routes d'authentification exposées et l'aperçu d'une invitation (limité à un jeton) : elle
  **identifie une application**, elle n'autorise personne (OWASP API Security :
  *Broken Authentication*).
- `IOT_API_KEY` — **un vrai secret**, qui ne quitte ni le serveur ni la passerelle IoT, et qui
  n'ouvre l'ingestion que s'il est enregistré comme passerelle (`IotGateway`, empreinte SHA-256,
  révocable) : c'est cette ligne qui décide **dans quelle organisation** atterrit la trame. Il lui faut
  ce statut : une trame de télémétrie ne décrit pas, elle **décide** — elle met en quarantaine tous
  les lots du matériel visé, lève une alerte PANIC et scelle un maillon d'audit WORM. Avec une clé
  publique, un inconnu **arrêtait la production** en postant une fausse température.

**Une intégration machine (ERP/WMS) se connecte avec un COMPTE DE SERVICE** : un utilisateur, avec
ses propres identifiants et le rôle `operator`. Il obtient une session, comme tout le monde — et il
se **révoque**, ce qu'une clé livrée à des milliers de téléphones ne permet pas.

L'auteur d'une écriture vient **toujours** de la session : le payload n'a plus aucun champ pour le
déclarer (`received_by` et `actorUserId` ont été supprimés). Ce qui n'existe pas ne se falsifie pas.

Preuve reproductible, contre l'API réelle : `npm run e2e:api-key`.

> 🔴 **À FAIRE — la clé actuelle est COMPROMISE.** Elle a été commitée dans `.env.example` sur un
> dépôt **public** : considérez-la comme connue de tous, et **régénérez-la maintenant**. Rien à
> purger dans l'historique (aucun `.env` réel n'a jamais été commité) — une rotation suffit, car
> l'ancienne valeur ne vaut plus rien une fois remplacée.
>
> ```bash
> node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # ×2
> ```
>
> 1. `API_KEY` (nouvelle valeur) → `.env` de l'API, `.env` du front, `EXPO_PUBLIC_API_KEY` du mobile.
> 2. `IOT_API_KEY` (**valeur différente**) → `.env` de l'API **uniquement**. Jamais dans un client.
>
> `.env.example` ne contient que des valeurs factices : ne jamais y remettre un secret.

### Le reste

- **Multi-tenancy strict (defense-in-depth)** : chaque requête Prisma filtre par `organization_id` ; garde centralisée dans `sessionAuth` / `requireOrgRole` (rejet si aucune organisation active).
- **Audit WORM** : journal chaîné par hash (`signature_hash` ← `prev_hash`), recomputable et vérifié par un job planifié — intégrité de la piste d'audit (HACCP / ISO 22000).
- **Sûreté sanitaire (quarantaine HACCP)** : un lot reçu non-conforme est mis en `BLOQUE` — impossible à transformer ou expédier ; levée auditée (décision qualité tracée).
- **Intégrité concurrente** : transactions Serializable, optimistic locking (`Batch.version`), advisory locks Postgres.
- **Durcissement entrées/sorties** : validation VineJS systématique, anti-XSS sur les emails, neutralisation d'injection de formule CSV à l'export, sanitization CRLF des en-têtes.
- **Configuration fail-fast** : les variables d'environnement critiques sont validées au démarrage.

---

## Limitations connues

- **Authenticité des capteurs (trou assumé, et il est sérieux)** : la clé d'une passerelle couvre **tous les capteurs de son organisation**, et le `sensor_id` est déclaré dans le corps de la requête sans être rattaché à un appareil authentifié. Qui détient cette clé (une passerelle compromise) peut donc agir au nom de n'importe quel capteur **de cette organisation** — et une trame ne fait pas qu'écrire une mesure : elle **met en quarantaine tous les lots du matériel visé** et lève une alerte PANIC. Autrement dit : fabriquer une chaîne du froid conforme, noyer une vraie excursion, **ou arrêter la production**. La séparation des clés met cette capacité hors de portée d'un client public (le bundle mobile), et l'enregistrement des passerelles la borne à un seul tenant (elle est de plus **révocable** sans redéploiement) ; la fermer complètement demande un **secret par appareil** ou une **signature des trames** — hors périmètre de ce projet, et c'est le prochain durcissement à faire.
- **Aperçu d'invitation** (`GET /identity/invitations/:token/preview`) : accessible avec la seule clé publique, il expose l'e-mail et le rôle de l'invité — une donnée personnelle. C'est nécessaire (l'écran d'inscription s'affiche avant toute session) et borné par la connaissance du jeton, mais c'est une lecture de PII sans compte, à connaître pour le DPIA.
- **ABAC** : l'attribution par site (`Location`) prévue par l'objectif sécurité est reportée — les utilisateurs sont rattachés à l'organisation, pas au site.
- **Préfixe GS1 simulé** : les identifiants GS1 sont conformes (numéro de lot court AI 10, URN LGTIN/SSCC, GS1 Digital Link), mais le préfixe entreprise par défaut (`3456789`) est fictif — environnement de démonstration, aucun préfixe réel acheté auprès de GS1. Chaque organisation peut renseigner le sien (`Organization.gs1_company_prefix`). Les URN sont découpées positionnellement à la longueur du préfixe déclaré, sans vérifier que le GTIN (fictif en démo) encode réellement ce préfixe ; un déploiement réel validerait cette correspondance à l'enregistrement produit. Le `lot_number` (suffixe aléatoire, ~2 Md de combinaisons/jour/org) s'appuie sur la contrainte d'unicité en base sans retry applicatif — une collision (improbable avant ~50 000 lots/jour/org) renverrait un 400.

---

## Documentation détaillée

**[Index complet des 28 documents](docs/README.md)** — avec, pour chacun, son statut : à jour, plan, ou historique à ne pas appliquer.

Les documents techniques par domaine sont dans [`docs/`](docs/) :

- [`20_PRESENTATION_PROJET.md`](docs/20_PRESENTATION_PROJET.md) — **présentation du projet** (problème → solution → démo → preuves)
- [`19_architecture.md`](docs/19_architecture.md) — **schémas d'architecture** (5 diagrammes Mermaid)
- [`00_contexte_projet.md`](docs/00_contexte_projet.md) — contexte et cadrage
- [`04_tracabilite_et_lots.md`](docs/04_tracabilite_et_lots.md), [`11_TECH_TRANSFORMATIONS_GENEALOGY.md`](docs/11_TECH_TRANSFORMATIONS_GENEALOGY.md) — traçabilité & généalogie
- [`12_RECALLS_SYSTEM.md`](docs/12_RECALLS_SYSTEM.md) — système de rappel
- [`15_iot_cold_chain_alerts.md`](docs/15_iot_cold_chain_alerts.md) — chaîne du froid IoT
- [`06_standards_techniques.md`](docs/06_standards_techniques.md), [`05_bonnes_pratiques_api.md`](docs/05_bonnes_pratiques_api.md) — standards & conventions
- [`README_SECURITY.md`](docs/README_SECURITY.md), [`09_SECURITY_DECISION_MATRIX.md`](docs/09_SECURITY_DECISION_MATRIX.md) — sécurité, **documents historiques** : ils décrivent un flux clé API antérieur au durcissement et ne doivent pas servir de spécification (chacun porte un bandeau)

---

## Licence

**Tous droits réservés** — voir [`LICENSE`](LICENSE).

Le code est consultable, exécutable et évaluable librement (recruteur, partenaire). Sa redistribution,
sa publication et toute réutilisation dans un autre projet demandent l'accord écrit des auteurs.

Ce choix est le plus réversible : une licence permissive peut être accordée plus tard, alors qu'un
code publié sous licence ouverte le reste définitivement pour la version diffusée.
