# Documentation Technique : Transformations et Généalogie

Ce document détaille les implémentations critiques réalisées sur la branche `feat/traceability-transformations` pour garantir la performance, l'intégrité et la conformité du module de traçabilité.

## 1. Généalogie par Recursive CTE (SQL)
Pour éviter le problème de performance "N+1" lors de la recherche des ancêtres (Upstream) ou des descendants (Downstream) d'un lot, nous utilisons des requêtes SQL récursives (Common Table Expressions).

- **Fichier :** `src/modules/traceability/transformations/services/genealogy.service.ts`
- **Avantage :** Une seule requête en base de données permet de parcourir toute l'arborescence, peu importe la profondeur (ex: blé -> farine -> pain -> sandwich).
- **Limitation :** La profondeur est bridée à 100 niveaux par sécurité.

## 2. Intégrité et Concurrence
Le module gère des flux de production où plusieurs utilisateurs peuvent consommer le même lot simultanément.

- **Optimistic Locking :** Chaque lot possède un champ `version`. Lors d'une mise à jour de stock (consommation), nous vérifions que la version en base correspond à celle lue au début de la transaction.
- **Transactions Atomiques :** L'intégralité du processus de transformation (création du lot enfant + mise à jour des parents + logs d'audit) est encapsulé dans une `Prisma.TransactionClient`. Si une étape échoue (ex: stock insuffisant, erreur réseau), rien n'est enregistré.

## 3. Piste d'Audit WORM (Write Once Read Many)
Conformément aux normes HACCP et Objectif 7 du projet, les actions critiques sont enregistrées de manière immuable.

- **Chaînage par Hash :** Chaque nouveau log d'audit contient un `signature_hash` calculé à partir de ses propres données ET du hash du log précédent de l'organisation. 
- **Entités Auditées :**
  - Création de Transformation.
  - Déclenchement d'un Rappel (Recall).

## 4. Accès Public B2C (Scan Lot)
Une route publique a été ouverte pour permettre la transparence totale envers le consommateur final.

- **Endpoint :** `GET /api/public/scan/:id`
- **Sécurité :** Cette route est **non protégée** (pas de Token requis) mais ne renvoie qu'un sous-ensemble limité et sécurisé des données (nom produit, producteur, **nom commercial de la ferme** via `genealogyService.getOrigins`, généalogie produit, statut sanitaire). Pas de contact fournisseur, d'adresse, de prix ni de stocks.

## 5. Standards Techniques
- **GS1 Compatibility :** Les unités de mesure sont validées selon un référentiel strict (`src/shared/constants/units.constants.ts`).
- **Performance :** Des index de base de données ont été ajoutés sur les clés étrangères des liaisons de transformation.
