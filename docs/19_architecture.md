# 19 — Architecture de NutriChain API

> Document de référence pour la soutenance. Tous les schémas reflètent le code réel
> (`src/app.ts`, `src/modules/`, `src/shared/`, `prisma/schema.prisma`) à la date du 04/07/2026.

## 1. Vue de contexte — qui parle à l'API ?

L'API est le point central d'un écosystème de traçabilité agroalimentaire : elle sert
des humains (opérateurs, consommateurs), des machines (capteurs, ERP) et une application
mobile capable de travailler hors-ligne.

```mermaid
flowchart LR
    subgraph Acteurs
        WEB["Front web opérateur<br/>(sessions Better-Auth)"]
        MOBILE["App mobile terrain<br/>(scans hors-ligne)"]
        IOT["Capteurs IoT<br/>(température chaîne du froid)"]
        ERP["ERP / WMS<br/>(clé API, CSV)"]
        CONSO["Consommateur<br/>(scan QR public, sans compte)"]
    end

    API["NutriChain API<br/>Express + TypeScript<br/>monolithe modulaire"]

    subgraph Sorties
        PG[("PostgreSQL<br/>Prisma ORM")]
        MAIL["E-mails<br/>(rappels, invitations, alertes)"]
    end

    WEB -->|"REST /api/*"| API
    MOBILE -->|"POST /api/sync/scans<br/>(idempotent)"| API
    IOT -->|"POST /api/telemetry/ping"| API
    ERP -->|"imports CSV / export EPCIS"| API
    CONSO -->|"GET scan public d'un lot"| API

    API --> PG
    API --> MAIL
```

Points clés :

- **Deux modes d'authentification** : sessions Better-Auth (humains) et clé API
  (machines ERP/WMS), unifiés par le middleware `mixedAuth`.
- **Une route volontairement publique** : le scan consommateur d'un lot expédié
  (transparence sanitaire), qui n'expose que des données non sensibles.
- **PostgreSQL est l'unique état persistant** : pas de cache externe ni de broker,
  la cohérence repose sur les transactions Prisma.

## 2. Vue modulith — les modules métier

Le projet est un **monolithe modulaire** : un seul déployable, mais des frontières
de modules strictes calquées sur les domaines métier. Chaque module possède ses
routes, middlewares, contrôleurs et services ; le partage passe exclusivement par
`src/shared/` (noyau commun) — jamais d'import direct entre entrailles de modules.

```mermaid
flowchart TB
    HTTP["Express — pipeline global<br/>requestId → JSON → CORS → Helmet →<br/>compression → rate limit → sanitize → logs"]

    subgraph Modules["src/modules — un module par domaine"]
        IDENTITY["identity<br/>auth Better-Auth, invitations,<br/>organisations, rôles"]
        TRACE["traceability<br/>catalogue, transformations,<br/>généalogie, rappels, événements EPCIS"]
        LOGI["logistics<br/>réceptions, expéditions,<br/>lots, SSCC"]
        IOTM["iot<br/>télémétrie, détection<br/>d'excursion de température"]
        ALERTS["alerts<br/>cycle de vie des alertes,<br/>résolution tracée"]
        SYNC["sync<br/>scans mobiles hors-ligne,<br/>idempotence"]
        CONN["connectors<br/>imports CSV ERP,<br/>export EPCIS"]
        AUDIT["auditIntegrity<br/>vérification de la chaîne<br/>d'audit, checkpoints, job planifié"]
        CORE["core<br/>health, hello"]
    end

    subgraph Shared["src/shared — noyau commun"]
        MW["middlewares<br/>mixedAuth, rateLimiter,<br/>sanitize, requestId"]
        UTILS["utils<br/>gs1, audit hash-chain, validateData,<br/>csv, mailer, errorHandler, logger"]
        CONSTS["constants<br/>EPCIS, configs, types"]
    end

    PRISMA["Prisma Client"]
    DB[("PostgreSQL<br/>~30 modèles")]

    HTTP --> Modules
    Modules --> Shared
    Modules --> PRISMA
    PRISMA --> DB

    IOTM -.->|"crée des alertes"| ALERTS
    TRACE -.->|"rappel → notification clients"| CONN
```

Pourquoi ce choix plutôt que des microservices :

- **Cohérence transactionnelle** : une réception crée en un seul `prisma.$transaction`
  le lot, le mouvement de stock, l'événement EPCIS et l'entrée d'audit. En
  microservices, cela exigerait des sagas — complexité injustifiée à cette échelle (YAGNI).
- **Frontières prêtes pour l'extraction** : chaque module étant autonome (routes →
  services), un module peut devenir un service séparé si la charge l'exige un jour.
- **Un seul pipeline de sécurité** : auth, rate limiting, sanitisation et audit
  sont appliqués uniformément.

## 3. Zoom hexagonal — anatomie d'un module

Chaque module suit le même patron **ports & adaptateurs** : le cœur métier (services,
fonctions pures) ne connaît ni Express ni le transport HTTP. Exemple réel :
`logistics/receipts`.

```mermaid
flowchart LR
    subgraph Adapters_In["Adaptateurs entrants"]
        R["routes<br/>receipt.routes.ts"]
        M["middlewares<br/>requireAuth / mixedAuth<br/>verifyReceiptAccess (multi-tenant)<br/>validateReceipt (VineJS, messages FR)"]
        C["controllers<br/>receipt.controller.ts<br/>(traduction HTTP ↔ métier)"]
    end

    subgraph Core["Cœur métier"]
        S["services<br/>receipt.service.ts<br/>règles métier, transactions"]
        G["shared/utils/gs1<br/>fonctions pures :<br/>SSCC, URN LGTIN, lot AI(10)"]
        A["shared/utils/audit<br/>hash-chain WORM"]
    end

    subgraph Adapters_Out["Adaptateurs sortants"]
        P["Prisma Client<br/>(persistance)"]
        ML["mailer<br/>(notifications)"]
    end

    R --> M --> C --> S
    S --> G
    S --> A
    S --> P
    S --> ML
```

Conséquences concrètes :

- **Testabilité** : les services se testent avec un Prisma mocké, les utilitaires GS1
  sont des fonctions pures testées sans aucun mock (375 tests, 68 fichiers).
- **Validation aux frontières** : VineJS (messages français centralisés) valide toute
  entrée *avant* le contrôleur ; le cœur métier reçoit des données déjà typées
  (`Infer<typeof schema>`, zéro `any`).
- **Multi-tenancy garanti en profondeur** : les gardes d'accès (middlewares) filtrent
  par `activeOrganizationId`, et chaque requête Prisma des services refiltre par
  `organization_id` — défense en profondeur, jamais une seule barrière.

## 4. Flux de traçabilité bout en bout (EPCIS / GS1)

Le scénario métier central : suivre un produit de la réception au consommateur,
avec identifiants GS1 stricts et rappel ciblé par généalogie.

```mermaid
sequenceDiagram
    autonumber
    participant ERP as ERP (CSV)
    participant API as NutriChain API
    participant DB as PostgreSQL
    participant CL as Clients livrés
    participant QR as Consommateur

    ERP->>API: import produits (GTIN-13/14 validés)
    API->>DB: upsert idempotent par (org, GTIN)

    Note over API: Réception fournisseur
    API->>DB: Batch + lot AI(10) « AAMMJJ-XXXXXX »
    API->>DB: EPCIS ObjectEvent (URN LGTIN, quantityList)
    API->>DB: Audit_Log chaîné (hash n-1 → hash n)

    Note over API: Transformation
    API->>DB: lots enfants + TransformationComposition (généalogie)

    Note over API: Expédition
    API->>DB: SSCC 18 chiffres (préfixe GS1 org + garde capacité)
    API->>DB: EPCIS AggregationEvent (SSCC ⊃ lots)

    Note over API: Excursion chaîne du froid détectée (IoT)
    API->>DB: Alert + lots en quarantaine

    Note over API: Rappel produit
    API->>DB: généalogie récursive (CTE) → lots impactés
    API->>CL: notification e-mail des clients livrés

    QR->>API: scan QR public du lot
    API-->>QR: statut sanitaire (CONFORME / RAPPEL_CONSOMMATEUR)
```

Standards appliqués :

| Standard | Implémentation |
|---|---|
| GTIN-13/14 | validé à l'import (`/^\d{13,14}$/`), porté par `Product.code_gtin` |
| Lot AI(10) | ≤ 20 caractères, format `AAMMJJ-XXXXXX`, unique par organisation |
| SSCC | 18 chiffres, check digit modulo 10, préfixe entreprise de l'organisation |
| URN EPC | `urn:epc:class:lgtin:...` et `urn:epc:id:sscc:...` (sans check digit, règle GS1) |
| EPCIS | ObjectEvent, TransformationEvent, AggregationEvent persistés et exportables CSV |

## 5. Chaîne d'audit WORM (hash-chain)

Chaque action sensible écrit une entrée `Audit_Log` **dans la même transaction** que
l'action. Les entrées sont chaînées par hachage : falsifier une ligne casse toutes
les suivantes.

```mermaid
flowchart LR
    E1["Entrée n-1<br/>hash = H(données + hash n-2)"]
    E2["Entrée n<br/>hash = H(données + hash n-1)"]
    E3["Entrée n+1<br/>hash = H(données + hash n)"]
    CP["Audit_Checkpoint<br/>(ancrage périodique)"]

    E1 --> E2 --> E3
    E3 -.-> CP

    JOB["Job planifié<br/>auditChainVerify"] -->|"re-calcule et compare<br/>toute la chaîne"| E1
```

- **WORM** (Write Once, Read Many) : aucune route de modification ou suppression
  n'existe sur `Audit_Log`.
- Le module `auditIntegrity` expose la vérification à la demande et l'exécute
  périodiquement ; toute rupture de chaîne lève une alerte.

## 6. Multi-tenancy

Toutes les données métier portent un `organization_id`. Le modèle est **partagé
par schéma** (une base, filtrage par organisation) :

1. Better-Auth fournit `activeOrganizationId` dans la session.
2. Les gardes de module (`verifyBatchAccess`, `verifyReceiptAccess`,
   `verifyAlertAccess`, …) rejettent en 403/404 tout accès hors organisation.
3. Chaque requête Prisma des services inclut `organization_id` dans son `where` —
   même si la garde a déjà filtré (défense en profondeur).
4. Les imports/exports connecteurs sont cloisonnés par la clé API, liée à une
   organisation unique.

## 7. Décisions structurantes (résumé pour la soutenance)

| Décision | Motivation |
|---|---|
| Monolithe modulaire, pas de microservices | Transactions ACID sur les flux critiques ; équipe de 1 ; frontières extractibles plus tard |
| Hexagonal par module | Cœur métier testable sans HTTP ni base ; 375 tests rapides |
| Prisma + migrations versionnées | Schéma tracé en Git, reproductible (fini `db push`) |
| Better-Auth + clé API via `mixedAuth` | Humains et machines sur le même pipeline de sécurité |
| VineJS aux frontières, messages FR | Erreurs exploitables par le front, cœur métier typé strict (zéro `any`) |
| Audit hash-chain en transaction | Preuve d'intégrité opposable, sans infrastructure dédiée |
| GS1/EPCIS natifs (pas de plugin) | Maîtrise fine des règles (URN sans check digit, AI(10) ≤ 20 car.) |
