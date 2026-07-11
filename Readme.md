# NutriChain API

API REST B2B/B2C de **traçabilité agroalimentaire « de la ferme au rayon »**, conforme aux standards **GS1/EPCIS**, avec **surveillance de la chaîne du froid** (IoT) et **rappel produit rapide** (< 15 min décision → notification).

> Projet fil rouge 4e année. Monolithe modulaire hexagonal, multi-tenant (SaaS), orienté conformité réglementaire (HACCP / ISO 22000) et intégrité d'audit (WORM).

**État** : `develop` — build TypeScript strict ✅ · ESLint ✅ · **378 tests verts** (Vitest) · migrations Prisma versionnées.

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
| 01/03 | Sécurisation : auth + MFA + contrôle d'accès | ✅ Better-Auth (sessions, **MFA TwoFactor**, organisations) ; RBAC opérationnel — ⚠️ *ABAC reporté* | `modules/identity` |
| 10/03 | CI/CD industrielle | ✅ Pipelines GitHub Actions | `.github/workflows/` |
| 15/03 | Alerte chaîne du froid < 30 s p95 | ✅ Détection d'excursion + alertes | `modules/iot`, `modules/alerts` |
| 10/06 | Mobile : scan rapide, mode offline | ✅ Sync offline-first idempotente | `modules/sync` |
| 20/06 | Traçabilité EPCIS conforme GS1 (MVP) | ✅ Object/Transformation/AggregationEvents en URN LGTIN/SSCC + endpoint `/events` | `modules/traceability` |
| 22/06 | Rappel produit complet < 15 min | ✅ Blocage descendance set-based + notif clients | `modules/traceability/.../recall.service.ts` |
| 30/09 | Connecteurs ERP/WMS + auditabilité WORM | ✅ Import CSV produits/clients + export EPCIS ; audit WORM hash-chain | `modules/connectors`, `shared/utils/audit` |

---

## Architecture

**Monolithe modulaire hexagonal** : un module par domaine métier, séparation stricte des couches.

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
| `auditIntegrity` | Vérification de la chaîne d'audit WORM (job planifié) |
| `core` | Health checks, endpoints utilitaires |

Le code transverse (utilitaires, middlewares, configs, constantes, types) vit dans `src/shared/`.

### Stack

- **Runtime** : Node.js + TypeScript (mode strict, `tsx`)
- **HTTP** : Express 4, Helmet, CORS, compression, rate-limit
- **Données** : PostgreSQL via **Prisma** (relationnel) + MongoDB via **Mongoose** (logs/télémétrie)
- **Auth** : **Better-Auth** (sessions, MFA, multi-organisations)
- **Validation** : **VineJS** (messages en français)
- **Tests** : **Vitest** + Supertest
- **Observabilité** : Winston (logs rotatifs)

---

## Démarrage rapide

### Prérequis

- Node.js ≥ 20, npm
- PostgreSQL (base `nutrichain`)
- MongoDB (logs applicatifs)

### Installation

```bash
npm install
cp .env.example .env      # puis renseigner les variables ci-dessous
```

Variables d'environnement requises (validées au démarrage — *fail-fast*) :

| Variable | Description |
|---|---|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL |
| `MONGO_URI` | Chaîne de connexion MongoDB (logs) |
| `BETTER_AUTH_SECRET` | Secret Better-Auth (≥ 32 caractères) |
| `API_KEY` | Clé API pour le mode machine-à-machine (M2M : IoT, scripts) |
| `API_KEY_ORG_ID` | `Organization.id` lié à la clé API (mode M2M) |
| `API_URL` | URL publique de l'API |
| `FRONTEND_URL` | URL du frontend (liens cliquables dans les emails) |

### Base de données & seed

```bash
npx prisma migrate deploy   # applique les migrations versionnées (non destructif)
npx prisma db seed          # jeu de données de démo (org, produits, lots, clients…)
```

> ⚠️ Les migrations sont **versionnées** (`prisma/migrations/`). Toute évolution de schéma passe par une nouvelle migration — **jamais `db push`**.

### Lancer

```bash
npm run dev      # serveur de développement (tsx watch)
npm run build    # compilation TypeScript (tsc)
npm run lint     # ESLint
```

### Ou tout lancer avec Docker

```bash
docker compose up --build   # API (port 3000) + PostgreSQL + MongoDB, migrations appliquées au démarrage
```

Les valeurs par défaut suffisent pour une démo locale (surchargées par votre `.env` s'il existe).
Pour seeder la base du conteneur depuis l'hôte (PostgreSQL exposé sur le port 5433) :

```bash
DATABASE_URL="postgresql://nutrichain:nutrichain@localhost:5433/nutrichain?schema=public" npx prisma db seed
```

---

## Tests

```bash
npm run unit:test            # suite unitaire + intégration (Vitest)
npm run test:coverage        # couverture de code (plancher CI : 70 % — mesurée à ~84 % lignes / ~89 % branches)
```

> Périmètre de couverture : la logique applicative (`src/**`), hors bootstrap serveur,
> déclarations de types, templates d'e-mails et config Swagger (cf. `vitest.config.js`).

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

- **Multi-tenancy strict (defense-in-depth)** : chaque requête Prisma filtre par `organization_id` ; garde centralisée dans `mixedAuth` / `requireOrgRole` (rejet si aucune organisation active).
- **Audit WORM** : journal chaîné par hash (`signature_hash` ← `prev_hash`), recomputable et vérifié par un job planifié — intégrité de la piste d'audit (HACCP / ISO 22000).
- **Sûreté sanitaire (quarantaine HACCP)** : un lot reçu non-conforme est mis en `BLOQUE` — impossible à transformer ou expédier ; levée auditée (décision qualité tracée).
- **Intégrité concurrente** : transactions Serializable, optimistic locking (`Batch.version`), advisory locks Postgres.
- **Durcissement entrées/sorties** : validation VineJS systématique, anti-XSS sur les emails, neutralisation d'injection de formule CSV à l'export, sanitization CRLF des en-têtes.
- **Configuration fail-fast** : les variables d'environnement critiques sont validées au démarrage.

---

## Limitations connues

- **RBAC partiel** : le modèle de rôles est en cours de construction. Deux taxonomies coexistent — rôles d'organisation (`owner`/`admin`/`member`, Better-Auth) et rôles métier (`logistics_*`) — non encore réconciliées ; l'authentification des routes logistiques en session web est de fait limitée (le mode M2M par clé API est pleinement fonctionnel). L'**ABAC** prévu par l'objectif sécurité est reporté. À traiter dans une itération dédiée.
- **Préfixe GS1 simulé** : les identifiants GS1 sont conformes (numéro de lot court AI 10, URN LGTIN/SSCC, GS1 Digital Link), mais le préfixe entreprise par défaut (`3456789`) est fictif — projet d'école, aucun préfixe réel acheté auprès de GS1. Chaque organisation peut renseigner le sien (`Organization.gs1_company_prefix`). Les URN sont découpées positionnellement à la longueur du préfixe déclaré, sans vérifier que le GTIN (fictif en démo) encode réellement ce préfixe ; un déploiement réel validerait cette correspondance à l'enregistrement produit. Le `lot_number` (suffixe aléatoire, ~2 Md de combinaisons/jour/org) s'appuie sur la contrainte d'unicité en base sans retry applicatif — une collision (improbable avant ~50 000 lots/jour/org) renverrait un 400.

---

## Documentation détaillée

Les documents techniques par domaine sont dans [`docs/`](docs/) :

- [`20_DOSSIER_SOUTENANCE.md`](docs/20_DOSSIER_SOUTENANCE.md) — **dossier de soutenance** (problème → solution → démo → preuves)
- [`19_architecture.md`](docs/19_architecture.md) — **schémas d'architecture** (5 diagrammes Mermaid)
- [`00_contexte_projet.md`](docs/00_contexte_projet.md) — contexte et cadrage
- [`04_tracabilite_et_lots.md`](docs/04_tracabilite_et_lots.md), [`11_TECH_TRANSFORMATIONS_GENEALOGY.md`](docs/11_TECH_TRANSFORMATIONS_GENEALOGY.md) — traçabilité & généalogie
- [`12_RECALLS_SYSTEM.md`](docs/12_RECALLS_SYSTEM.md) — système de rappel
- [`15_iot_cold_chain_alerts.md`](docs/15_iot_cold_chain_alerts.md) — chaîne du froid IoT
- [`06_standards_techniques.md`](docs/06_standards_techniques.md), [`05_bonnes_pratiques_api.md`](docs/05_bonnes_pratiques_api.md) — standards & conventions
- [`README_SECURITY.md`](docs/README_SECURITY.md), [`09_SECURITY_DECISION_MATRIX.md`](docs/09_SECURITY_DECISION_MATRIX.md) — sécurité
