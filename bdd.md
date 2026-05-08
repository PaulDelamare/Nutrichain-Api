### 0. Tables utilitaires

- **Table `Unite`** (canonicalisation des unités) — *Liste des unités et facteurs de conversion*
    - `code` : Postgres `text` — Prisma `String` — Identifiant court de l’unité (ex: "L", "kg", "u").
    - `nom` : Postgres `text` — Prisma `String` — Nom lisible de l’unité.
    - `factor_to_base` : Postgres `numeric` — Prisma `Decimal` — Facteur de conversion vers l’unité de référence (pour normaliser les quantités).
- **Table `EPCIS_Event`** (optionnel mais recommandé pour traçabilité évènementielle) — *Events EPCIS pour reconstituer la chronologie métier*
    - `id` : Postgres `uuid` — Prisma `String (uuid)` — Identifiant unique de l’événement.
    - `event_time` : Postgres `timestamptz` — Prisma `DateTime` — Horodatage de l’événement.
    - `event_type` : Postgres `text` / ENUM — Prisma `String` / Enum — Type d’événement (RECEPTION, TRANSFORMATION, ...).
    - `related_entity` : Postgres `text` — Prisma `String` — Table ou entité liée ("lot","reception"...).
    - `related_id` : Postgres `text` — Prisma `String` — Identifiant de la ressource liée (uuid ou string).
    - `payload` : Postgres `jsonb` — Prisma `Json` — Données détaillées (métadonnées, mesures).

---

### 1. Table `Lieux` (Le plan de l'usine) — *Zones physiques de l'usine*

- **`id`** : Postgres `uuid` — Prisma `String (uuid)` — Identifiant unique du lieu.
- **`nom`** : Postgres `text` — Prisma `String` — Nom lisible (ex : “Entrepôt Nord”).
- **`type`** : Postgres `text` / ENUM — Prisma `String` / Enum — Catégorie (Stockage, Transformation, Quai).
- **`description`** : Postgres `text` — Prisma `String` — Informations complémentaires (accès, contraintes).

---

### 2. Table `Materiel` (L'inventaire technique) — *Machines, frigos, cuves*

- `id` : Postgres `uuid` — Prisma `String (uuid)` — Identifiant unique du matériel.
- `nom` : Postgres `text` — Prisma `String` — Libellé (ex : “Frigo n°3”).
- `type` : Postgres `text` / ENUM — Prisma `String` / Enum — Catégorie (FROID, CHAUD, MIXEUR).
- `id_lieu` : Postgres `uuid` — Prisma `String (uuid)` — FK → `Lieux.id`, localisation physique.
- `statut` : Postgres `text` / ENUM — Prisma `String` / Enum — État opérationnel (PRET, EN_NETTOYAGE, ALERTE, EN_UTILISATION).
- `temp_actuelle` : Postgres `numeric` — Prisma `Decimal` — Valeur cache de la température (source de vérité = `Temperature_Log`).
- `temp_seuil_max` : Postgres `numeric` — Prisma `Decimal` — Seuil à partir duquel on déclenche alerte.
- `qr_code_id` : Postgres `text` — Prisma `String` — Identifiant scannable pour attacher un opérateur.
- `last_cleaned_at` : Postgres `timestamptz` — Prisma `DateTime` — Timestamp du dernier nettoyage validé.

---

### 3. Table `Lot` (La "vie" du produit) — *Suivi d’un batch / lot physique*

- `id` : Postgres `uuid` — Prisma `String (uuid)` — Identifiant unique (ou GS1 si applicable).
- `id_produit` : Postgres `uuid` — Prisma `String (uuid)` — FK → `Produit.id`.
- `quantite_actuelle` : Postgres `numeric` — Prisma `Decimal` — Quantité restante dans l’unité `unite`.
- `unite` : Postgres `text` — Prisma `String` — Référence `Unite.code`.
- `quantite_base` : Postgres `numeric` — Prisma `Decimal` — Quantité convertie en unité de référence (pour checks).
- `date_peremption` : Postgres `timestamptz` — Prisma `DateTime` — DLC / DLUO.
- `statut` : Postgres `text` / ENUM — Prisma `String` / Enum — (EN_STOCK, CONSOMME, EXPEDIE, QUARANTAINE, REBUT).
- `id_materiel_actuel` : Postgres `uuid` — Prisma `String (uuid)` — FK → `Materiel.id` (position courante).
- `date_creation` : Postgres `timestamptz` — Prisma `DateTime` — Date de création du lot.
- `created_by` : Postgres `uuid` — Prisma `String (uuid)` — FK → `User.id`.
- `version` : Postgres `integer` — Prisma `Int` — Version pour optimistic locking (si utilisé).

---

### 4. Table `Transformation` (Le lien de parenté) — *Événement production (N parents → 1 enfant)*

- `id` : Postgres `uuid` — Prisma `String (uuid)` — Identifiant de l’opération.
- `id_lot_enfant` : Postgres `uuid` — Prisma `String (uuid)` — FK → `Lot.id` du lot créé.
- `id_produit_fini` : Postgres `uuid` — Prisma `String (uuid)` — FK → `Produit.id` attendu.
- `id_recette` : Postgres `uuid` (nullable) — Prisma `String (uuid)` — FK → `Recette_Composition.id` pour validation.
- `id_user` : Postgres `uuid` — Prisma `String (uuid)` — FK → `User.id` (opérateur initiateur).
- `id_materiel` : Postgres `uuid` — Prisma `String (uuid)` — FK → `Materiel.id` utilisé.
- `statut` : Postgres `text` / ENUM — Prisma `String` / Enum — (EN_COURS, TERMINE, ANNULE, ERREUR).
- `note_technique` : Postgres `jsonb` — Prisma `Json` — Paramètres machine et métadonnées.
- `horodatage_debut` : Postgres `timestamptz` — Prisma `DateTime` — Début de l’opération.
- `horodatage_fin` : Postgres `timestamptz` (nullable) — Prisma `DateTime` — Fin de l’opération.
- `duration_seconds` : Postgres `integer` (nullable) — Prisma `Int` — Durée calculée (optionnel).

---

### 4bis. Table `Transformation_Composition` (Pivot) — *Détail des prélèvements pour une transformation*

- `id_transformation` : Postgres `uuid` — Prisma `String (uuid)` — FK → `Transformation.id`.
- `id_lot_parent` : Postgres `uuid` — Prisma `String (uuid)` — FK → `Lot.id` parent.
- `quantite_prelevee` : Postgres `numeric` — Prisma `Decimal` — Quantité prélevée (dans `unite`).
- `unite` : Postgres `text` — Prisma `String` — `Unite.code`.
- `lot_parent_epuise` : Postgres `boolean` — Prisma `Boolean` — True si le parent est vidé après prélèvement.
- `note` : Postgres `text` — Prisma `String` — Commentaire / conversion appliquée.

---

### 5. Table `User` & `Role` (Sécurité) — *Comptes utilisateurs et rôle*

- `id` : Postgres `uuid` — Prisma `String (uuid)` — Identifiant user.
- `nom_prenom` : Postgres `text` — Prisma `String` — Nom complet.
- `email` : Postgres `text` — Prisma `String` — Adresse email (unique côté application).
- `password_hash` : Postgres `text` — Prisma `String` — Hash du mot de passe.
- `id_role` : Postgres `uuid` — Prisma `String (uuid)` — FK → `Role.id`.
- `mfa_enabled` : Postgres `boolean` — Prisma `Boolean` — MFA activé ou non.
- `last_login` : Postgres `timestamptz` — Prisma `DateTime` — Dernière connexion.

*(Table `Role` : `id uuid`, `name text` — ex: OPERATOR, RECEPTION, QUALITE, ADMIN.)*

---

### 6. Table `Produit` (Catalogue) — *Référentiel produit et conservation*

- `id` : Postgres `uuid` — Prisma `String (uuid)` — Identifiant produit.
- `nom` : Postgres `text` — Prisma `String` — Libellé produit (Yaourt nature).
- `code_gtin` : Postgres `text` — Prisma `String` — GTIN / code-barres GS1.
- `categorie` : Postgres `text` — Prisma `String` — Catégorie (Produit fini, Matière première...).
- `duree_conservation_defaut` : Postgres `integer` — Prisma `Int` — Durée en jours pour DLC par défaut.
- `seuil_alerte_stock` : Postgres `numeric` — Prisma `Decimal` — Seuil commande/réappro.
- `unite_reference` : Postgres `text` — Prisma `String` — `Unite.code` référence.

---

### 7. Table `Expedition` — *Bon de livraison / shipment*

- `id` : Postgres `uuid` — Prisma `String (uuid)` — Identifiant expédition.
- `id_client` : Postgres `uuid` — Prisma `String (uuid)` — FK → `Client.id`.
- `shipment_id` : Postgres `text` (UNIQUE) — Prisma `String` — Identifiant transporteur (SSCC) pour idempotence.
- `date_envoi` : Postgres `timestamptz` — Prisma `DateTime` — Date et heure d’envoi.
- `transporteur` : Postgres `text` — Prisma `String` — Nom du transporteur.
- `statut_livraison` : Postgres `text` / ENUM — Prisma `String` — (PREPARATION, EN_ROUTE, LIVRE, RETOURNE).
- `created_by` : Postgres `uuid` — Prisma `String (uuid)` — FK → `User.id`.

---

### 8. Table `Client` — *Destinataires / points de vente*

- `id` : Postgres `uuid` — Prisma `String (uuid)` — Identifiant client.
- `nom_enseigne` : Postgres `text` — Prisma `String` — Nom commercial.
- `contact_urgence` : Postgres `text` — Prisma `String` — Téléphone / email responsable qualité.
- `adresse_livraison` : Postgres `text` — Prisma `String` — Adresse complète.
- `notes` : Postgres `text` — Prisma `String` — Notes opérationnelles (SLA, contraintes).

---

### 9. Table `Alerte` (La réactivité 30s) — *Alertes critiques & notifications*

- `id` : Postgres `uuid` — Prisma `String (uuid)` — Identifiant alerte.
- `type` : Postgres `text` / ENUM — Prisma `String` — TEMPÉRATURE / DLC_PROCHE / ...
- `niveau_gravite` : Postgres `text` / ENUM — Prisma `String` — INFO / WARNING / CRITIQUE.
- `message` : Postgres `text` — Prisma `String` — Texte descriptif de l’alerte.
- `id_materiel` : Postgres `uuid` (nullable) — Prisma `String (uuid)` — FK → `Materiel.id` si applicable.
- `related_entity` : Postgres `text` — Prisma `String` — Entité liée (ex: "lot").
- `related_id` : Postgres `text` — Prisma `String` — Identifiant lié.
- `statut` : Postgres `text` / ENUM — Prisma `String` — ACTIVE / ACQUITTEE / RESOLUE.
- `created_at` : Postgres `timestamptz` — Prisma `DateTime` — Création de l’alerte.
- `resolved_by` : Postgres `uuid` (nullable) — Prisma `String (uuid)` — FK → `User.id`.
- `resolved_at` : Postgres `timestamptz` (nullable) — Prisma `DateTime` — Résolution horodatée.

> Comportement : DB/worker évalue les règles (ex: règle température) et crée Alerte. Push WebSocket sur création.
> 

---

### 10. Table `Audit_Log` — *Journal immuable d’actions*

- `id` : Postgres `bigserial` — Prisma `Int` — Identifiant séquentiel.
- `id_user` : Postgres `uuid` (nullable) — Prisma `String (uuid)` — Qui a effectué l’action.
- `action` : Postgres `text` — Prisma `String` — Libellé action (ex: "Modification statut").
- `entity` : Postgres `text` — Prisma `String` — Table impactée.
- `entity_id` : Postgres `text` — Prisma `String` — Identifiant de la ligne affectée.
- `ancienne_valeur` : Postgres `jsonb` — Prisma `Json` — Valeur avant modification.
- `nouvelle_valeur` : Postgres `jsonb` — Prisma `Json` — Valeur après modification.
- `prev_hash` : Postgres `text` — Prisma `String` — Hash du log précédent (chaînage).
- `signature_hash` : Postgres `text` — Prisma `String` — Hash courant (intégrité).
- `horodatage` : Postgres `timestamptz` — Prisma `DateTime` — Horodatage.

---

### 11. Table `Liaison_Expedition` — *Contenu du camion / mapping lot ↔ expédition*

- `id` : Postgres `uuid` — Prisma `String (uuid)` — Identifiant.
- `id_expedition` : Postgres `uuid` — Prisma `String (uuid)` — FK → `Expedition.id`.
- `id_lot` : Postgres `uuid` — Prisma `String (uuid)` — FK → `Lot.id`.
- `quantite_expediee` : Postgres `numeric` — Prisma `Decimal` — Quantité embarquée.
- `unite` : Postgres `text` — Prisma `String` — `Unite.code`.
- `pallet_id` : Postgres `text` (nullable) — Prisma `String` — Identifiant palette / agrégation.

---

### 12. Table `Fournisseur` — *Origine amont / producteur*

- `id` : Postgres `uuid` — Prisma `String (uuid)` — Identifiant fournisseur.
- `nom_ferme` : Postgres `text` — Prisma `String` — Nom ferme/producteur.
- `type_produit` : Postgres `text` — Prisma `String` — (Bio, AOP, Conventionnel).
- `contact_qualite` : Postgres `text` — Prisma `String` — Contact qualité (tel/email).
- `adresse_siege` : Postgres `text` — Prisma `String` — Adresse siège social.

---

### 13. Table `Reception` — *Entrée en usine / réception camion*

- `id` : Postgres `uuid` — Prisma `String (uuid)` — Identifiant réception.
- `id_fournisseur` : Postgres `uuid` — Prisma `String (uuid)` — FK → `Fournisseur.id`.
- `shipment_id` : Postgres `text` (UNIQUE NOT NULL) — Prisma `String` — Identifiant transporteur pour idempotence.
- `date_reception` : Postgres `timestamptz` — Prisma `DateTime` — Date et heure d’arrivée.
- `temperature_camion_summary` : Postgres `jsonb` — Prisma `Json` — Résumé min/max/avg.
- `temperature_camion_raw` : Postgres `jsonb` (nullable) — Prisma `Json` — Séries brutes (optionnel).
- `statut_controle` : Postgres `text` / ENUM — Prisma `String` — (CONFORME, REFUSE, EN_ATTENTE_ANALYSE).
- `received_by` : Postgres `uuid` — Prisma `String (uuid)` — FK → `User.id`.

> Processus : idempotence via shipment_id; si non-conforme → Alerte CRITIQUE + Audit_Log; création des Lot initiaux à l’arrivée.
> 

---

### 14. Table `Nettoyage_Maintenance` — *Hygiène & interventions*

- `id` : Postgres `uuid` — Prisma `String (uuid)` — Identifiant intervention.
- `id_materiel` : Postgres `uuid` — Prisma `String (uuid)` — FK → `Materiel.id`.
- `id_user` : Postgres `uuid` — Prisma `String (uuid)` — FK → `User.id`.
- `type_action` : Postgres `text` — Prisma `String` — Nettoyage complet / Désinfection / Maintenance.
- `produit_utilise` : Postgres `text` — Prisma `String` — Produit chimique utilisé.
- `date_debut` : Postgres `timestamptz` — Prisma `DateTime` — Début intervention.
- `date_fin` : Postgres `timestamptz` — Prisma `DateTime` — Fin intervention.
- `valid_until` : Postgres `timestamptz` — Prisma `DateTime` — Validité du nettoyage (ex: 24h).

---

### 15. Table `Performance_Stats` — *Métriques & KPIs*

- `id` : Postgres `bigserial` — Prisma `Int` — Identifiant métrique.
- `type_metrique` : Postgres `text` — Prisma `String` — TEMPS_SCAN, LATENCE_ALERTE, etc.
- `valeur` : Postgres `numeric` — Prisma `Decimal` — Valeur mesurée.
- `id_reference` : Postgres `uuid` (nullable) — Prisma `String (uuid)` — Référence optionnelle (lot/alerte).
- `horodatage` : Postgres `timestamptz` — Prisma `DateTime` — Horodatage métrique.

> Recomm. stocker ces séries en TimescaleDB si possible.
> 

---

### 16. Table `Gestion_Rebuts` — *Pertes / déchets*

- `id` : Postgres `uuid` — Prisma `String (uuid)` — Identifiant.
- `id_lot` : Postgres `uuid` — Prisma `String (uuid)` — FK → `Lot.id`.
- `quantite_jetee` : Postgres `numeric` — Prisma `Decimal` — Quantité mise au rebut.
- `unite` : Postgres `text` — Prisma `String` — `Unite.code`.
- `motif` : Postgres `text` — Prisma `String` — Raison du rebut.
- `date_mise_au_rebut` : Postgres `timestamptz` — Prisma `DateTime` — Date du rebut.
- `created_by` : Postgres `uuid` — Prisma `String (uuid)` — Opérateur ayant enregistré.

---

### 17. Table `Controle_Qualite` — *Résultats laboratoire*

- `id` : Postgres `uuid` — Prisma `String (uuid)` — Identifiant du test.
- `id_lot` : Postgres `uuid` — Prisma `String (uuid)` — FK → `Lot.id`.
- `type_test` : Postgres `text` — Prisma `String` — Type de test (Listeria, pH...).
- `resultat` : Postgres `text` / ENUM — Prisma `String` / Enum — CONFORME / NON_CONFORME.
- `id_user_labo` : Postgres `uuid` — Prisma `String (uuid)` — Technicien laboratoire.
- `certificat_pdf` : Postgres `text` — Prisma `String` — URL/chemin du document.
- `date_test` : Postgres `timestamptz` — Prisma `DateTime`.
- `notes` : Postgres `text` — Prisma `String`.

> Règle métier : lot enfant passe QUARANTAINE → EN_STOCK uniquement si resultat = CONFORME.
> 

---

### 18. Table `Temperature_Log` (Historique) — *Séries temporelles IoT*

- `id` : Postgres `bigserial` — Prisma `Int` — Identifiant séquentiel.
- `id_materiel` : Postgres `uuid` — Prisma `String (uuid)` — FK → `Materiel.id`.
- `valeur` : Postgres `numeric` — Prisma `Decimal` — Valeur mesurée (°C).
- `unite` : Postgres `text` — Prisma `String` — Unité (ex: "C").
- `horodatage` : Postgres `timestamptz` — Prisma `DateTime` — Timestamp lecture.

> Recomm. hypertable / partitioning + retention policy.
> 

---

### 19. Table `Recette_Composition` (Garde-fou) — *Recettes théoriques et tolérances*

- `id` : Postgres `uuid` — Prisma `String (uuid)` — Identifiant recette.
- `id_produit_fini` : Postgres `uuid` — Prisma `String (uuid)` — FK → `Produit.id`.
- `id_type_ingredient` : Postgres `uuid` / `text` — Prisma `String` — Catégorie ingrédient (Lait, Ferment...).
- `quantite_theorique` : Postgres `numeric` — Prisma `Decimal` — Quantité attendue.
- `unite` : Postgres `text` — Prisma `String` — `Unite.code`.
- `tolerance_percent` : Postgres `numeric` — Prisma `Decimal` — Tolérance acceptée en %.

---

### 20. Table `Lot_Mouvement` (nouveau, essentiel) — *Historique append-only des mouvements*

- `id` : Postgres `bigserial` — Prisma `Int` — Identifiant séquentiel.
- `id_lot` : Postgres `uuid` — Prisma `String (uuid)` — FK → `Lot.id`.
- `type_action` : Postgres `text` — Prisma `String` — RECEPTION / TRANSFORMATION_CONSOMMATION / ...
- `quantite` : Postgres `numeric` — Prisma `Decimal` — Quantité impactée.
- `unite` : Postgres `text` — Prisma `String` — `Unite.code`.
- `id_transformation` : Postgres `uuid` (nullable) — Prisma `String (uuid)` — FK → `Transformation.id`.
- `id_expedition` : Postgres `uuid` (nullable) — Prisma `String (uuid)` — FK → `Expedition.id`.
- `id_user` : Postgres `uuid` (nullable) — Prisma `String (uuid)` — Opérateur initiateur.
- `created_at` : Postgres `timestamptz` — Prisma `DateTime` — Horodatage écriture mouvement.
- `metadata` : Postgres `jsonb` — Prisma `Json` — Données additionnelles (raison, références).

> Rôle : append-only — base de la reconstruction de l’historique et des audits.
>