# Limites connues et dette assumée

**Vérifié dans le code le 28/07/2026.** Ce document recense ce que le projet **n'a pas**.

Une dette connue, écrite et chiffrée n'est pas une faute — une dette ignorée en est une. L'objectif
ici est qu'aucune limite de cette API ne soit découverte par quelqu'un d'autre avant de l'être par
l'équipe. Chaque ligne dit donc trois choses : ce qui manque, **la conséquence concrète**, et ce que
coûterait sa fermeture.

## Comment ce document a été établi

Par lecture du code, pas par relecture des documents : requête dans les migrations, inventaire des
~74 endpoints applicatifs, recherche dans les sources. *(77 déclarations `router.<verbe>`, dont
trois sont des middlewares de validation greffés sur des chemins Better-Auth, plus quatre
`router.all('/auth/*')` qui sont des couches de middleware et non des endpoints.)*

**Cette méthode a produit trois affirmations fausses**, corrigées depuis et signalées comme telles
dans le corps du document. Les trois venaient de la même faute : une recherche textuelle qui ne
trouve pas le mot cherché a été prise pour la preuve que la capacité n'existe pas. Une recherche
sensible à la casse ne voit pas `sendResetPassword` ; chercher « quarantaine » ne trouve pas un
blocage écrit par un service de contrôle qualité.

**La règle qui en découle, et qui vaut pour toute mise à jour de ce document** : une absence ne
s'établit pas par une recherche qui ne trouve rien. Elle s'établit en **exécutant** — un appel HTTP
réel contre le serveur, une action dans l'application. Les entrées de ce document marquées comme
vérifiées par exécution sont les seules sur lesquelles s'appuyer sans revérifier.

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

**Conséquence** : une faille publiée sur une dépendance n'est signalée par rien. Personne ne
l'apprend avant de la chercher.

**Ce qu'a donné la première recherche** (28/07/2026, à la main) : **13 avis, dont un critique sur la
bibliothèque d'authentification**. C'est l'état de la branche de préproduction à la date de ce
document.

Les correctifs sans rupture sont réunis dans une PR **non encore intégrée** : une fois celle-ci
mergée, il en restera **7**, se ramenant à deux causes. *(Tant qu'elle ne l'est pas, les 13 avis
sont toujours là — ne pas lire les lignes qui suivent comme l'état courant.)*

- **cinq** ne sont qu'une seule chaîne d'outillage de test (`@vitest/coverage-v8` → `test-exclude` →
  `glob` → `minimatch` → `brace-expansion`) : une seule montée majeure les ferme tous ;
- **un** touche la production, `nodemailer` 8 → 9. L'option incriminée (`raw`) n'est jamais utilisée
  ici — les trois appelants ne passent que `to`, `subject` et `html` ;
- le dernier, bas, concerne le serveur de développement d'`esbuild` et reste retenu par `vite`.

**Coût de fermeture** : très faible — un fichier de configuration. C'est le contrôle le moins cher
de tout ce document, et le seul qui empêche la prochaine faille d'attendre qu'on la cherche.

### 🟧 Les journaux ne sortent pas de la machine

La journalisation écrit sur la console et sur disque. Aucun envoi vers un outil de corrélation
externe n'est en place.

**Conséquence** : la détection décrite dans `22_JOURNALISATION_SIEM.md` suppose un collecteur qui
n'existe pas encore. Les événements sont produits et exploitables, mais leur corrélation reste
manuelle. Si la machine est perdue, les journaux le sont aussi.

### 🟧 Double authentification : partiellement ouverte

L'enrôlement par application d'authentification fonctionne et est utilisé.

**Les codes de secours sont pires qu'absents : ils sont émis, affichés, et inutilisables.**
Correction d'une version antérieure de ce document, qui les disait inexistants. `/two-factor/enable`
est dans l'allowlist, et Better-Auth y **génère** les codes et les **retourne** dans la réponse ; le
front les affiche à l'utilisateur (`mon-compte`). Mais l'endpoint qui les **consomme**
(`/two-factor/verify-backup-code`) n'est pas dans l'allowlist.

**Conséquence** : l'utilisateur note soigneusement des codes présentés comme son filet de sécurité,
et découvre le jour où il perd son téléphone qu'aucun ne fonctionne. Une absence se contourne ; une
promesse fausse se découvre au pire moment. Seule une intervention en base rétablit l'accès — et
cette conséquence se cumule avec la réinitialisation de mot de passe, elle aussi fermée.

L'envoi de code par courriel ou SMS, lui, est bien absent.

---

## 2. Fonctionnel — ce que l'API ne permet pas

### 🟥 La réinitialisation de mot de passe est implémentée, mais fermée

**Correction d'une version antérieure de ce document**, qui affirmait qu'aucun endpoint n'existait.
C'était faux, et l'erreur venait d'une recherche sensible à la casse qui ne pouvait pas trouver
`sendResetPassword`.

Le service existe bel et bien : `auth.config.ts` configure `sendResetPassword`, et le courriel a son
gabarit (`ResetPasswordEmail`). Ce sont les **routes** qui sont fermées : `allowAuthRoutes` n'ouvre
que sept couples chemin + méthode, et le flux de réinitialisation n'en fait pas partie.

Les endpoints réels de Better-Auth 1.6.25 sont `POST /request-password-reset`,
`POST /reset-password` et `GET /reset-password/:token`. *(Une version antérieure de ce document
citait `/forget-password`, un nom abandonné depuis Better-Auth 1.2 : l'allowlist refusant tout ce
qu'elle ne connaît pas, un `403` sur ce nom-là ne prouvait rien.)*

**Ce n'est pas un choix documenté.** L'historique est net : `sendResetPassword` existe depuis avril
et le flux a fonctionné trois mois ; l'allowlist du 14/07, qui échoue fermé, l'a refermé
**collatéralement**, sans qu'aucun commit ni aucune issue ne le nomme — contrairement aux codes de
secours de la double authentification, dont la fermeture est justifiée en commentaire et rattachée à
une issue. Le commentaire du 22/07 qui constate que la réinitialisation « n'est pas exposée »
entérine l'état de fait, il ne le décide pas.

**Conséquence, inchangée** : un utilisateur qui oublie son mot de passe est enfermé dehors, et seule
une intervention directe en base le débloque.

**Coût de fermeture — plus élevé qu'il n'y paraît.** Il faut ouvrir **trois** entrées, dont un `GET`
à segment paramétré. Or `ALLOWED_AUTH_ROUTES` est un `Record<string, 'POST'>` comparé par égalité
stricte : il ne peut exprimer ni une autre méthode, ni un chemin paramétré. **Ouvrir ce flux impose
donc de changer la structure du middleware**, puis d'arbitrer l'absence de RBAC et d'audit sur ces
routes. Et l'objet du courriel de réinitialisation contient aujourd'hui un caractère corrompu, à
corriger au passage.

**Effet de bord à connaître** : le verrouillage anti-bruteforce justifie son compromis — un verrou
de 15 minutes plutôt que définitif — par le fait que la réinitialisation « n'est pas exposée ». Ce
commentaire est exact. Ouvrir ces routes impose donc de revoir ce raisonnement.

### ✅ La mise en quarantaine manuelle existe — correction d'une erreur de ce document

Une version antérieure affirmait qu'un lot ne pouvait pas être bloqué à la main. **C'est faux.**

`POST /organization/quality-controls` avec un résultat `NON_CONFORME` place le lot en `BLOQUE`
**quel que soit son état de départ** — voir `nextStatus()` dans `qualityControl.service.ts`, dont le
commentaire le dit explicitement. C'est le geste métier attendu : on ne bloque pas un lot par un
interrupteur, on enregistre le contrôle qui motive le blocage, et le blocage en découle. La
traçabilité de la décision est ainsi structurelle.

**Vérifié par exécution** (rôle `quality`, serveur réel) : un lot `EN_STOCK` passe à `BLOQUE` après
`POST /organization/quality-controls` avec `resultat: NON_CONFORME`.

Les chemins qui écrivent `BLOQUE` sont **trois** :

1. un contrôle qualité `NON_CONFORME` **sur un lot déjà en stock** — le geste manuel ;
2. un contrôle `NONCONFORME` ou `ALERTE` **à la réception**, qui fait naître le lot déjà bloqué ;
3. une excursion thermique détectée sur la télémétrie (`iotAlert.service.ts`).

Le rappel, lui, n'écrit **pas** `BLOQUE` mais `ALERTE`, un statut irréversible. La version
précédente de ce document confondait les deux.

### 🟥 En revanche, une quarantaine qualité ne se lève pas

C'est la vraie limite, et elle était masquée par l'erreur précédente. Une fois un lot `BLOQUE` par
un contrôle non conforme, **aucun chemin ne le ramène en stock** — vérifié par exécution, les deux
tentatives échouent en `409` :

| Tentative | Résultat |
|---|---|
| `POST /logistics/batches/:id/release` avec motif | `409` — « ne se libère pas par la levée de quarantaine froid » |
| `POST /organization/quality-controls` avec `CONFORME` | `409` — « sa levée est une décision qualité tracée à part » |

Les deux messages se renvoient l'un à l'autre : chacun désigne l'autre canal comme étant le bon.

C'est un **choix assumé**, écrit dans `batch.service.ts` : « un tel lot n'a, à ce stade du modèle,
pas d'autre issue que le rebut : on refuse de le remettre en circulation, on ne promet pas de
retour. » La conséquence mérite d'être connue : une contre-analyse favorable ne rattrape rien, et
un contrôle saisi par erreur condamne définitivement de la marchandise saine.

**Et la seule issue prévue — le rebut — n'est appelable depuis aucune interface** (issue #254). Un
lot bloqué par erreur est donc, en pratique, coincé sans aucune action possible depuis
l'application.

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
| Transformations | Pas de ressource propre, et aucun filtre par date | Elles **se relisent** — chaque transformation écrit deux mouvements (`TRANSFORMATION_ENTREE` / `TRANSFORMATION_SORTIE`) que `GET /organization/movements` restitue. Mais ce journal ne se filtre que par lot : répondre à « qu'a-t-on produit mardi ? » impose de tout parcourir. *(Correction : une version antérieure les disait en écriture seule.)* |
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

### 🟨 La branche de production a 639 commits de retard (au 28/07/2026)

**C'est la dette la plus visible du projet.** L'image publiée ne correspond à rien de ce qui est
décrit dans cette documentation : aucune des corrections récentes n'y figure.

**Coût de fermeture** : ce n'est pas du code à écrire, c'est une décision de livraison à prendre.
Ce chiffre est le seul de ce document qui **croît tout seul** : chaque intégration sur la branche de
préproduction l'augmente tant que la promotion n'est pas faite.

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
