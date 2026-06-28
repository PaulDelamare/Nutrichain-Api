# 14 — Sync Mobile Offline-First (Bulk Endpoint)

> **Objectif SMART n°4** : Expérience mobile offline et résiliente (cible 10/06/2026)
> **Statut** : MVP livré sur la branche `feat/mobile-sync-bulk`, durci après revue multi-agent.

## 1. Contexte

L'application mobile React Native fonctionne en mode **offline-first** : dans une usine sans réseau (zones froides, métallurgie, cages de Faraday), les scans des opérateurs sont stockés localement en SQLite, puis synchronisés en bulk dès le retour connecté.

Cet endpoint :
- accepte un lot d'opérations (jusqu'à 100 à la fois),
- garantit l'**absence de doublons** sur retry réseau via `clientOpId` (idempotency),
- reporte **un statut par item** (offline-first → le mobile retire de sa file les ops OK et retente seulement les KO),
- exécute chaque item dans une **transaction atomique** (idempotency + opération métier + audit WORM tout ou rien).

## 2. Périmètre v1

| Opération | Inclus v1 | Note |
|---|:---:|---|
| Réception (`receipt`) | ✅ | Crée `Receipt` + `Batch` via `receiptService.createReceipt` (transaction imbriquée) |
| Transformation | ❌ | Différé (P3) — voir §11 |
| Expédition | ❌ | Différé (P3) |
| Quality scan | ❌ | Différé (P3) |

Le champ `type` est un enum extensible : ajouter `'transformation'` cassera la compilation TypeScript tant que son handler n'est pas câblé (assertion `never` dans `runOperation`).

## 3. Contrat API

### `POST /api/sync/scans`

**Auth** : `mixedAuth([owner, admin, logistics_operator, logistics_admin, logistics_owner])` — accepte cookie HttpOnly (web), Bearer Token (mobile session) ou `x-api-key` (M2M).

**Headers** :
- `Content-Type: application/json`
- `Authorization: Bearer <token>` *(ou)* `x-api-key: <key>`

**Body** :
```json
{
  "items": [
    {
      "clientOpId": "550e8400-e29b-41d4-a716-446655440000",
      "type": "receipt",
      "payload": {
        "id_fournisseur": "uuid",
        "shipment_id": "SHIP-20260528-001",
        "id_produit": "uuid",
        "quantite_actuelle": 100,
        "unite_code": "KG",
        "statut_controle": "OK"
      }
    }
  ],
  "actorUserId": "uuid-de-l-operateur"
}
```

**Contraintes payload** (VineJS, Fail Fast) :
- `items` : array, min 1, **max 100** (DoS guard + objectif latence < 500 ms / 50 items)
- `items[*].clientOpId` : UUID v4 (généré par le mobile, identique sur retry)
- `items[*].type` : enum `['receipt']`
- `items[*].payload` : mêmes contraintes que `validateReceiptParams`. `received_by` n'est **jamais lu du payload** : il est forcé serveur-side par le service.
- `actorUserId` : UUID, **optionnel en session, requis en M2M**. En session, ignoré. En M2M, le service vérifie que l'utilisateur cible est membre de l'org bound **avec un rôle ∈ `SYNC_WRITE_ROLES`** (anti privilege escalation).

### Réponse 207 Multi-Status

```json
{
  "status": 207,
  "message": "Sync traité",
  "data": {
    "results": [
      {
        "clientOpId": "550e8400-...",
        "status": "ok",
        "serverId": { "receiptId": "uuid", "batchId": "uuid" }
      },
      {
        "clientOpId": "660f9511-...",
        "status": "error",
        "error": { "field": "id_fournisseur", "message": "Fournisseur introuvable ou accès refusé" }
      },
      {
        "clientOpId": "770a0622-...",
        "status": "conflict",
        "error": { "field": "clientOpId", "message": "Idempotency conflict — payload diverged" }
      }
    ],
    "summary": { "total": 3, "ok": 1, "error": 1, "conflict": 1 }
  }
}
```

**Statuts par item** :
- `ok` : opération créée avec succès (ou rejouée à l'identique depuis le cache d'idempotency)
- `error` : échec — le champ `error.field` indique la nature :
  - `error.field` = nom métier (`id_fournisseur`, `id_produit`, etc.) → **erreur permanente** (FK inexistante, validation). Le mobile doit ne PAS retenter, marquer l'op comme rejetée et alerter l'utilisateur.
  - `error.field` = `'internal'` → **erreur transitoire serveur** (audit DB down, etc.). Le mobile DOIT retenter avec backoff exponentiel (typiquement 30s → 1min → 5min, plafond 30min) — la cause sera résolue côté infra, pas côté payload.
- `conflict` : même `clientOpId` rejoué avec un `payload` divergent — bug client à investiguer

**Codes globaux** :
- `207` : toujours (même si tous les items sont en erreur — la requête HTTP elle-même est valide)
- `400` : payload globalement invalide ou `actorUserId` manquant en M2M
- `401` : non authentifié
- `403` : rôle insuffisant ou `actorUserId` non membre (M2M)
- `500` : erreur serveur

## 4. Workflow mobile attendu

```
1. Scan offline → mobile génère un clientOpId UUID v4, sauve l'op dans SQLite avec status=PENDING
2. Retour connecté → mobile bundle 1..100 ops PENDING en bulk
3. POST /api/sync/scans
4. Pour chaque résultat :
   - status='ok'                       → mobile passe l'op à SYNCED, stocke serverId
   - status='conflict'                 → mobile alerte l'opérateur (incohérence locale) et marque CONFLICT
   - status='error' & field='internal' → erreur transitoire serveur, retry avec backoff exponentiel
   - status='error' & autre field      → erreur permanente, marquer REJECTED et alerter l'opérateur
5. Boucle tant qu'il reste des PENDING (sans retry-tempête sur 'internal')
```

**Important** : le mobile **ne doit jamais régénérer un clientOpId** sur retry — c'est la clé qui garantit l'idempotency.

## 5. Idempotency atomique

Table `IdempotencyKey` (Postgres, TTL 7j) :
- Unicité `(organization_id, client_op_id)` — pas de collision cross-tenant
- `request_hash` : SHA256 du payload normalisé (clés triées récursivement)
- `response_status` : `'pending'` (placeholder pendant l'exécution) → `'ok'` après finalisation
- `response_payload` : le résultat à rejouer

**Flux atomique** (toute la séquence dans une transaction Serializable) :
1. `findUnique` sur `(org_id, client_op_id)` :
   - **Trouvé même hash** → renvoie `response_payload` sans réexécuter
   - **Trouvé hash divergent** → throw `APIError(409)` → `'conflict'`
   - **Non trouvé** → étape 2
2. `create` placeholder (`response_status: 'pending'`)
3. `receiptService.createReceipt(payload, tx)` — réutilise la même transaction
4. `update` placeholder → `response_status: 'ok'` + `response_payload: <serverId>`
5. `auditService.logAction(..., tx)` — WORM hash chain

Si l'étape 3, 4 ou 5 échoue, **toute la transaction rollback** : la clé d'idempotency n'est pas créée, aucun receipt n'est commité, aucun audit n'est écrit. Le mobile peut retenter sans crainte de doublon.

Cron `cleanupIdempotencyKeys.job` purge à 3h chaque jour les entrées `expires_at < now()`.

## 6. Sécurité

- **`received_by` override** : le service force `req.auth.user.id` en session ou `actorUserId` en M2M ; le payload `received_by` n'existe pas dans le schéma VineJS (ignoré silencieusement par Vine).
- **Isolation multi-tenant** : toutes les FK (`id_fournisseur`, `id_produit`) sont filtrées par `organization_id` dans `receiptService`. Un item référençant une FK d'une autre org tombe en `status: 'error'`.
- **M2M role check** : `actorUserId` doit pointer vers un membre de l'org bound **avec un rôle dans `SYNC_WRITE_ROLES`**. Empêche une clé API d'usurper un VIEWER pour écrire.
- **Hash divergence = conflict** : détecte un mobile compromis ou un bug client qui rejouerait un clientOpId avec un payload modifié.
- **VineJS Fail Fast** : structure validée avant toute interaction DB.
- **Audit trail WORM atomique** : impossible d'avoir un Receipt sans son audit (transaction unique).

## 7. Limites

| Limite | Valeur | Raison |
|---|---|---|
| Items max par requête | 100 | DoS guard + latence < 500 ms |
| TTL IdempotencyKey | 7 jours | Compromis robustesse retry / volume DB |
| Types d'opération v1 | `receipt` uniquement | Petites PR — voir §11 |
| Isolation transactionnelle | Serializable | Atomicité forte (idempotency + receipt + audit) |
| Timeout transaction | 30 s | Tolère les pics DB sans planter |

## 8. Exemples curl

### Succès simple (M2M)
```bash
curl -X POST http://localhost:3000/api/sync/scans \
  -H "Content-Type: application/json" \
  -H "x-api-key: <YOUR_API_KEY>" \
  -d '{
    "items": [
      {
        "clientOpId": "550e8400-e29b-41d4-a716-446655440000",
        "type": "receipt",
        "payload": {
          "id_fournisseur": "<supplier_uuid>",
          "shipment_id": "SHIP-20260528-001",
          "id_produit": "<product_uuid>",
          "quantite_actuelle": 100,
          "unite_code": "KG",
          "statut_controle": "OK"
        }
      }
    ],
    "actorUserId": "<user_uuid_of_an_org_member_with_write_role>"
  }'
```

### Replay (rejouer la même requête)
Renvoie le même `serverId` sans recréer en base (la clé d'idempotency match exactement).

### Conflit
Modifier `quantite_actuelle: 999` et garder le même `clientOpId` → l'item passe en `status: 'conflict'`.

## 9. Tests

Couverture (Vitest + Supertest, tous co-localisés) :
- `idempotency.service.test.ts` — hashing canonical (5 cas)
- `syncScans.service.test.ts` — résolution actor session/M2M, role check, processItem atomique, replay, conflict, partial success, audit rollback, anti-usurpation (~12 cas)
- `validateSyncScans.middleware.test.ts` — toutes les contraintes VineJS + boundary 100 items (~10 cas)
- `sync.routes.test.ts` — session, M2M positif, M2M rejet, validation, mix success/error (~7 cas)

Lancement : `npm run unit:test`

## 10. E2E end-to-end

`scripts/e2e-mobile-sync.ts` valide 5 scénarios en conditions réelles : happy path, idempotency replay (vérifie DB), hash divergence, partial success, audit WORM trail.

```bash
# Pré-requis : API démarrée, migration + seed appliqués, .env complet (API_KEY_ORG_ID renseigné)
npm run e2e:sync
```

## 11. Hors scope — Dette P3 (post-merge)

Ces items sont volontairement reportés ; ils ne bloquent pas l'objectif 10/06/2026 mais doivent être pris dans une PR ultérieure.

### Évolutions fonctionnelles
- **Endpoint de réconciliation post-conflit** — `GET /api/sync/scans/:clientOpId` pour permettre au mobile de récupérer le `serverId` d'un op en conflit et résoudre côté UX.
- **Code d'erreur enum machine-parseable** — actuellement les clients parsent `error.field` qui est human-readable. Ajouter `error.code: 'FK_NOT_FOUND' | 'VALIDATION' | 'IDEMPOTENCY_CONFLICT' | 'ROLE_INSUFFICIENT' | 'INTERNAL'`.
- **Versioning `serverId` polymorphe** — `serverId: { receiptId, batchId }` est typé pour receipt. Quand `transformation` arrive, transformer en discriminated union : `serverId: { kind: 'receipt', ... } | { kind: 'transformation', ... }`.
- **Rate limit signaling** — documenter `429 Retry-After` et un code "batch too large" distinct de la validation 400 pour permettre au mobile d'auto-splitter.
- **Quota IdempotencyKey par org** — protection contre le bloat de table si la clé API est compromise.
- **Sync transformations / expéditions / quality scans** — étendre le `type` enum (voir [[10_PLAN_SHIPMENTS]] pour shipments).
- **Webhook de notification de fin de sync** — actuellement le mobile poll les résultats.

### Pièges connus et limites techniques

- **Latent nested-transaction trap sur `receiptService.createReceipt`** — Le service accepte un `externalTx` optionnel ; si fourni, il l'utilise sans ouvrir une nouvelle transaction. Tout futur appelant DOIT continuer à passer ce `tx` quand il est lui-même déjà dans une transaction Serializable, sinon deadlock ou perte d'atomicité. Mitigation envisagée : forcer `tx` non-optionnel + ajouter un `createReceiptStandalone()` thin wrapper.
- **Sequential await loop** — `syncScansService.syncScans` itère séquentiellement sur les items (chaque item ouvre sa propre transaction Serializable). À 100 items, ça peut dépasser le SLA 500 ms sur DB chargée. Benchmark requis avant d'envisager une exécution parallèle bornée (`p-limit ~5`). Risque : conflits Serializable plus fréquents en parallèle.
- **`actorUserId` accepté silencieusement en session** — VineJS ne strictement-rejette pas un `actorUserId` présent quand `sessionUserId` est défini ; le service le drop. Pas exploitable mais peut masquer un bug client. Envisager un fail-loud (400) pour aider au débogage.
- **`as unknown as` pour Prisma JSON** — `response_payload as unknown as Prisma.InputJsonValue` côté write + `as unknown as SyncItemResult` côté read. Sans helper natif `Prisma.JsonObject` strict, ces casts restent acceptables sous condition de validation runtime à terme.

## 12. Référence schéma Prisma

```prisma
model IdempotencyKey {
  id               String       @id @default(uuid())
  organization_id  String
  organization     Organization @relation(fields: [organization_id], references: [id], onDelete: Cascade)
  client_op_id     String
  user_id          String
  user             User         @relation(fields: [user_id], references: [id])
  request_hash     String       @db.Char(64)
  response_status  String       // 'pending' | 'ok'
  response_payload Json
  created_at       DateTime     @default(now())
  expires_at       DateTime

  @@unique([organization_id, client_op_id])
  @@index([organization_id])
  @@index([expires_at])
}
```

---

*Branche : `feat/mobile-sync-bulk`. Doc mise à jour le 2026-05-28 après revue multi-agent (4 reviewers, 7 fixes appliqués).*
