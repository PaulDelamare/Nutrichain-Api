# API — Service Traçabilité

Référence complète des endpoints du module **traçabilité** : catalogue (produits / lots),
transformations, généalogie, rappels et scan public B2C.

Tous les endpoints sont montés sous le préfixe **`/api`** et documentés dans Swagger
(`GET /api-docs`, tags **Traçabilité** et **Public**).

## Authentification

| Type de route | Auth requise |
|---------------|--------------|
| Catalogue, transformations, généalogie, rappel | Session Better Auth (`requireAuth` + `requireOrgRole`) |
| Events EPCIS | `mixedAuth` (session web **ou** clé API) |
| Scan public B2C | Aucune (rate-limit 100 req / 15 min / IP) |

## Format de réponse

Succès : `{ "status", "message", "data" }`. Erreur : `{ "status", "error": [...] }`.

---

## Vue d'ensemble

| Méthode | Chemin | Rôles | Description |
|---------|--------|-------|-------------|
| `GET` | `/api/traceability/products` | owner/admin/member | Catalogue produits |
| `GET` | `/api/traceability/batches` | owner/admin/member | Liste des lots (recherche `q`) |
| `POST` | `/api/traceability/transformations` | owner/admin/member | Enregistrer une transformation |
| `GET` | `/api/traceability/batches/:id/genealogy` | owner/admin/member | Généalogie amont + aval |
| `POST` | `/api/traceability/batches/:id/recall` | owner/admin | Déclencher un rappel (destructif) |
| `GET` | `/api/traceability/events` | owner/admin/member | Événements EPCIS (paginé) |
| `GET` | `/api/public/scan/:id` | public | Scan B2C anonymisé |

---

## 1. `GET /api/traceability/products`

Liste tous les produits du catalogue de l'organisation active.

**Réponse 200** : `data` = tableau de produits (`id`, `nom`, `code_gtin`, `categorie`,
`duree_conservation_defaut`, `seuil_alerte_stock`, `unite_reference`).

---

## 2. `GET /api/traceability/batches`

Liste les lots de l'organisation (max 100, triés par date de création décroissante).

**Query params** : `q?` — recherche insensible à la casse sur l'id du lot, le nom du produit
ou le statut.

**Réponse 200** : `data` = tableau de lots avec `produit`, `unite`, `user`.

---

## 3. `POST /api/traceability/transformations`

Consomme un ou plusieurs lots parents pour créer un lot enfant (produit fini/semi-fini).
Met à jour le stock et la généalogie dans une transaction.

**Body**

| Champ | Type | Contraintes |
|-------|------|-------------|
| `id_produit_fini` | string (uuid) | requis |
| `id_materiel` | string (uuid) | requis |
| `quantite_produite` | number | > 0, 2 décimales max |
| `unite_code` | enum | `KG`,`G`,`L`,`ML`,`UNIT`,`PALLET`,`BOX` |
| `date_peremption` | string (ISO) | optionnel |
| `note_technique` | object | optionnel |
| `inputs` | array | 1–50 éléments |
| `inputs[].id_lot_parent` | string (uuid) | requis |
| `inputs[].quantite_prelevee` | number | > 0 |
| `inputs[].unite` | enum | unités valides |
| `inputs[].lot_parent_epuise` | boolean | requis |

**Réponse 201** : `data` = `{ transformation_id, lot_enfant_id }`.

---

## 4. `GET /api/traceability/batches/:id/genealogy`

Renvoie la généalogie complète d'un lot, calculée via CTE récursive SQL. **Lecture seule,
non destructive** (vue plafonnée à 1000 lignes).

**Réponse 200**

```json
{
  "status": 200,
  "message": "Généalogie récupérée.",
  "data": {
    "batchId": "<uuid>",
    "upstream": [ /* lots parents/ancêtres */ ],
    "downstream": [ /* lots enfants/descendants */ ]
  }
}
```

> La branche **downstream** est utilisée par la page front « Simulation de rappel » pour
> estimer l'impact d'un rappel **sans rien bloquer**.

---

## 5. `POST /api/traceability/batches/:id/recall`

**Action destructive.** Bloque le lot source et tous ses descendants récursivement
(set-based, sans plafond) et identifie les expéditions clients impactées.
Réservé aux rôles **owner / admin**.

**Body** : `{ "reason": "Contamination listeria détectée" }` (obligatoire).

**Réponse 200**

```json
{
  "status": 200,
  "message": "Rappel produit exécuté avec succès. Tous les lots impactés sont bloqués.",
  "data": {
    "blockedBatchesCount": 5,
    "impactedBatchIds": ["..."],
    "affectedShipments": [ /* expéditions clients */ ],
    "depthSaturated": false
  }
}
```

**Erreurs** : `400` motif manquant · `401` non authentifié · `403` rôle insuffisant.

---

## 6. `GET /api/traceability/events`

Journal des événements EPCIS (réceptions/expéditions), paginé.

**Query params** : `page?` (≥ 1), `limit?` (1–500, défaut 20),
`event_type?` (`ObjectEvent`), `related_entity?` (`Receipt` | `Shipment`).

**Réponse 200** : `data.data[]` + `data.pagination`.

---

## 7. `GET /api/public/scan/:id` (B2C, public)

Route publique pour les consommateurs. `id` = UUID lot ou SSCC.

Seuls les lots `EXPEDIE` ou `ALERTE` sont exposés (sinon `404`). Le payload est **anonymisé**
(aucun `organization_id`, aucune donnée interne).

**Réponse 200** : `data.lot` (date de péremption, nom produit, GTIN, producteur, statut
sanitaire) + `data.trace` (nombre d'étapes, détails simplifiés).
