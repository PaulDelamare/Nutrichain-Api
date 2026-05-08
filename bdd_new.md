# REFONTE BIZ & DATA : CE QU'IL MANQUE À `bdd.md` (La version "NutriChain 2026")

Ton fichier `bdd.md` initial est une excellente base relationnelle (PostgreSQL) métier. Mais pour soutenir nos ambitions (SLA < 2s, architecture Modulith, authentification OIDC/@better-auth, scalabilité IoT WORM), voici les **modules critiques qui devront être modélisés** :

---

## 1. MODULE IDENTITÉ & SÉCURITÉ (`@better-auth` & ABAC)

Ton entité `User` et `Role` sont insuffisantes pour une gestion B2B avancée (OIDC, OAuth, et attributs de contrôle ABAC pour restreindre l'accès par usine).

*   **Table `Organisation`** (B2B/Tenant)
    *   `id` : L'entreprise ou l'usine locataire (Tenant).
    *   `name`, `gs1_company_prefix` : Indispensable pour la génération des SSCC et GTIN.
*   **Les tables standards imposées par `@better-auth`** :
    *   `user` (étendue) : Ajout de la clé étrangère vers `Organisation`.
    *   `session` : Gère l'expiration dynamique, l'IP de la machine industrielle, le token de rafraîchissement.
    *   `account` : Permet la liaison OIDC (Active Directory, Google Workspace de tes clients B2B).
    *   `verification` : Modèle de double authentification MFA (TOTP / SMS / Email).

---

## 2. MODULE IOT TEMPÉRATURE (La pile "Data-Lake MongoDB")

On ne stockera JAMAIS les **11 000 pings/seconde de tes capteurs dans PostgreSQL**. Cela casserait l'intégrité transactionnelle (Locks excessifs de DB). On utilise une approche Time-Series sous **MongoDB**.

*   **Collection MongoDB `IoT_Telemetry` (Time-Series)**
    *   `timestamp` (Index Temps) : L'heure milliseconde du relevé.
    *   `metadata.sensor_id` (Index Meta) : Le MAC ou UUID de la sonde (lié à ton `Materiel.id` dans Postgres).
    *   `temperature` : Double.
    *   `humidity` : Double.
    *   `battery_level` : Int.
    *   *TTL Index (Optional)* : Si NutriChain a une date de péremption définie de la conservation légale de data (ex : 5 ans et 1 jour), MongoDB s'auto-purgera pour économiser le cloud.

---

## 3. STRUCTURE DE TRAÇABILITÉ RÈGLE GS1/EPCIS (PostgreSQL)

Au lieu de faire une simple `Transformation` enfant-parent, le format métier requiert plus de standardisation :

*   **Table `EPCIS_Aggregation_Event`** 
    *   Événement logistique où X *Lots* formés rentrent dans Un (1) grand *SSCC* (La palette logistique pour l'expédition).
*   **Les index "Arbre Généalogique" sur Postgres**
    *   Une *CTEs (Common Table Expression)* récursive en SQL a impérativement besoin d'**INDEX B-Tree** sur `id_lot_enfant` et `id_lot_parent`. Sans cet index ajouté au Prisma Schema, la requête pour reconstruire l'historique du *Rappel Produit en 15 min* crashera sur les 18M de lignes !

---

## 4. LA CHAÎNE WORM (AUDIT PENAL)

Pour que notre table `Audit_Log` soit intègre comme une petite blockchain (Write Once Read Many), la ligne _précédente_ a besoin d'être hachée avec l'actuelle :
*   Le script Back-end doit impérativement calculer un `signature_hash = SHA256(ancienne_valeur + nouvelle_valeur + prev_hash + PRIVATE_SALT_NUTRICHAIN)`. 
*   Le Schema Prisma aura le modèle `Audit_Log` configuré de manière à ce qu'aucune route d'Update ou Delete ne soit générée (strictement restreint par le controller Modulith).

---

### PROCHAINES ÉTAPES BDD :
Lorsque l'on générera le `schema.prisma`, nous fusionnerons ton `bdd.md` et ce nouveau contexte (Auth, Indexation, Logistique EPCIS). La structure MongoDB sera gérée par du Mongoose/pilotage driver bas niveau dans son module IoT respectif.
