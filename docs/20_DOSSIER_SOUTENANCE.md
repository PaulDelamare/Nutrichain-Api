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
| 01/03 | Auth + MFA + contrôle d'accès | ⚠️ partiel (MFA et ABAC reportés, cf. §7) | Better-Auth sessions, invitations, organisations, RBAC 5 rôles |
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
2. **Couches strictes par module** — routes → middlewares (auth, validation) → controllers →
   services. Aucun service ne dépend d'Express : 724 tests rapides, utilitaires GS1
   en fonctions pures.
3. **PostgreSQL comme unique source de vérité** — transactions Serializable, optimistic
   locking (`Batch.version`), migrations Prisma versionnées.

## 5. Scénario de démonstration (pas-à-pas)

Préparation : `npx prisma migrate deploy`, `npx prisma db seed`, **`npm run seed:demo`**, puis
`npm run dev`. Le second seed n'est pas optionnel : sans lui, Traçabilité, Chaîne du froid, Rappels
et Généalogie s'affichent vides — le socle ne contient ni site, ni capteur, ni transformation.
Requêtes prêtes dans la collection Bruno (`Nutrichain.json`).

| # | Action | Endpoint | Ce que le jury voit |
|---|---|---|---|
| 1 | L'ERP pousse son catalogue | `POST /api/connectors/imports/products` puis `/customers` (CSV) | Import idempotent, validation ligne à ligne, GTIN-13/14 imposé |
| 2 | Réception fournisseur | `POST /api/logistics/receipts` (avec `id_materiel` de stockage) | Lot créé avec **numéro GS1 court** (`AAMMJJ-XXXXXX`), **rattaché à son emplacement** (matériel → lieu, position connue) + ObjectEvent EPCIS en **URN LGTIN** |
| 3 | Étiquette du lot | `GET /api/logistics/batches/:id/label` | QR code **GS1 Digital Link** (GTIN + lot) |
| 4 | Réception NON CONFORME — **connecté en `operator`** | `POST /api/logistics/receipts` (`statut_controle: NONCONFORME`) | Lot créé **BLOQUE** (quarantaine HACCP) — l'expédier renvoie 400 |
| 5a | L'opérateur tente de lever SA propre quarantaine | `POST /api/logistics/batches/:id/release` | **403** : on ne libère pas le lot qu'on a enregistré (séparation des tâches) |
| 5b | Décision qualité — **se reconnecter en `quality`** | `POST /api/logistics/batches/:id/release` (motif obligatoire) | Levée acceptée et tracée dans l'audit WORM |
| 6 | Transformation | `POST /api/traceability/transformations` | Lot enfant + généalogie (`GET .../batches/:id/genealogy`) + TransformationEvent LGTIN |
| 7 | Expédition | `POST /api/logistics/shipments` (`shipment_id: AUTO`) | **SSCC 18 chiffres** généré + AggregationEvent (palette ⊃ lots) |
| 8 | Excursion chaîne du froid | `POST /api/telemetry/ping` (température hors seuil) | Alerte TEMP_EXCURSION < 30 s + email **ET les lots stockés dans l'équipement passent automatiquement en quarantaine (`BLOQUE`)** ; résolution `PATCH /api/alerts/:id/resolve` |
| 9 | **Rappel produit** | `POST /api/traceability/batches/:id/recall` | Toute la descendance passe en ALERTE (chrono affiché : millisecondes), expéditions impactées listées, **clients notifiés par email automatiquement** |
| 10 | Le consommateur scanne | `GET /api/public/scan/:id` (route publique, `:id` = numéro de lot) | `statut_sanitaire: RAPPEL_CONSOMMATEUR` — transparence B2C |
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
  et inexpédiable ; levée uniquement par décision qualité tracée avec motif, et **signée par une
  autre personne que celle qui a enregistré le lot** (séparation des tâches). La règle porte sur la
  personne, pas sur le rôle : `admin` conserve ses droits, mais pas sur sa propre production. Si
  l'organisation ne compte aucun autre décideur habilité, la levée passe et l'audit porte la
  mention `AUTO_SIGNEE_AUCUN_AUTRE_DECIDEUR` — on trace au lieu de bloquer du stock.
- **Durcissement** : validation VineJS systématique (messages français), anti-XSS emails,
  anti-injection de formule CSV à l'export, sanitization CRLF, variables d'environnement
  validées au démarrage (fail-fast), rate limiting.
- **Résistance au bruteforce** : deux couches complémentaires sur la connexion. Un limiteur par IP
  qui ne compte que les tentatives ÉCHOUÉES, et un verrou par COMPTE (5 échecs en 15 min → 15 min
  de refus, mot de passe correct compris). Aucune ne suffit seule : la première laisse passer
  l'acharnement sur une victime depuis plusieurs adresses, la seconde le balayage de comptes depuis
  une seule. L'incrément est atomique et posé AVANT la vérification du mot de passe — compté après,
  il se perdait dès que les tentatives arrivaient en parallèle. L'e-mail n'est stocké qu'en
  empreinte HMAC, purgée quotidiennement.

## 7. Limites assumées et perspectives

Dire au jury ce qui n'est **pas** fait vaut mieux que de le laisser le découvrir :

- **MFA implémentée mais non exposée — décision de sécurité, pas un oubli.** Le plugin
  `twoFactor` de Better-Auth est activé et sa table existe, mais les routes
  `/auth/two-factor/*` sont fermées, comme le reste du cœur Better-Auth. Motif : ces routes
  sont servies par un passthrough qui **ne traverse ni notre RBAC ni le journal d'audit
  WORM**. Les ouvrir en bloc rouvrirait aussi `update-user`, `change-email`,
  `change-password` et la gestion des sessions, hors de tout contrôle de rôle et sans
  trace. Nous avons donc préféré une **allowlist stricte de trois routes** (connexion,
  inscription, déconnexion) : la règle échoue *fermé*, et un nouvel endpoint apparu dans
  une version ultérieure de la dépendance ne rouvre pas un trou en silence. Exposer la MFA
  proprement suppose de la faire passer par nos propres routes gardées : c'est l'itération
  suivante, pas une case à cocher.
- **ABAC reporté** : le contrôle d'accès livré est un **RBAC à cinq rôles**
  (`owner`, `admin`, `quality`, `operator`, `viewer`), vocabulaire unique et canonique — il a
  remplacé les anciens `logistics_*`, `quality_control` et `manager`, absents du code. Reste une
  scorie : `Member.role` a encore `@default("member")` en base, valeur qui n'appartient à aucun
  ensemble de rôles et ne donnerait donc aucun droit. Elle n'est jamais atteinte — les deux seuls
  points de création fixent le rôle explicitement — mais le défaut du schéma devrait être aligné.
  La granularité par attribut (permissions atomiques, affectation par site) décrite en
  `02_roles_et_permissions.md` reste une cible de conception.
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

- **TDD à trois niveaux** : 724 tests unitaires/intégration (Vitest + Supertest,
  104 fichiers, 86 % de couverture de lignes) + suites e2e contre PostgreSQL réel + benchmark de généalogie.
- **TypeScript strict, zéro `any` en production** ; validation typée aux frontières
  (`Infer<typeof schema>`).
- **Migrations versionnées** (`prisma/migrations/`), commits conventionnels, hooks
  husky/lint-staged, revues de code multi-angles avant merge, CI GitHub Actions.
- **Documentation vivante** : 28 documents dans `docs/` (architecture, sécurité,
  PCA/PRA, modules), Readme opérationnel, collection Bruno.

## 9. Chiffres clés à retenir

| Indicateur | Valeur |
|---|---|
| Rappel produit (généalogie + blocage) | **~21 ms** pour 4 645 lots (budget : 15 min) |
| Alerte chaîne du froid | **< 30 s** entre télémétrie et alerte |
| Tests automatisés | **724** verts (86 % de couverture de lignes) + suites e2e |
| Modules métier | 11 (+ noyau partagé), 33 modèles de données |
| Standards | GS1 : GTIN, AI(10), SSCC, URN LGTIN/SSCC, Digital Link · EPCIS : Object/Transformation/AggregationEvent |
| Conformité visée | HACCP, ISO 22000, RPO 15 min / RTO 60-120 min (PCA/PRA, cf. `18_PCA_PRA.md`) |
