NutriChain 
I. Sommaire 
NutriChain..............................................................................................................................................1 
I. Sommaire.....................................................................................................................................2 
II. Contexte du projet.......................................................................................................................3 
III. Objectifs S.M.A.R.T....................................................................................................................5 
A. Objectif 1 - Traçabilité complète et standardisée des lots (cible : 20/06/2026)..............5 
B. Objectif 2 — Alerte froide émise en moins de 30 secondes (p95) (cible : 15/03/2026)..5 
C. Objectif 3 — Sécurisation avancée des accès et de l'identité (cible : 01/03/2026).........5 
D. Objectif 4 — Expérience mobile fluide, rapide et résiliente (cible : 10/06/2026)..............6 
E. Objectif 5 — Processus de rappel produit en moins de 15 minutes (cible : 22/06/2026).
6 
F. Objectif 6 — Intégration normalisée avec les systèmes ERP/WMS/TMS (cible : 
30/09/2026)..............................................................................................................................6 
G. Objectif 7 — Auditabilité renforcée et conformité réglementaire totale (cible : 
30/09/2026)..............................................................................................................................6 
H. Objectif 8 — Mise en place d’une chaîne CI/CD fiable et industrielle (cible : 
10/03/2026)..............................................................................................................................7 
IV. Parties prenantes.......................................................................................................................7 
V. Rôles et responsabilités.............................................................................................................8 
VI. Diagramme de Gantt (M1 à M12).....................................................................................10 
VII. Indicateurs KPI.................................................................................................................11 
VIII. Comparaison d’architectures candidates........................................................................14 
A. Architecture monolithique 3-tiers..................................................................................14 
B. Architecture monolithique modulaire (Modulith) avec architecture hexagonale...........15 
C. Architecture microservices synchrones........................................................................16 
IX. Audit d’outils nécessaires face aux besoin du projet........................................................17 
X. Benchmark des langages de développement....................................................................20 
XI. Architecture retenue..........................................................................................................22 
XII. Langages de développement et outils retenus................................................................24 
A. Choix du backend et de l’API : Node.js........................................................................24 
B. Choix du frontend web : Svelte....................................................................................25 
C. Choix du développement mobile : React Native..........................................................26 
D. Choix de la base de données principale : PostgreSQL................................................27 
E. Choix de l’ORM : Prisma..............................................................................................28 
F. Usage complémentaire d’une base NoSQL : MongoDB (logging)................................28 
G. Conclusion...................................................................................................................28  
II. Contexte du projet 
Le secteur agroalimentaire est soumis à des exigences croissantes en matière de traçabilité, 
de sécurité sanitaire et de réactivité face aux incidents logistiques ou qualité. Les industriels, 
transformateurs, logisticiens et distributeurs doivent être capables d’identifier précisément 
l’origine des produits, de suivre chaque lot tout au long de son cycle de vie et d’intervenir 
rapidement en cas de non-conformité ou d’anomalie de température. Dans la réalité du terrain, 
ces entreprises fonctionnent encore avec une grande hétérogénéité d’outils : ERP incompatibles, 
tableurs utilisés comme système principal de suivi des lots, étiquetage non standardisé, 
capteurs de température déconnectés du système informatique et rappels produits gérés par 
e-mail. 
Ce fonctionnement fragmente la donnée, complique les croisements d’informations et 
ralentit considérablement les processus critiques, en particulier les rappels produits et la 
surveillance de la chaîne du froid. 
NutriChain, créé en 2021, intervient précisément dans ce contexte. L’entreprise fournit des 
solutions permettant de tracer les produits « de la ferme au rayon », de centraliser les 
événements logistiques selon les standards GS1/EPCIS et de surveiller la chaîne du froid en 
temps réel grâce à des capteurs IoT. Avec près de 18 millions de lots suivis, plus de 11 000 
capteurs de température déployés et un p95 ingest→alerte actuellement à 35 secondes, 
NutriChain fait face à une demande croissante de la part de plus de 75 clients répartis en 
France, Belgique et Espagne. 
L’ambition stratégique est d’accroître la fiabilité, la rapidité et l’automatisation des 
opérations, tout en préparant une expansion vers l’Allemagne et l’Italie à l’horizon 2026. 
Les systèmes actuels des clients présentent plusieurs limites structurelles. Les processus 
de réception, transformation et expédition ne sont pas uniformisés, et les informations critiques 
(GTIN, lots, DLC/DLUO, SSCC) sont souvent saisies manuellement, sans standardisation fiable. 
La chaîne du froid repose encore sur des enregistreurs USB ou des capteurs non intégrés, ce qui 
empêche l’obtention d’alertes en temps réel et génère un risque sanitaire réel. 
En cas de rappel produit, l’absence de traçabilité consolidée nécessite des opérations 
manuelles longues, sources d’erreurs, souvent incomplètes et parfois trop tardives. Ces 
NUTRICHAIN 
3 
contraintes augmentent significativement les risques opérationnels : rappel tardif, produits non 
conformes en rayon, données inexactes, interventions non documentées ou non auditées. 
Le projet NutriChain vise à refondre et moderniser l’application existante pour fournir une 
plateforme unifiée, fiable et interopérable, capable de gérer la traçabilité complète des lots, la 
surveillance continue de la chaîne du froid et l’exécution de rappels produits rapides et ciblés. 
Cette refonte s’appuie sur des exigences fortes : disponibilité mensuelle supérieure à 99,9 %, p95 
ingest→alerte froid inférieur à 30 secondes, stabilité mobile supérieure à 99,5 % et latence de 
scan inférieure à 500 millisecondes. 
La plateforme doit également garantir une sécurité avancée fondée sur OIDC, MFA et un 
contrôle d’accès ABAC, tout en assurant une traçabilité rigoureuse des actions via des logs 
immuables (WORM) et un plan de reprise d’activité robuste (RTO 60–120 min, RPO 15 min). 
Les enjeux internes sont tout aussi déterminants. Les parties prenantes (équipes qualité, 
production, logistique, DSI, magasins et consommateurs) attendent un système simple, rapide et 
f
iable permettant d’améliorer le suivi opérationnel, d’automatiser les contrôles et de centraliser 
les données critiques. Les opérations doivent s’inscrire dans un cadre réglementaire strict, 
incluant HACCP, ISO 22000 et les normes GS1. 
NutriChain doit également composer avec ses propres contraintes techniques : connecteurs 
ERP/WMS/TMS hétérogènes, stockage distribué, sécurité partielle, logs non WORM et 
observabilité encore insuffisante côté RUM. 
Dans ce contexte, la refonte NutriChain n’est pas seulement une évolution technique : c’est 
une transformation profonde des processus métier autour d’une architecture standardisée, 
orientée microservices, pilotée par les événements EPCIS et capable de gérer efficacement les 
scénarios critiques tels que l’excursion de température ou le rappel produit. Le MVP visé doit 
démontrer la capacité à scanner un lot, réaliser une transformation simple, l’expédier et retrouver 
l’intégralité de sa traçabilité. 
Cette base solide permettra d’étendre progressivement la couverture fonctionnelle, de 
renforcer la sécurité, d’améliorer la performance globale et de garantir une interopérabilité 
complète avec les systèmes des clients. 
NUTRICHAIN 
4 
III. Objectifs S.M.A.R.T. 
Dans le cadre de la refonte de la plateforme NutriChain, il est essentiel de formaliser des 
objectifs SMART clairs et partagés afin de guider la conception, prioriser les livrables et mesurer 
les progrès. Ces objectifs sont conçus pour être spécifiques, mesurables, atteignables, réalistes 
et datés. Ils traduisent les priorités opérationnelles observées sur le terrain (traçabilité, sécurité 
sanitaire, réactivité en cas de rappel, performance mobile et interopérabilité) et servent de base 
au pilotage du projet pour les équipes produit, développement, qualité et exploitation. 
A. Objectif 1 - Traçabilité complète et standardisée des lots (cible : 20/06/2026) 
Mettre en place un système EPCIS conforme GS1 permettant d’enregistrer et de restituer 
l’intégralité des événements logistiques (réception, transformation, agrégation, expédition) 
afin d’assurer une traçabilité amont/aval complète pour 100 % des lots couverts par le 
périmètre MVP, démontrable à la livraison du premier jalon. 
B. Objectif 2 — Alerte froide émise en moins de 30 secondes (p95) (cible : 
15/03/2026) 
Le système doit pouvoir détecter une excursion de température et générer une alerte en 
moins de 30 secondes (p95). Cela implique un pipeline de streaming optimisé, une ingestion 
f
iable et des mécanismes d’alerting tolérants aux pannes. L’objectif vise à réduire les pertes, 
limiter les risques sanitaires et permettre une intervention immédiate des équipes sur le 
terrain. 
C. Objectif 3 — Sécurisation avancée des accès et de l'identité (cible : 
01/03/2026) 
L’objectif consiste à généraliser l’authentification OIDC, à rendre la MFA obligatoire pour 
les rôles critiques et à établir une autorisation dynamique via un modèle ABAC. Ce 
renforcement des accès doit être pleinement opérationnel pour le livrable L2, afin de garantir 
NUTRICHAIN 
5 
une protection solide contre les accès non autorisés et d’assurer la conformité aux 
standards internes de sécurité. 
D. Objectif 4 — Expérience mobile fluide, rapide et résiliente (cible : 
10/06/2026) 
Le scan des lots doit être instantané, avec une latence inférieure à 500 ms et un taux de 
crash inférieur à 0,5 %. L’application mobile doit fonctionner hors-ligne, stocker localement 
les scans et synchroniser automatiquement les données. Cet objectif vise à garantir un 
usage fiable dans des environnements industriels souvent contraints (zones froides, 
entrepôts métalliques, faible réseau). 
E. Objectif 5 — Processus de rappel produit en moins de 15 minutes (cible : 
22/06/2026) 
Le système doit être capable d’exécuter un rappel complet (identification des lots 
concernés, ciblage, envoi des notifications et suivi des retraits) en moins de 15 minutes entre 
la décision initiale et la diffusion effective. Cet objectif est central pour réduire les risques 
sanitaires et améliorer la réactivité des équipes qualité. 
F. Objectif 6 — Intégration normalisée avec les systèmes ERP/WMS/TMS (cible : 
30/09/2026) 
L’objectif est d’assurer une interopérabilité fluide avec les systèmes clients grâce à des 
connecteurs normés (SAP, Oracle, Navision, WMS, TMS) et un support EDI/CSV pour les 
environnements legacy. Deux connecteurs opérationnels doivent être livrés dès le second 
livrable, afin de réduire les ressaisies manuelles et renforcer la cohérence des données. 
G. Objectif 7 — Auditabilité renforcée et conformité réglementaire totale (cible : 
30/09/2026) 
Le projet doit garantir une journalisation inviolable (WORM) couvrant l’ensemble des 
actions critiques, avec une rétention minimale de 30 jours. Les exigences HACCP, ISO 22000 
et internes doivent être respectées grâce à une gestion stricte des logs, un RPO de 15 
minutes et un RTO maximal de deux heures en cas d’incident majeur. 
NUTRICHAIN 
6 
H. Objectif 8 — Mise en place d’une chaîne CI/CD fiable et industrielle (cible : 
10/03/2026) 
La CI/CD doit permettre un déploiement continu en environnement de test, intégrer des 
tests unitaires et d'intégration systématiques, et garantir un temps de build et de 
déploiement maîtrisé. L’objectif est d’éliminer les erreurs humaines, d’accélérer les mises en 
production et de fournir un pipeline stable dès le livrable L2, puis entièrement opérationnel 
pour L3.  
IV. Parties prenantes 
La refonte de la plateforme NutriChain implique un ensemble d’acteurs internes et externes 
dont les besoins, responsabilités et contraintes influencent directement la conception du 
système. Leur compréhension est indispensable pour aligner les objectifs du projet sur les 
réalités opérationnelles du terrain et garantir l’adoption de la solution. Les parties prenantes 
identifiées se répartissent en six catégories principales : Qualité, Production, Logistique, DSI, 
Magasins et Consommateurs (B2C). 
Les équipes Qualité jouent un rôle central dans la traçabilité, le suivi des non-conformités et 
la gestion des rappels produits. Elles ont besoin d’un système fiable permettant d’identifier 
rapidement les lots concernés, de documenter les actions menées et de garantir la conformité 
aux normes HACCP et ISO 22000. Pour elles, la rapidité du rappel, la disponibilité des données et 
l’intégrité des logs WORM sont essentielles. 
Les équipes de Production sont responsables de l’enregistrement des événements de 
transformation, d’agrégation et d’expédition. Leur efficacité dépend d’interfaces simples, rapides 
et adaptées aux contraintes d’un environnement industriel. Elles attendent un système 
permettant de réduire les saisies manuelles, d’éviter les erreurs de lot et de fluidifier la saisie et 
le scan grâce à des standards GS1/EPCIS. 
Les équipes Logistiques gèrent les réceptions, les mouvements de stock, les palettes 
(SSCC) et les expéditions. Leur priorité est d’obtenir un suivi en temps réel des flux physiques et 
un accès immédiat aux événements EPCIS pour garantir la cohérence entre les stocks 
NUTRICHAIN 
7 
théoriques et réels. Elles dépendent par ailleurs d’une application mobile robuste, fonctionnant 
hors-ligne et capable de synchroniser les scans dans des zones à faible couverture réseau. 
La Direction des Systèmes d’Information (DSI) supervise l’intégration de la plateforme avec 
les systèmes internes et externes, notamment les ERP, WMS et TMS. Elle est particulièrement 
attentive aux aspects de sécurité (OIDC, MFA, ABAC), de disponibilité, de PRA/PCA et 
d’observabilité. La DSI attend une architecture standardisée, interopérable et évolutive, capable 
de s’intégrer dans un écosystème déjà complexe. 
Les équipes Magasins interviennent principalement sur la consultation des lots, la 
vérification des dates, la gestion des retraits et l’exécution des rappels en rayon. Elles ont besoin 
d’un portail simple d’utilisation, rapide et accessible depuis mobile, permettant de confirmer la 
présence ou l’absence de produits concernés. 
Enfin, les Consommateurs (B2C) doivent pouvoir vérifier un lot via un code ou un QR scan, 
consulter l’historique du produit et être informés efficacement en cas de rappel. Leur expérience 
doit être transparente, fiable et sécurisée, car elle influe directement sur la confiance dans la 
marque. 
En résumé, ces différentes parties prenantes imposent une solution fiable, interopérable et 
adaptée aux réalités du terrain. Leur diversité souligne l’importance d’une plateforme capable de 
répondre à des exigences opérationnelles, réglementaires et techniques tout en garantissant une 
adoption fluide par l’ensemble de la chaîne de valeur. 
V. Rôles et responsabilités 
La réussite de la refonte de la plateforme NutriChain repose sur une coordination claire et 
une répartition précise des responsabilités au sein de l’équipe projet. Définir ces rôles permet de 
garantir la cohérence dans la réalisation des livrables, d’éviter les doublons et de responsabiliser 
chaque membre sur ses missions. L’équipe projet est composée de trois développeurs aux 
compétences complémentaires et d’un chef de projet assurant la supervision globale. 
Nom 
Paul 
Rôle 
Chef de projet et développeur 
API 
Responsabilités 
Coordination globale du projet, suivi du planning et 
communication avec le client. Développement de 
l’API principale. Implémentation des flux EPCIS, de la 
NUTRICHAIN 
8 
traçabilité des lots et de la gestion des événements 
logistiques. Garantie de la qualité technique des 
livrables et du respect des exigences de sécurité et 
de performance. 
Hugo 
Yoann 
Développeur Front-end / 
Mobile 
Développeur polyvalent 
Développement des interfaces web et mobiles de la 
plateforme. Optimisation de l’expérience utilisateur 
pour des environnements industriels contraints 
(zones froides, faible connectivité). Conception et 
implémentation des écrans de consultation, de scan 
des lots et de suivi des alertes, en garantissant 
rapidité, fiabilité et ergonomie. 
Contribution transversale à l’ensemble du projet. 
Intervention selon les priorités sur l’API, le front-end 
ou l’intégration avec les systèmes clients 
(ERP/WMS/TMS). Support aux autres développeurs 
et adaptation rapide aux besoins du projet afin de 
garantir l’avancement des travaux dans les délais. 
Cette répartition assure que chaque composant de la plateforme NutriChain est pris en 
charge par un responsable dédié, tout en maintenant une collaboration étroite entre les 
membres de l’équipe. L’organisation garantit une exécution efficace, conforme aux exigences du 
client, et facilite la maintenance et l’évolution future de la solution. 
Le cadrage du projet NutriChain est désormais complet et partagé avec l’équipe. Nous 
validons le contexte métier, les objectifs SMART avec dates cibles, les parties prenantes et la 
répartition des rôles. Les responsabilités de chaque membre de l’équipe sont claires et alignées 
sur les besoins opérationnels. La méthodologie SCRUM, les KPI principaux et la planification 
préliminaire sont définis pour suivre l’avancement. 
La prochaine étape du livrable consiste à passer à la conception détaillée : architecture cible, 
anticipation des besoins et préparation de l’infrastructure. 
NUTRICHAIN 
9 
VI. Diagramme de Gantt (M1 à M12) 
10 
NUTRICHAIN 
VII. Indicateurs KPI 
KPI 
Traçabilité (EPCIS) 
Couverture de 
traçabilité 
Définition 
Objectif / Seuil Importance 
Pourcentage de lots / palettes 
/ produits complètement 
> 98% 
Indique si les données sont 
complètes et exploitables 
NUTRICHAIN 
11 
retracés (réception → 
transformation → expédition) 
pour un rappel. 
Taux d’évènements 
EPCIS valides 
Pourcentage d’évènements 
conformes au standard GS1 
(structure, champs 
obligatoires) 
> 99% Garantir l’interopérabilité 
avec ERP / WMS. 
Temps moyen de 
reconstruction d’un 
arbre de traçabilité 
Délai pour générer la vue 
complète d’un lot (upstream + 
downstream) 
< 2 secondes Impact direct sur la vitesse 
de décision lors d’un rappel 
Taux d’erreurs de scan 
(mobile ou poste fixe) 
Pourcentage de scans 
invalides, illisibles ou non 
reconnus 
< 3% Mesure la qualité des 
données entrantes et la 
facilité d’usage pour les 
opérateurs. 
Chaîne du froid / IOT 
Temps p95 ingest → 
alerte 
Temps entre lecture capteur 
et affichage alerte 
< 30 secondes 
(exigence NFR) 
KPI critique pour la sécurité 
alimentaire 
Nombre d’excursions 
par mois 
Nombre de dépassements de 
seuils détectés 
< 15 Permet de repérer des sites 
problématiques 
Durée moyenne 
d’excursion 
Temps entre début 
d’excursion et action 
corrective 
< 10 minutes Impact sur le risque sanitaire 
et pertes produits. 
Taux de perte de 
messages IOT 
Pourcentage de mesures non 
reçues (packet loss) 
< 0.1% Indique la robustesse de 
l’ingestion IOT. 
Rappels produits 
Temps médian entre 
décision et notification 
Délai pour que les 
magasins/clients reçoivent la 
notification après décision de 
rappel 
< 15 minutes KPI stratégique pour la 
conformité réglementaire. 
Taux de rappel 
complété 
Pourcentage de quantités 
rappelées contre les quantités 
ciblées 
> 90% Mesure l’efficacité réelle du 
rappel. 
Taux de faux positifs Pourcentage de produits 
rappelés alors qu’il n’étaient 
pas concernés 
< 1% Impact direct sur coût et 
confiance clients. 
Taux de clôture d’un 
rappel 
Durée totale du début à la 
clôture 
Selon les 
normes internes 
Pour reporting interne 
(COPIL, QSE). 
Performance et UX mobile 
Latence par scan Temps entre scan et 
validation 
< 500ms (NFR) Impact sur ergonomie et 
productivité 
 
  
NUTRICHAIN 12 
 
Taux de crash mobile Pourcentage de sessions se 
terminant par un crash 
< 0.5% (NFR) Garantit la fiabilité de 
l’application. 
Temps de chargement 
des écrans critiques  
Accès dashboard, scan, 
alerte 
< 1 seconde Impact adoption utilisateur 
Interopérabilité / Intégrations 
Taux d’imports 
ERP/WMS réussis 
Pourcentage de fichiers / API 
ingérées sans erreur 
> 99% Critique pour clients legacy. 
Temps de traitement 
d’un import CSV/EDI 
Parsing + validation + 
transformation 
< 60 secondes Pouvoir ne pas retarder la 
traçabilité 
Taux de normalisation 
automatique 
Pourcentage de données mal 
formées correctement 
corrigées 
> 90% Réduit le besoin 
d’intervention humaine 
Sécurité et conformité 
Taux de tentatives 
d’accès non autorisées 
bloquées 
Nombre d’incidents par mois Tendance en 
baisse continue 
Suivi cybersécurité 
Utilisateurs MFA activité Pourcentage de comptes 
sensibles 
100% pour rôles 
importants / 
administrateurs 
Garantir la conformité et 
l’auditabilité. 
Logs disponibles et 
immuables 
Pourcentage de logs 
conservés > 30 jours 
(WORM) 
> 99.9% (NFR) Exigence légale de 
traçabilité 
SLA / Résilience 
Disponibilité du service Pourcentage de l’uptime 
mensuel 
> 99.9% (NFR) Impact sur les opérations 
critiques 
RTO Temps de restauration après 
incident 
60-120 minutes 
(NFR) 
Limite interruption chaîne de 
traçabilité 
RPO Perte maximale de données < 15 minutes 
(NFR) 
Garantit l’intégrité des 
données IOT / EPCIS 
Coûts et non qualité 
Coût mensuel des 
pertes produits 
Valeur des produits détruits 
suite à excursion ou rappel 
En baisse 
continue 
KPI financier essentiel 
Nombre d’incidents 
qualité 
Rappels, excursions, erreurs 
de lot, etc. 
En baisse 
continue 
Permet classification des 
causes récurrentes 
Adoption utilisateur 
Taux d’utilisation de 
l’app/scans 
Nombre de scans par 
opérateur par jour 
En croissance 
continue 
Mesure adoption API & UI 
 
  
NUTRICHAIN 13 
 
Temps moyen de 
formation 
Durée pour qu’un nouvel 
opérateur soit autonome 
< 2 heures 
KPI ergonomie et 
onboarding. 
VIII. Comparaison d’architectures candidates 
Dans le cadre du projet NutriChain, une phase de réflexion préalable a été menée afin d’identifier 
les architectures logicielles les plus adaptées aux enjeux du système. 
Cette analyse est réalisée indépendamment des choix technologiques afin d’évaluer les impacts 
de chaque architecture sur la maintenabilité, l’évolutivité, la disponibilité et la complexité globale 
du projet. 
Trois architectures principales ont été étudiées : 
● l’architecture monolithique 3-tiers, 
● l’architecture monolithe modulaire associée à une architecture hexagonale, 
● l’architecture microservices synchrones. 
Les sections suivantes détaillent le principe de chacune de ces architectures, ainsi que leurs 
avantages et inconvénients dans le contexte spécifique du projet NutriChain. 
A. Architecture monolithique 3-tiers 
(API + logique métier + base de données unique) 
L’architecture monolithique 3-tiers repose sur une application unique regroupant l’ensemble des 
fonctionnalités du système. 
Cette application est structurée en trois couches principales : 
● une couche de présentation ou d’API (exposition des endpoints), 
● une couche de logique métier, 
● une couche de persistance, reposant sur une base de données unique. 
L’ensemble est déployé et exécuté comme un seul artefact logiciel. 
L’un des principaux avantages de cette architecture est sa simplicité de mise en œuvre. Le 
déploiement est direct, la configuration est centralisée et les interactions entre composants sont 
réalisées par des appels directs en mémoire. 
NUTRICHAIN 
14 
Cette simplicité facilite également le débogage, notamment en phase de démarrage du projet, 
car l’ensemble du système peut être analysé depuis un point unique. 
Dans un contexte de développement initial ou de preuve de concept, cette approche permet 
d’obtenir rapidement une première version fonctionnelle du produit. 
Cependant, cette architecture présente plusieurs limites pour un projet tel que NutriChain. 
Le couplage fort entre les différentes parties du système implique que toute évolution 
fonctionnelle ou technique peut impacter l’ensemble de l’application. Cela rend le travail en 
parallèle plus complexe et augmente le risque de régressions. 
Par ailleurs, NutriChain intègre des aspects hétérogènes, notamment la gestion d’événements de 
traçabilité, des alertes temps réel et des flux simulés liés à l’IoT. Dans une architecture 
monolithique 3-tiers, ces traitements peuvent entrer en concurrence pour les mêmes ressources 
(runtime, base de données), ce qui peut entraîner des problèmes de performance ou de 
saturation lorsque le volume d’événements augmente. 
Enfin, cette architecture offre une faible flexibilité d’évolution, notamment si le système devait à 
terme être découpé ou distribué. 
L’architecture monolithique 3-tiers constitue une solution simple et efficace pour des 
applications de petite taille, mais elle montre rapidement ses limites dès que les domaines 
métier se complexifient ou nécessitent une évolution indépendante. 
B. Architecture monolithique modulaire (Modulith) avec architecture 
hexagonale 
L’architecture monolithe modulaire repose sur une application unique, mais dont le code est 
structuré par domaines métier clairement identifiés (par exemple : catalogue produit, traçabilité, 
rappels, alertes). 
Chaque module est conçu comme une unité cohérente, avec des frontières explicites. 
L’utilisation de principes issus de l’architecture hexagonale renforce cette séparation en 
distinguant : 
● le cœur métier (indépendant des technologies), 
● les ports (interfaces définissant les besoins du métier), 
● les adaptateurs (implémentations techniques telles que l’API REST ou l’accès à la base 
de données). 
NUTRICHAIN 
15 
Cette architecture combine la simplicité de déploiement du monolithe avec une organisation 
interne beaucoup plus robuste. 
La structuration par domaines réduit le couplage entre les fonctionnalités et améliore la lisibilité 
du code, ce qui est particulièrement bénéfique dans un projet collaboratif. 
Les frontières explicites introduites par l’architecture hexagonale facilitent : 
● l’écriture de tests unitaires et d’intégration, 
● l’évolution du système sans impact global, 
● le remplacement ou l’adaptation de composants techniques. 
Dans le contexte de NutriChain, cette approche permet de modéliser correctement les domaines 
métier (traçabilité, chaîne du froid, rappels) tout en conservant une base de code unique et 
maîtrisable. 
Bien que plus structurée qu’un monolithe classique, cette architecture reste un monolithe du 
point de vue du déploiement. 
L’application conserve donc un point de défaillance unique et ne bénéficie pas nativement des 
avantages de la distribution (scalabilité indépendante, isolation complète des pannes). 
De plus, cette approche nécessite une discipline de conception plus importante. Sans règles 
claires, les frontières entre modules peuvent être progressivement contournées, ce qui réduit les 
bénéfices attendus. 
L’architecture monolithe modulaire constitue un compromis équilibré entre simplicité et qualité 
architecturale. Elle est particulièrement adaptée aux projets de taille moyenne souhaitant 
préparer une éventuelle évolution vers une architecture distribuée, sans en subir immédiatement 
la complexité. 
C. Architecture microservices synchrones 
(REST / gRPC, base de données par service) 
L’architecture microservices synchrones repose sur un découpage du système en plusieurs 
services indépendants, chacun responsable d’un domaine métier spécifique. 
Chaque microservice est déployé de manière autonome et communique avec les autres via des 
appels synchrones (HTTP REST ou gRPC). 
NUTRICHAIN 
16 
Chaque service dispose généralement de sa propre base de données afin de garantir une 
isolation forte. 
Cette architecture offre un découplage fort entre les domaines métier, permettant des 
déploiements indépendants et une évolution ciblée des fonctionnalités. 
Elle améliore également la disponibilité globale du système : la défaillance d’un service non 
critique n’entraîne pas nécessairement l’indisponibilité de l’ensemble de la plateforme. 
Dans un contexte industriel à grande échelle, cette approche facilite la montée en charge, 
l’organisation par équipes et l’intégration de nouvelles fonctionnalités. 
L’architecture microservices introduit cependant une complexité opérationnelle importante. Elle 
nécessite des outils et des pratiques avancées en matière de CI/CD, de monitoring, de gestion 
des logs et de gestion des erreurs réseau. 
Dans le cadre d’un projet comme NutriChain, le risque principal est le sur-découpage prématuré. 
Mettre en place une architecture microservices avant d’avoir validé les besoins fonctionnels 
réels peut entraîner une complexité excessive sans bénéfice immédiat, notamment pour un MVP. 
La gestion des transactions distribuées et la cohérence des données entre services représentent 
également des défis non négligeables. 
L’architecture microservices synchrones est particulièrement adaptée aux systèmes complexes 
et à grande échelle, mais elle peut s’avérer contre-productive lorsqu’elle est adoptée trop tôt. Son 
intérêt est réel sur le long terme, mais son coût initial est élevé. 
IX. Audit d’outils nécessaires face aux besoin du 
projet 
Besoin 
Outil de conception et pilotage du projet 
Gestion de projet 
Outil / Langage 
Rédaction CDC et spécificités du projet 
Jira / Trello 
Notion / Google Docs 
NUTRICHAIN 
17 
Diagrammes Draw.io / Lucidchart 
Roadmap du projet Notion / Jira 
Documentation technique développeur Markdown sur Git 
Design UX/UI 
Wireframes Figma 
Design system Figma 
Prototypes dynamiques Figma 
Icônes Material Icons 
Mindmap / Visualisation des processus Miro 
Développement Frontend Web 
IDE VSCode / Suite JetBrains / Cursor 
Framework web React / Vue / Svelte 
UI Material UI / Tailwind / Ant Design 
Charts KPI Recharts / Chart.js 
Authentification JWT / OAuth2 
App admin Web App responsive 
Développement Mobile (Android et iOS) 
IDE VSCode / Suite JetBrains / Cursor 
Simulateurs Android Studio et XCode 
App mobile cross-platform Flutter / React Native / SvelteNative 
Accès caméra SDK natif / dépendance 
Scan code-barres ZXing / ML Kit 
Notifications Firebase / OneSignal 
Mode offline Stockage local (SQLite) 
Backend et API 
API Rest Node.js / Java / Python / Rust / .NET 
Gestion évènements EPCIS API custom 
Authentification API / Keycloak 
 
  
NUTRICHAIN 18 
 
Notifications Email / Push 
Rappels produits Workflow backend 
Simulation IOT API REST mock 
Documentation API Swagger / OpenAPI 
Base de données 
Choix type BDD Relationnelle / Non-relationnelle 
Si relationnelle PostgreSQL / MySQL 
Si non-relationnelle MongoSQL 
ORM relationnel Prisma / Sequelize 
ORM non-relationnel Mongoose 
Tests et qualité 
Tests unitaires Jest / JUnit / PyTest 
Tests API  Postman 
Tests E2E Cypress 
Tests mobile Tests manuels documentés 
Tests charge k6 
Qualité et couvrage SonarQube 
DevOps et CI/CD 
Versioning Github / Gitlab 
CI/CD Github Actions 
Environnements Dev / Pré-prod / Prod 
Build mobile Pipeline automatisé 
Déploiement Container Docker sur serveur VPS 
Sécurité et conformité 
Authentification JWT / OAuth2 
Rôles Hiérarchie des rôles 
Logs Immuables 
Audit trail Qui / Quand / Quoi 
 
  
NUTRICHAIN 19 
 
RGPD Données minimales 
IOT et Chaine du froid 
Ingestion capteurs API REST 
Données simulées Script ou mock endpoint 
Alertes Notifications PUSH / Email 
X. Benchmark des langages de développement 
 
 
Développement Frontend Web 
 React Vue Svelte  
Performance 
(bundle, TTI) 
Bon mais plus lourd Bon et meilleur que 
React 
Meilleure 
performance 
globale 
Temps de 
chargement 
Moyen Bon Rapide 
Taille du bundle ~45-70 KB ~35-50 KB ~15-25 KB  
DOM Virtuel Oui Oui Non 
Courbe 
d’apprentissage 
Moyenne Moyenne Facile 
Ecosystème Très large Moyen Petit mais croissant 
Communauté Très grande Grande Petite 
Documentation Très riche Bonne Bonne 
Adoption 
entreprise 
Très élevée Elevée Faible 
Cas d’usage Grandes 
applications 
complexes 
Projets flexibles Performances 
extrêmes et MVPs 
Prise en main 
personnelle des 
développeurs du 
projet 
Très facile Moyenne Facile 
 
  
NUTRICHAIN 20 
 
Développement mobile 
 React Native Flutter  
Performance Bonne Très bonne 
Bridge natif Oui Non 
UI 
cross-plateform 
Variable Identique 
Communauté Très grande Grande 
Réutilisabilité du 
code 
Elevé (++ si React 
en parallèle)  
Elevé 
Courbe 
d’apprentissage 
Facile (++ si React 
connu) 
Moyenne  
Taille de l’app Plus petite que 
Flutter 
Plus grande que RN 
Ecosystème 
dépendances 
Très large Large 
UI demandante 
et animations 
Contraintes en 
fonction de la 
demande 
Très fluide 
Prise en main 
personnelle des 
développeurs du 
projet 
Facile Difficile 
Backend et API 
 Node.js Java / SpringBoot Python Rust 
Performance 
(RPS) 
Moyenne (78k) Bonne (243k) Moyenne (30k) Très bonne (320k) 
Ecosystème Très grand Grand Grand Moyen 
Courbe 
d’apprentissage 
Faible Moyenne à élevée Moyenne Elevée 
Documentation Très riche Très riche Bonne Correcte 
Communauté Très grande Très grande Très grande Plus restreinte 
Temps de 
développement 
Rapide Plus lent que 
Node.js 
Rapide Lent 
Facilité de tests Bonne Très bonne Très bonne Bonne 
 
  
NUTRICHAIN 21 
 
Prise en main 
personnelle des 
développeurs du 
projet 
Facile 
Moyenne 
XI. Architecture retenue 
Moyenne 
Difficile 
Les exigences de ce projet impliquent une logique métier riche, fortement orientée événements, 
avec des règles fonctionnelles critiques (auditabilité, intégrité des données, historisation). 
Dans ce contexte, le choix de l’architecture logicielle doit répondre à plusieurs objectifs : 
● garantir une bonne structuration du métier, 
● permettre une évolution progressive du système, 
● rester réaliste et maîtrisable dans le cadre d’un projet académique réalisé par une équipe 
réduite. 
L’architecture monolithique classique, bien que simple à mettre en œuvre, présente des limites 
importantes face à la diversité des domaines fonctionnels de NutriChain. Le regroupement de la 
traçabilité, de la gestion des alertes, de la chaîne du froid et du reporting dans un même noyau 
faiblement structuré entraîne un couplage fort, rendant l’évolution et la maintenance plus 
complexes. 
À l’inverse, une architecture microservices, bien qu’adaptée à des systèmes industriels à grande 
échelle, introduit une complexité significative en termes d’infrastructure, de déploiement, de 
communication réseau et d’observabilité. Dans le cadre d’un projet académique, cette 
complexité représenterait un coût disproportionné par rapport à la valeur fonctionnelle 
réellement apportée, en particulier pour un MVP. 
L’architecture monolithe modulaire permet de concilier les avantages des deux approches 
précédentes. 
Elle repose sur une application unique, facilitant le déploiement et la mise en œuvre, tout en 
imposant une séparation stricte des domaines métier. 
Dans NutriChain, cette séparation se traduit naturellement par des modules correspondant aux 
grands domaines : 
NUTRICHAIN 
22 
● gestion du catalogue et des référentiels, 
● traçabilité des lots et événements EPCIS, 
● supervision de la chaîne du froid, 
● gestion des alertes et rappels produits, 
● reporting et indicateurs. 
Chaque module est conçu comme une unité cohérente, responsable de son propre périmètre 
fonctionnel, ce qui améliore la lisibilité du code et réduit les dépendances croisées. 
L’intégration des principes de l’architecture hexagonale renforce encore la pertinence de ce 
choix. 
En isolant le cœur métier des préoccupations techniques (API REST, base de données, services 
externes, simulation IoT), NutriChain bénéficie d’un modèle où la logique fonctionnelle reste 
indépendante des choix technologiques. 
Cette approche est particulièrement adaptée au projet pour plusieurs raisons : 
● la traçabilité et les règles métier EPCIS peuvent être testées indépendamment de 
l’infrastructure, 
● les sources de données (capteurs simulés, entrées manuelles, API externes) peuvent 
évoluer sans remise en cause du métier, 
● l’architecture facilite la simulation de composants (IoT, alertes), ce qui correspond aux 
contraintes pédagogiques du projet. 
L’architecture hexagonale contribue également à une meilleure testabilité, en permettant de 
valider les cas d’usage métier sans dépendre d’une base de données ou d’un serveur HTTP. 
Un autre avantage majeur de l’architecture monolithe modulaire avec architecture hexagonale 
est sa capacité à préparer une évolution vers une architecture plus distribuée, sans réécriture 
complète du système. 
Les modules métiers, déjà bien délimités et faiblement couplés, peuvent être extraits 
ultérieurement sous forme de microservices si le contexte l’exige (montée en charge, exigences 
de disponibilité accrues, organisation par équipes). 
NUTRICHAIN 
23 
Ainsi, l’architecture retenue s’inscrit dans une logique d’évolution progressive, en cohérence 
avec les pratiques industrielles. 
Au regard des exigences fonctionnelles de NutriChain, des contraintes opérationnelles décrites 
dans la synthèse détaillée et du cadre académique du projet, l’architecture monolithe modulaire 
s’appuyant sur les principes de l’architecture hexagonale apparaît comme le choix le plus 
pertinent. 
Elle permet : 
● une structuration claire et robuste des domaines métier, 
● une maîtrise de la complexité technique, 
● une forte testabilité, 
● et une évolutivité raisonnée vers des architectures plus distribuées. 
Ce choix offre ainsi un équilibre optimal entre rigueur architecturale, faisabilité et crédibilité 
industrielle, en adéquation avec les objectifs du projet NutriChain. 
XII. Langages de développement et outils retenus 
Les choix retenus visent à garantir un équilibre entre performance, maintenabilité et faisabilité, 
tout en tenant compte du contexte académique du projet et de la taille réduite de l’équipe de 
développement. 
A. Choix du backend et de l’API : Node.js 
Le backend de NutriChain est chargé de gérer : 
● des APIs REST exposant les fonctionnalités métier, 
● des flux événementiels liés à la traçabilité (EPCIS), 
● des règles métier critiques (alertes, rappels produits), 
● des interactions avec des applications web et mobiles, 
NUTRICHAIN 
24 
● une logique de simulation pour les données IoT. 
Ces besoins impliquent une API réactive, maintenable et capable de traiter un volume 
raisonnable de requêtes avec une latence maîtrisée. 
Node.js a été retenu pour le développement de l’API pour les raisons suivantes : 
● Productivité élevée : la simplicité de JavaScript et la rapidité de mise en œuvre 
permettent de livrer rapidement un MVP fonctionnel. 
● Asynchronisme natif : le modèle event-driven de Node.js est bien adapté au traitement 
d’événements de traçabilité et à la gestion de flux asynchrones. 
● Écosystème très mature : disponibilité de bibliothèques pour l’authentification, la 
validation des données, la documentation d’API et la gestion des bases de données. 
● Bonne performance pour le besoin métier : les performances mesurées sont largement 
suffisantes au regard des volumes attendus dans NutriChain. 
● Cohérence full-stack : l’utilisation de JavaScript sur l’ensemble de la stack simplifie le 
partage de modèles, de validations et de bonnes pratiques entre frontend, mobile et 
backend. 
Ainsi, Node.js représente un compromis équilibré entre performance, flexibilité et rapidité de 
développement. 
B. Choix du frontend web : Svelte 
Le frontend web de NutriChain vise principalement : 
● l’administration des données, 
● la visualisation des indicateurs (KPI), 
● la consultation des informations de traçabilité, 
● l’ergonomie pour des utilisateurs professionnels. 
Les priorités sont donc la performance perçue, la simplicité du code et une expérience utilisateur 
f
luide. 
NUTRICHAIN 
25 
Svelte a été retenu pour le frontend web pour les raisons suivantes : 
● Excellentes performances : l’absence de Virtual DOM permet des temps de chargement 
rapides et une faible latence à l’interaction. 
● Taille de bundle réduite : un bundle plus léger améliore l’expérience utilisateur, 
notamment sur des connexions limitées. 
● Simplicité du code : la syntaxe de Svelte est plus concise et lisible, ce qui réduit la 
complexité du frontend. 
● Adaptation aux besoins du projet : les écrans d’administration et de visualisation 
bénéficient directement des performances offertes par Svelte. 
● Approche moderne : Svelte favorise une architecture claire et un état de l’art en matière 
de développement frontend. 
Bien que l’écosystème soit plus restreint que celui de React, il reste suffisant pour les besoins du 
projet NutriChain. 
C. Choix du développement mobile : React Native 
Les applications mobiles NutriChain sont destinées aux opérateurs terrain, avec des contraintes 
spécifiques : 
● utilisation sur Android et iOS, 
● accès à la caméra pour le scan de QR codes et codes-barres, 
● fonctionnement en mode hors ligne, 
● notifications push, 
● ergonomie et réactivité. 
React Native a été retenu pour le développement mobile pour les raisons suivantes : 
● Développement cross-platform : une base de code unique pour Android et iOS, réduisant 
les coûts et le temps de développement. 
● Très grande communauté : abondance de plugins pour l’accès au matériel (caméra, 
stockage, notifications). 
NUTRICHAIN 
26 
● Bonne performance native : suffisante pour les usages terrain (scan, navigation, 
synchronisation). 
● Réutilisation des compétences JavaScript : cohérence avec le backend Node.js et une 
partie du frontend. 
● Maturité industrielle : largement utilisé en production dans des applications mobiles 
complexes. 
Ce choix permet de répondre efficacement aux contraintes terrain tout en garantissant la 
maintenabilité de l’application mobile. 
D. Choix de la base de données principale : PostgreSQL 
Le projet NutriChain doit garantir : 
● l’intégrité des données, 
● la traçabilité complète des événements, 
● l’auditabilité et l’historisation, 
● la gestion de relations complexes (produits, lots, événements, alertes). 
PostgreSQL a été retenu comme base de données principale pour les raisons suivantes : 
● Modèle relationnel robuste : adapté aux données structurées et fortement liées. 
● Transactions ACID : essentielles pour garantir la cohérence des données de traçabilité. 
● Support avancé des types de données : JSON, timestamps précis, indexation 
performante. 
● Maturité et fiabilité : base de données largement utilisée dans des systèmes critiques. 
● Adaptation à l’audit trail : possibilité de tables immuables (append-only) pour l’historique. 
PostgreSQL répond ainsi parfaitement aux exigences de fiabilité et de conformité du projet. 
NUTRICHAIN 
27 
E. Choix de l’ORM : Prisma 
Prisma a été retenu pour l’accès aux données pour les raisons suivantes : 
● Typage fort et sécurité : génération de types garantissant la cohérence entre le code et la 
base de données. 
● Productivité : simplifie l’écriture des requêtes et réduit les erreurs. 
● Intégration native avec Node.js : cohérence avec le backend choisi. 
● Migrations maîtrisées : versionnement clair du schéma de base de données. 
L’utilisation de Prisma contribue à la maintenabilité et à la robustesse du backend. 
F. Usage complémentaire d’une base NoSQL : MongoDB (logging) 
Pour les besoins de journalisation, de logs applicatifs et d’événements techniques, une base 
NoSQL de type MongoDB peut être utilisée en complément : 
● Schéma flexible : adapté aux logs hétérogènes. 
● Écriture rapide : optimisée pour l’ingestion de volumes élevés de données. 
● Décorrélation du métier : évite de polluer la base relationnelle principale. 
● Scalabilité horizontale : adaptée à la croissance des logs. 
Ce choix permet de séparer les préoccupations métier et techniques tout en facilitant l’analyse 
et le debugging. 
G. Conclusion 
Les choix technologiques retenus pour NutriChain résultent d’un compromis raisonné entre 
performance, maintenabilité, maturité des outils et contraintes organisationnelles. 
L’utilisation de Node.js, Svelte, React Native et PostgreSQL constitue une stack cohérente, 
moderne et adaptée aux exigences fonctionnelles du projet, tout en restant réaliste dans un 
cadre académique. 
NUTRICHAIN 
28 
Cette stack permet également une évolution progressive du système, tant sur le plan fonctionnel 
que technique.

Livrable 2 - Nutrichain
CADET HUGO
DELAMARE Paul
GIMENEZ Yoann
s
I. Détails manquants lors du Livrable 1
A. Lien entre fonctionnalités clés, KPI et méthode de mesure
Chaque KPI est directement rattaché à une fonctionnalité critique du système, permettant de
mesurer concrètement la valeur métier apportée par la plateforme et de piloter les
améliorations continues.
Feature NutriChain KPI associé Objectif / Seuil Méthode de mesure
Scan & traçabilité
EPCIS (réception →
expédition)
Couverture de traçabilité > 98% % de lots ayant un graphe
complet (requête DB sur
événements EPCIS)
Moteur de rappel
produit ciblé
Temps médian de rappel < 15 min Timestamp entre décision de
rappel et envoi notification
Pipeline IoT (capteurs
→ alertes)
Temps p95 ingest → alerte < 30 sec Mesure entre timestamp
capteur et création alerte
Application mobile (scan
opérateur)
Latence de scan < 500 ms Temps entre scan et réponse
API (logs frontend +
backend)
Détection anomalies
chaîne du froid
Nombre d’excursions < 15 / mois Comptage mensuel des
alertes générées
Système de notification
(email/SMS/API)
Taux de réception des alertes > 99% % notifications envoyées vs
reçues (logs + accusés)
Logs WORM & audit
trail
Disponibilité des logs > 99.9% % logs disponibles sur 30
jours
B. Comparaison d’architecture (tableau clair)
Architecture Avantages Risques / Limites Pertinence pour
NutriChain
Monolithe 3-tiers Simple à développer,
rapide pour MVP
Couplage fort, faible
scalabilité, difficile à
maintenir
Peu adapté (complexité
métier élevée)
Monolithe modulaire Bonne séparation Discipline nécessaire, point Très adapté (MVP +
(hexagonal) métier, testabilité,
évolutivité progressive
de défaillance unique évolution)
Microservices
synchrones
Scalabilité,
découplage fort,
déploiement
indépendant
Complexité élevée, coût
infra, gestion réseau
difficile
Possibilité d’être
surdimensionné et incapacité
de rendre un POC
suffisamment complet
Le choix du monolithe modulaire avec architecture hexagonale représente un compromis
optimal entre :
● simplicité de mise en œuvre (adapté au contexte académique),
● structuration métier robuste,
● capacité d’évolution vers des microservices à moyen terme.
C. Parties prenantes → tableau acteur / besoin / succès
La formalisation suivante permet de relier directement les besoins métier aux indicateurs de
performance (KPI) et aux fonctionnalités implémentées dans Nutrichain.
Acteur Besoin principal Critère de réussite
Équipe Qualité Identifier rapidement les lots à risque Rappel lancé en < 15 min
Production Enregistrer les transformations sans erreur < 3% d’erreurs de scan
Logistique Suivre les flux en temps réel 100% des événements EPCIS
enregistrés
DSI Intégration sécurisée et stable > 99.9% disponibilité + MFA
actif
Magasins Vérifier rapidement les produits à retirer Consultation lot < 2 sec
Consommateurs (B2C) Vérifier si un produit est concerné par un
rappel
Réponse via QR code en < 3
sec
II. Architecture retenue
Les exigences de ce projet impliquent une logique métier riche, fortement orientée
événements, avec des règles fonctionnelles critiques (auditabilité, intégrité des données,
historisation).
Dans ce contexte, le choix de l’architecture logicielle doit répondre à plusieurs objectifs :
● garantir une bonne structuration du métier,
● permettre une évolution progressive du système,
● rester réaliste et maîtrisable dans le cadre d’un projet académique réalisé par une
équipe réduite.
L’architecture monolithique classique, bien que simple à mettre en œuvre, présente des
limites importantes face à la diversité des domaines fonctionnels de NutriChain. Le
regroupement de la traçabilité, de la gestion des alertes, de la chaîne du froid et du reporting
dans un même noyau faiblement structuré entraîne un couplage fort, rendant l’évolution et la
maintenance plus complexes.
À l’inverse, une architecture microservices, bien qu’adaptée à des systèmes industriels à
grande échelle, introduit une complexité significative en termes d’infrastructure, de
déploiement, de communication réseau et d’observabilité. Dans le cadre d’un projet
académique, cette complexité représenterait un coût disproportionné par rapport à la valeur
fonctionnelle réellement apportée, en particulier pour un MVP.
L’architecture monolithe modulaire permet de concilier les avantages des deux approches
précédentes.
Elle repose sur une application unique, facilitant le déploiement et la mise en œuvre, tout en
imposant une séparation stricte des domaines métiers.
Dans NutriChain, cette séparation se traduit naturellement par des modules correspondant
aux grands domaines :
● gestion du catalogue et des référentiels,
● traçabilité des lots et événements EPCIS,
● supervision de la chaîne du froid,
● gestion des alertes et rappels produits,
● reporting et indicateurs.
Chaque module est conçu comme une unité cohérente, responsable de son propre périmètre
fonctionnel, ce qui améliore la lisibilité du code et réduit les dépendances croisées.
L’intégration des principes de l’architecture hexagonale renforce encore la pertinence de ce
choix.
En isolant le cœur métier des préoccupations techniques (API REST, base de données,
services externes, simulation IoT), NutriChain bénéficie d’un modèle où la logique
fonctionnelle reste indépendante des choix technologiques.
Cette approche est particulièrement adaptée au projet pour plusieurs raisons :
● la traçabilité et les règles métier EPCIS peuvent être testées indépendamment de
l’infrastructure,
● les sources de données (capteurs simulés, entrées manuelles, API externes) peuvent
évoluer sans remise en cause du métier,
● l’architecture facilite la simulation de composants (IoT, alertes), ce qui correspond
aux contraintes pédagogiques du projet.
L’architecture hexagonale contribue également à une meilleure testabilité, en permettant de
valider les cas d’usage métier sans dépendre d’une base de données ou d’un serveur HTTP.
Un autre avantage majeur de l’architecture monolithe modulaire avec architecture
hexagonale est sa capacité à préparer une évolution vers une architecture plus distribuée,
sans réécriture complète du système.
Les modules métiers, déjà bien délimités et faiblement couplés, peuvent être extraits
ultérieurement sous forme de microservices si le contexte l’exige (montée en charge,
exigences de disponibilité accrues, organisation par équipes).
Ainsi, l’architecture retenue s’inscrit dans une logique d’évolution progressive, en cohérence
avec les pratiques industrielles.
Au regard des exigences fonctionnelles de NutriChain, des contraintes opérationnelles
décrites dans la synthèse détaillée et du cadre académique du projet, l’architecture
monolithe modulaire s’appuyant sur les principes de l’architecture hexagonale apparaît
comme le choix le plus pertinent.
Elle permet :
● une structuration claire et robuste des domaines métier,
● une maîtrise de la complexité technique,
● une forte testabilité,
● et une évolutivité raisonnée vers des architectures plus distribuées.
Ce choix offre ainsi un équilibre optimal entre rigueur architecturale, faisabilité et crédibilité
industrielle, en adéquation avec les objectifs du projet NutriChain.
III. Modélisation de l’architecture et des bases de
données
A. Processus de réception
Lien du processus de réception produit
Corfirme la fin c
FHASE6- Aflfectation a une
PHASE 7
locallsés
Application Nurithan Systöme Nutrithar
Trace 'alerte de pécurite sanitaire
Traçabllité (EPC
B. Processus de transformation
C. Processus de rappel produit
Lien du processus de rappel produit
D. Base de données
0. Tables utilitaires
● Table Unite (canonicalisation des unités) — Liste des unités et facteurs de
conversion
○ code : Postgres text — Prisma String — Identifiant court de l’unité (ex:
"L", "kg", "u").
○ nom : Postgres text — Prisma String — Nom lisible de l’unité.
○ factor_to_base : Postgres numeric — Prisma Decimal — Facteur de
conversion vers l’unité de référence (pour normaliser les quantités).
● Table EPCIS_Event (optionnel mais recommandé pour traçabilité évènementielle)
— Events EPCIS pour reconstituer la chronologie métier
○ id : Postgres uuid — Prisma String (uuid) — Identifiant unique de
l’événement.
○ event_time : Postgres timestamptz — Prisma DateTime — Horodatage
de l’événement.
○ event_type : Postgres text / ENUM — Prisma String / Enum — Type
d’événement (RECEPTION, TRANSFORMATION, ...).
○ related_entity : Postgres text — Prisma String — Table ou entité liée
("lot","reception"...).
○ related_id : Postgres text — Prisma String — Identifiant de la
ressource liée (uuid ou string).
○ payload : Postgres jsonb — Prisma Json — Données détaillées
(métadonnées, mesures).
1. Table Lieux (Le plan de l'usine) — Zones physiques de l'usine
● id : Postgres uuid — Prisma String (uuid) — Identifiant unique du lieu.
● nom : Postgres text — Prisma String — Nom lisible (ex : “Entrepôt Nord”).
● type : Postgres text / ENUM — Prisma String / Enum — Catégorie (Stockage,
Transformation, Quai).
● description : Postgres text — Prisma String — Informations complémentaires
(accès, contraintes).
2. Table Materiel (L'inventaire technique) — Machines, frigos, cuves
● id : Postgres uuid — Prisma String (uuid) — Identifiant unique du matériel.
● nom : Postgres text — Prisma String — Libellé (ex : “Frigo n°3”).
● type : Postgres text / ENUM — Prisma String / Enum — Catégorie (FROID,
CHAUD, MIXEUR).
● id_lieu : Postgres uuid — Prisma String (uuid) — FK → Lieux.id,
localisation physique.
● statut : Postgres text / ENUM — Prisma String / Enum — État opérationnel
(PRET, EN_NETTOYAGE, ALERTE, EN_UTILISATION).
● temp_actuelle : Postgres numeric — Prisma Decimal — Valeur cache de la
température (source de vérité = Temperature_Log).
● temp_seuil_max : Postgres numeric — Prisma Decimal — Seuil à partir duquel
on déclenche alerte.
● qr_code_id : Postgres text — Prisma String — Identifiant scannable pour
attacher un opérateur.
● last_cleaned_at : Postgres timestamptz — Prisma DateTime — Timestamp
du dernier nettoyage validé.
3. Table Lot (La "vie" du produit) — Suivi d’un batch / lot physique
● id : Postgres uuid — Prisma String (uuid) — Identifiant unique (ou GS1 si
applicable).
● id_produit : Postgres uuid — Prisma String (uuid) — FK → Produit.id.
● quantite_actuelle : Postgres numeric — Prisma Decimal — Quantité
restante dans l’unité unite.
● unite : Postgres text — Prisma String — Référence Unite.code.
● quantite_base : Postgres numeric — Prisma Decimal — Quantité convertie en
unité de référence (pour checks).
● date_peremption : Postgres timestamptz — Prisma DateTime — DLC /
DLUO.
● statut : Postgres text / ENUM — Prisma String / Enum — (EN_STOCK,
CONSOMME, EXPEDIE, QUARANTAINE, REBUT).
● id_materiel_actuel : Postgres uuid — Prisma String (uuid) — FK →
Materiel.id (position courante).
● date_creation : Postgres timestamptz — Prisma DateTime — Date de
création du lot.
● created_by : Postgres uuid — Prisma String (uuid) — FK → User.id.
● version : Postgres integer — Prisma Int — Version pour optimistic locking (si
utilisé).
4. Table Transformation (Le lien de parenté) — Événement production (N parents → 1
enfant)
● id : Postgres uuid — Prisma String (uuid) — Identifiant de l’opération.
● id_lot_enfant : Postgres uuid — Prisma String (uuid) — FK → Lot.id du
lot créé.
● id_produit_fini : Postgres uuid — Prisma String (uuid) — FK →
Produit.id attendu.
● id_recette : Postgres uuid (nullable) — Prisma String (uuid) — FK →
Recette_Composition.id pour validation.
● id_user : Postgres uuid — Prisma String (uuid) — FK → User.id
(opérateur initiateur).
● id_materiel : Postgres uuid — Prisma String (uuid) — FK →
Materiel.id utilisé.
● statut : Postgres text / ENUM — Prisma String / Enum — (EN_COURS,
TERMINE, ANNULE, ERREUR).
● note_technique : Postgres jsonb — Prisma Json — Paramètres machine et
métadonnées.
● horodatage_debut : Postgres timestamptz — Prisma DateTime — Début de
l’opération.
● horodatage_fin : Postgres timestamptz (nullable) — Prisma DateTime — Fin
de l’opération.
● duration_seconds : Postgres integer (nullable) — Prisma Int — Durée
calculée (optionnel).
4bis. Table Transformation_Composition (Pivot) — Détail des prélèvements pour une
transformation
● id_transformation : Postgres uuid — Prisma String (uuid) — FK →
Transformation.id.
● id_lot_parent : Postgres uuid — Prisma String (uuid) — FK → Lot.id
parent.
● quantite_prelevee : Postgres numeric — Prisma Decimal — Quantité
prélevée (dans unite).
● unite : Postgres text — Prisma String — Unite.code.
● lot_parent_epuise : Postgres boolean — Prisma Boolean — True si le parent
est vidé après prélèvement.
● note : Postgres text — Prisma String — Commentaire / conversion appliquée.
5. Table User & Role (Sécurité) — Comptes utilisateurs et rôle
● id : Postgres uuid — Prisma String (uuid) — Identifiant user.
● nom_prenom : Postgres text — Prisma String — Nom complet.
● email : Postgres text — Prisma String — Adresse email (unique côté
application).
● password_hash : Postgres text — Prisma String — Hash du mot de passe.
● id_role : Postgres uuid — Prisma String (uuid) — FK → Role.id.
● mfa_enabled : Postgres boolean — Prisma Boolean — MFA activé ou non.
● last_login : Postgres timestamptz — Prisma DateTime — Dernière
connexion.
(Table Role : id uuid, name text — ex: OPERATOR, RECEPTION, QUALITE, ADMIN.)
6. Table Produit (Catalogue) — Référentiel produit et conservation
● id : Postgres uuid — Prisma String (uuid) — Identifiant produit.
● nom : Postgres text — Prisma String — Libellé produit (Yaourt nature).
● code_gtin : Postgres text — Prisma String — GTIN / code-barres GS1.
● categorie : Postgres text — Prisma String — Catégorie (Produit fini, Matière
première...).
● duree_conservation_defaut : Postgres integer — Prisma Int — Durée en
jours pour DLC par défaut.
● seuil_alerte_stock : Postgres numeric — Prisma Decimal — Seuil
commande/réappro.
● unite_reference : Postgres text — Prisma String — Unite.code référence.
7. Table Expedition — Bon de livraison / shipment
● id : Postgres uuid — Prisma String (uuid) — Identifiant expédition.
● id_client : Postgres uuid — Prisma String (uuid) — FK → Client.id.
● shipment_id : Postgres text (UNIQUE) — Prisma String — Identifiant
transporteur (SSCC) pour idempotence.
● date_envoi : Postgres timestamptz — Prisma DateTime — Date et heure
d’envoi.
● transporteur : Postgres text — Prisma String — Nom du transporteur.
● statut_livraison : Postgres text / ENUM — Prisma String —
(PREPARATION, EN_ROUTE, LIVRE, RETOURNE).
● created_by : Postgres uuid — Prisma String (uuid) — FK → User.id.
8. Table Client — Destinataires / points de vente
● id : Postgres uuid — Prisma String (uuid) — Identifiant client.
● nom_enseigne : Postgres text — Prisma String — Nom commercial.
● contact_urgence : Postgres text — Prisma String — Téléphone / email
responsable qualité.
● adresse_livraison : Postgres text — Prisma String — Adresse complète.
● notes : Postgres text — Prisma String — Notes opérationnelles (SLA,
contraintes).
9. Table Alerte (La réactivité 30s) — Alertes critiques & notifications
● id : Postgres uuid — Prisma String (uuid) — Identifiant alerte.
● type : Postgres text / ENUM — Prisma String — TEMPÉRATURE /
DLC_PROCHE / ...
● niveau_gravite : Postgres text / ENUM — Prisma String — INFO / WARNING
/ CRITIQUE.
● message : Postgres text — Prisma String — Texte descriptif de l’alerte.
● id_materiel : Postgres uuid (nullable) — Prisma String (uuid) — FK →
Materiel.id si applicable.
● related_entity : Postgres text — Prisma String — Entité liée (ex: "lot").
● related_id : Postgres text — Prisma String — Identifiant lié.
● statut : Postgres text / ENUM — Prisma String — ACTIVE / ACQUITTEE /
RESOLUE.
● created_at : Postgres timestamptz — Prisma DateTime — Création de l’alerte.
● resolved_by : Postgres uuid (nullable) — Prisma String (uuid) — FK →
User.id.
● resolved_at : Postgres timestamptz (nullable) — Prisma DateTime —
Résolution horodatée.
Comportement : DB/worker évalue les règles (ex: règle température) et crée
Alerte. Push WebSocket sur création.
10. Table Audit_Log — Journal immuable d’actions
● id : Postgres bigserial — Prisma Int — Identifiant séquentiel.
● id_user : Postgres uuid (nullable) — Prisma String (uuid) — Qui a effectué
l’action.
● action : Postgres text — Prisma String — Libellé action (ex: "Modification
statut").
● entity : Postgres text — Prisma String — Table impactée.
● entity_id : Postgres text — Prisma String — Identifiant de la ligne affectée.
● ancienne_valeur : Postgres jsonb — Prisma Json — Valeur avant modification.
● nouvelle_valeur : Postgres jsonb — Prisma Json — Valeur après modification.
● prev_hash : Postgres text — Prisma String — Hash du log précédent
(chaînage).
● signature_hash : Postgres text — Prisma String — Hash courant (intégrité).
● horodatage : Postgres timestamptz — Prisma DateTime — Horodatage.
11. Table Liaison_Expedition — Contenu du camion / mapping lot ↔ expédition
● id : Postgres uuid — Prisma String (uuid) — Identifiant.
● id_expedition : Postgres uuid — Prisma String (uuid) — FK →
Expedition.id.
● id_lot : Postgres uuid — Prisma String (uuid) — FK → Lot.id.
● quantite_expediee : Postgres numeric — Prisma Decimal — Quantité
embarquée.
● unite : Postgres text — Prisma String — Unite.code.
● pallet_id : Postgres text (nullable) — Prisma String — Identifiant palette /
agrégation.
12. Table Fournisseur — Origine amont / producteur
● id : Postgres uuid — Prisma String (uuid) — Identifiant fournisseur.
● nom_ferme : Postgres text — Prisma String — Nom ferme/producteur.
● type_produit : Postgres text — Prisma String — (Bio, AOP, Conventionnel).
● contact_qualite : Postgres text — Prisma String — Contact qualité
(tel/email).
● adresse_siege : Postgres text — Prisma String — Adresse siège social.
13. Table Reception — Entrée en usine / réception camion
● id : Postgres uuid — Prisma String (uuid) — Identifiant réception.
● id_fournisseur : Postgres uuid — Prisma String (uuid) — FK →
Fournisseur.id.
● shipment_id : Postgres text (UNIQUE NOT NULL) — Prisma String —
Identifiant transporteur pour idempotence.
● date_reception : Postgres timestamptz — Prisma DateTime — Date et heure
d’arrivée.
● temperature_camion_summary : Postgres jsonb — Prisma Json — Résumé
min/max/avg.
● temperature_camion_raw : Postgres jsonb (nullable) — Prisma Json — Séries
brutes (optionnel).
● statut_controle : Postgres text / ENUM — Prisma String — (CONFORME,
REFUSE, EN_ATTENTE_ANALYSE).
● received_by : Postgres uuid — Prisma String (uuid) — FK → User.id.
Processus : idempotence via shipment_id; si non-conforme → Alerte CRITIQUE
+ Audit_Log; création des Lot initiaux à l’arrivée.
14. Table Nettoyage_Maintenance — Hygiène & interventions
● id : Postgres uuid — Prisma String (uuid) — Identifiant intervention.
● id_materiel : Postgres uuid — Prisma String (uuid) — FK →
Materiel.id.
● id_user : Postgres uuid — Prisma String (uuid) — FK → User.id.
● type_action : Postgres text — Prisma String — Nettoyage complet /
Désinfection / Maintenance.
● produit_utilise : Postgres text — Prisma String — Produit chimique utilisé.
● date_debut : Postgres timestamptz — Prisma DateTime — Début intervention.
● date_fin : Postgres timestamptz — Prisma DateTime — Fin intervention.
● valid_until : Postgres timestamptz — Prisma DateTime — Validité du
nettoyage (ex: 24h).
15. Table Performance_Stats — Métriques & KPIs
● id : Postgres bigserial — Prisma Int — Identifiant métrique.
● type_metrique : Postgres text — Prisma String — TEMPS_SCAN,
LATENCE_ALERTE, etc.
● valeur : Postgres numeric — Prisma Decimal — Valeur mesurée.
● id_reference : Postgres uuid (nullable) — Prisma String (uuid) —
Référence optionnelle (lot/alerte).
● horodatage : Postgres timestamptz — Prisma DateTime — Horodatage
métrique.
Recomm. stocker ces séries en TimescaleDB si possible.
16. Table Gestion_Rebuts — Pertes / déchets
● id : Postgres uuid — Prisma String (uuid) — Identifiant.
● id_lot : Postgres uuid — Prisma String (uuid) — FK → Lot.id.
● quantite_jetee : Postgres numeric — Prisma Decimal — Quantité mise au
rebut.
● unite : Postgres text — Prisma String — Unite.code.
● motif : Postgres text — Prisma String — Raison du rebut.
● date_mise_au_rebut : Postgres timestamptz — Prisma DateTime — Date du
rebut.
● created_by : Postgres uuid — Prisma String (uuid) — Opérateur ayant
enregistré.
17. Table Controle_Qualite — Résultats laboratoire
● id : Postgres uuid — Prisma String (uuid) — Identifiant du test.
● id_lot : Postgres uuid — Prisma String (uuid) — FK → Lot.id.
● type_test : Postgres text — Prisma String — Type de test (Listeria, pH...).
● resultat : Postgres text / ENUM — Prisma String / Enum — CONFORME /
NON_CONFORME.
● id_user_labo : Postgres uuid — Prisma String (uuid) — Technicien
laboratoire.
● certificat_pdf : Postgres text — Prisma String — URL/chemin du
document.
● date_test : Postgres timestamptz — Prisma DateTime.
● notes : Postgres text — Prisma String.
Règle métier : lot enfant passe QUARANTAINE → EN_STOCK uniquement si
resultat = CONFORME.
18. Table Temperature_Log (Historique) — Séries temporelles IoT
● id : Postgres bigserial — Prisma Int — Identifiant séquentiel.
● id_materiel : Postgres uuid — Prisma String (uuid) — FK →
Materiel.id.
● valeur : Postgres numeric — Prisma Decimal — Valeur mesurée (°C).
● unite : Postgres text — Prisma String — Unité (ex: "C").
● horodatage : Postgres timestamptz — Prisma DateTime — Timestamp lecture.
Recomm. hypertable / partitioning + retention policy.
19. Table Recette_Composition (Garde-fou) — Recettes théoriques et tolérances
● id : Postgres uuid — Prisma String (uuid) — Identifiant recette.
● id_produit_fini : Postgres uuid — Prisma String (uuid) — FK →
Produit.id.
● id_type_ingredient : Postgres uuid / text — Prisma String — Catégorie
ingrédient (Lait, Ferment...).
● quantite_theorique : Postgres numeric — Prisma Decimal — Quantité
attendue.
● unite : Postgres text — Prisma String — Unite.code.
● tolerance_percent : Postgres numeric — Prisma Decimal — Tolérance
acceptée en %.
20. Table Lot_Mouvement (nouveau, essentiel) — Historique append-only des
mouvements
● id : Postgres bigserial — Prisma Int — Identifiant séquentiel.
● id_lot : Postgres uuid — Prisma String (uuid) — FK → Lot.id.
● type_action : Postgres text — Prisma String — RECEPTION /
TRANSFORMATION_CONSOMMATION / ...
● quantite : Postgres numeric — Prisma Decimal — Quantité impactée.
● unite : Postgres text — Prisma String — Unite.code.
● id_transformation : Postgres uuid (nullable) — Prisma String (uuid) — FK
→ Transformation.id.
● id_expedition : Postgres uuid (nullable) — Prisma String (uuid) — FK →
Expedition.id.
● id_user : Postgres uuid (nullable) — Prisma String (uuid) — Opérateur
initiateur.
● created_at : Postgres timestamptz — Prisma DateTime — Horodatage
écriture mouvement.
● metadata : Postgres jsonb — Prisma Json — Données additionnelles (raison,
références).
Rôle : append-only — base de la reconstruction de l’historique et des audits.
NutriChain a été conçu pour digitaliser l’intégralité du cycle de vie des produits, de la ferme
au rayon, en garantissant traçabilité, intégrité et actionnabilité en cas d’incident. Le point
d’entrée est la chaîne logistique amont : chaque fournisseur est répertorié et chaque
livraison donne lieu à une entrée structurée (Reception) identifiée de façon idempotente
par un shipment_id (SSCC/BL). Cette contrainte d’unicité empêche le
double-enregistrement des réceptions et constitue la première garantie contre les erreurs
humaines et les replays IoT. Lors d’une réception, les lectures de température du camion
sont stockées (résumé + lectures brutes si nécessaire) et évaluées selon une règle
paramétrable ; si la règle est violée (par exemple : > 4 °C pendant ≥ 10 minutes
consécutives ou un pic > 8 °C), le système crée immédiatement une Alerte critique,
marque la réception comme REFUSE et génère les événements de traçabilité
(EPCIS_Event) et d’audit (Audit_Log). Les lots initiaux créés à la réception sont associés
à la source (fournisseur) et contiennent quantité, unité et quantité convertie en unité de
référence pour faciliter la vérification des bilans matières.
La table Lot est la vérité opérationnelle des quantités : elle contient quantite_actuelle,
son unité d’origine et une quantite_base canonique. Toute modification de quantité ou de
statut s’accompagne obligatoirement d’un enregistrement append-only dans
Lot_Mouvement pour permettre la reconstruction complète de l’historique matériel. Les
règles métier appliquées sont strictes : on ne modifie jamais un lot sans écrire un
mouvement, on ne supprime pas ces mouvements et on applique des checks pour
empêcher des quantités négatives. Un lot passe en CONSOMME quand sa
quantite_actuelle atteint zéro ; un lot enfant créé lors d’une production est inséré
initialement avec le statut QUARANTAINE et ne peut être libéré pour la vente qu’après
validation explicite du laboratoire (Controle_Qualite = CONFORME).
La transformation est un événement métier atomique qui relie N lots parents à un lot enfant.
Le processus doit être encapsulé dans une transaction courte et verrouiller les parents
(SELECT ... FOR UPDATE) pour éviter le sur-prélèvement concurrentiel. Le flux idéal :
verrouillage des lots parents, conversion des quantités prélevées en unités de référence via
la table Unite, vérification de suffisance, insertion du lot enfant (statut=QUARANTAINE),
insertion du Transformation et des lignes Transformation_Composition, mise à
jour des quantités parents et écriture des Lot_Mouvement correspondants, puis commit. Si
la validation de recette (Recette_Composition) échoue (hors tolérance), la
transformation doit produire une alerte qualité et laisser le lot enfant en quarantaine — elle
ne doit pas être automatiquement libérée. Si une erreur se produit pendant la transaction, le
rollback annule tout ; si un incident survient après le commit, une procédure de
compensation claire (script idempotent qui recrédite parents et injecte
Lot_Mouvement(type=AJUSTEMENT)) doit être disponible.
La gestion des unités est non négociable : toutes les conversions s’effectuent à l’écriture en
utilisant Unite.factor_to_base et la quantite_base est persistée. Les contrôles
empêchent l’écriture d’un prélèvement supérieur à la disponibilité (après conversion). Cette
approche évite les erreurs de calculs à la volée et facilite la vérification des bilans en batch.
Par ailleurs, les recettes doivent inclure une tolerance_percent : lors d’une
transformation, on compare la composition réelle avec la théorique et l’on déclenche une
alerte ou une mise en erreur si la déviation dépasse la tolérance documentée.
L’alerte et la surveillance temps réel reposent sur une ingestion sécurisée des données IoT :
chaque capteur envoie des lectures signées/authentifiées vers le service d’ingestion, qui
écrit Temperature_Log (hypertable ou partitions journalières recommandées) et émet les
évaluations de règles sur des fenêtres glissantes. Lorsqu’une condition d’alerte est
rencontrée, le worker crée une Alerte, met à jour le statut des lots affectés
(QUARANTAINE), écrit les Lot_Mouvement nécessaires et pousse une notification via
WebSocket / push mobile aux opérateurs concernés. La latence cible pour la chaîne
ingestion→alerte doit être inférieure à 30 s pour respecter les exigences métier.
La traçabilité et l’intégrité des logs sont assurées par deux mécanismes complémentaires :
EPCIS_Event pour les événements métier interopérables et Audit_Log append-only avec
chaînage cryptographique (prev_hash + signature_hash). Des triggers AFTER
INSERT/UPDATE/DELETE sur les tables critiques (Lot, Reception, Transformation,
Expedition, Alerte) doivent générer automatiquement ces entrées d’audit. Les permissions
DB doivent interdire toute suppression ou modification directe d’un audit ; les clés de
signature sont gérées via un secret manager externe pour garantir l’intégrité hors de la base.
L’expédition est structurée autour d’un shipment_id unique et d’une table de jointure
Liaison_Expedition reliant lots et expéditions (avec possibilité d’agrégation par
pallet_id). Pour permettre un rappel rapide, la base maintient une table dérivée
lot_current_location (mise à jour à chaque expédition) indexée sur id_lot : en cas
d’alerte produit, on interroge directement cette table pour retrouver les clients impactés en
temps constant/rapide. Le scénario de rappel documentaire : identification du lot suspect,
récupération des clients via lot_current_location, création d’un
EPCIS_Event(RECALL) et d’une Alerte CRITIQUE, blocage des préparations en cours
et envoi de notifications aux clients et autorités selon SLA.
Sur la partie performance et maintien, les tables de séries temporelles (Temperature_Log,
Performance_Stats) doivent être optimisées via TimescaleDB ou partitioning, avec des
politiques de rétention (ex. 2 ans) et routage vers un data lake (Parquet) pour l’archivage à
long terme. Les tables volumineuses (Lot_Mouvement) doivent être partitionnées
(mois/année) si le débit l’exige. Indices essentiels : IDX_Lot(id_produit, statut),
IDX_Liaison_Expedition(id_lot), IDX_Temperature_Log(id_materiel,
horodatage DESC) et IDX_Lot_Mouvement(id_lot, created_at DESC). Ces
choix permettent aux requêtes critiques (rappel, recherche lot→client, agrégations
temporelles) d’être réalisées en quelques millisecondes.
La robustesse opérationnelle passe par des workers découplés : ingestion IoT, évaluation de
règles, réconciliation mass balance, purge/archivage, et compensation des transformations.
Ces workers doivent consommer depuis une file (Kafka/Rabbit) afin d’éviter de bloquer les
transactions utilisateur et permettre un redémarrage sur événements non traités. Les
triggers DB n’ont pas à contenir de logique métier lourde ; ils servent à garantir l’écriture
d’événements d’audit et à alimenter la file.
Côté sécurité et gouvernance, applique RBAC fin : rôles Reception, Operateur,
Qualite, Logistique, Admin. Restreint l’accès aux opérations sensibles via RLS et MFA
pour Qualite et Admin. Les backups sont quotidiens avec WAL shipping pour un RPO
faible ; les exports vers data lake servent d’archive immuable. Conformément aux exigences
réglementaires, conserver les logs d’audit pendant la durée légale, chiffrés et horodatés de
manière infalsifiable.
Enfin, prépare la montée en charge et les tests : jeux de tests unitaires DB (transactions de
transformation, conversions d’unités), tests d’intégration bout-à-bout (réception →
transformation → QC → expédition → rappel), tests de charge sur ingestion IoT et mesure
de la latence d’alerte (p95 < 30 s). Documente les procédures opératoires pour les cas
d’erreur (transformation interrompue, réception refusée, dérive de mass balance) et fournis
des scripts idempotents de compensation. Avec ces règles et mécanismes en place,
NutriChain devient un système traçable, défendable en audit sanitaire, et capable d’exécuter
un rappel produit rapide et fiable tout en gardant une base de données cohérente et fidèle à
la réalité terrain.
Lien du schéma de la base de données
IV. Maquettes de l’interface web et mobile
Lien des maquettes de Nutrichain
A. Interface web
N
NutriChain Recherche de lots
Traçabilité & qualité
PILOTAGE
AA Tableau de bord
Recherche de lots
Filtres avancés - GTIN, lot, SSCC, produit, site, dates, statut.
Q Recherche globale: lot, GTIN, SSCC.. 3 alertes froid Déconnexion
ព
↑
Recherche lots
Fiche lot
Traçabilité
GTIN
356007...
N° lot SSCC Site Statut
L-2025-08912 0037612... Tous
Lot QUALITÉ & RISQUES Produit GTIN Site Dernière temp.
Chaîne du froid L-2025-08912 Yaourt nature bio 4x125g 3560070891234 Bretagne Nord Conforme 3.8°C
Non-conformités
L-2025-08801 Emmental tranché 3560070456789 RDC IDF Surveillance 5,1°C
Rappels produits
RÉSEAU
Portail magasins
Intégrations
SYSTÈME
Utilisateurs
Audit & logs
NutriChain v2.4-GS1/EPCIS
L-2025-08744 Salade barquette 3560070123456 Loire Quarantaine 9.2°C
Appliquer
M
NutriChain
Traçabilité & qualité
Tableau de bord
Vue d'ensemble
PILOTAGE
KPI temps réel - lots suivis, alertes, rappels et synchronisations.
AA Tableau de bord
Q Recherche globale: lot, GTIN, SSCC...
ព
1
Recherche lots
Fiche lot
Traçabilité
QUALITÉ & RISQUES
Chaîne du froid
Non-conformités
Rappels produits
RÉSEAU
Portail magasins
Intégrations
SYSTÈME
Utilisateurs
Audit & logs
12847
LOTS SUIVIS (30 J) ALERTES CHAÎNE DU FROID RAPPELS EN COURS ANOMALIES OUVERTES SYNC. INTÉGRATIONS
3 1 7
+4,2% vs. période
précédente
2 en investigation Yaourt bio -lot ciblé 3 quarantaine active
99%
Dernier flux WMS il y a 2 min
Activité récente (EPCIS)
Aujourd'hui 14:32 ObjectEvent -réception
SSCC 00376123456789012345 Site Bretagne Nord
Aujourd'hui 13:05
Transformation - découpe
Lot L-2025-08912 conforme НАССР
Hier-18:40
Aggregation - palette
EPCIS 2.0 expédition vers RDCÎle-de-France
À traiter
Validation qualité - 5 bons de réception en attente de visa.
Rappel RAP-2025-014 - retrait magasin à 78%- voir le suivi
NutriChain v2.4-GS1/EPCIS
3 alertes froid Déconnexion
N
NutriChain
Traçabilité & qualité
PILOTAGE
AA
ព
Tableau de bord
Recherche lots
Fiche lot
Traçabilité
QUALITÉ & RISQUES
Ο
Chaîne du froid
Non-conformités
Rappels produits
RÉSEAU
Portail magasins
Intégrations
Traçabilité
Arbre de traçabilité
Vue amont/aval-matières premières vers produits finis et expéditions.
AMONT -MATIERE
Lait cru - Ferme Les Aubépines
Lot MP-2025-441
TRANSFORMATION
Pasteurisation + conditionnement
HACCP validé
AVAL- PRODUIT FINI
L-2025-08912-Yaourt nature bio
EPCIS Aggregation
SYSTÈME
Utilisateurs
Audit & logs
NutriChain v2.4 GS1/EPCIS
Q Recherche globale: lot, GTIN, SSCC.. 3 alertes froid Déconnexion
B. Interface mobile
Bonjour,
Marie L.
·Logistique - Site Lyon
SCANS AUJOURD'HUI EN ATTENTE SYNC
47 0
ALERTES ACTIVES RÉCEPTIONS
2 3
ACTION PRINCIPALE
Scanner un lot
GTIN, SSCC, datamatrix - lecture rapide
Réception
Marchandise entrante
Mouvement
Stockage / expédition
Alertes froid Quarantaine
2 incidents Lots isolés
Chaîne du froid
Palette SSCC 00 3761... - +4,2 °C
En ligne
Ξ
Accueil Scan Sync Profil
Retour Scanner
Placez le code-barres ou le datamatrix dans le cadre
lecture quasi instantanée
SAISIE MANUELLE (SSCC / LOT/ GTIN)
376112345678901234
Simuler un scan réussi
Sync
Accueil Scan Profil
V. Mise en oeuvre de la partie infrastructure -
CI/CD
A. Exemple de jeu de tests
Un premier jeu de test basique est présent pour initier un début de CI/CD sous forme de
démo. Ce jeu de test se base sur des méthodes globales présentes dans un grand nombre
de projet dont Nutrichain. Pour chaque méthode type utilitaire, sa version de test existe.
import { describe, it, expect } from 'vitest';
import vine from '@vinejs/vine';
import { validateData } from './validateData';
describe('validateData multiple errors', () => {
const schema = vine.object({
name: vine.string(),
age: vine.number().min(18),
});
it('should throw both "required" and "min" errors when both fields
are invalid', async () => {
const invalidData = { age: 16 };
try {
await validateData(schema, invalidData);
} catch (error: any) {
expect(error.status).toBe(400);
expect(error.error).toEqual(expect.arrayContaining([
{ field: 'name', rule: 'required', message: "Ce champ
est obligatoire." },
{ field: 'age', rule: 'min', message: "La valeur doit
être supérieure ou égale à 18." }
]));
}
});
it('should throw "required" error when "name" is missing', async ()
=> {
const invalidData = { age: 20 };
try {
await validateData(schema, invalidData);
} catch (error: any) {
expect(error.status).toBe(400);
expect(error.error).toEqual(expect.arrayContaining([
{ field: 'name', rule: 'required', message: "Ce champ
est obligatoire." }
]));
}
});
it('should throw "min" error when "age" is less than 18', async ()
=> {
const invalidData = { name: 'John', age: 16 };
try {
await validateData(schema, invalidData);
} catch (error: any) {
expect(error.status).toBe(400);
expect(error.error).toEqual(expect.arrayContaining([
{ field: 'age', rule: 'min', message: "La valeur doit
être supérieure ou égale à 18." }
]));
}
});
it('should pass validation when all fields are valid', async () => {
const validData = { name: 'John', age: 20 };
const result = await validateData(schema, validData);
expect(result).toEqual(validData);
});
it('should throw "string" error when "name" is not a string', async
() => {
const invalidData = { name: 123, age: 20 };
try {
await validateData(schema, invalidData);
} catch (error: any) {
expect(error.status).toBe(400);
expect(error.error).toEqual(expect.arrayContaining([
{ field: 'name', rule: 'string', message: "Ce champ doit
être une chaîne de caractères." }
]));
}
});
it('should throw "number" error when "age" is not a number', async
() => {
const invalidData = { name: 'John', age: 'twenty' };
try {
await validateData(schema, invalidData);
} catch (error: any) {
expect(error.status).toBe(400);
expect(error.error).toEqual(expect.arrayContaining([
{ field: 'age', rule: 'number', message: "Ce champ doit
être un nombre." }
]));
}
});
});
B. Début de CI/CD de Nutrichain API
name: API CI/CD
on:
push:
branches: [ main ]
pull_request:
branches: [ main ]
jobs:
ci:
name: API CI
runs-on: ubuntu-latest
services:
postgres:
image: postgres:15
env:
POSTGRES_USER: nutrichain
POSTGRES_PASSWORD: nutrichain-pwd
POSTGRES_DB: nutrichain_db
ports:
- 5432:5432
options: >-
--health-cmd="pg_isready"
--health-interval=10s
--health-timeout=5s
--health-retries=5
env:
DATABASE_URL:
postgresql://nutrichain:nutrichain-pwd@localhost:5432/nutrichain_db
NODE_ENV: test
steps:
- name: Checkout code
uses: actions/checkout@v4
- name: Setup Node.js
uses: actions/setup-node@v4
with:
node-version: 22
cache: npm
- name: Install dependencies
run: npm ci
- name: Generate Prisma client
run: npx prisma generate
- name: Apply database migrations
run: npx prisma migrate deploy
- name: Run unit tests
run: npm run unit:test
- name: Build API
run: npm run build
cd:
name: API CD
runs-on: ubuntu-latest
needs: ci
if: github.ref == 'refs/heads/main'
steps:
- name: Checkout code
uses: actions/checkout@v4
- name: Setup Node.js
uses: actions/setup-node@v4
with:
node-version: 22
cache: npm
- name: Install dependencies
run: npm ci
- name: Build for production
run: npm run build
- name: Upload API artifact
uses: actions/upload-artifact@v4
with:
name: api-build
path: dist
VI. Tâches et suivi du livrable 2