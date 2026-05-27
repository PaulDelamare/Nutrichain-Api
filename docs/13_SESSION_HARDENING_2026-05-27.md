# Session de durcissement — 27 mai 2026

Trace audit de la session de hardening menée le 2026-05-27 sur la branche `feat/traceability-transformations`. **24 commits**, **126 tests unitaires verts**, **0 bug bloquant**, premier flow E2E métier validé en live contre Postgres.

Ce document remplace en partie les éléments « à faire » de `06_standards_techniques.md` et `09_SECURITY_DECISION_MATRIX.md` qui sont désormais **implémentés**.

---

## 1. Résumé exécutif

| Axe | Avant | Après |
|---|---|---|
| Tests unitaires | 90 | **126** (+36) |
| Tests E2E | 1 script (logistics happy path) | **2 scripts** dont `e2e-security-fixes.ts` (6 scénarios) |
| Failles critiques connues | 6 (cf. revue multi-agent) | **0** |
| Boot sans `.env` valide | Crash tardif à la 1re requête | **Fail-fast** au boot |
| Audit WORM | Chaîne techniquement présente mais non vérifiable | **Recompute exact** + Restrict on delete |
| Better-Auth IDs | nanoid (incompatible avec `vine.uuid()`) | **UUID v4** systématique |
| Multi-tenancy M2M | Bypass `x-api-key` + spoofing `x-org-id` | **Strict env-bound** |

---

## 2. Commits classés par catégorie

### P0 — Bugs concrets corrigés (3)

| Commit | Description | Fichier principal |
|---|---|---|
| `437c93a` | `organizationId` non-déclaré → utilise `activeOrgId` + scoper `deleteMany` au tenant | `invitation.controller.ts` |
| `52ac135` | `updateMany` ne retournait pas l'enregistrement → audit WORM falsifié. Calcul Decimal préservé. | `transformation.service.ts:171` |
| `fb51edd` | Relations Prisma en français : `produit`/`unite` (anglais avant → crash) | `verifyBatchAccess.middleware.ts` |

### P0 — Sécurité critique (4)

| Commit | Description | Impact |
|---|---|---|
| `3206df0` | `checkApiKey` ne lit plus `x-org-id` — résout depuis `process.env.API_KEY_ORG_ID` | Spoofing multi-tenant fermé |
| `82c66c5` | Suppression `if (apiKey) return next()` dans `verifyBatchAccess` / `verifyReceiptAccess` | Bypass tenant M2M fermé |
| `2c0e9a8` | Public scan B2C filtré sur `statut in [EXPEDIE, ALERTE]` (était `findUnique` libre) | Fuite lots internes fermée |
| `9fd2f02` | `advanced.generateId: () => crypto.randomUUID()` sur Better-Auth | Compatible `vine.uuid()` métier |

### P0 — Intégrité WORM (2)

| Commit | Description |
|---|---|
| `4a13f75` | `horodatage` capturé une fois en JS, persisté ET inclus dans le hash → chaîne recomputable depuis les champs DB |
| `8823795` | `Audit_Log.organization onDelete: Restrict` (était Cascade) → un org delete avec audits → P2003 |

### P1 — Standards documentés (2)

| Commit | Description | Doc référence |
|---|---|---|
| `926328b` | `assertEnv()` au boot, exit 1 si var manquante (DATABASE_URL, API_KEY, API_KEY_ORG_ID, API_URL, MONGO_URI, BETTER_AUTH_SECRET) | `06_standards_techniques.md §3` |
| `77db699` | `requestIdMiddleware` injecte UUID dans `req.requestId` + `X-Request-ID` réponse + interpole dans le printf Winston | `06_standards_techniques.md §2` |

### P1/P2 — Tests TDD (8)

| Commit | Type | Couverture |
|---|---|---|
| `f9de453` | E2E | Script 5 scénarios (spoofing, bypass, public scan, WORM chain, Audit Restrict) |
| `ab8b274` | Unit | Optimistic locking 409 (`Batch.version` race) |
| `5908813` | Schema | WORM invariants enrichis (SetNull rejeté, `@db.Char(64)`) |
| `70cdaaf` | Unit + E2E | Genealogy CTE — smoke unit + scénario 6 E2E sur chaîne 3 niveaux |
| `6dd521b` | Unit | `mixedAuth` M2M vs session — dispatch testé |
| `551b2b2` | Unit | `verifyBatchAccess` + `verifyReceiptAccess` tests directs (3 cas chacun) |
| `ee50f45` | Unit + security | Sanitization `X-Request-ID` entrant (anti CRLF + cap 128 chars) |
| `f50200e` | Refactor test | `buildHappyMockTx` helper → 86 lignes économisées dans `transformation.service.test.ts` |

### Refactor / hygiène (4)

| Commit | Description |
|---|---|
| `a759677` | 3 `new PrismaClient()` → 1 seul (mutualisation pool DB) |
| `dfd97dd` | Quote sur `summary: "[B2C] ..."` pour éviter le YAMLSyntaxError swagger-jsdoc au boot |
| `306a01f` | `.env.example` complet (`MONGO_URI`, `API_URL`) + `import 'dotenv/config'` en tête de `server.ts` |
| `2f47b26` | Bruno collection alignée sur format d'import + seed enrichi (Supplier, Customer, invitation pending) |

---

## 3. Validation E2E manuelle effectuée

Premier flow métier end-to-end validé en direct contre Postgres (cf. transcript de session, sign-in → telemetry ping → create receipt → get batch → create shipment) :

1. ✅ **Sign Up** avec invitation pending pré-seedée
2. ✅ **Sign In** → token Better-Auth capturé
3. ✅ **Telemetry Ping** (M2M, x-api-key) → 202 Accepted
4. ✅ **Create Receipt** → 201 + batch auto-généré + audit WORM
5. ✅ **Get Batch by ID** → relations `produit` / `unite` correctes, version 1
6. ✅ **Create Shipment** → 201 + SSCC GS1 auto (`034567890000000019`)

---

## 4. Variables d'environnement requises au boot (`assertEnv`)

Le validateur impose désormais ces 6 variables — toute absence → `process.exit(1)` immédiat :

- `DATABASE_URL` (Prisma)
- `API_KEY` (clé partagée M2M)
- `API_KEY_ORG_ID` (UUID d'une org existante, résout l'`activeOrgId` en mode M2M — remplace l'ancien header `x-org-id`)
- `API_URL` (utilisé par Better-Auth pour les liens d'invitation et le `baseURL`)
- `MONGO_URI` (logs applicatifs)
- `BETTER_AUTH_SECRET` (signature des sessions ; min 32 chars recommandé, généré via `crypto.randomBytes(48).toString('base64url')`)

Voir `.env.example` à jour.

---

## 5. Dette explicitement déférée

Documenté dans la mémoire interne + le plan original `jiggly-puzzling-balloon.md`. À reprendre **selon un déclencheur réel** (bug, nouveau use case, exigence produit), pas spéculativement.

### P2 — Tests qui demandent une DB de test
- Profondeur > 20 sur la CTE généalogie
- Cross-tenant unit explicite sur `verifyBatchAccess` / `verifyReceiptAccess` (couvert via E2E aujourd'hui)
- `mixedAuth` avec `req.headers` undefined (crash silencieux possible)

### P3 — Refactor architectural
- **`transformationService.createTransformation` (225 lignes)** — découpage SRP en 4 collaborateurs (`BatchInputValidator`, `ChildBatchFactory`, `ParentBatchConsumer`, `EpcisEventEmitter`). Trop risqué sans coverage exhaustive.
- **`InvitationService` / `OnboardingService`** extraction depuis le hook `databaseHooks.user.create.after` (`auth.config.ts`).
- **`AuthenticatedRequest` god-type** — typer les 4 `validated*: any` via `Infer<typeof schema>` VineJS.
- **`BatchStatus` enum** — 27 magic strings (`EN_STOCK`, `EPUISE`, `ALERTE`, `NON_CONFORME`, `EXPEDIE`, `TERMINE`) dispersés.
- **Hexagonal vrai** — ports/adaptateurs, repositories injectables.

### P4 — Production-readiness
- **Table `ApiKey`** multi-clés par organisation (l'env-driven suffit en dev mais bloque la prod multi-tenant M2M).
- **Suppression pollution Swagger JSDoc** (7 fichiers de routes) — générer depuis VineJS comme prévu §1 de `06_standards_techniques.md`.
- **Pagination uniforme** `limit=500` + format `{data, meta}` partout (`06_standards_techniques.md §4`).
- **Propagation `requestId`** dans tous les `logger.*` métier (changement de signatures).
- **Recall — impact logistique** : lier `getDownstream()` à `Liaison_Shipment`, lister les `Shipment_ID` partis à notifier.
- **Timeout SQL** sur `getUpstream`/`getDownstream` (anti-DoS).

---

## 6. Comment relancer la batterie complète

```bash
# 1. Migration Prisma + seed
npm run dev          # ou tsx watch
# (autre terminal)
npx prisma migrate reset --force   # drop + migrate + seed (run seed.ts)

# 2. Tests unitaires
npm run unit:test    # → 126 verts attendus

# 3. Lint
npm run lint

# 4. E2E sécurité (besoin dev server up)
npm run e2e:security
```

Variables d'env nécessaires : cf. `.env.example` (copier vers `.env` et remplir, notamment `API_KEY_ORG_ID` avec l'UUID d'une org seedée ou `usine-laitiere-paris` slug).

---

## 7. Liens

- Plan original + revue + cleanup : `C:\Users\paulo\.claude\plans\jiggly-puzzling-balloon.md` (hors repo)
- Mémoire interne : `lessons_dev_workflow.md`, `handover_traceability.md`
- Standards en vigueur : `05_bonnes_pratiques_api.md`, `06_standards_techniques.md`
- Sécurité (matrice par route) : `09_SECURITY_DECISION_MATRIX.md`
