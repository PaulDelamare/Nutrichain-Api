# NutriChain - Matrice des Rôles et Permissions (RBAC/ABAC)

Comme convenu, pour éviter l'effondrement du système (l'explosion des rôles), nous divisons la sécurité en **Permissions** (des actions pures) et en **Profils Métiers** (des groupes de permissions). Ces profils seront ensuite assignés à un utilisateur **pour un lieu donné**.

## 1. Les Permissions Atomiques (Les "Actions")

Ce sont les droits unitaires qui seront vérifiés par l'API (ex: `if (!user.hasPermission('LOT_TRANSFORM')) return 403`).

### 📦 Opérations Logistiques & Lots
- `LOT_RECEIVE` : Enregistrer l'arrivée d'un produit (Quai de réception).
- `LOT_MOVE` : Déplacer un lot d'un frigo/stockage à un autre.
- `LOT_TRANSFORM` : Mélanger / Transformer / Diviser un ou plusieurs lots.
- `LOT_EXPEDITE` : Charger un lot dans un camion pour expédition.
- `LOT_SCAN` : Droit basique de scanner et consulter l'historique d'un lot.

### 🏭 Gestion de l'Usine (Matériel & Lieux)
- `SENSOR_VIEW` : Consulter les températures et les alertes.
- `SENSOR_MANAGE` : Ajouter/Modifier des capteurs de température ou des machines.
- `LOCATION_MANAGE` : Modifier l'organisation physique du lieu.

### 🛑 Qualité et Recettes
- `PRODUCT_CREATE` : Inventer de nouveaux produits / Définir des recettes.
- `RECALL_TRIGGER` : Déclencher une alerte sanitaire ou un rappel produit.
- `QUARANTINE_LOT` : Mettre un lot spécifique en quarantaine (blocage).

### 👥 Administration (Système)
- `USER_INVITE` : Envoyer un lien d'invitation à un nouvel employé.
- `USER_MANAGE` : Désactiver (`isActive: false`) ou modifier un employé.
- `GLOBAL_DASHBOARD` : Voir les statistiques financières et logistiques.

---

## 2. Les Profils Métiers (Les "Rôles")

Voici les modèles de rôles standards basés sur ton expression de besoin. Un profil = Une addition de permissions atomiques.

### 👑 Pôle Direction & Global
- **Administrateur Global** :
  - *Permissions* : TOUTES.
  - *Lieu d'affectation* : Global (`*`).
- **Directeur R&D (Créateur de Produit)** :
  - *Permissions* : `PRODUCT_CREATE`, `LOT_SCAN`.
  - *Lieu d'affectation* : Global ou Siège.
- **Responsable Qualité (Qualiticien)** :
  - *Permissions* : `RECALL_TRIGGER`, `QUARANTINE_LOT`, `LOT_SCAN`, `SENSOR_VIEW`.
  - *Lieu d'affectation* : Global ou par Usine.

### 🏭 Pôle Usine (Opérationnel)
- **Chef d'Entrepôt / Manager** :
  - *Permissions* : `USER_INVITE`, `USER_MANAGE`, `SENSOR_MANAGE`, + toutes les perms logistiques.
  - *Lieu d'affectation* : L'Entrepôt qu'il gère (ex: "Entrepôt Nord").
- **Réceptionniste / Magasinier** :
  - *Permissions* : `LOT_RECEIVE`, `LOT_MOVE`, `LOT_SCAN`.
  - *Lieu d'affectation* : Son lieu de travail.
- **Cariste / Préparateur de Commande** :
  - *Permissions* : `LOT_MOVE`, `LOT_EXPEDITE`, `LOT_SCAN`.
  - *Lieu d'affectation* : Son lieu de travail.
- **Opérateur de Production (Mélangeur)** :
  - *Permissions* : `LOT_TRANSFORM`, `LOT_MOVE`, `LOT_SCAN`.
  - *Lieu d'affectation* : Uniquement la zone de production.

### 🚚 Pôle Externe / Transport
- **Conducteur / Chauffeur** :
  - *Permissions* : `LOT_SCAN`, `LOT_EXPEDITE` (pour signer le bon de prise en charge).
  - *Lieu d'affectation* : Temporaire (affecté au camion de transport ou à la flotte).

---

## 3. Comment cela s'applique (Exemples Concrets ABAC)

**Exemple A : Le Chef d'Entrepôt**
1. Marc a le rôle `Manager`.
2. Son rôle est assigné au Lieu `Entrepôt Nord`.
3. Il a donc automatiquement la permission `USER_INVITE`, mais l'API restreindra son action : il ne pourra inviter des employés *que* pour l'Entrepôt Nord.

**Exemple B : La mutation d'un employé**
1. Jean est `Opérateur de Production` à `Usine Sud`.
2. Jean doit faire un remplacement de 2 jours à `Usine Est`.
3. Pas besoin de créer un nouveau rôle. Le Manager lui ajoute simplement une affectation : Role `Opérateur de Production` -> Lieu `Usine Est`.

## 4. Ébauche du Schéma Prisma (Pour notre ABAC)

Nous allons matérialiser cela avec cette structure :
```prisma
// L'énumération des permissions possibles.
enum Permission {
  LOT_RECEIVE
  LOT_MOVE
  LOT_TRANSFORM
  // ...
}

// Le Rôle (Le "modèle")
model RoleTemplate {
  id          String   @id @default(uuid())
  name        String   @unique // ex: "Responsable Qualité", "Cariste"
  permissions Permission[] // La liste des actions qu'il peut faire
}

// L'assignation (La clé de voûte)
model UserRoleAssignment {
  id             String       @id @default(uuid())
  userId         String
  roleTemplateId String
  locationId     String?      // Peut être NULL si c'est un rôle global (Admin)
  startDate      DateTime?    // Pour les accès temporaires
  endDate        DateTime?    // Pour les accès temporaires
  
  // Relations...
}
```

## 5. Enrichissements du Modèle (Suite à l'analyse experte)

L'analyse approfondie de notre cahier des charges (HACCP, Normes ISO 22000, GS1/EPCIS et KPIs) a mis en lumière des manques dans notre première ébauche, spécifiques au secteur industriel. Voici les ajouts validés :

### 🛡️ Permissions supplémentaires requises
**Traçabilité & Audit (WORM / GS1)** :
- `EPCIS_EVENT_VIEW` / `EPCIS_EXPORT` : Indispensable pour prouver la chaîne de traçabilité aux normes GS1 (Objectif 1).
- `AUDIT_LOG_VIEW` : Pour consulter les logs inaltérables (WORM).

**Maintenance & Frigos (IoT)** :
- `SENSOR_MAINTENANCE` : La survie des lots dépend des capteurs. Il faut pouvoir enregistrer qu'un technicien a calibré la sonde du frigo (Objectif 2).
- `MATERIEL_MAINTENANCE` : Tracer les nettoyages des cuves (Obligatoire en HACCP).

**Qualité & Fraudes** :
- `QUALITY_TEST_MANAGE` : Saisir les résultats de tests en laboratoire.
- `INVENTORY_AUDIT` / `PHYSICAL_COUNT` : Pouvoir faire des comptages d'inventaire et corriger les écarts gérés par l'ERP.

### 👥 Nouveaux Profils Métiers (Templates)
- **Auditeur (Interne / Externe)** : Accès en lecture seule globale (`AUDIT_LOG_VIEW`, `EPCIS_EVENT_VIEW`, etc.) pour les inspecteurs sanitaires.
- **Technicien de Maintenance (IoT)** : Celui qui installe et gère les capteurs thermiques.
- **Technicien Laboratoire (Qualité)** : Saisit les résultats de tests, gère la quarantaine.

## 6. La Gestion des "Compromis" (Réalité Terrain)

Dans une véritable usine, l'organisation n'est jamais parfaite et nécessite une flexibilité que notre modèle ABAC gère nativement :

- **Le cumul de rôles (Polyvalence) :** Une personne peut cumuler plusieurs lignes dans `UserRoleAssignment`. (Ex: "Cariste" + "Opérateur").
- **Séparation des Tâches (SoD) :** Les règles logiques (codées dans l'API) empêcheront d'assigner certaines combinaisons de rôles pour éviter la fraude (Ex: Créer un lot + Valider la qualité de ce même lot).
- **Délégation d'urgence (Assignation Temporelle) :** L'ajout de `startDate` et `endDate` sur l'assignation du rôle permet de remplacer un manager malade pendant exactement 48 heures.
