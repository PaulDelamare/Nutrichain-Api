# API — Service Lots (Logistique)

Référence complète des endpoints liés au cycle de vie d'un **lot** (`Batch`) : réception,
expédition, consultation, étiquetage et levée de quarantaine.

Tous les endpoints sont montés sous le préfixe **`/api`** et documentés dans Swagger
(`GET /api-docs`, tag **Logistique**). Ce document sert de référence rapide et de complément
au guide de test curl `logistics-api-endpoints.md`.

## Authentification

Les routes logistiques acceptent **deux modes** (middleware `mixedAuth`) :

| Mode | En-tête | Usage |
|------|---------|-------|
| Session web | Cookie Better Auth | Front SvelteKit (rôles org + rôles logistiques) |
| Clé API (M2M) | `x-api-key: <clé>` | IoT, scripts, intégrations |

L'organisation active est résolue côté serveur (jamais via un en-tête client).

## Format de réponse

Succès : `{ "status", "message", "data" }` (via `sendSuccess`).
Erreur : `{ "status", "error": [{ "field", "message", "rule?" }] }`.

---

## Vue d'ensemble

| Méthode | Chemin | Rôles | Description |
|---------|--------|-------|-------------|
| `POST` | `/api/logistics/receipts` | operator+ | Créer une réception + le lot |
| `GET` | `/api/logistics/receipts` | viewer+ | Lister les réceptions (paginé) |
| `GET` | `/api/logistics/receipts/stats` | admin/owner | Statistiques du jour |
| `GET` | `/api/logistics/receipts/:id` | viewer+ | Détail d'une réception |
| `POST` | `/api/logistics/shipments` | operator+ | Expédier des lots |
| `GET` | `/api/logistics/batches/:id` | org + logistiques | Détail d'un lot |
| `GET` | `/api/logistics/batches/:id/label` | org + logistiques | Étiquette QR (PNG) |
| `POST` | `/api/logistics/batches/:id/release` | QA/admin/owner | Lever la quarantaine |

---

## 1. `POST /api/logistics/receipts`

Crée une `Receipt` et le `Batch` associé dans une transaction atomique.

**Body**

| Champ | Type | Contraintes |
|-------|------|-------------|
| `id_fournisseur` | string (uuid) | requis |
| `shipment_id` | string | 3–100 caractères |
| `id_produit` | string (uuid) | requis |
| `quantite_actuelle` | number | > 0 |
| `unite_code` | string | max 10 |
| `statut_controle` | string | `OK` \| `ALERTE` \| `NONCONFORME` \| `CONFORME` |
| `received_by` | string (uuid) | surchargé par la session web |

**Réponse 201**

```json
{
  "status": 201,
  "message": "Réception confirmée et Lot généré",
  "data": {
    "message": "Réception enregistrée avec succès et Lot généré.",
    "receiptId": "<uuid>",
    "batchId": "<uuid>"
  }
}
```

**Erreurs** : `400` payload invalide · `401` non authentifié · `403` rôle insuffisant ·
`404` référence liée introuvable.

---

## 2. `GET /api/logistics/receipts`

Liste paginée et filtrable des réceptions.

**Query params** (optionnels) : `page` (défaut 1), `limit` (défaut 20, max 100),
`supplierId` (uuid), `from` (ISO date-time), `to` (ISO date-time).

**Réponse 200** : `data.data[]` (réceptions) + `data.pagination` (`page`, `limit`, `total`, `totalPages`).

---

## 3. `GET /api/logistics/receipts/stats`

Statistiques journalières. Réservé aux rôles **admin/owner**.

**Réponse 200**

```json
{
  "status": 200,
  "message": "Statistiques récupérées",
  "data": { "total_receipts_today": 1, "total_quantity_kg": 0 }
}
```

---

## 4. `GET /api/logistics/receipts/:id`

Détail d'une réception (avec le fournisseur si peuplé). `404` si introuvable dans l'org active.

---

## 5. `POST /api/logistics/shipments`

Crée une expédition à partir d'un ou plusieurs lots et décrémente leur stock.

**Body**

| Champ | Type | Contraintes |
|-------|------|-------------|
| `id_client` | string (uuid) | requis |
| `shipment_id` | string | requis |
| `transporteur` | string | requis |
| `destination_adresse` | string | requis |
| `created_by` | string (uuid) | fallback M2M |
| `lots` | array | min 1 élément |
| `lots[].id_lot` | string (uuid) | requis |
| `lots[].quantite_expediee` | number | > 0 |

**Réponse 201** : `data.shipment` (objet `Shipment`).
**Erreurs** : `400` stock insuffisant / payload invalide · `404` client ou lot introuvable.

---

## 6. `GET /api/logistics/batches/:id`

Détail d'un lot avec ses relations : `produit`, `unite`, `user`, `materiel.lieu`, et les
10 derniers `mouvements`. `404` si le lot n'appartient pas à l'organisation active (isolation tenant).

---

## 7. `GET /api/logistics/batches/:id/label`

Génère l'étiquette **QR Code GS1 Digital Link** du lot.

> Renvoie une **image `image/png`**, pas du JSON.
> En-têtes : `Content-Type: image/png`, `Cache-Control: public, max-age=31536000, immutable`.

**Erreurs** : `400` produit sans GTIN · `404` lot introuvable.

---

## 8. `POST /api/logistics/batches/:id/release`

Lève la quarantaine d'un lot (`BLOQUE` → `EN_STOCK`). Décision qualité réservée aux rôles
**QA / admin / owner**.

**Body** : `{ "motif": "Nouveau contrôle conforme" }` (3–500 caractères).

**Erreurs** : `404` lot introuvable · `409` lot pas en quarantaine.

---

## Endpoint connexe

| Méthode | Chemin | Module | Description |
|---------|--------|--------|-------------|
| `GET` | `/api/traceability/batches` | Catalog | Liste des lots de l'org (voir `api-tracabilite-endpoints.md`) |
| `GET` | `/api/organization/quarantine-batches` | Organization | Lots en quarantaine (tableau de bord) |
