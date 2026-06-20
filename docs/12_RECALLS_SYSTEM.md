# Système de Rappel Produit (Recall & Genealogy)

Ce module implémente la capacité critique de NutriChain à identifier et bloquer des lots contaminés en un temps record.

## 🚀 Fonctionnalités Clés

1. **Traçabilité Bidirectionnelle** :
   - **Upstream (Ascendante)** : Remonter aux lots parents pour identifier la cause (ex: ingrédient contaminé).
   - **Downstream (Descendante)** : Identifier tous les lots enfants ayant utilisé un lot spécifique.
2. **Blocage en Cascade (Atomic Recall)** : Passages de tous les lots impactés en statut `ALERTE` via une seule transaction Prisma.
3. **Alertes Système** : Génération automatique d'un enregistrement dans la table `Alert` pour audit et notification.

## 🛠️ Endpoints API

### 1. Consulter la Généalogie
`GET /api/traceability/batches/:id/genealogy`
- **Rôles** : Owner, Admin, Member.
- **Retour** : Arbre complet des ancêtres et descendants.

### 2. Déclencher un Rappel
`POST /api/traceability/batches/:id/recall`
- **Rôles** : Owner, Admin.
- **Body** : `{ "reason": "Détection Listeria" }`
- **Action** :
  1. Bloque le lot source + toute sa descendance (statut `ALERTE`, version incrémentée).
  2. **Identifie les expéditions déjà parties** qui contiennent un de ces lots (Liaison_Shipment → Shipment → Customer).
  3. Crée une alerte système (`PRODUCT_RECALL`, niveau `CRITIQUE`).
  4. Log immuable dans `Audit_Log` (action `BATCH_RECALL_TRIGGERED`).

#### Structure de la réponse

```json
{
  "blockedBatchesCount": 12,
  "impactedBatchIds": ["uuid-source", "uuid-child-1", ...],
  "affectedShipments": [
    {
      "shipmentId": "uuid",
      "shipmentRef": "SHIP-20260520-007",
      "customerId": "uuid",
      "customerName": "Supermarché Central Paris 10e",
      "customerContact": "+33612345678",
      "customerAddress": "50 av Distribution, 75010 Paris",
      "dateEnvoi": "2026-05-20T10:00:00Z",
      "statutLivraison": "LIVRE",
      "transporteur": "Transports Nutri",
      "batchIds": ["uuid-source"]
    }
  ]
}
```

**Notification interne (automatique)** : dès qu'un rappel est déclenché, un email d'alerte est envoyé automatiquement aux membres `owner`/`admin` de l'organisation (équipe Qualité) via `notifyOrgAdmins`, en fire-and-forget après le commit de la transaction (n'affecte ni ne bloque le rappel). Objectif SMART n°5 « décision → notification < 15 min » couvert côté interne (mesuré en e2e).

**Notification client externe** : l'équipe Qualité utilise `affectedShipments` (renvoyé en HTTP) pour contacter chaque `customerContact` (email/SMS/téléphone). L'envoi automatique vers les clients externes reste différé en P3 — pour la v1, le frontend liste les contacts à joindre.

## 🛡️ Sécurité & Performance

- **Multi-tenancy** : L'algorithme de recherche récursive ET la query d'expéditions vérifient strictement l'`organization_id` (la requête `Liaison_Shipment.findMany` filtre via `expedition.organization_id` puisque Liaison_Shipment n'a pas d'`organization_id` direct).
- **Atomicité** : Tout (blocage lots + query expéditions + alerte + audit) est exécuté dans une `$transaction` Prisma Serializable — soit tout, soit rien.
- **Audit WORM** : `newValue` inclut `affectedShipmentsCount` + `shipmentRefs` (capés à 100 références pour éviter le bloat WORM sur rappel massif ; la liste complète reste dans la réponse HTTP).
- **PII protection** : si une `Liaison_Shipment` référence un `Customer` supprimé (drift référentiel), l'entrée est skippée silencieusement avec un `logger.warn` ne contenant QUE le `shipmentId` (jamais `contact_urgence` ni `adresse_livraison`).

## 🔍 Algorithme

L'algorithme utilise une recherche en largeur (BFS) avec un set de détection de cycles pour naviguer dans les relations `TransformationComposition` ↔ `Transformation`.
