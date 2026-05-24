# 🚩 Passation : Module Traçabilité & Rappels (NutriChain)

**Date :** 24 Mai 2026
**Statut de la branche :** 90% Opérationnelle (Cœur métier validé).

---

## ✅ RÉALISATIONS DE LA SESSION
- **Transformations (Généalogie)** : Implémentation complète du cycle de production.
    - `TransformationService` : Création de lots enfants avec consommation de lots parents (Transaction Prisma).
    - Validation stricte : Blocage si lot parent périmé, en `ALERTE` ou `NON_CONFORME`.
    - Typage : 0 `any`, utilisation de `ValidatedTransformation`.
- **Moteur de Recherche récursive** :
    - `GenealogyService` : Algorithmes `getUpstream` (remontée aux origines) et `getDownstream` (identification des impacts).
- **Système de Rappel (Recall)** :
    - `RecallService` : Blocage atomique d'un lot et de toute sa descendance en une transaction.
    - Création automatique d'alertes de niveau `CRITIQUE`.

---

## 🚀 À FAIRE (PROCHAINE INSTANCE)

### 1. 🧪 Tests E2E Traçabilité (Priorité 1)
Créer le script `scripts/e2e-traceability-recall.ts` pour valider le flux complet :
- Créer des lots parents -> Créer une transformation -> Déclencher un rappel sur un parent -> Vérifier que l'enfant est bloqué.

### 2. 🚛 Impact Logistique (Recall Impact)
Élargir le service de rappel pour identifier les expéditions concernées :
- Lier `getDownstream()` avec la table `Liaison_Shipment`.
- Lister les `Shipment_ID` déjà partis pour prévenir les clients.

### 3. 🛡️ Tests d'intégration des Routes
Ajouter `src/modules/traceability/transformations/routes/recall.routes.test.ts` pour valider :
- Le middleware `requireOrgRole(['owner', 'admin'])` sur le endpoint de rappel.
- La gestion des erreurs 404 (lot inconnu) et 400 (raison manquante).

### 📊 4. Dashboard Traçabilité
Endpoint `GET /api/traceability/stats` pour le monitoring global des lots bloqués.

---

## 🛠️ CONVENTIONS À RESPECTER
- **Multi-tenancy** : TOUJOURS filtrer par `organization_id` ou `activeOrgId`. Ne jamais faire un `findUnique` sans vérifier l'appartenance à l'organisation (Standard NutriChain).
- **Validation** : Continuer d'utiliser `validateData` (VineJS) avec les messages d'erreurs en français.
- **Erreurs** : Utiliser `APIError` avec le format `{ status, error: [{ field, message }] }`.
- **Typage** : Interdiction du type `any`. Utiliser `unknown` ou des interfaces précises.

---

## 📂 RÉSUMÉ DES FICHIERS CLÉS
- `src/modules/traceability/transformations/services/genealogy.service.ts` (Moteur récursif).
- `src/modules/traceability/transformations/services/recall.service.ts` (Logique de blocage).
- `docs/12_RECALLS_SYSTEM.md` (Documentation technique).
