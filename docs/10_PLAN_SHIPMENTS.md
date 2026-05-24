# Nutrichain - Plan d'Implémentation : Module Expéditions (Shipments)

Ce document trace la feuille de route pour la Phase 2 de la logistique. L'objectif est de permettre l'expédition de lots (Batches) vers des clients ou d'autres centres de production.

## 🏁 Étape 1 : Squelette & Création d'Expédition
- **Tâche** : Créer l'entité `Shipment` dans la base de données.
- **Dossier** : `src/modules/logistics/shipments/`
- **Actions** :
    - [ ] Définir le validateur VineJS pour `CreateShipment`.
    - [ ] Créer `ShipmentService.createShipment`.
    - [ ] Exposer `POST /api/logistics/shipments`.
- **Contraintes** : L'expédition doit être liée à l'`organization_id` de l'expéditeur.

## 📦 Étape 2 : Gestion du Colisage (Packing List)
- **Tâche** : Lier des `Batches` existants à une `Shipment`.
- **Règles Métier** :
    - [ ] Vérifier que le lot appartient à l'organisation.
    - [ ] Déduire la quantité expédiée du stock du lot (`quantite_actuelle`).
    - [ ] Bloquer l'expédition si le lot est périmé ou sous statut `NON_CONFORME`.

## 🏷️ Étape 3 : Traçabilité GS1 (Sortie)
- **Tâche** : Générer les identifiants de transport.
- **Actions** :
    - [ ] Implémenter le service de génération de **SSCC** (Serial Shipping Container Code).
    - [ ] Créer un endpoint `GET /shipments/:id/label` pour imprimer le bon de transport.

## 🧪 Stratégie de Test (TDD)
1. **Tests Unitaires** : Validation du calcul des stocks restants dans le service.
2. **Tests d'Intégration** : Validation des routes avec `Supertest`.
3. **Tests de Sécurité** : Vérifier qu'une Org A ne peut pas expédier un lot appartenant à une Org B.

---
*Document de travail généré le 18 mai 2026 pour les prochaines instances.*
