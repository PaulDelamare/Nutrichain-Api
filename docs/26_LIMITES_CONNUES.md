# Limites connues et dette assumée

**Vérifié dans le code le 28/07/2026.** Ce document recense ce que le projet **n'a pas**.

Une dette connue, écrite et chiffrée n'est pas une faute — une dette ignorée en est une. L'objectif
ici est qu'aucune limite de cette API ne soit découverte par quelqu'un d'autre avant de l'être par
l'équipe. Chaque ligne dit donc trois choses : ce qui manque, **la conséquence concrète**, et ce que
coûterait sa fermeture.

## Comment ce document a été établi

Par lecture du code, pas par relecture des documents. Chaque absence a été constatée : requête dans
les migrations, inventaire des 81 routes déclarées, recherche dans les sources. Les affirmations qui
proviendraient d'un autre document sans avoir été vérifiées n'y figurent pas.

**Périmètre : le dépôt de l'API.** Le front et le mobile ont leurs propres limites, hors de cette
liste. Ce document est donc fermé sur son périmètre, pas sur le projet entier.

| Classe | Ce que ça veut dire |
|---|---|
| 🟥 **Trou fonctionnel** | Un utilisateur ne peut pas faire quelque chose qu'il devrait pouvoir faire. |
| 🟧 **Durcissement** | Le comportement est correct ; il manque une seconde ligne de défense. |
| 🟨 **Exploitation** | Le code est sain ; c'est la mise en service qui est incomplète. |

---

## 1. Sécurité — les défenses en profondeur qui manquent

### 🟧 Pas de sécurité au niveau des lignes (RLS) en base

L'isolation entre organisations clientes est **entièrement applicative** : chaque requête porte son
filtre d'organisation, et ce filtre vient de la session.

**Conséquence** : il n'y a pas de seconde ligne de défense. Si une requête oublie son filtre, rien
en dessous ne la rattrape — et le piège est réel, car Prisma ignore silencieusement un filtre dont
la valeur vaut `undefined` : la requête ne filtre alors plus rien, sans lever d'erreur.

**Ce qui limite le risque aujourd'hui** : l'organisation est obligatoire dans les types, elle n'est
jamais lue depuis le corps d'une requête, et des tests de cloisonnement existent par module.

**Coût de fermeture** : élevé. PostgreSQL doit savoir *qui* interroge, ce que Prisma ne transmet pas
nativement — il faut émettre un `SET LOCAL` sur chaque transaction et écrire une politique par
table. Ce n'est pas un correctif, c'est un chantier qui touche tous les chemins d'écriture.

### 🟧 Pas de contrainte de vocabulaire en base

Aucun type énuméré dans le schéma, aucune contrainte `CHECK` dans les migrations : tous les statuts
sont des colonnes texte libres. Le vocabulaire n'est tenu que par les constantes TypeScript et la
validation d'entrée.

**Conséquence** : rien n'empêche techniquement d'écrire un statut inventé — par un script de
maintenance, une correction manuelle, ou un futur chemin de code qui contournerait la validation.

**Coût de fermeture** : faible. Une migration ajoutant des contraintes `CHECK` sur les colonnes de
statut ferme l'essentiel sans toucher au code applicatif. C'est le meilleur rapport effort/bénéfice
de cette section.

### 🟧 Pas de gestion centralisée des secrets, ni de rotation

Les secrets sont fournis par variables d'environnement. Il n'existe ni coffre, ni rotation
automatique, ni traçabilité des accès à un secret.

**Ce qui a déjà été traité** : les valeurs par défaut silencieuses ont été supprimées. Le fichier
`.env.demo` est publié **volontairement** et l'annonce ; l'API **refuse de démarrer** avec ces
valeurs tant que `ALLOW_DEMO_SECRETS` n'est pas posé. Le danger principal — des secrets connus qui
passent en production sans que personne ne le remarque — est donc fermé.

**Ce qui reste** : la rotation d'un secret impose un redémarrage et une intervention manuelle.

**Coût de fermeture** : dépend d'une décision d'infrastructure, pas de code. Il n'y a pas
d'orchestrateur dans lequel brancher un coffre aujourd'hui.

### 🟧 Pas de chiffrement au repos

Aucun chiffrement applicatif des données en base. La protection repose entièrement sur le
chiffrement disque de la machine hôte, s'il est activé.

### 🟧 Aucun scan de vulnérabilités des dépendances

Ni analyse des dépendances, ni analyse statique de sécurité, ni détection de secrets commités dans
l'intégration continue.

**Conséquence** : une faille publiée sur une dépendance ne serait signalée par rien. Personne ne
l'apprendrait avant de la chercher.

**Coût de fermeture** : très faible — un fichier de configuration. C'est le contrôle le moins cher
de tout ce document.

### 🟧 Les journaux ne sortent pas de la machine

La journalisation écrit sur la console et sur disque. Aucun envoi vers un outil de corrélation
externe n'est en place.

**Conséquence** : la détection décrite dans `22_JOURNALISATION_SIEM.md` suppose un collecteur qui
n'existe pas encore. Les événements sont produits et exploitables, mais leur corrélation reste
manuelle. Si la machine est perdue, les journaux le sont aussi.

### 🟧 Double authentification : partiellement ouverte

L'enrôlement par application d'authentification fonctionne et est utilisé. En revanche, **il n'y a
pas de codes de secours**, ni d'envoi de code par courriel ou SMS.

**Conséquence** : un utilisateur qui perd son téléphone perd l'accès à son compte, et seule une
intervention en base le rétablit. Cette conséquence se cumule avec la suivante.

---

## 2. Fonctionnel — ce que l'API ne permet pas

### 🟥 Pas de réinitialisation de mot de passe

Aucun endpoint de mot de passe oublié.

**Conséquence** : un utilisateur qui oublie son mot de passe est définitivement enfermé dehors.
Seule une intervention directe en base le débloque. C'est le premier défaut qu'un nouvel
utilisateur rencontre.

**Effet de bord à connaître** : le verrouillage anti-bruteforce justifie son compromis par l'absence
de cette fonctionnalité — un verrou temporaire de 15 minutes plutôt que définitif, précisément
parce qu'aucune réinitialisation n'existe. Un manque fonctionnel est ainsi devenu un argument de
conception : le combler impose de revoir ce raisonnement.

### 🟥 Pas de mise en quarantaine manuelle

Un lot ne devient `BLOQUE` que par deux chemins automatiques : un contrôle `NONCONFORME` ou
`ALERTE` à la réception, ou la propagation d'un rappel. La **levée** de quarantaine existe
(`POST /logistics/batches/:id/release`), la **pose** n'existe pas.

**Conséquence** : un responsable qualité qui suspecte un lot déjà en stock — signalement client,
défaut constaté en cours de journée — n'a aucun moyen de le bloquer. Il peut lever une quarantaine
qu'il n'a pas le droit de créer.

**Coût de fermeture** : faible. Le service, la machine à états et l'écriture d'audit existent déjà
pour l'opération inverse.

### 🟥 Un rappel déclenché par erreur n'a aucune issue

Le rappel est irréversible **par conception**, et ce choix se défend : il propage un blocage à toute
la descendance d'un lot, et un rappel qu'on pourrait défaire ne serait plus une garantie.

**Conséquence** : un rappel déclenché sur le mauvais lot laisse toute sa descendance en `ALERTE`
définitivement. La seule sortie est la mise au rebut — donc détruire de la marchandise saine pour
corriger une erreur de saisie.

**Décision à prendre** : soit un endpoint d'annulation tracé et réservé au rôle qualité, soit
l'assumer explicitement comme une propriété du système. Aujourd'hui, ce n'est ni l'un ni l'autre.

### 🟥 Aucune détection des lots périmés

Cinq tâches planifiées existent ; aucune ne surveille les dates limites de consommation.

**Conséquence** : un lot périmé n'est intercepté qu'au moment où quelqu'un tente de l'utiliser — en
transformation ou en expédition. Il reste affiché comme disponible jusque-là, et rien ne prévient
personne.

### 🟥 Ressources en écriture seule

| Ressource | Ce qui manque | Conséquence |
|---|---|---|
| Transformations | Aucune lecture (`POST` seul) | On en crée, on n'en relit jamais. Impossible de répondre à « qu'a-t-on produit mardi ? » — la généalogie est centrée sur le lot, pas sur l'opération. |
| Expéditions | Pas de détail par identifiant | On crée et on liste, on ne consulte jamais une expédition précise. |
| Matériel | Ni modification, ni archivage | Une cuve mal nommée l'est définitivement ; une cuve retirée du service reste proposée dans les listes. Toutes les autres ressources ont leur bascule d'activité — le matériel a été oublié. |
| Passerelles IoT | Pas de modification | Seule la révocation est possible. |
| Invitations | Ni liste, ni révocation | On émet une invitation sans jamais savoir lesquelles sont en attente. Une invitation envoyée à la mauvaise adresse ne peut qu'expirer. |

Par ailleurs, **aucune ressource secondaire n'expose de lecture unitaire** (fournisseurs, clients,
emplacements, produits, contrôles qualité, alertes) : elles se listent et se modifient, mais ne se
consultent pas individuellement. Sans gravité tant que les volumes restent modestes, coûteux
ensuite.

### 🟥 Un endpoint livré mais inaccessible

`POST /logistics/batches/:id/scrap` (mise au rebut) n'est appelé par aucune interface — suivi en
issue #254. Ce n'est pas une absence : c'est du travail livré que personne ne peut déclencher.

### 🟨 Pas de versionnement d'API

Aucun préfixe de version.

**Conséquence** : le jour où un champ change de forme, il n'existe **aucun moyen de faire cohabiter
deux contrats** pendant la transition. Un parc mobile se met à jour lentement, et certains
utilisateurs refusent les mises à jour : une modification incompatible casserait les clients
anciens sans période de recouvrement. C'est le genre de décision qui se prend avant d'avoir des
clients tiers, jamais après.

### 🟨 Pas de notification sortante (webhooks)

Les alertes de chaîne du froid ne se récupèrent qu'en interrogeant l'API.

**Conséquence** : un système tiers qui veut être prévenu d'une excursion thermique doit sonder en
boucle. Pour de la surveillance à contrainte de temps, c'est la limite d'intégration la plus
structurante de cette liste.

### Incohérences de surface, sans conséquence fonctionnelle

- Les lots sont exposés sous **deux préfixes** (`/logistics/batches` et `/traceability/batches`)
  selon le module qui les a écrits.
- `/organization/*` sert d'espace de noms fourre-tout, alors que l'organisation vient de la session
  et n'apparaît jamais dans l'URL.
- Les actions mélangent les verbes : `PATCH` pour résoudre une alerte, `POST` pour lever une
  quarantaine, révoquer ou mettre au rebut.
- Les imports de connecteurs couvrent les clients et les produits, **pas les fournisseurs**.

---

## 3. Exploitation et livraison

### 🟨 La branche de production a 632 commits de retard

**C'est la dette la plus visible du projet.** L'image publiée ne correspond à rien de ce qui est
décrit dans cette documentation : aucune des corrections récentes n'y figure.

**Coût de fermeture** : ce n'est pas du code à écrire, c'est une décision de livraison à prendre.

### 🟨 L'arrêt propre ne s'exécute jamais en conteneur

Le processus écoute `SIGINT`, mais **pas `SIGTERM`** — or c'est `SIGTERM` qu'envoie un
orchestrateur de conteneurs pour demander un arrêt.

**Conséquence** : la fermeture ordonnée des connexions est du code mort en production. À chaque
arrêt, le processus est tué sans avoir terminé ce qu'il faisait.

**Coût de fermeture** : deux lignes.

### 🟨 Le délai de remise en service n'a jamais été mesuré

Les scripts de sauvegarde et de restauration existent, l'engagement est écrit dans
`18_PCA_PRA.md`. Mais **aucune restauration n'a été chronométrée**.

**Conséquence** : le délai annoncé est une intention, pas un engagement tenable. Tant qu'une
restauration n'a pas été jouée de bout en bout, sa durée réelle est inconnue.

---

## 4. Ce qui, contrairement à une idée reçue, ne manque pas

Ces points sont régulièrement supposés absents. Ils ne le sont pas, et le confondre reviendrait à
s'accuser à tort.

| Sujet | État réel |
|---|---|
| **Protection contre le bruteforce** | **En place, à deux couches** : verrou par compte (5 échecs, fenêtre et verrou de 15 min, incrément atomique) et limiteur par adresse IP sur les seuls échecs. Câblés sur les routes d'authentification. |
| En-têtes de sécurité HTTP | En place. |
| Limitation de débit globale | En place, avec un limiteur dédié au scan public. |
| Journal d'audit inviolable | Chaîné par empreinte, vérifié par une tâche planifiée sous verrou d'exclusion. |
| Validation des entrées | Systématique, avec bornes de pagination plafonnées en un point unique. |
| Sauvegarde et restauration | Scripts présents, restauration protégée par trois garde-fous. |
| Sondes de santé | Vivacité et disponibilité, cette dernière interrogeant les deux bases et l'écriture disque. |
| Double authentification | Enrôlement fonctionnel (voir plus haut pour ce qui reste fermé). |

---

## 5. Ce que ce document ne couvre pas

- **Le front et le mobile** : hors périmètre, limites propres.
- **Le comportement des routes** : cet inventaire porte sur les endpoints *déclarés*. Il ne prouve
  pas que chacun est correctement gardé par rôle — c'est le travail des tests, pas de ce document.
- **Ce que les clients consomment réellement** : une absence listée ici peut ne gêner personne, et
  un manque non listé peut bloquer une interface. Le confronter aux besoins du front et du mobile
  reste à faire.
- **Les limites qu'on n'a pas su chercher.** Cette liste est fermée sur la méthode décrite en tête,
  pas sur la réalité. Une absence non listée n'est pas une absence inexistante.
