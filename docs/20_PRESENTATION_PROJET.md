# 20 — Présentation du projet NutriChain

> Fil conducteur de la présentation du projet : le problème, la réponse, la preuve.
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
| 01/03 | Auth + MFA + contrôle d'accès | ⚠️ partiel (ABAC reporté, cf. §7 — MFA TOTP livrée end-to-end) | Better-Auth sessions, invitations, organisations, RBAC 5 rôles, 2FA TOTP (front + mobile web) |
| 10/03 | CI/CD industrielle | ✅ | GitHub Actions (build, lint, tests, migrations) |
| 15/03 | Alerte chaîne du froid < 30 s p95 | ⚠️ partiel | `e2e:iot-alert` prouve l'enchaînement excursion → alerte, mais ne chronomètre pas ; le seuil 30 s n'est pas mesuré automatiquement |
| 10/06 | Mobile : scan rapide, mode offline | ⚠️ partiel | Sync idempotente prouvée (HTTP 207, `clientOpId`, `e2e:sync`) ; la latence de scan n'est pas mesurée |
| 20/06 | Traçabilité EPCIS conforme GS1 | ✅ | ObjectEvent / TransformationEvent / AggregationEvent en URN LGTIN/SSCC, `e2e:epcis` 24/24 |
| 22/06 | Rappel produit complet < 15 min | ✅ | **~21 ms pour 4 645 lots descendants** (`bench:genealogy`) |
| 30/09 | Connecteurs ERP/WMS + audit WORM | ✅ partiel | Import CSV produits/clients + export EPCIS ; hash-chain vérifiée (`e2e:audit-verify`) |

## 4. Architecture en trois décisions

Le détail (5 diagrammes) est dans [`19_architecture.md`](19_architecture.md). L'essentiel :

1. **Monolithe modulaire, pas de microservices** — une réception crée le lot, le
   mouvement, l'événement EPCIS et l'entrée d'audit dans **une seule transaction ACID**.
   En microservices : des sagas, pour aucun bénéfice à cette échelle (YAGNI).
2. **Couches strictes par module** — routes → middlewares (auth, validation) → controllers →
   services. Aucun service ne dépend d'Express : 870 tests rapides, utilitaires GS1
   en fonctions pures.
3. **PostgreSQL comme unique source de vérité** — transactions Serializable, optimistic
   locking (`Batch.version`), migrations Prisma versionnées.

## 5. Scénario de démonstration (pas-à-pas)

Préparation : `npx prisma migrate deploy`, `npx prisma db seed`, **`npm run seed:demo`**, puis
`npm run dev`. Le second seed n'est pas optionnel : sans lui, Traçabilité, Chaîne du froid, Rappels
et Généalogie s'affichent vides — le socle ne contient ni site, ni capteur, ni transformation.
Requêtes prêtes dans la collection Bruno (`Nutrichain.json`).

| # | Action | Endpoint | Résultat observé |
|---|---|---|---|
| 1 | L'ERP pousse son catalogue | `POST /api/connectors/imports/products` puis `/customers` (CSV) | Import idempotent, validation ligne à ligne, GTIN-13/14 imposé |
| 2 | Réception fournisseur | `POST /api/logistics/receipts` (avec `id_materiel` de stockage) | Lot créé avec **numéro GS1 court** (`AAMMJJ-XXXXXX`), **rattaché à son emplacement** (matériel → lieu, position connue) + ObjectEvent EPCIS en **URN LGTIN** |
| 3 | Étiquette du lot | `GET /api/logistics/batches/:id/label` | QR code **GS1 Digital Link** (GTIN + lot) |
| 4 | Réception NON CONFORME — **connecté en `operator`** | `POST /api/logistics/receipts` (`statut_controle: NONCONFORME`) | Lot créé **BLOQUE** (quarantaine HACCP) — l'expédier renvoie 400 |
| 5a | L'opérateur tente de lever SA propre quarantaine | `POST /api/logistics/batches/:id/release` | **403** : on ne libère pas le lot qu'on a enregistré (séparation des tâches) |
| 5b | Décision qualité — **se reconnecter en `quality`** | `POST /api/logistics/batches/:id/release` (motif obligatoire) | Levée acceptée et tracée dans l'audit WORM |
| 6 | Transformation | `POST /api/traceability/transformations` | Lot enfant + généalogie (`GET .../batches/:id/genealogy`) + TransformationEvent LGTIN |
| 6c | Contrôle qualité de sortie — **connecté en `quality`** | `POST /api/organization/quality-controls` (`resultat: CONFORME`) | Un produit fini sort en `EN_ATTENTE_QC` : sans ce contrôle, il n'est ni transformable ni expédiable — il libère le lot en `EN_STOCK` |
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

Documenter honnêtement ce qui n'est **pas** fait vaut mieux que de le laisser découvrir plus tard :

- **MFA (TOTP) livrée end-to-end, activation non obligatoire.** Le plugin `twoFactor` de
  Better-Auth est activé ; quatre routes (`enable`, `get-totp-uri`, `verify-totp`,
  `disable`) sont ouvertes dans l'allowlist du passthrough — les autres (`update-user`,
  `change-email`, `change-password`, gestion des sessions) restent fermées, hors de tout
  contrôle de rôle et sans trace d'audit. Écran d'activation/désactivation côté front
  (`/mon-compte`) et challenge de connexion côté front et mobile web. Ce qui reste :
  l'activation n'est pas **obligatoire** pour les rôles sensibles (`owner`/`admin`), et
  seule la cible web du mobile a été vérifiée en conditions réelles — pas les cibles
  natives iOS/Android.
- **ABAC reporté** : le contrôle d'accès livré est un **RBAC à cinq rôles**
  (`owner`, `admin`, `quality`, `operator`, `viewer`), vocabulaire unique et canonique — il a
  remplacé les anciens `logistics_*`, `quality_control` et `manager`, absents du code. Reste une
  scorie : `Member.role` a encore `@default("member")` en base, valeur qui n'appartient à aucun
  ensemble de rôles et ne donnerait donc aucun droit. Elle n'est jamais atteinte — les deux seuls
  points de création fixent le rôle explicitement — mais le défaut du schéma devrait être aligné.
  La granularité par attribut (permissions atomiques, affectation par site) décrite en
  `02_roles_et_permissions.md` reste une cible de conception.
- **Préfixe GS1 simulé** : les identifiants sont structurellement conformes, mais le
  préfixe entreprise est fictif — aucun préfixe n'a été acheté auprès de GS1 dans cet
  environnement de démonstration. Chaque organisation peut renseigner le sien ; les URN sont
  découpées positionnellement sans vérifier la correspondance préfixe/GTIN (GTIN de démo fictifs).
- **Connecteurs ERP génériques** : CSV normalisé en entrée, export EPCIS en sortie —
  pas d'adaptateur natif SAP/Odoo (l'architecture les accueille : un service par
  adaptateur dans `connectors`).
- **Perspectives** : réconciliation RBAC→ABAC, sérialisation EPCIS JSON-LD complète,
  adaptateurs ERP natifs, tests de charge k6.

## 8. Qualité logicielle (comment c'est construit)

- **TDD à trois niveaux** : 870 tests unitaires/intégration (Vitest + Supertest,
  116 fichiers, 88,86 % de couverture de lignes) + suites e2e contre PostgreSQL réel + benchmark de généalogie.
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
| Alerte chaîne du froid | seuil visé **< 30 s** ; enchaînement excursion → alerte prouvé (`e2e:iot-alert`), délai non chronométré |
| Tests automatisés | **870** verts (88,86 % de couverture de lignes) + suites e2e |
| Modules métier | 10 (+ noyau partagé `core`), 31 modèles de données |
| Standards | GS1 : GTIN, AI(10), SSCC, URN LGTIN/SSCC, Digital Link · EPCIS : Object/Transformation/AggregationEvent |
| Conformité visée | HACCP, ISO 22000, RPO 15 min / RTO 60-120 min (PCA/PRA, cf. `18_PCA_PRA.md`) |

## 10. Indicateurs KPI (Baseline → Cible M6 → Cible M12)

Sélection des 7 KPI les plus représentatifs parmi les ~25 suivis (liste complète :
`context.md` §VII). Baseline = mesuré en environnement de démonstration, pas en production
(aucune n'est déployée, cf. §7).

| KPI | Baseline | Cible M6 | Cible M12 |
|---|---|---|---|
| Temps p95 ingest → alerte (chaîne du froid) | non chronométré (`e2e:iot-alert` prouve l'enchaînement, pas la latence) | < 20 s, mesuré | < 15 s, mesuré |
| Temps médian rappel produit (généalogie + blocage) | ~21 ms pour 4 645 lots (`bench:genealogy`) | < 5 min en prod | < 15 min en prod (seuil contractuel) |
| Taux d'évènements EPCIS conformes GS1 | 100 % (`e2e:epcis`, 24/24) | > 99 % en prod | > 99,5 % en prod |
| Couverture de tests (lignes) | 88,86 % (870 tests) | 90 % | 92 % |
| Comptes sensibles avec MFA actif | 0 % (fonctionnalité livrée, adoption non mesurée) | 50 % | 100 % |
| Disponibilité du service | non mesurée (pas d'environnement déployé) | 99 % | 99,9 % (NFR) |
| Taux de perte de messages IoT | non mesuré (pas de flux réel en continu) | < 0,5 % | < 0,1 % |

## 11. Déroulé chronométré, répétition, plan B

Montage à partir du scénario en 12 étapes (§5), pas de contenu nouveau. Budget total 30 min :
intro (3 min), réponse (2 min), architecture (3 min), **démo pas-à-pas (17 min)**, sécurité et
limites (3 min), conclusion (2 min).

Répartition des 17 min de démo — les étapes qui ne produisent qu'une ligne de résultat (import,
étiquette) vont vite ; celles à effet visible et démonstratif (quarantaine, alerte froid, rappel)
en méritent davantage :

| Étape (§5) | Temps cible |
|---|---|
| 1. Import ERP | 1 min |
| 2. Réception fournisseur | 1 min |
| 3. Étiquette GS1 | 30 s |
| 4-5. Quarantaine + séparation des tâches | **3 min** — le point le plus démonstratif de la rigueur HACCP |
| 6. Transformation + généalogie | 1,5 min |
| 7. Expédition + SSCC | 1 min |
| 8. Excursion chaîne du froid | **2,5 min** — alerte + quarantaine automatique |
| 9. Rappel produit | **2,5 min** — le chrono en millisecondes est l'argument à appuyer |
| 10. Scan consommateur | 1 min |
| 11. Export EPCIS | 1 min |
| 12. Preuve d'intégrité WORM | 1 min |

Total 16,5 min — 30 s de marge pour un aléa.

**Répétition technique — faite, temps réels mesurés.** Le scénario complet (§5, 5a/5b compris) a
été rejoué en HTTP réel contre un Postgres/Mongo Docker, chronomètre au niveau serveur (avant/après
chaque appel) :

| Étape | Temps serveur mesuré |
|---|---|
| 1. Import ERP (produits + clients) | 13 + 13 ms |
| 2. Réception fournisseur | 17 ms |
| 3. Étiquette GS1 | 20 ms |
| 4. Réception NON CONFORME | 17 ms |
| 5a. Refus operator (403 attendu) | 9 ms |
| 5b. Levée de quarantaine (quality) | 13 ms |
| 6. Transformation + généalogie | 21 + 13 ms |
| 6c. Contrôle qualité de sortie d'usine | 13 ms |
| 7. Expédition (SSCC) | 15 ms |
| 8. Excursion chaîne du froid | 7 ms |
| 9. Rappel produit | 17 ms |
| 10. Scan consommateur | 3 ms |
| 11. Événements EPCIS + export | 11 + 9 ms |
| 12. Vérification audit WORM | 11 ms |

**Total serveur : ~220 ms.** Ce chiffre confirme que le système n'est pas le facteur limitant : le
temps réel d'une présentation sera dicté par la narration et la saisie humaines, pas par une
latence technique. Les cibles du tableau ci-dessus (16,5 min) restent donc la bonne base pour
caler un passage parlé — mesurer le débit de parole réel reste à faire, séparément, avec une
personne qui présente à voix haute.

Une étape absente du scénario d'origine a été découverte pendant cette répétition : un produit
issu d'une transformation sort en `EN_ATTENTE_QC` et n'est **pas expédiable** tant qu'un contrôle
qualité de sortie (`POST /organization/quality-controls`, rôle `quality`) ne le libère pas en
`EN_STOCK` — l'étape 7 échouait (400) sans elle. Ajoutée au tableau §5 comme étape 6c.

**Découverte critique — la base de développement partagée avait une chaîne d'audit WORM rompue**
(`GET /audit/verify` → `valid: false`, rupture à une ligne ancienne, plusieurs lignes manquantes
en séquence). Cause : des suppressions directes de lignes `Audit_Log` lors de nettoyages de tests
antérieurs, hors du chemin applicatif normal — pas un défaut du code de production (les écritures
de cette répétition, elles, sont toutes passées par les services réels et n'ont rien cassé).
Conséquence directe pour le jour de la présentation : **ne jamais présenter sur une base de
développement réutilisée**. Item de check avant démarrage à ajouter systématiquement : relancer
`GET /audit/verify` juste avant de commencer, sur la base qui servira réellement, et n'utiliser
que `npx prisma migrate deploy && npx prisma db seed && npm run seed:demo` sur un volume Postgres
fraîchement créé pour cette occasion.

**Plan B — captures de secours, produites.** Capturées en réel (front + navigateur, connecté
`operator`) pendant cette même répétition : tableau de bord (activité EPCIS + rappel actif),
non-conformités (lot en quarantaine + note de séparation des tâches), chaîne du froid (alerte
active sur `SENSOR-FROID-A1`), rappels produits (carte du rappel avec lots bloqués et expédition
notifiée), scan consommateur (`⚠ Rappel en cours — ne pas consommer`). Non capturée : la preuve
d'intégrité WORM (12) — la session navigateur est restée bloquée sur le rôle `operator`, qui n'a
pas accès à cet écran ; la preuve existe malgré tout en réel, via la réponse JSON de
`GET /audit/verify` ci-dessus. Captures actuellement hors du dépôt (non commitées) : à committer
dans un dossier dédié si retenues comme repli, décision hors périmètre de ce correctif. Leçon déjà
tirée : tout ce qui dépend du réseau de la salle doit avoir un repli (le scan caméra en dépendait,
corrigé par Mobile PR #28) — ces captures sont ce repli côté API/front.
