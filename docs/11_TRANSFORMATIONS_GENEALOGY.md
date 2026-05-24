# Module Traçabilité : Transformations et Généalogie

## 🧬 Concept
Le module `Transformations` gère le cycle de vie de la transformation industrielle au sein de Nutrichain. Il permet de lier des lots d'entrée (ingrédients/matières premières) à un lot de sortie (produit fini ou semi-fini).

C'est le cœur de la **généalogie ascendante et descendante**.

## 🛠️ Spécifications Techniques

### 1. Endpoint : Enregistrement d'une Transformation
`POST /api/traceability/transformations`

**Validation (VineJS) :**
- `id_produit_fini` : UUID (Produit qui sera créé)
- `id_materiel` : UUID (Machine ou Cuve utilisée)
- `quantite_produite` : Nombre positif (Quantité du lot enfant)
- `unite_code` : Code unité (KG, L, etc.)
- `inputs` : Tableau d'objets (Composants consommés)
    - `id_lot_parent` : UUID
    - `quantite_prelevee` : Nombre positif
    - `lot_parent_epuise` : Booléen (Si true, le lot parent passe en statut `EPUISE`)

### 2. Règles Métier (Service)
- **Isolation Multi-tenant** : Le service vérifie que l'utilisateur et TOUS les lots (parents et enfant) appartiennent à la même organisation.
- **Validation Qualité** :
    - Bloque si un lot parent est **périmé**.
    - Bloque si un lot parent est en statut **NON_CONFORME** ou **ALERTE**.
- **Atomicité** : Utilisation de `$transaction` Prisma pour garantir que :
    1. Le stock des parents est déduit.
    2. Le lot enfant est créé.
    3. La liaison de généalogie (`TransformationComposition`) est enregistrée.
    4. Les mouvements de stock sont audités dans `Batch_Mouvement`.

## 📦 Structure du Module
```
src/modules/traceability/transformations/
├── controllers/
│   ├── transformation.controller.ts
│   └── recall.controller.ts (Généalogie & Rappel)
├── middlewares/
│   └── validateTransformation.middleware.ts
├── services/
│   ├── transformation.service.ts
│   ├── genealogy.service.ts (Moteur récursif)
│   ├── recall.service.ts (Algorithme de blocage)
│   └── ...test.ts
└── routes/
    ├── transformation.routes.ts
    └── transformation.routes.test.ts
```

## 🔒 Sécurité
- Authentification requise (`requireAuth`).
- Rôles autorisés : `owner`, `admin`, `member`.
- Accès filtré par `activeOrgId`.
