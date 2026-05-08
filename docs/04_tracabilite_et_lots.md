# Logique Métier : Traçabilité et Gestion des Lots (Nutrichain)

Ce document régit les règles fondamentales pour l'architecture et le développement des fonctionnalités liées à la chaîne d'approvisionnement (Supply Chain) dans le projet Nutrichain.

## 1. Principes de Traçabilité (Batch Tracking)

Pour garantir une traçabilité précise, le modèle de données fait une distinction stricte entre le "Produit" et le "Lot" :

- **Le Produit (Product)** : Représente la définition générique et abstraite d'une marchandise (ex: "Bouteille de lait 1L", avec son Nutri-Score, sa liste d'ingrédients, son code EAN-13 par défaut).
- **Le Lot (Batch)** : Représente l'instance de production de ce Produit (ex: "Bouteille de lait 1L produite le 13 Avril, Lot #12345"). Chaque lot possède ses propres attributs spécifiques (date de péremption/DLC, quantité produite, identifiant GS1 DataMatrix unique).

La traçabilité des mouvements (changements de lieux, transferts de propriété) s'effectue **exclusivement au niveau du Lot**, afin de retracer l'historique exact d'un groupe d'articles sans le confondre avec le reste de la production.

## 2. Gestion des Rappels Sanitaires (Recalls)

L'architecture doit permettre une gestion des rappels "chirurgicale" :
- Si un lot est identifié comme défectueux ou dangereux, le système doit pouvoir l'isoler immédiatement.
- Grâce au suivi par Lot, Nutrichain sera capable de localiser instantanément où se trouvent toutes les unités de ce lot précis (dans quel entrepôt, quel magasin) afin d'alerter les acteurs concernés sans impacter la vente des autres lots sains du même produit.

## 3. Normes et Génération des Codes-Barres

Pour répondre aux exigences industrielles et mondiales :

- **Respect des Standards GS1** : Les codes générés par la plateforme Nutrichain devront respecter les standards mondiaux. Les lots utiliseront préférentiellement des formats comme le **GS1 DataMatrix** (ou GS1 Digital Link), capables d'encoder simultanément dans un seul scan :
  - L'identifiant du produit (GTIN)
  - Le numéro de lot (Batch)
  - La date d'expiration
- **Génération Locale** : La création visuelle des QR Codes, GS1 DataMatrix, et codes-barres linéaires (EAN-13) sera assurée **en interne** (par le backend Node.js via des bibliothèques robustes comme `bwip-js`). Cela garantit un système hautement performant, autonome, gratuit et sécurisé (évitant la dépendance à des API de génération d'images externes).

## 4. Centralisation et Modularité

- Un service (ex: `src/Services/barcode/barcode.service.ts`) ou un utilitaire (ex: `src/Utils/barcodeGenerator/`) dédié sera créé pour gérer toute la logique d'encodage et de dessin de ces identifiants logistiques.
