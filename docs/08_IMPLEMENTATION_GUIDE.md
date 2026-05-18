# Implémentation Sécurité Logistics - GUIDE D'INTÉGRATION

## 📦 Fichiers à Implémenter

### 1. Constantes (NEW)
✅ **Créé**: `src/modules/logistics/constants/logistics.constants.ts`
- Énumérations des rôles, permissions, statuts
- Matrice rôles ↔ routes

### 2. Middlewares de Sécurité (NEW)
✅ **Créé**: `src/modules/logistics/middlewares/requireLogisticsRole.middleware.ts`
- Vérifier le rôle logistics (flux Web/Mobile)
- Authentification via Better-Auth

✅ **Créé**: `src/modules/logistics/middlewares/verifyReceiptAccess.middleware.ts`
- Filtre d'accès par organisation pour réceptions

✅ **Créé**: `src/modules/logistics/middlewares/verifyBatchAccess.middleware.ts`
- Filtre d'accès par organisation pour lots

### 3. Validation (À MODIFIER)
📝 **À modifier**: `src/modules/logistics/receipts/middlewares/validateReceipt.middleware.ts`
- (Code complet dans le guide d'implémentation)

### 4. Service (À MODIFIER)
📝 **À modifier**: `src/modules/logistics/receipts/services/receipt.service.ts`
- Ajouter filtrage par organisation
- Supporter les types stricts

### 5. Contrôleur (À MODIFIER)
📝 **À modifier**: `src/modules/logistics/receipts/controllers/receipt.controller.ts`
- Override `received_by` en mode Web
- Passer `activeOrgId` au service

### 6. Routes (À REMPLACER)
📝 **À remplacer**: `src/modules/logistics/receipts/routes/receipt.routes.ts`
- Ajouter les middlewares de sécurité
- Documenter les cas d'usage

---

## 🔧 ÉTAPES D'IMPLÉMENTATION DÉTAILLÉES

### ÉTAPE 1: Copier les Fichiers NEW

Les 3 fichiers middleware et les constantes ont été créés directement.

**Vérifier que les fichiers existent:**
```bash
ls -la src/modules/logistics/constants/
ls -la src/modules/logistics/middlewares/
```

### ÉTAPE 2: Modifier `validateReceipt.middleware.ts`

**Fichier**: `src/modules/logistics/receipts/middlewares/validateReceipt.middleware.ts`

Remplacer le contenu par:

```typescript
import { Request, Response, NextFunction } from 'express';
import vine from '@vinejs/vine';

/**
 * Validation des données d'entrée pour une réception.
 * 
 * Appliqué AVANT le contrôleur (Fail Fast).
 * Les erreurs sont catchées par le errorHandler global.
 */
export const validateReceiptParams = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const schema = vine.object({
      id_fournisseur: vine.string().uuid(),
      shipment_id: vine.string().minLength(3).maxLength(100),
      id_produit: vine.string().uuid(),
      quantite_actuelle: vine.number().positive().decimal({ places: 2 }),
      unite_code: vine.string().maxLength(10),
      statut_controle: vine.enum(['OK', 'ALERTE', 'NONCONFORME']),
      received_by: vine.string().uuid(),
    });

    const validatedData = await schema.validate(req.body);
    (req as unknown as { validatedReceipt: typeof validatedData }).validatedReceipt =
      validatedData;

    next();
  } catch (error) {
    next(error);
  }
};
```

### ÉTAPE 3: Modifier `receipt.service.ts`

**Fichier**: `src/modules/logistics/receipts/services/receipt.service.ts`

Remplacer le contenu INTÉGRALEMENT par le code du guide (section 4️⃣).

**Points clés:**
- Ajouter les types `CreateReceiptInput` et `ListReceiptsFilters`
- Modifier `createReceipt()` pour typer correctement
- Modifier `listReceipts()` pour filtrer par `activeOrgId`
- Modifier `getReceiptStats()` pour prendre `activeOrgId` en paramètre

### ÉTAPE 4: Modifier `receipt.controller.ts`

**Fichier**: `src/modules/logistics/receipts/controllers/receipt.controller.ts`

Remplacer le contenu INTÉGRALEMENT par le code du guide (section 5️⃣).

**Points clés:**
- `createReceiptController`: Déterminer si c'est B2B ou Web, override `received_by`
- `listReceiptsController`: Passer `activeOrgId` au service
- `getReceiptStatsController`: Récupérer `activeOrgId` et le passer
- Tous les contrôleurs typés strictement (pas de `any`)

### ÉTAPE 5: Remplacer `receipt.routes.ts`

**Fichier**: `src/modules/logistics/receipts/routes/receipt.routes.ts`

Remplacer le contenu INTÉGRALEMENT par le code du guide (section 6️⃣).

**Points clés:**
- Importer les 3 nouveaux middlewares
- Importer les constantes (`LOGISTICS_ROLES`)
- `POST /receipts`: `checkApiKey() + validateReceiptParams`
- `GET /receipts/stats`: `requireLogisticsRole([LOGISTICS_ROLES.ADMIN])`
- Autres routes: Adapter pour B2B vs Web

---

## 🧪 TESTS DE VALIDATION

### Test 1: Flux B2B (Clé API)

```bash
API_KEY="YOUR_API_KEY"
curl -X POST http://localhost:3000/api/logistics/receipts \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "id_fournisseur": "123e4567-e89b-12d3-a456-426614174000",
    "shipment_id": "SHIP-2026-05-17-001",
    "id_produit": "123e4567-e89b-12d3-a456-426614174001",
    "quantite_actuelle": 500,
    "unite_code": "KG",
    "statut_controle": "OK",
    "received_by": "123e4567-e89b-12d3-a456-426614174099"
  }'

# Attendu: 201 Created avec receiptId et batchId
```

### Test 2: Flux Web - Opérateur Crée une Réception

```bash
TOKEN="YOUR_BETTER_AUTH_TOKEN"
curl -X POST http://localhost:3000/api/logistics/receipts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id_fournisseur": "123e4567-e89b-12d3-a456-426614174000",
    "shipment_id": "SHIP-2026-05-17-002",
    "id_produit": "123e4567-e89b-12d3-a456-426614174001",
    "quantite_actuelle": 300,
    "unite_code": "KG",
    "statut_controle": "OK",
    "received_by": "IGNORED"
  }'

# Attendu: 201 Created (received_by overridé)
```

### Test 3: Flux Web - Stats (Admin Only)

```bash
TOKEN="YOUR_BETTER_AUTH_ADMIN_TOKEN"
curl http://localhost:3000/api/logistics/receipts/stats \
  -H "Authorization: Bearer $TOKEN"

# Attendu: 200 OK avec statistiques
# Attendu si operator: 403 Forbidden
```

### Test 4: Pas d'Authentification (Flux Web)

```bash
curl http://localhost:3000/api/logistics/receipts/stats

# Attendu: 401 Unauthorized
```

### Test 5: Cross-Organization Attack

```bash
# Utiliser un token d'une autre org et essayer d'accéder à une réception
TOKEN="ANOTHER_ORG_TOKEN"
RECEIPT_ID="receipt-de-lautre-org"

curl http://localhost:3000/api/logistics/receipts/$RECEIPT_ID \
  -H "Authorization: Bearer $TOKEN"

# Attendu: 404 Not Found (ne pas révéler l'existence)
```

---

## 📊 Tableau de Récapitulatif des Routes

| Route | Méthode | Authentification | Rôle(s) Requis | Filtre Org |
|-------|---------|-----------------|-----------------|-----------|
| `/api/logistics/receipts` | POST | Clé API OU Auth | Operator+ (Web) | Non (B2B) |
| `/api/logistics/receipts` | GET | Clé API OU Auth | Viewer+ (Web) | Oui (Web) |
| `/api/logistics/receipts/stats` | GET | Auth UNIQUEMENT | Admin | Oui |
| `/api/logistics/receipts/:id` | GET | Clé API OU Auth | Viewer+ (Web) | Oui (Web) |
| `/api/logistics/batches/:id` | GET | Clé API OU Auth | Viewer+ (Web) | Oui (Web) |

---

## 🔒 Checklist de Sécurité

- [ ] Pas de `any` type dans le code
- [ ] Tous les rôles vérifiés via middleware
- [ ] Organisation filtrée pour toutes les routes Web
- [ ] 404 générique pour les erreurs d'accès cross-org
- [ ] Messages d'erreur ne révèlent pas les rôles requis
- [ ] VineJS valide TOUTES les entrées
- [ ] Les transactions Prisma sont atomiques
- [ ] Logs d'erreur en cas de tentative d'accès
- [ ] Tests couvrent les cas d'erreur

---

## 🚀 Prochaines Étapes

1. **Séparer les routes B2B et Web**
   ```typescript
   // B2B:
   router.post('/api/logistics/receipts', checkApiKey(), ...)
   
   // Web:
   router.post('/api/web/logistics/receipts', 
     requireLogisticsRole([...]), ...)
   ```

2. **Ajouter les rôles au schéma Prisma** (si besoin)
   ```prisma
   model Member {
     logisticsRole String? // logistics_admin, logistics_operator, etc.
   }
   ```

3. **Implémenter ABAC complète**
   - Permissions granulaires (LOT_RECEIVE, LOT_MOVE, etc.)
   - Conditions par lieu/usine

4. **Audit Trail (Audit_Log)**
   - Tracer TOUTES les opérations critique
   - WORM (Write Once, Read Many) pour immuabilité

5. **Tests E2E**
   - Vitest avec mocks Prisma
   - Tester cross-org rejection
   - Tester rôle insuffisant

---

## 📝 Questions Fréquentes

**Q: Pourquoi retourner 404 au lieu de 403 pour les accès cross-org?**
A: Pour ne pas révéler l'existence d'une ressource à un utilisateur non autorisé. Si on répond "403 Forbidden", cela signifie que la ressource existe. Un attaquant pourrait enumérer les IDs.

**Q: Comment faire passer reçu_by automatiquement en flux Web?**
A: Dans le contrôleur, vérifier si `req.user` existe (attaché par le middleware). Si oui, c'est du Web → override `received_by` avec `req.user.id`.

**Q: Peut-on mélanger B2B et Web sur la même route?**
A: Oui, mais c'est risqué. Le mieux est de créer deux routes séparées (`/api/logistics/...` pour B2B, `/api/web/logistics/...` pour Web).

**Q: Comment filtrer par organisation en flux B2B?**
A: On ne filtre pas. Les systèmes B2B (API Key) peuvent accéder à TOUTES les réceptions. C'est le choix métier.

---

## 📞 Support & Débogage

**Les tests ne passent pas?**

1. Vérifier que tous les imports sont corrects
   ```bash
   npm run build
   ```

2. Vérifier que `requireLogisticsRole` attache bien `req.activeOrgId`
   - Ajouter des logs: `console.log('activeOrgId:', req.activeOrgId)`

3. Vérifier que Better-Auth est configuré correctement
   - Lire: `src/modules/identity/auth.config.ts`

4. Vérifier que les rôles dans la base de données matchent les constantes
   ```sql
   SELECT DISTINCT role FROM member;
   ```

5. Exécuter les tests:
   ```bash
   npm run test src/modules/logistics/
   ```
