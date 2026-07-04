# 20 — Dossier de soutenance NutriChain

> Fil conducteur de la présentation au jury : le problème, la réponse, la preuve.
> Les schémas d'architecture sont dans [`19_architecture.md`](19_architecture.md) ;
> le démarrage technique dans le [`Readme`](../Readme.md).

---

## 1. Le problème

Dans l'agroalimentaire, trois défaillances coûtent cher — en santé publique et en argent :

1. **Traçabilité fragmentée** : quand un lot contaminé est détecté, remonter son origine
   et identifier tout ce qui en dérive (transformations, expéditions) prend des heures,
   parfois des jours. La réglementation (INCO, HACCP, ISO 22000) exige pourtant une
   traçabilité amont/aval complète.
2. **Chaîne du froid aveugle** : une excursion de température détectée trop tard, c'est
   un lot entier à détruire — ou pire, livré.
3. **Rappels produits lents et imprécis** : faute de généalogie fiable, on rappelle trop
   large (coût), trop tard (risque), et sans savoir quels clients ont réellement été livrés.

## 2. La réponse NutriChain

Une API de traçabilité **« de la ferme au rayon »**, multi-tenant (SaaS), construite sur
les standards d'interopérabilité **GS1/EPCIS** :

- **Traçabilité complète des lots** — réception → transformation → expédition, généalogie
  ascendante/descendante, événements EPCIS aux identifiants GS1 stricts (lot AI 10,
  URN LGTIN, SSCC, étiquette GS1 Digital Link scannable par le consommateur).
- **Chaîne du froid en temps réel** — ingestion de télémétrie IoT, détection d'excursion
  sur fenêtre glissante, alerte en moins de 30 secondes.
- **Rappel produit chirurgical** — blocage atomique d'un lot **et de toute sa descendance**
  (CTE récursive, jamais de troncature silencieuse), notification automatique des clients
  réellement livrés, en millisecondes.

Le tout **auditable** (journal WORM chaîné par hash, opposable) et **cloisonné par
organisation** (multi-tenancy en défense en profondeur).

## 3. Objectifs SMART : engagement vs livré

| Échéance | Objectif | Livré | Preuve mesurable |
|---|---|---|---|
| 01/03 | Auth + MFA + contrôle d'accès | ✅ (⚠️ ABAC reporté, cf. §7) | Better-Auth sessions + TwoFactor, invitations, organisations |
| 10/03 | CI/CD industrielle | ✅ | GitHub Actions (build, lint, tests) |
| 15/03 | Alerte chaîne du froid < 30 s p95 | ✅ | `e2e:iot-alert` : excursion → alerte + email |
| 10/06 | Mobile : scan rapide, mode offline | ✅ | Sync idempotente (HTTP 207, `clientOpId`), `e2e:sync` |
| 20/06 | Traçabilité EPCIS conforme GS1 | ✅ | ObjectEvent / TransformationEvent / AggregationEvent en URN LGTIN/SSCC, `e2e:epcis` 24/24 |
| 22/06 | Rappel produit complet < 15 min | ✅ | **~21 ms pour 4 645 lots descendants** (`bench:genealogy`) |
| 30/09 | Connecteurs ERP/WMS + audit WORM | ✅ partiel | Import CSV produits/clients + export EPCIS ; hash-chain vérifiée (`e2e:audit-verify`) |

## 4. Architecture en trois décisions

Le détail (5 diagrammes) est dans [`19_architecture.md`](19_architecture.md). L'essentiel :

1. **Monolithe modulaire, pas de microservices** — une réception crée le lot, le
   mouvement, l'événement EPCIS et l'entrée d'audit dans **une seule transaction ACID**.
   En microservices : des sagas, pour aucun bénéfice à cette échelle (YAGNI).
2. **Hexagonal par module** — routes → middlewares (auth, validation) → controllers →
   services. Le cœur métier ne connaît pas HTTP : 378 tests rapides, utilitaires GS1
   en fonctions pures.
3. **PostgreSQL comme unique source de vérité** — transactions Serializable, optimistic
   locking (`Batch.version`), migrations Prisma versionnées.

## 5. Scénario de démonstration (pas-à-pas)

Préparation : `npx prisma migrate deploy && npx prisma db seed`, puis `npm run dev`.
Requêtes prêtes dans la collection Bruno (`Nutrichain.json`).

| # | Action | Endpoint | Ce que le jury voit |
|---|---|---|---|
| 1 | L'ERP pousse son catalogue | `POST /api/connectors/imports/products` puis `/customers` (CSV) | Import idempotent, validation ligne à ligne, GTIN-13/14 imposé |
| 2 | Réception fournisseur | `POST /api/logistics/receipts` | Lot créé avec **numéro GS1 court** (`AAMMJJ-XXXXXX`) + ObjectEvent EPCIS en **URN LGTIN** |
| 3 | Étiquette du lot | `GET /api/logistics/batches/:id/label` | QR code **GS1 Digital Link** (GTIN + lot) |
| 4 | Réception NON CONFORME | `POST /api/logistics/receipts` (`statut_controle: NONCONFORME`) | Lot créé **BLOQUE** (quarantaine HACCP) — l'expédier renvoie 400 |
| 5 | Décision qualité | `POST /api/logistics/batches/:id/release` (motif obligatoire) | Levée tracée dans l'audit WORM |
| 6 | Transformation | `POST /api/traceability/transformations` | Lot enfant + généalogie (`GET .../batches/:id/genealogy`) + TransformationEvent LGTIN |
| 7 | Expédition | `POST /api/logistics/shipments` (`shipment_id: AUTO`) | **SSCC 18 chiffres** généré + AggregationEvent (palette ⊃ lots) |
| 8 | Excursion chaîne du froid | `POST /api/telemetry/ping` (température hors seuil) | Alerte TEMP_EXCURSION < 30 s + email ; résolution `PATCH /api/alerts/:id/resolve` |
| 9 | **Rappel produit** | `POST /api/traceability/batches/:id/recall` | Toute la descendance passe en ALERTE (chrono affiché : millisecondes), expéditions impactées listées, **clients notifiés par email automatiquement** |
| 10 | Le consommateur scanne | `GET /api/public/scan/:numero_lot` (route publique) | `statut_sanitaire: RAPPEL_CONSOMMATEUR` — transparence B2C |
| 11 | L'ERP récupère l'historique | `GET /api/traceability/events` + `GET /api/connectors/exports/events` | Journal EPCIS filtrable + export CSV |
| 12 | Preuve d'intégrité | `GET /api/audit/verify` | La chaîne de hash WORM est recalculée et validée |

**Plan B démo** (si le direct tourne mal) : chaque étape a son scénario e2e rejouable —
`npm run e2e:quarantine | e2e:recall | e2e:epcis | e2e:iot-alert | e2e:connectors | e2e:sync | e2e:audit-verify | e2e:security`.

## 6. Sécurité et conformité

- **Multi-tenancy en défense en profondeur** : gardes middleware (organisation active
  obligatoire) **et** refiltrage `organization_id` dans chaque requête Prisma. Vérifié
  par des tests d'anti-fuite cross-tenant (unit, intégration, e2e).
- **Audit WORM** : chaque action sensible écrit une entrée chaînée par hash **dans la
  même transaction** ; vérification à la demande et par job planifié ; checkpoints
  anti-troncature. Aucune route de modification/suppression n'existe.
- **Sûreté sanitaire (HACCP)** : lot non conforme → quarantaine `BLOQUE`, intransformable
  et inexpédiable ; levée uniquement par décision qualité tracée avec motif.
- **Durcissement** : validation VineJS systématique (messages français), anti-XSS emails,
  anti-injection de formule CSV à l'export, sanitization CRLF, variables d'environnement
  validées au démarrage (fail-fast), rate limiting.

## 7. Limites assumées et perspectives

Dire au jury ce qui n'est **pas** fait vaut mieux que de le laisser le découvrir :

- **RBAC partiel / ABAC reporté** : deux taxonomies de rôles coexistent (organisation
  et métier logistique), non réconciliées. Le mode machine (clé API) est complet ; la
  granularité fine par rôle métier en session web est une itération dédiée à venir.
- **Préfixe GS1 simulé** : les identifiants sont structurellement conformes, mais le
  préfixe entreprise est fictif (aucun préfixe acheté auprès de GS1 — projet d'école).
  Chaque organisation peut renseigner le sien ; les URN sont découpées positionnellement
  sans vérifier la correspondance préfixe/GTIN (GTIN de démo fictifs).
- **Connecteurs ERP génériques** : CSV normalisé en entrée, export EPCIS en sortie —
  pas d'adaptateur natif SAP/Odoo (l'architecture les accueille : un service par
  adaptateur dans `connectors`).
- **Perspectives** : réconciliation RBAC→ABAC, sérialisation EPCIS JSON-LD complète,
  adaptateurs ERP natifs, tests de charge k6.

## 8. Qualité logicielle (comment c'est construit)

- **TDD à trois niveaux** : 378 tests unitaires/intégration (Vitest + Supertest,
  68 fichiers) + 8 suites e2e contre PostgreSQL réel + benchmark de généalogie.
- **TypeScript strict, zéro `any` en production** ; validation typée aux frontières
  (`Infer<typeof schema>`).
- **Migrations versionnées** (`prisma/migrations/`), commits conventionnels, hooks
  husky/lint-staged, revues de code multi-angles avant merge, CI GitHub Actions.
- **Documentation vivante** : 20 documents dans `docs/` (architecture, sécurité,
  PCA/PRA, modules), Readme opérationnel, collection Bruno.

## 9. Chiffres clés à retenir

| Indicateur | Valeur |
|---|---|
| Rappel produit (généalogie + blocage) | **~21 ms** pour 4 645 lots (budget : 15 min) |
| Alerte chaîne du froid | **< 30 s** entre télémétrie et alerte |
| Tests automatisés | **378** verts + 8 suites e2e |
| Modules métier | 9 (+ noyau partagé), 31 modèles de données |
| Standards | GS1 : GTIN, AI(10), SSCC, URN LGTIN/SSCC, Digital Link · EPCIS : Object/Transformation/AggregationEvent |
| Conformité visée | HACCP, ISO 22000, RPO 15 min / RTO 60-120 min (PCA/PRA, cf. `18_PCA_PRA.md`) |
