# MASTER CAHIER DES CHARGES : NUTRICHAIN REFONTE INDUSTRIELLE 2026
> **Statut** : Document de référence absolu
> **Confidentialité** : Interne (Équipe Projet : Paul, Hugo, Yoann, IT, Direction)

---

## I. INTRODUCTION ET CONTEXTE DU PROJET

L’industrie agroalimentaire est en pleine crise systémique de confiance et de lenteur technologique. Les exigences croissantes en matière de traçabilité "de la ferme à la fourchette", de sécurité sanitaire (surveillance de la température en temps réel) et de réactivité face aux crises sont incompatibles avec les infrastructures IT actuelles du secteur.

Dans la réalité du terrain, les industriels, les fabricants, les logisticiens et les distributeurs fonctionnent aujourd'hui avec des architectures morcelées, "en silos". 
1. **Éparpillement Technologique** : Le système de l'entrepôt (WMS comme Reflex) ne communique pas en temps réel avec le système logistique de transport (TMS), ni avec le logiciel comptable (ERP comme SAP ou Oracle).
2. **Outils Archaïques** : Le suivi des processus critiques (lots de fabrication, DLC) se fait encore sur des tableurs Excel, rendant l'historisation impossible et la modification extrêmement dangereuse.
3. **Surveillance Thermique Insuffisante** : La chaîne du froid est surveillée par des capteurs USB jetables. La rupture d'une courbe de température dans un camion frigorifique n'est signalée qu'à l'arrivée sur le quai de chargement. Le résultat final est souvent une palette entière de marchandises avariées qui doit être détruite.
4. **Le Cauchemar du Rappel Produit (Recall)** : Sans base de données mutualisée et normalisée pour retracer l'arbre généalogique d'un produit, détecter l'origine d'un lot pathogène (Listeria, Salmonella) prend des jours.

**NUTRICHAIN**, créé en 2021, intervient précisément pour résoudre ces dérives sanitaires et logistiques. Plateforme B2B/B2C, NutriChain centralise la traçabilité. 
L'ampleur du succès initial est incontestable :
- **18 millions de lots scrupuleusement suivis.**
- **Plus de 11 000 capteurs de température IoT déployés.**
- **Un p95 pour l'Alerte Froid fixé à 35 secondes.**
- **Plus de 75 grands comptes clients industriels en France, Belgique et Espagne.**

Toutefois, pour soutenir son expansion (Allemagne, Italie prévues pour 2026), l'ancienne base logicielle atteint ses limites. Ce projet est donc une **réingénierie absolue (Refonte 2026)** visant à transformer l'API NutriChain en un standard industriel et réglementaire incontournable en Europe, reposant strictement sur les standards mondiaux **GS1 / EPCIS**.

---

## II. LES 8 OBJECTIFS STRATÉGIQUES S.M.A.R.T.

Chaque ligne de code de notre API Node.js doit être dictée par l'atteinte sans compromis de ces 8 objectifs stricts fixés par la direction de NutriChain.

### Objectif 1 - Traçabilité complète et standardisée des lots (Cible : 20/06/2026)
L'API doit enregistrer nativment l'ensemble des événements logistiques.
- **Les Normes GS1** : Obligation d'utiliser le GTIN (Produit), le SSCC (Palettes logistiques agrégées).
- **Le Modèle EPCIS** : L'API tracera tout événement selon le paradigme de l'Electronic Product Code Information Services (Quoi, Où, Quand, Pourquoi - *ObjectEvent, AggregationEvent, TransactionEvent*).
- *Performance* : La base de données PostgreSQL via Prisma devra être optimisée par indexation afin de reconstruire en **moins de 2 secondes** l'arbre complet de traçabilité (downstream/upstream) d'une palette entière.

### Objectif 2 — Alerte froide émise en moins de 30 secondes (Cible : 15/03/2026)
Le réseau IoT (LoRaWAN/Cellulaire) transmet des relevés télémétriques vitaux pour l'intégrité de la chaîne du froid (exigence NFR). 
- *Alerte critique* : Le pipeline de la plateforme (streaming) doit détecter l'anomalie d'une benne frigorifique (ex: +4°C pendant > 15min) et expédier une notification "Panic" en **< 30 secondes (P95)**.
- *Isolation Data* : Pour éviter que ces 5 millions de "pings" par jour lèsent la base SQL de traçabilité (PostgreSQL), ces points temporels s'écriront asynchrone dans MongoDB (modèle NoSQL Time-Series).

### Objectif 3 — Sécurisation avancée des identités et accès (Cible : 01/03/2026)
Les clients sont en rivalité directe (concurrents commerciaux).
- **Standards** : Déploiement systématique de l'**OIDC** (OpenID Connect) et généralisation impérative de la **MFA**.
- **ABAC (Attribute-Based Access Control)** : Le simple RBAC n’est plus toléré. Si l’utilisateur A est "Manager Qualité" (Rôle) dans "l'Usine Nord" (Attribut), il n'a strictement aucun droit pour interroger l’API sur les données de "L'Usine Sud" de sa propre entreprise.

### Objectif 4 — Expérience mobile offline et résiliente ultra-fluide (Cible : 10/06/2026)
Beaucoup d'usines sont des "cages de Faraday" dénuées de Wifi (zones de métallurgie ou congélateurs industriels).
- L'application (React Native) exige un mode "Offline-First" avec synchronisation sur connexion retrouvée.
- **SLA Mobile** : La validation d'un chargement en bulk (scan palettes) par l'API doit avoir une latence de réponse **< 500 ms**.
- **Taux de crash acceptable maximal** : `< 0,5%`. L'API ne doit émettre ni erreurs inattendues 500, ni doublons (Idempotence).

### Objectif 5 — Rappel produit en moins de 15 minutes (Cible : 22/06/2026)
C'est la fonctionnalité phare du logiciel. 
Si la décision de rappel est actée, le backend NutriChain exécute son "algoritme de Recall". Il parcourt des millions de lots et palettes pour retrouver chaque supermarché, adresse, et distributeur receveur de la marchandise pathogène. Ce processus lourd (création des alertes en masse) doit être finalisé en moins de 15 minutes réelles, ce qui implique une vélocité sans faille sur les requêtes Prisma et les Sockets.

### Objectif 6 — Connecteurs d'Intégration normalisés ERP/WMS/TMS (Cible : 30/09/2026)
Toute entreprise doit pouvoir connecter NutriChain à ses machines rapidement. L'API exposera des SDK et des Endpoints (API Keys paramétrées) pour ingérer depuis SAP, Oracle, ou Navision. Pour les "Legacy clients" sans système REST, l'architecture servira un import asynchrone EDI / CSV qui doit être traité en moins de 60 secondes.

### Objectif 7 — Auditabilité renforcée (Logs Immuables) et Normes ISO (Cible : 30/09/2026)
Norme HACCP oblige : une action ne s'efface jamais (Auditabilité Pénale).
- **Log WORM (Write Once Read Many)** : Toute altération d'un modèle (édition de date, de quantité) conserve un audit absolu des changements ("Qui a fait quoi, et quand ?").
- **PCA/PRA (Plan de Continuité/Reprise d'Activité)** : En cas d'explosion serveur, l'infrastructure doit soutenir une perte maximale tolérée en temps de RPO (Loss) de **< 15 minutes**, avec un rétablissement opérationnel RTO de **60 à 120 minutes**.

### Objectif 8 — Chaîne CI/CD de Classe Industrielle (Cible : 10/03/2026)
Aucun déploiement manuel : 
- Tests unitaires complets sur chaque commit via Vitest (rapide et moderne).
- Vérifications drastiques du Typage TypeScript (`any` formellement banni).


---

## III. LES 6 PARTIES PRENANTES ("STAKEHOLDERS") MÉTIS & FRONTIÈRES

Les utilisateurs suivants attendent tous de notre plateforme logicielle des réponses à des enjeux radicalement différents, qu’il faut cloisonner pour maintenir une API "Clean" :

1. **L'Équipe Qualité et Assurances (Cibles primaires de conformité)** : 
   Exigent une sécurité de base de données irréprochable (Logs WORM et Historique sans trou). Ils se reposent sur la vitesse folle du Rappel Produit (15m).
2. **La Production (Cible Industrielle)** : 
   Des opérateurs avec des gros gants. Il faut des interfaces fluides où une pression erronée sur l’écran tactile est bloquée en instantanée avec une erreur HTTP (et une UI claire en retour).
3. **La Logistique (Cible Manutention - Stock)** : 
   Créateurs des flots d’événements en mode *Bulk*. Les camions ne peuvent pas patienter. L'API doit accepter l'enregistrement instantané d'une palette entière (un "SSCC" et de tous ses "Lots") en un éclair (< 500 ms de latence).
4. **La DSI Interne & Clients (Cible Architecturale)** : 
   Exigent que notre API propose une intégration parfaite. Ils requièrent une documentation automatique Swagger, immuable, qui garantit la rétrocompatibilité lors d’une version majeure. (Aucun field manquant, aucun type variant aléatoirement).
5. **Les Magasiniers (Cibles Finalité Opérationnelle)** : 
   Ils utilisent les applications mobiles de NutriChain sur le sol. Leur attrait principal est d'isoler au plus vite une palette dès l'ouverture de leur boutique.
6. **Le Consommateur Final B2C (Cible Web Viralité)** : 
   Il scanne un QR GS1 au supermarché. Si ce produit est à la télé et qu'il y a un choc de trafic, notre Route Publique GET B2C doit être suffisamment robuste (ou mise en Cache) pour afficher l'histoire du Lot au client final, sans jamais provoquer de dénis de service (DoS) involontaire effondrant le coeur BDB de traitement des données.

---

## IV. RÔLES EXPLICITES DE NOTRE ÉQUIPE

Voici le "Qui fait quoi" de la *Refonte 2026* pour assurer une progression continue :

- **PAUL (Chef de Projet & Lead Développeur API)** : C'est le cerveau de l'ombre. Il est chargé de toute la conception de l'architecture serveur Node.js. Il assure que les choix de la BDD permettent la traçabilité complexe, intègre `Prisma` selon les exigences de scalabilité, et que le modèle `GS1` soit implémenté sans dérive sémantique.
- **HUGO (Lead Développeur Frontend & Mobile)** : Magicien de l'User-Experience sous contrainte. Il doit sortir une Application Web d'administration sur `Svelte` extrêmement réactive et l'essentielle et épineuse App sur `React Native` pour les lecteurs industriels (gestion du mode déconnecté *Offline Local SQLite*, Scanner de Codes-Barres `ZXing`, etc.).
- **YOANN (Développeur "Renfort / Couteau Suisse")** : Sa polyvalence permet à l'équipe de tenir les échéances asymétriques. Selon la roadmap du sprint, il pourra dépanner le Frontend sur Figma/Svelte, coder des endpoints Node, et piloter les connecteurs ERP M2M (les moulinettes EDI & SAP).


---

## V. ÉTUDE D'ARCHITECTURE ET CHOIX DÉFINITIFS

Avant la validation du projet, un véritable "Benchmark & Audit" a été émis pour figer l'Architecture (Node vs Java, Monolithe vs Microservices, React vs Flutter vs Svelte, Postgres vs MongoSQL).

### A. L'Architecture Logique : Modulith & Hexagonal
L’architecture "Monolithe 3-Tiers basique" a été abandonnée : le couplage métier la rendrait inmaintenable avec nos contraintes (traçabilité, alertes, IoT sur la même base code intriquée). 
De l'autre côté, la "Stratégie Microservices Synchrones" a été refusée par la DSI pour la taille de notre équipe (le devOps et le maintien global requiert des compétences massives que Paul/Hugo/Yoann n'auront pas la possibilité d'amortir).

**La solution officielle** est donc l' **Architecture Monolithe Modulaire (Modulith)** couplée à l'approche **Hexagonale** :
- Une application unique (déploiement simple) mais au code totalement découpé et séquestré fonctionnellement (`Core`, `Identity`, `Traceability`, `Alerting`).
- L'infrastructure technique (Endpoint HTTP, Prisma DB) se contente de parler au "Cœur" du système ("Domaine"), via des Interfaces et des Ports. Ainsi, les règles vitales (Les métiers complexes P95 de Rappels) sont codées sans interférence directe de dépendances ExpressJS ou Fastify. Le respect strict de cette architecture *Clean Code* est l’exigence absolue posée par la hiérarchie.

### B. Stack Technologique Globale "Adoptée"
- **API & BACKEND** : `Node.js` a été vainqueur (78k req/sec) pour sa rapidité de dev et d'écosystème parfait, supporté par le langage impératif du typage fort `TypeScript`.
- **VALIDATION** : Le "Fail Fast" est assuré par `VineJS`, bloquant le mauvais Json instantanément côté Routeur (pour renvoyer une erreur 400 documentée) avant d'atteindre le processeur Métier.
- **SÉCURITÉ API/SSO** : Configuration minutieuse de **@better-auth**, apte à fusionner l'authentification OIDC + le complexe plugin ABAC.
- **RÉFÉRENTIELS BDD** : On utilise l'ORM `Prisma` surpuissant avec typage lié directement au front, reposant sur le moteur de base de données Relationnel principal **PostgreSQL**.
- **HISTORIQUE "DATA WORM"** : Parce que l'IoT sature tout, la politique "Data-lake NoSQL" incombe à **MongoDB** géré séparément ou avec Mongoose/Drivers dédiés pour écrire massivement sans locks transactionnels le log d'alertes IoT à la chaîne.
- **WEB APPLICATION FRONTEND** : Le Framework **Svelte** (pour fuir le surpoids de bundle que React générait, et ses performances extrêmes sur le long terme).
- **APPLI MOBILE INDUSTRIELLE** : Le plébiscité **React Native**, plus aisé à déployer pour l'équipe (partage lexical du JS du front et du Backend Node) que "Flutter".

---

## VI. DIAGRAMME DE LECTURE GLOBALE ET PERFORMANCE

L'application doit assurer un **Déploiement en Continue (CI/CD)** via Github Actions très robuste, pour se conformer au diagramme directeur initial sur l'Année (M1 à M12 du Gantt Chart approuvé) dont les Jalons capitaux :
1. Mois 3 : Livraison des Alertes Chaud/Froid M2M (-30s).
2. Mois 4 : Architecture Docker CI/CD finale.
3. Mois 6/7 : L'App Mobile React Native avec mode Déconnecté Opérationnelle.
4. Mois 7 : Test Grandeur Nature de RAPPEL PRODUIT à travers des instances de test (en visée de sa marque stratégique de 15 minutes max de runtime).
5. Mois 9/12 : Extension d'API ERP, Connecteurs WMS SAP, et consolidations WORM ISO définitives de fin d'année.

La totalité du développement sera cadrée par ce présent document de conception. La moindre décision s'écartant d'une de ces volontés stratégiques logistiques, techniques ("Clean Code", TypeScript strict) ou de sécurité (ABAC par lieu) expose un flanc fatal à la structure de NutriChain de par l'échelle colossale (18 Millions de Palettes tracées et d'interconnexion au Standard Mondial GS1).