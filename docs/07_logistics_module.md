# Module Logistics : Réception & Étiquetage GS1 (Refonte 2026)

## 1. Vue d'ensemble
Le module `logistics` gère l'entrée des marchandises et la création de l'identité numérique des lots. Il est conçu pour assurer une traçabilité totale dès le point d'entrée, conformément aux standards GS1.

## 2. Architecture Technique

### Sécurité (Zero-Trust)
- **M2M (Machine to Machine)** : Accès via `@apiKey` pour les terminaux de scannage industriels.
- **Web/App** : Accès via session Better-Auth avec le guard `requireOrgRole`.
- **Défense en profondeur** : Le `activeOrgId` est injecté au niveau des Services pour garantir l'isolation multi-tenant (IDOR prevention).

### Services Clés
- `ReceiptService` : Orchestre la création des réceptions et la récupération des lots.
- `LabelService` : Génère des identifiants au format **GS1 Digital Link** (`/01/{gtin}/10/{batchId}`) et produit les fichiers binaires pour QR Code et DataMatrix.

## 3. Endpoints API

### Réceptions (Receipts)
- `GET /logistics/receipts/:id` : Récupère les détails d'une réception.
- `GET /logistics/batches/:id/label` : Génère l'étiquette industrielle du lot.

### Paramètres de l'Étiquette
| Header | Valeur | Raison |
| :--- | :--- | :--- |
| `Content-Type` | `image/png` | Format standard pour impression thermique. |
| `Cache-Control` | `public, max-age=31536000, immutable` | Performance maximale, les données GS1 d'un lot ne changent jamais. |
| `Content-Disposition` | `inline; filename="label-{id}.png"` | Facilite la gestion par les navigateurs/clients. |

## 4. Standards GS1 Supportés
- **GTIN (Global Trade Item Number)** : Identifiant produit unique.
- **Batch/Lot** : Identifiant de lot de production.
- **Digital Link** : URI structurée permettant de lier le physique au numérique.

---
*Documentation générée automatiquement le 18 mai 2026.*
