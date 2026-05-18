# Matrice de Sécurité: Décisions d'Accès par Scénario

## 🎯 Vue d'Ensemble

Ce document trace les décisions de sécurité **exacts** pour chaque route et chaque scénario (B2B vs Web, admin vs operator, etc.).

---

## 1. POST /api/logistics/receipts (Créer une Réception)

### Flux B2B/M2M (Clé API)
```
Requête reçue
    ↓
checkApiKey() → Vérifie la clé API
    ↓
validateReceiptParams → Valide le schema VineJS
    ↓
createReceiptController
    ├─ Heuristique: !req.user → B2B
    ├─ received_by utilisé TEL QUE fourni dans le payload
    ├─ Transation Prisma: receipt + batch
    └─ Response: 201 Created
```

**Erreurs Possibles:**
- 400: Clé API manquante OU invalide
- 422: Payload invalide (VineJS)
- 404: Fournisseur/Produit/User introuvable
- 500: Erreur DB

**Points de Sécurité:**
- ✅ Clé API vérifiée
- ✅ Références FK existantes
- ✅ Données validées
- ❌ Pas de vérification d'organisation (flux B2B = confiance)

---

### Flux Web/Mobile (Better-Auth + Rôle)
```
Requête reçue
    ↓
checkApiKey() → SKIP ou FALLBACK
    ↓
requireLogisticsRole([OPERATOR, ADMIN]) → Vérifier auth + rôle
    ├─ Récupérer session Better-Auth
    ├─ Vérifier activeOrgId
    ├─ Récupérer rôle dans l'org
    ├─ Vérifier que rôle ∈ [OPERATOR, ADMIN]
    └─ Attacher req.activeOrgId, req.user
    ↓
validateReceiptParams → Valide schema VineJS
    ↓
createReceiptController
    ├─ Heuristique: req.user existe → Web
    ├─ Override: received_by = req.user.id (force l'utilisateur actuel)
    ├─ Transaction: receipt + batch
    └─ Response: 201 Created
```

**Erreurs Possibles:**
- 401: Pas authentifié (Better-Auth invalide)
- 400: Pas d'org active sélectionnée
- 403: Rôle insuffisant (nécessite OPERATOR+)
- 422: Payload invalide
- 404: Fournisseur/Produit introuvable
- 500: Erreur serveur

**Points de Sécurité:**
- ✅ Authentification obligatoire
- ✅ Rôle vérifié pour cette route
- ✅ received_by forcé (pas de spoofing)
- ✅ Organisation active obligatoire
- ✅ Données validées

---

## 2. GET /api/logistics/receipts (Lister)

### Flux B2B (Clé API)

```
checkApiKey()
    ↓
listReceiptsController
    ├─ Heuristique: !req.user → B2B
    ├─ Filtres: supplierId, date range, pagination
    ├─ NO filtre organisation (B2B = accès global)
    └─ Response: 200 OK + pagination
```

**Données Retournées:**
- Toutes les réceptions (aucun filtre org)
- Fournisseur complet
- Utilisateur (who received it)

**Points de Sécurité:**
- ✅ Clé API vérifiée
- ❌ Pas de filtre org (intentionnel: B2B = confiance)

---

### Flux Web (Better-Auth + Rôle)

```
requireLogisticsRole([VIEWER, OPERATOR, QA, ADMIN])
    ├─ Auth + rôle OK
    ├─ Attacher req.activeOrgId
    └─ next()
    ↓
listReceiptsController
    ├─ Heuristique: req.user existe → Web
    ├─ Récupérer filtrés par activeOrgId (via created_by)
    ├─ Filtres: supplierId, date range, pagination
    ├─ FILTRE ORG: Lister que receptions créées par users de l'org
    └─ Response: 200 OK + pagination
```

**Données Retournées:**
- Réceptions de l'org active UNIQUEMENT
- Fournisseur
- User (name, email, ID)

**Points de Sécurité:**
- ✅ Auth + rôle obligatoires
- ✅ Filtre organisation FORCÉ
- ✅ Pas de fuite de données cross-org
- ✅ VIEWER peut lire (read-only)

---

## 3. GET /api/logistics/receipts/stats (Statistiques)

### Flux B2B: ❌ FORBIDDEN

```
checkApiKey()
    ↓
Stats endpoint
    ├─ Vérifier que B2B (pas de req.user)
    ├─ Répondre: 403 Forbidden (ou 404 selon la politique)
    └─ Pas de stats exposées aux systèmes externes
```

**Raison:** Les stats administratives ne doivent pas être exposées aux partenaires (données sensibles d'audit).

---

### Flux Web: Admin UNIQUEMENT

```
requireLogisticsRole([ADMIN])
    ├─ Auth + rôle = ADMIN vérifié
    ├─ Attacher req.activeOrgId
    └─ next()
    ↓
getReceiptStatsController
    ├─ Récupérer activeOrgId
    ├─ Compter réceptions du jour (filtre org)
    ├─ Compter toutes réceptions (filtre org)
    ├─ Calculer quantité totale
    └─ Response: 200 OK
```

**Données Retournées:**
```json
{
  "total_receipts_today": 12,
  "total_quantity_kg": 5000,
  "total_receipts_all_time": 1520
}
```

**Points de Sécurité:**
- ✅ ADMIN UNIQUEMENT
- ✅ Filtre par org active
- ✅ Pas de données d'autres organisations
- ✅ Stats sensibles protégées

---

## 4. GET /api/logistics/receipts/:id (Consulter une Réception)

### Flux B2B (Clé API)

```
checkApiKey()
    ↓
getReceiptByIdController
    ├─ Récupérer receptionId depuis req.params.id
    ├─ Requête directe (pas de filtre org)
    └─ Response: 200 OK ou 404
```

**Points de Sécurité:**
- ✅ Clé API vérifiée
- ❌ Accès direct (pas de filtre org)

---

### Flux Web (Better-Auth + Rôle + Filtre Org)

```
requireLogisticsRole([VIEWER, OPERATOR, QA, ADMIN])
    ├─ Auth + rôle OK
    ├─ Attacher req.activeOrgId
    └─ next()
    ↓
verifyReceiptAccess
    ├─ Récupérer receipt par ID
    ├─ Vérifier que receipt existe
    ├─ Récupérer créateur du receipt (user)
    ├─ Vérifier que créateur ∈ org active
    ├─ SI non → Response: 404 (ne pas révéler existence)
    └─ SI oui → Attacher req.receipt, next()
    ↓
getReceiptByIdController
    ├─ Utiliser req.receipt (déjà vérifié)
    └─ Response: 200 OK
```

**Erreurs Possibles:**
- 401: Pas authentifié
- 400: Pas d'org active
- 403: Rôle insuffisant
- 404: Réception introuvable OU cross-org access (même code)

**Points de Sécurité:**
- ✅ Auth + rôle obligatoires
- ✅ Filtre organisation appliqué
- ✅ 404 générique (ne révèle pas motif)
- ✅ Pas de fuite de données cross-org

---

## 5. GET /api/logistics/batches/:id (Consulter un Lot)

### Flux B2B (Clé API)

```
checkApiKey()
    ↓
getBatchByIdController
    ├─ Récupérer batch par ID
    └─ Response: 200 OK ou 404
```

---

### Flux Web (Better-Auth + Rôle + Filtre Org)

```
requireLogisticsRole([VIEWER, OPERATOR, QA, ADMIN])
    ↓
verifyBatchAccess
    ├─ Récupérer batch par ID
    ├─ Vérifier créateur ∈ org active
    ├─ SI non → Response: 404
    └─ SI oui → Attacher req.batch, next()
    ↓
getBatchByIdController
    └─ Response: 200 OK
```

**Identique à receipts/:id, mais pour les lots.**

---

## 🎨 Tableau Résumé: Qui Peut Quoi?

| Route | B2B (Key) | VIEWER | OPERATOR | QA | ADMIN | Filtre Org |
|-------|-----------|--------|----------|-----|-------|-----------|
| POST /receipts | ✅ | ❌ | ✅ | ❌ | ✅ | N/A |
| GET /receipts | ✅ | ✅ | ✅ | ✅ | ✅ | B2B:Non, Web:Oui |
| GET /receipts/stats | ❌ | ❌ | ❌ | ❌ | ✅ | Oui |
| GET /receipts/:id | ✅ | ✅ | ✅ | ✅ | ✅ | B2B:Non, Web:Oui |
| GET /batches/:id | ✅ | ✅ | ✅ | ✅ | ✅ | B2B:Non, Web:Oui |

---

## 🔐 Principes de Sécurité Appliqués

### 1. Defense in Depth (Défense en Profondeur)
- Niveau 1: Authentification (Better-Auth OU API Key)
- Niveau 2: Autorisation (Rôle vérifié)
- Niveau 3: Données (Filtre organisation)
- Niveau 4: Validation (VineJS schema)

### 2. Least Privilege (Moindre Privilège)
- VIEWER: Lecture UNIQUEMENT (pas de CREATE)
- OPERATOR: CREATE + READ (pas de STATS)
- ADMIN: Tout + STATS

### 3. Zero Trust (Pas de Confiance par Défaut)
- Chaque requête doit prouver son identité
- Même les B2B (clé API = token)
- Même les admins (filtre org)

### 4. Separation of Duties (Séparation des Tâches)
- QA ne peut pas créer (juste tester)
- OPERATOR ne peut pas voir stats
- VIEWER ne peut pas créer

### 5. Fail Secure (Défaillance Sécurisée)
- Erreurs génériques (404, pas 403)
- Pas de stack traces en production
- Logs détaillés côté serveur

### 6. Defense Against OWASP Top 10
- A01: Broken Access Control ← Filtre org
- A03: Injection ← VineJS validation
- A04: Insecure Design ← RBAC + ABAC ready
- A06: Vulnerable Components ← Better-Auth official
- A07: Identification & Auth ← Bearer tokens + sessions

---

## 🧪 Cas de Test Critiques

### Test 1: Cross-Organization Attack
```
GIVEN: Utilisateur de l'org A
WHEN: Essayer d'accéder à une réception de l'org B
THEN: Response 404 (ne révèle pas l'existence)
```

### Test 2: Rôle Insuffisant
```
GIVEN: Utilisateur VIEWER
WHEN: Essayer POST /receipts
THEN: Response 401 (pas authentifié pour créer) ou 403 (rôle insuffisant)
```

### Test 3: Pas de Clé API
```
GIVEN: B2B → POST /receipts
WHEN: Sans header x-api-key
THEN: Response 400 ou 401
```

### Test 4: Token Expiré
```
GIVEN: Utilisateur Web avec ancien token
WHEN: Requête reçue
THEN: Response 401 (session expirée via Better-Auth)
```

### Test 5: Spoofing received_by
```
GIVEN: Utilisateur Web crée receptionWHEN: Payload inclut received_by d'un autre user
THEN: received_by overridé avec req.user.id (ignore le payload)
```

---

## 📊 Flux Décisionnel Global

```
Requête reçue
    ↓
[Header x-api-key?]
    ├─ OUI → Flux B2B
    │   ├─ checkApiKey()
    │   ├─ validateReceiptParams (si POST)
    │   └─ Accès DIRECT (pas de filtre org)
    │
    └─ NON → Flux Web
        ├─ requireLogisticsRole([...])
        │   ├─ Récupérer session Better-Auth
        │   ├─ Vérifier activeOrgId
        │   ├─ Extraire rôle
        │   └─ Vérifier rôle ∈ liste autorisée
        │
        ├─ verifyReceiptAccess (si GET /:id)
        │   └─ Filtre organisation
        │
        ├─ validateReceiptParams (si POST)
        │   └─ Schema VineJS
        │
        └─ Contrôleur
            ├─ received_by = req.user.id (override)
            ├─ activeOrgId = req.activeOrgId (filtre)
            └─ Response: 200/201/403/404/500
```

---

## 🔍 Checklist: Avant de Déployer en PROD

- [ ] Tous les middlewares tapés (pas de `any`)
- [ ] VineJS valide 100% des entrées
- [ ] Transactionalité Prisma (all-or-nothing)
- [ ] Filtres organisation appliqués à 100% des routes Web
- [ ] 404 générique pour les accès cross-org
- [ ] Messages d'erreur ne révèlent pas les rôles/permissions
- [ ] Logs d'accès refusé (pour détection d'attaques)
- [ ] Tests E2E couvrent B2B + Web + cross-org
- [ ] Code review sécurité (OWASP)
- [ ] Secrets (API keys) en variables d'environnement
- [ ] HTTPS en production
- [ ] Rate limiting activé
- [ ] Monitoring des tentatives d'accès refusées
