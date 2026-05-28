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
- **Action** : Bloque le lot source + toute sa descendance de manière récursive.

## 🛡️ Sécurité & Performance

- **Multi-tenancy** : L'algorithme de recherche récursive vérifie strictement l'ID de l'organisation à chaque étape pour éviter toute fuite de données inter-sites.
- **Atomicité** : Le blocage est exécuté dans une `$transaction` Prisma pour garantir que soit tout le monde est bloqué, soit personne (en cas d'erreur).
- **Audit Log** : Chaque rappel est logué avec l'ID utilisateur et une alerte système est créée.

## 🔍 Algorithme

L'algorithme utilise une recherche en largeur (BFS) avec un set de détection de cycles pour naviguer dans les relations `TransformationComposition` ↔ `Transformation`.
