# GS1 et EPCIS : ce que c'est, pourquoi, et comment c'est implémenté ici

**Vérifié dans le code le 29/07/2026.** Les autres documents disent *à quoi sert* GS1 dans NutriChain
(`19_architecture.md` §4, `20_PRESENTATION_PROJET.md`). Celui-ci répond aux quatre questions qui
manquaient : **ce que c'est**, **pourquoi c'est construit comme ça**, **où ça vit dans le code**, et
**à quoi ça ressemble concrètement**. Toutes les valeurs montrées plus bas ont été produites en
exécutant le code de ce dépôt, pas rédigées à la main.

---

## 1. Ce que c'est

### GS1 : l'organisation, et le problème qu'elle résout

GS1 est l'organisme mondial qui normalise l'identification des marchandises. C'est lui qui a produit
le code-barres EAN que porte tout produit en rayon depuis 1974. Son utilité tient en une phrase :
**pour qu'une information circule entre deux entreprises, il faut d'abord qu'elles désignent la même
chose par le même identifiant.**

Sans standard, chaque acteur nomme les mêmes marchandises à sa façon : la laiterie appelle son lot
`LT-2026-0043`, le transporteur le renumérote, le distributeur lui donne encore un autre code. Le
jour d'un rappel, personne ne peut prouver que ces trois lignes désignent le même produit. GS1 fournit
des clés d'identification que tout le monde émet selon les mêmes règles, et qui sont **uniques au
niveau mondial** — sans base de données centrale, par construction.

Le mécanisme est simple : GS1 vend à chaque entreprise un **préfixe entreprise** (*company prefix*),
une suite de chiffres qui n'appartient qu'à elle. L'entreprise complète librement ce préfixe pour
fabriquer ses identifiants. Deux entreprises ne peuvent pas produire le même identifiant, puisqu'elles
ne partent pas du même préfixe. C'est un espace de noms hiérarchique, comme les noms de domaine.

### Les quatre clés utilisées dans ce projet

| Clé | Identifie | Longueur | Où elle apparaît chez nous |
|---|---|---|---|
| **GTIN** *(Global Trade Item Number)* | Un **type** de produit — « yaourt nature 125 g », pas un pot en particulier | 13 ou 14 chiffres | `Product.code_gtin`, importé de l'ERP |
| **AI (10)** — numéro de lot | Le **lot de production** d'un produit | ≤ 20 caractères | `Batch.lot_number`, généré à la réception |
| **SSCC** *(Serial Shipping Container Code)* | Une **unité logistique** : une palette, un carton d'expédition | 18 chiffres | `Shipment.shipment_id`, généré à l'expédition |
| **GLN** *(Global Location Number)* | Un lieu physique ou une entité juridique | 13 chiffres | **Non implémenté** — cf. §6 |

La distinction GTIN / lot est celle qui structure tout le modèle. Le GTIN dit *quel produit*, le lot
dit *quelle fournée*. Un rappel ne porte jamais sur un GTIN seul (ce serait retirer toute la gamme du
marché) : il porte sur le couple **GTIN + lot**. C'est exactement le couple que nos étiquettes
encodent.

### Les Application Identifiers : pourquoi un code-barres contient des chiffres bizarres

Un code-barres GS1 ne contient pas que des données : il contient des **préfixes de champ**, appelés
*Application Identifiers* (AI). Chaque AI est un petit nombre qui annonce la nature et le format de
ce qui suit.

| AI | Signification | Format |
|---|---|---|
| `01` | GTIN | 14 chiffres, longueur fixe |
| `10` | Numéro de lot | ≤ 20 caractères, longueur variable |
| `17` | Date limite de consommation | 6 chiffres `AAMMJJ` |
| `00` | SSCC | 18 chiffres |

C'est ce qui permet à un seul scan de transmettre plusieurs informations sans ambiguïté : le lecteur
lit `01`, sait que les 14 chiffres suivants sont un GTIN, puis lit `10` et sait que la suite est un
numéro de lot. **Ces deux nombres, `01` et `10`, sont ceux qu'on retrouve littéralement dans nos URL
d'étiquette** — c'est la seule raison pour laquelle elles ressemblent à ça.

### EPCIS : le standard des *événements*

Les clés ci-dessus identifient des choses. Elles ne disent pas ce qui leur est arrivé. C'est l'objet
d'**EPCIS** (*Electronic Product Code Information Services*), le second standard GS1 qu'implémente ce
projet : un format normalisé pour publier **l'histoire** d'un objet, événement par événement.

Chaque événement EPCIS répond à quatre questions, toujours les mêmes :

| Dimension | Question | Champ EPCIS |
|---|---|---|
| **What** | Quels objets ? | `epcList` / `quantityList` |
| **When** | Quand ? | `eventTime` |
| **Where** | À quel endroit ? | `readPoint`, `bizLocation` |
| **Why** | Dans quel contexte métier ? | `bizStep`, `disposition` |

Le *pourquoi* est standardisé lui aussi, par un vocabulaire appelé **CBV** (*Core Business
Vocabulary*) : « réception » ne s'écrit pas `reception`, `RECEIVING` ou `entrée_stock` selon
l'humeur, mais toujours `urn:epcglobal:cbv:bizstep:receiving`. Sans ce vocabulaire commun, deux
systèmes échangeraient des événements syntaxiquement valides et sémantiquement incomparables.

EPCIS définit trois types d'événements, et ce sont les trois que nous émettons :

- **ObjectEvent** — il est arrivé quelque chose à des objets (réception, expédition).
- **TransformationEvent** — des objets ont été consommés pour en produire d'autres. C'est
  l'événement qui porte la **généalogie** : sans lui, le lien entre le lait entrant et le yaourt
  sortant n'existe nulle part.
- **AggregationEvent** — des objets ont été placés dans un contenant (des lots sur une palette SSCC).

---

## 2. Pourquoi c'est construit comme ça

Cinq décisions de conception qui ne vont pas de soi, et leur raison.

### Pourquoi un chiffre-clé (*check digit*)

Le dernier chiffre d'un GTIN ou d'un SSCC n'est pas une donnée : c'est une **somme de contrôle**,
calculée en modulo 10 avec des poids alternés 3 et 1. Elle détecte 100 % des erreurs d'un chiffre et
la quasi-totalité des inversions de deux chiffres voisins — les deux fautes typiques d'une saisie
manuelle ou d'une lecture optique dégradée. Un identifiant mal lu est ainsi **rejeté** plutôt que
silencieusement attribué à un autre produit.

C'est un choix des années 1970, quand les lecteurs étaient peu fiables. Il reste pertinent : chez
nous, les numéros de lot fournisseur sont encore souvent saisis à la main.

### Pourquoi l'URN EPC ne contient pas le chiffre-clé

Règle GS1 : dans une URN EPC, le *check digit* **ne figure jamais**. Il est déterministe — il se
recalcule à partir du reste — donc le transporter reviendrait à publier une donnée redondante que
deux systèmes pourraient contredire. Une somme de contrôle protège une *lecture*, pas un *transport
de données structurées* ; dans une URN, elle n'aurait plus rien à contrôler.

Conséquence concrète dans notre code : `buildLgtinUrn` et `buildSsccUrn` retirent explicitement ce
chiffre. C'est le genre de détail qu'un plugin aurait masqué et qu'on n'aurait jamais compris.

### Pourquoi LGTIN (classe) et non SGTIN (instance)

EPCIS distingue deux niveaux d'identification :

- **SGTIN** — *chaque unité* porte un numéro de série unique. Un pot de yaourt = un identifiant.
- **LGTIN** — on identifie **le lot**, comme une classe d'objets, et on en manipule des *quantités*.

Nous utilisons LGTIN. La raison est industrielle, pas technique : la sérialisation unitaire suppose
une ligne d'impression capable de marquer chaque unité individuellement, et une chaîne logistique qui
sait lire ce marquage à chaque étape. Dans l'agroalimentaire de volume, la traçabilité réglementaire
s'exerce **au lot**. Identifier chaque pot serait un coût sans usage.

C'est pourquoi nos événements portent une `quantityList` (« 500 litres de ce lot ») et non une
`epcList` (« ces 500 objets précis »).

### Pourquoi GS1 Digital Link plutôt qu'un GS1 DataMatrix

Un GS1 DataMatrix encode les AI sous forme brute : `(01)03042040209789(10)260729-U7ZH8S`. C'est
compact et c'est le standard en usine — mais **ce n'est lisible que par un lecteur professionnel**.
Le consommateur qui pointe l'appareil photo de son téléphone dessus obtient une chaîne
incompréhensible.

**GS1 Digital Link** encode exactement la même information sous forme d'URL :

```
https://<domaine>/api/gs1/01/<GTIN>/10/<lot>
                        └┬┘        └┬┘
                       AI 01      AI 10
```

Les mêmes AI, aux mêmes positions, avec la même sémantique — mais scannable par n'importe quel
téléphone, sans application dédiée. Le lecteur professionnel y retrouve ses clés ; le consommateur
atterrit sur une page. **Un seul code sert les deux publics**, ce qui est précisément l'objectif du
standard depuis 2018.

Ce choix a un corollaire qui nous a coûté deux correctifs : puisque l'étiquette encode une URL, cette
URL doit **réellement répondre**. Le lien pointait initialement vers un chemin hors de l'API (aucune
route montée → 404 à chaque scan, #139), puis vers un domaine de repli qui ne résolvait même pas
(#146). Un QR code se vérifie en le scannant, pas en le lisant.

### Pourquoi implémenter GS1 nous-mêmes plutôt qu'utiliser une bibliothèque

Décision documentée dans `19_architecture.md` §5. Les règles utilisées ici tiennent en une centaine
de lignes de fonctions pures et parfaitement testables (calcul du chiffre-clé, découpage d'URN, borne
de 20 caractères de l'AI 10). Une dépendance aurait ajouté une surface de mise à jour et une couche
d'indirection pour un gain nul — et surtout, elle aurait dissimulé les règles au lieu de les rendre
explicites. `bwip-js` reste utilisé pour le **rendu graphique** du QR code, qui, lui, n'a aucune
raison d'être réécrit.

---

## 3. Comment c'est implémenté ici

### Les fichiers

| Rôle | Fichier |
|---|---|
| Fonctions pures GS1 (SSCC, URN, lot, chiffre-clé) | `src/shared/utils/gs1/gs1.utils.ts` |
| Résolution du préfixe entreprise de l'organisation | `src/shared/utils/gs1/gs1Prefix.ts` |
| Réservation du numéro de série SSCC | `src/shared/utils/gs1/ssccSerial.ts` |
| Vocabulaire EPCIS / CBV centralisé | `src/shared/constants/epcis.constants.ts` |
| Digital Link + rendu QR | `src/modules/logistics/shared/services/label.service.ts` |
| Résolution d'un scan public | `src/modules/traceability/transformations/controllers/publicScan.controller.ts` |
| Émission des événements | `receipt.service.ts`, `shipment.service.ts`, `transformation.service.ts` |
| Persistance | modèle `EPCIS_Event` (`prisma/schema.prisma`) |
| Export CSV pour l'ERP | `src/modules/connectors/services/eventExport.service.ts` |

Les utilitaires GS1 sont des **fonctions pures sans dépendance** : ni Prisma, ni Express, ni
horloge. Elles se testent exhaustivement sans base de données — `gs1.utils.test.ts` couvre 37 cas.

### Trois points d'implémentation qui ont demandé une décision

**Le préfixe entreprise est porté par l'organisation, pas par l'application.** La colonne
`Organization.gs1_company_prefix` existe précisément parce que, dans une plateforme multi-client,
chaque organisation émet ses identifiants sous **son** préfixe — sinon deux clients produiraient des
SSCC identiques, et l'unicité mondiale, seule raison d'être du standard, disparaîtrait. Le repli
`DEFAULT_GS1_COMPANY_PREFIX` ne sert qu'aux organisations non configurées.

**Le numéro de série SSCC vient d'une séquence PostgreSQL, pas d'un `count()`.** Un comptage est une
*lecture* : deux expéditions simultanées obtenaient le même numéro, fabriquaient le même SSCC, et la
seconde mourait sur une violation d'unicité — un geste métier légitime perdu devant le camion (#124).
`nextval('sscc_serial_seq')` est une **réservation**, hors transaction, donc sans point de contention
entre expéditions concurrentes. Elle laisse des trous après un rollback, sans conséquence : un
identifiant GS1 doit être unique, pas contigu. Prouvé sous concurrence réelle par `npm run e2e:sscc`.

**La capacité du SSCC est gardée explicitement.** `padStart` complète, mais ne tronque pas : avec un
préfixe long et un volume élevé, un numéro de série trop grand aurait produit silencieusement un
SSCC de plus de 18 chiffres — structurellement invalide, et accepté sans un mot. La fonction lève
désormais une erreur explicite.

**Chaque événement EPCIS est écrit dans la transaction du geste métier**, aux côtés du lot, du
mouvement de stock et de l'entrée d'audit (`retryableTransaction`). Un événement de traçabilité qui
pourrait exister sans son fait métier — ou l'inverse — serait pire que pas d'événement du tout : il
constituerait une preuve fausse.

---

## 4. À quoi ça ressemble

Valeurs produites en exécutant les fonctions du dépôt (préfixe de repli `3456789`, GTIN du jeu de
démonstration, 29/07/2026) :

```
préfixe entreprise   3456789
GTIN                 3042040209789
numéro de lot        260729-U7ZH8S          (AAMMJJ + 6 caractères aléatoires, 13 car. ≤ 20)
SSCC                 034567890000000422     (18 chiffres, chiffre-clé = 2)
URN LGTIN            urn:epc:class:lgtin:3456789.020978.260729-U7ZH8S
URN SSCC             urn:epc:id:sscc:3456789.0000000042
Digital Link         https://api.nutrichain.fr/api/gs1/01/3042040209789/10/260729-U7ZH8S
```

### Anatomie du SSCC `034567890000000422`

```
0        3456789        000000042      2
│        │              │              │
│        │              │              └─ chiffre-clé (modulo 10, poids 3-1)
│        │              └──────────────── numéro de série, réservé par séquence PostgreSQL
│        └─────────────────────────────── préfixe entreprise de l'organisation
└──────────────────────────────────────── chiffre d'extension (capacité du contenant)
```

### Anatomie de l'URN LGTIN

```
urn:epc:class:lgtin:3456789.020978.260729-U7ZH8S
                    └──┬──┘ └──┬─┘ └──────┬─────┘
                  préfixe   indicateur   numéro de lot (AI 10)
                            + référence article,
                            SANS le chiffre-clé
```

### Ce qui est réellement persisté — ObjectEvent de réception

```json
{
  "event_type": "ObjectEvent",
  "related_entity": "Receipt",
  "payload": {
    "quantityList": [
      {
        "epcClass": "urn:epc:class:lgtin:3456789.020978.260729-U7ZH8S",
        "quantity": 500,
        "uom": "L"
      }
    ],
    "action": "ADD",
    "bizStep": "urn:epcglobal:cbv:bizstep:receiving",
    "disposition": "urn:epcglobal:cbv:disp:active",
    "sourceParty": "<id fournisseur>"
  }
}
```

### AggregationEvent d'expédition — la palette contient les lots

```json
{
  "event_type": "AggregationEvent",
  "payload": {
    "parentID": "urn:epc:id:sscc:3456789.0000000042",
    "childQuantityList": [ { "epcClass": "urn:epc:class:lgtin:...", "quantity": 120, "uom": "KG" } ],
    "action": "ADD",
    "bizStep": "urn:epcglobal:cbv:bizstep:shipping"
  }
}
```

`parentID` n'est une URN que pour un SSCC **que nous avons généré** avec notre préfixe. Un
identifiant fourni par l'appelant est conservé tel quel : nous ne pouvons pas affirmer la structure
d'un identifiant émis par un tiers.

### L'étiquette et son scan

| Étape | Appel | Résultat |
|---|---|---|
| Impression | `GET /api/logistics/batches/:id/label` | PNG du QR code (réponse binaire, hors enveloppe JSON) |
| Scan consommateur | `GET /api/gs1/01/:gtin/10/:lot` | Produit, producteur, origine ferme, **statut sanitaire** |

Le canal public est **non authentifié et limité en débit**. Il n'expose que ce qui doit l'être : nom
du produit, producteur, noms des fermes d'origine, et `RAPPEL_CONSOMMATEUR` le cas échéant. Jamais
d'identifiant fournisseur, de contact ni d'adresse (arbitrage DPIA). Seuls les lots `EXPEDIE` ou
`ALERTE` sont visibles — un lot encore en usine ne concerne pas le consommateur.

Deux gardes non évidentes, chacune née d'un défaut réel :

- `lot_number` est stocké en majuscules ; le scan force la casse avant la requête, sinon un lot
  parfaitement valide renvoyait un 404 silencieux.
- Un numéro de lot n'est unique **que par organisation**. Sur un canal public sans contexte
  d'organisation, deux producteurs peuvent porter le même. En cas d'homonymie, **le rappel prime** :
  un lot sous alerte ne doit jamais être masqué par un lot conforme d'un autre producteur, sinon
  l'alerte disparaît du seul canal dont c'est la raison d'être.

---

## 5. Ce qui est vérifié, et comment

| Vérification | Harnais | Portée |
|---|---|---|
| Règles GS1 pures (chiffre-clé, URN, bornes, capacité) | `gs1.utils.test.ts` — 13 cas | Unitaire, sans base |
| Unicité SSCC sous concurrence | `npm run e2e:sscc` | Base réelle, expéditions simultanées |
| Conformité des événements émis | `npm run e2e:epcis` — 24/24 | Base réelle, chaîne complète |
| Résolution du scan public (404, 409, rappel prioritaire, casse) | `publicScan.controller.test.ts` | Unitaire |
| Digital Link et rendu PNG | `label.service.test.ts` — 7 cas | Unitaire ; le PNG est vérifié comme **image valide et carrée**, son contenu optique ne l'est pas (cf. §7) |
| Export EPCIS vers l'ERP | `npm run e2e:connectors` | Base réelle |

---

## 6. Ce qui n'est pas conforme, et pourquoi c'est assumé

Complète `26_LIMITES_CONNUES.md`, qui ne couvrait pas ce périmètre.

**Le préfixe entreprise est fictif.** Aucun préfixe n'a été acheté auprès de GS1. Les identifiants
sont *structurellement* conformes, mais ne sont pas mondialement uniques dans les faits. Fermeture :
achat d'un préfixe et saisie dans `Organization.gs1_company_prefix` — aucun changement de code.

**Le chiffre-clé du GTIN n'est pas validé à l'import.** La validation impose 13 ou 14 chiffres
(`/^\d{13,14}$/`), sans recalculer la somme de contrôle. Conséquence : un GTIN mal saisi entre en
base et sera imprimé sur des étiquettes qu'un lecteur professionnel rejettera. Les GTIN du jeu de
démonstration sont d'ailleurs dans ce cas. Fermeture : faible coût — `gs1Utils.calculateCheckDigit`
existe déjà, il suffit de l'appeler dans la règle de validation.

**La référence article de l'URN LGTIN est découpée positionnellement.** `buildLgtinUrn` coupe le GTIN
à la longueur du préfixe déclaré sans vérifier que le GTIN encode réellement ce préfixe. Avec des
GTIN et un préfixe cohérents, le résultat est juste ; avec les valeurs fictives actuelles, l'URN est
structurellement valide mais sémantiquement arbitraire. Fermeture : contrôle de correspondance
préfixe/GTIN à l'enregistrement du produit.

**La dimension *Where* d'EPCIS est incomplète.** Seul le `TransformationEvent` porte un `readPoint`,
et sous forme d'identifiant interne de matériel, pas de SGLN. Les événements de réception et
d'expédition n'ont ni `readPoint` ni `bizLocation`. Conséquence : trois des quatre dimensions EPCIS
sont renseignées, la quatrième repose sur les tables métier. Fermeture : introduire le GLN au niveau
`Location`, puis dériver le SGLN à l'émission.

**Pas de sérialisation EPCIS 2.0 JSON-LD.** Les événements sont persistés dans notre propre structure
et exportés en CSV. Un partenaire attendant un document EPCIS conforme au schéma officiel devrait
passer par une transposition. Fermeture : une couche de sérialisation en sortie — le modèle de
données porte déjà l'information nécessaire.

**Les unités de mesure ne sont pas les codes UN/CEFACT attendus par GS1.** Le champ `uom` des
événements porte notre référentiel interne (`KG`, `L`, `UNIT`…), là où GS1 attend les codes
UN/CEFACT (`KGM`, `LTR`). Conséquence : un partenaire lisant nos événements devrait transposer les
unités. Fermeture : une table de correspondance dans `units.constants.ts`, appliquée à l'émission.

**Pas de GS1 DataMatrix ni d'EAN-13 imprimable.** Seul le QR Digital Link est produit. `bwip-js`
sait générer les deux autres, mais aucune route ne les expose.

**Pas de niveau instance (SGTIN).** Décision de conception assumée (§2), pas une dette : la
traçabilité de l'agroalimentaire de volume s'exerce au lot.

---

## 7. Ce qui n'a **pas** été vérifié : le scan par une caméra réelle

Aucune preuve, dans ce dépôt, qu'un QR code produit par `GET /api/logistics/batches/:id/label` ait
été scanné par l'appareil photo d'un téléphone jusqu'à l'affichage de la page de traçabilité.

Ce qui est prouvé, et qui n'est pas la même chose : le Digital Link est bien formé et pointe vers une
route montée ; l'endpoint d'étiquette renvoie **une image PNG valide** ; la route de résolution
renvoie les bonnes données (tests unitaires + capture réelle d'un écran « rappel en cours » côté
front, obtenu par saisie et non par caméra).

À noter : **aucun test ne décode le QR code**. `label.service.test.ts` vérifie la signature PNG et,
depuis #272, les dimensions du tampon produit — mais pas ce que le motif encode. Rien dans la suite
ne rougirait si `bwip-js` recevait le mauvais texte.

**Ce que cette absence de vérification a déjà coûté (#272).** En produisant les valeurs de ce
document, le rendu s'est révélé **étiré : 198×66 au lieu de 198×198**. `bwip-js` interprétait
l'option `height: 10` en millimètres pour un symbole 2D. Un QR étiré n'est pas décodable — ses
motifs de repérage supposent le même pas en X et en Y : **chaque étiquette imprimée était un
rectangle noir qu'aucune caméra n'aurait lu**. Trois défauts successifs sur ce même maillon (#139,
#146, #272), tous invisibles à une suite verte, tous visibles au premier scan réel. C'est l'argument
le plus net en faveur du protocole ci-dessus.

La chaîne non vérifiée est donc précisément : **caméra → décodage optique → ouverture du navigateur →
appel HTTP → page**. C'est le maillon où sont apparus les deux défauts déjà rencontrés (#139, #146),
et aucun test unitaire ne pouvait les voir. Le protocole de vérification est court :

1. démarrer l'API avec `API_URL` renseignée à une adresse **joignable depuis le téléphone** (l'IP de
   la machine sur le réseau local, pas `localhost`) ;
2. `GET /api/logistics/batches/:id/label`, afficher le PNG à l'écran ;
3. le scanner avec l'appareil photo, sans application dédiée ;
4. vérifier que le navigateur du téléphone affiche bien la réponse de traçabilité.

Tant que ces quatre étapes n'ont pas été faites, la formule exacte est : « le lien encodé est
vérifié, le scan optique de bout en bout ne l'est pas ».
