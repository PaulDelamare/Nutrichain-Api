# Routes API — Logistics (Receipts & Batches)

Copie/colle les exemples curl/JSON directement pour tester.
Remplace `<YOUR_API_KEY>` et `<BEARER_TOKEN>` le cas échéant.

---

## 1) Créer une réception — POST /api/logistics/receipts
But: créer `Receipt` + `Batch` dans une transaction atomique.

Headers:
- `Content-Type: application/json`
- `x-api-key: <YOUR_API_KEY>`

**Champs obligatoires** (7 champs):
- `id_fournisseur` (UUID du fournisseur)
- `shipment_id` (string — identifiant du lot de transport)
- `id_produit` (UUID du produit)
- `quantite_actuelle` (nombre positif — kg ou unité)
- `unite_code` (string — ex: "KG", "L")
- `statut_controle` (string — ex: "OK", "À_VÉRIFIER")
- `received_by` (UUID de l'utilisateur qui réceptionne)

Body (cas nominal — attendu 201):
```json
{
  "id_fournisseur": "123e4567-e89b-12d3-a456-426614174000",
  "shipment_id": "SHIP-20260517-0001",
  "id_produit": "123e4567-e89b-12d3-a456-426614174001",
  "quantite_actuelle": 100,
  "unite_code": "KG",
  "statut_controle": "OK",
  "received_by": "123e4567-e89b-12d3-a456-426614174099"
}
```

Curl:
```bash
curl -i -X POST http://localhost:3000/api/logistics/receipts \
  -H "Content-Type: application/json" \
  -H "x-api-key: <YOUR_API_KEY>" \
  -d '{"id_fournisseur":"123e4567-e89b-12d3-a456-426614174000","shipment_id":"SHIP-20260517-0001","id_produit":"123e4567-e89b-12d3-a456-426614174001","quantite_actuelle":100,"unite_code":"KG","statut_controle":"OK","received_by":"123e4567-e89b-12d3-a456-426614174099"}'
```

Réponse 201 (succès):
```json
{
  "status": 201,
  "message": "Réception confirmée",
  "data": {
    "message": "Réception enregistrée avec succès et Lot généré.",
    "receiptId": "57fad918-3aea-4c1a-a821-61b17a78adf0",
    "batchId": "b38b70a7-ed6e-4033-98b4-7d9e49fc9725"
  }
}
```

Autres réponses:
- 400: payload invalide (champ manquant / format UUID incorrect) — corps `{ status: 400, error: [ { field, message, rule } ] }`.
- 404: FK manquante (fournisseur/produit/user/unité introuvable) — corps `{ status: 404, error: [ { field, message } ] }`.

---

## 2) Validation manquante — POST /api/logistics/receipts (payload incomplet)
Body (manquant `quantite_actuelle` etc.) — attendu 400:
```json
{
  "id_fournisseur": "123e4567-e89b-12d3-a456-426614174000",
  "id_produit": "123e4567-e89b-12d3-a456-426614174001"
}
```

---

## 3) UUID invalide — POST /api/logistics/receipts (format UUID incorrect)
Body:
```json
{
  "id_fournisseur": "not-a-uuid",
  "shipment_id": "S1",
  "id_produit": "also-not-uuid",
  "quantite_actuelle": 10,
  "unite_code": "KG",
  "statut_controle": "OK",
  "received_by": "not-a-uuid"
}
```

Réponse attendue: 400 + erreurs par champ.

---

## 4) Lire une réception — GET /api/logistics/receipts/:id
Curl:
```bash
curl -H "x-api-key: <YOUR_API_KEY>" http://localhost:3000/api/logistics/receipts/153c0ca6-6711-4dfb-9a84-97b8d484554b
```
Réponses attendues:
- 200: objet `Receipt` complet (avec `fournisseur` si peuplé).
- 404: non trouvé.

---

## 5) Lister les réceptions — GET /api/logistics/receipts
Support: filtres (supplier), date range, pagination (page, limit).

Headers:
- `x-api-key: <YOUR_API_KEY>`

Query params (tous optionnels):
- `page` (défaut: 1)
- `limit` (défaut: 20, max: 100)
- `supplierId` (UUID du fournisseur)
- `from` (ISO date, ex: 2026-05-17T00:00:00Z)
- `to` (ISO date, ex: 2026-05-17T23:59:59Z)

Exemples:
- Tous les reçus (pagination par défaut):
```bash
curl -H "x-api-key: <YOUR_API_KEY>" http://localhost:3000/api/logistics/receipts
```

- Par fournisseur:
```bash
curl -H "x-api-key: <YOUR_API_KEY>" "http://localhost:3000/api/logistics/receipts?supplierId=123e4567-e89b-12d3-a456-426614174000&page=1&limit=20"
```

- Par plage de date:
```bash
curl -H "x-api-key: <YOUR_API_KEY>" "http://localhost:3000/api/logistics/receipts?from=2026-05-17T00:00:00Z&to=2026-05-17T23:59:59Z"
```

Réponse 200 (succès):
```json
{
  "status": 200,
  "message": "Réceptions récupérées",
  "data": {
    "data": [
      {
        "id": "57fad918-3aea-4c1a-a821-61b17a78adf0",
        "id_fournisseur": "123e4567-e89b-12d3-a456-426614174000",
        "shipment_id": "SHIP-20260517-0001",
        "date_reception": "2026-05-17T16:33:45.581Z",
        "statut_controle": "OK",
        "received_by": "123e4567-e89b-12d3-a456-426614174099",
        "fournisseur": {
          "id": "123e4567-e89b-12d3-a456-426614174000",
          "nom_ferme": "Ferme Test",
          "adresse_siege": "Adresse Test"
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "totalPages": 1
    }
  }
}
```

---

## 6) Statistiques quotidiennes — GET /api/logistics/receipts/stats
Curl:
```bash
curl -H "x-api-key: <YOUR_API_KEY>" http://localhost:3000/api/logistics/receipts/stats
```

Réponse 200 (succès):
```json
{
  "status": 200,
  "message": "Statistiques récupérées",
  "data": {
    "total_receipts_today": 1,
    "total_quantity_kg": 0
  }
}
```

---

## 7) Lire un lot — GET /api/logistics/batches/:id
Curl (avec ID valide):
```bash
curl -H "x-api-key: <YOUR_API_KEY>" http://localhost:3000/api/logistics/batches/b38b70a7-ed6e-4033-98b4-7d9e49fc9725
```

Réponse 200 (succès):
```json
{
  "status": 200,
  "message": "Lot récupéré",
  "data": {
    "id": "b38b70a7-ed6e-4033-98b4-7d9e49fc9725",
    "id_produit": "123e4567-e89b-12d3-a456-426614174001",
    "quantite_actuelle": 100,
    "quantite_base": 100,
    "unite_code": "KG",
    "statut": "EN_STOCK",
    "created_by": "123e4567-e89b-12d3-a456-426614174099",
    "produit": {
      "id": "123e4567-e89b-12d3-a456-426614174001",
      "nom": "Produit Test"
    }
  }
}
```

Réponse 404 (lot inexistant):
```json
{
  "status": 404,
  "error": [
    {
      "field": "id",
      "message": "Lot introuvable"
    }
  ]
}
```

---

## 8) Scénarios d'erreur & sécurité
- Appel sans `x-api-key` → 401. Test: enlever l'en-tête et vérifier le message d'erreur.
- Mauvaise clé → 401.
- Violation de contrainte unique (ex: `shipment_id` réutilisé) → 400 + message Prisma converti.

---

## 9) Conseils pour copier-coller
- Remplace `<YOUR_API_KEY>` par ta clé.
- Utilise `jq` pour formater les réponses JSON dans les scripts.
- Pour tests simultanés, conserve des `shipment_id` uniques (timestamp ou uuid).
- Bruno HTTP Client est compatible: importe ces curl directement ou tape l'URL + headers.

---

## ✅ Routes Testées & Validées
- ✅ POST /api/logistics/receipts (201 — création Receipt + Batch)
- ✅ GET /api/logistics/receipts (200 — liste paginée avec filtres)
- ✅ GET /api/logistics/receipts/:id (200 — détails d'une réception)
- ✅ GET /api/logistics/receipts/stats (200 — statistiques journalières)
- ✅ GET /api/logistics/batches/:id (200 — détails d'un lot avec produit inclus)

---

## � Workflow de Test Complet

### Étape 1: Créer une réception
```bash
curl -i -X POST http://localhost:3000/api/logistics/receipts \
  -H "Content-Type: application/json" \
  -H "x-api-key: <YOUR_API_KEY>" \
  -d '{"id_fournisseur":"123e4567-e89b-12d3-a456-426614174000","shipment_id":"SHIP-20260517-TEST-001","id_produit":"123e4567-e89b-12d3-a456-426614174001","quantite_actuelle":500,"unite_code":"KG","statut_controle":"OK","received_by":"123e4567-e89b-12d3-a456-426614174099"}'
```
→ Récupère le `batchId` dans la réponse (ex: `b442cef5-a1f3-4dd4-baee-aa067e6997e5`)

### Étape 2: Tester GET batch avec l'ID reçu
```bash
curl -H "x-api-key: <YOUR_API_KEY>" http://localhost:3000/api/logistics/batches/b442cef5-a1f3-4dd4-baee-aa067e6997e5
```

Réponse attendue: 200 + détails complets du Batch avec `produit` inclus ✓

---

## 🟡 Autres Scénarios à Tester

1. **Erreurs 401 (sans x-api-key)**
   - Test: Appel GET /api/logistics/receipts sans header `x-api-key`
   - Attendu: 401 + message d'erreur

2. **Erreurs 404 (ressource inexistante)**
   - GET /api/logistics/receipts/:id avec mauvais UUID
   - GET /api/logistics/batches/:id avec mauvais UUID
   - Attendu: 404 + message "Réception introuvable" ou "Lot introuvable"

3. **Violations de contraintes uniques**
   - POST /api/logistics/receipts avec `shipment_id` déjà existant (test 2x le même SHIP-...)
   - Attendu: 400 + message Prisma converti

4. **Paramètres de pagination invalides**
   - GET /api/logistics/receipts?page=abc&limit=xyz
   - Attendu: 400 (NaN) ou comportement gracieux

---

Si tu veux, je peux générer une collection Postman/OpenAPI de ces routes automatiquement.
