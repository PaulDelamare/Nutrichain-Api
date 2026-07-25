# Index de la documentation

Vingt-huit documents se sont accumulés au fil du projet. Certains décrivent le code d'aujourd'hui,
d'autres une intention passée. **Rien ne les distinguait** : il fallait ouvrir chaque fichier pour
savoir lequel faisait foi — et deux d'entre eux enseignaient un modèle de sécurité supprimé depuis.

Cet index tranche. Trois statuts, un seul sens de lecture.

| Statut | Ce que ça veut dire |
|---|---|
| ✅ **À jour** | Décrit le code tel qu'il est. Vérifié le 22/07/2026. |
| 📌 **Plan / passation** | Une intention à une date donnée. Ce qui est livré est indiqué en tête du document. |
| 🛑 **Historique** | Décrit un état **révolu**. À ne pas appliquer : conservé pour la traçabilité des décisions. |

---

## Pour découvrir le projet

| Doc | Statut | Contenu |
|---|:--:|---|
| [`20_DOSSIER_SOUTENANCE.md`](20_DOSSIER_SOUTENANCE.md) | ✅ | Problème → réponse → démonstration → preuves. **Commencer ici.** |
| [`19_architecture.md`](19_architecture.md) | ✅ | Cinq diagrammes : contexte, modules, anatomie d'un module, flux EPCIS, décisions. |
| [`00_contexte_projet.md`](00_contexte_projet.md) | 📌 | Cadrage initial et besoins métier. |

## Le métier

| Doc | Statut | Contenu |
|---|:--:|---|
| [`04_tracabilite_et_lots.md`](04_tracabilite_et_lots.md) | ✅ | Règles de traçabilité, cycle de vie d'un lot. |
| [`11_TECH_TRANSFORMATIONS_GENEALOGY.md`](11_TECH_TRANSFORMATIONS_GENEALOGY.md) | ✅ | Transformations et généalogie, côté technique. |
| [`11_TRANSFORMATIONS_GENEALOGY.md`](11_TRANSFORMATIONS_GENEALOGY.md) | 📌 | Note de conception antérieure, même sujet. Le fichier `11_TECH_*` fait foi. |
| [`12_RECALLS_SYSTEM.md`](12_RECALLS_SYSTEM.md) | ✅ | Rappel produit et propagation à la descendance. |
| [`15_iot_cold_chain_alerts.md`](15_iot_cold_chain_alerts.md) | ✅ | Chaîne du froid : détection d'excursion, alerte, quarantaine automatique. |
| [`17_alert_resolve.md`](17_alert_resolve.md) | ✅ | Résolution tracée d'une alerte. |
| [`07_logistics_module.md`](07_logistics_module.md) | 📌 | Conception du module logistique. |
| [`10_PLAN_SHIPMENTS.md`](10_PLAN_SHIPMENTS.md) | 📌 | Plan des expéditions. Livré sauf l'étiquette au niveau expédition. |

## Conventions et méthode

| Doc | Statut | Contenu |
|---|:--:|---|
| [`05_bonnes_pratiques_api.md`](05_bonnes_pratiques_api.md) | ✅ | Architecture en couches, cloisonnement, transactions, tests. |
| [`06_standards_techniques.md`](06_standards_techniques.md) | ✅ | Swagger, observabilité, variables d'environnement, pagination, CI. |
| [`21_WORKFLOW_GIT.md`](21_WORKFLOW_GIT.md) | ✅ | Branches, commits, protections de branche réellement actives. |
| [`../GUIDE_IA.md`](../GUIDE_IA.md) | ✅ | Méthode de travail. Chaque règle est adossée à un incident réel du projet. |

## Sécurité

| Doc | Statut | Contenu |
|---|:--:|---|
| [`13_SESSION_HARDENING_2026-05-27.md`](13_SESSION_HARDENING_2026-05-27.md) | 📌 | Trace d'une session de durcissement. |
| [`18_PCA_PRA.md`](18_PCA_PRA.md) | ✅ | Continuité, reprise, vérification de la chaîne d'audit. |
| [`22_JOURNALISATION_SIEM.md`](22_JOURNALISATION_SIEM.md) | ✅ | Rétention des journaux, point de collecte, et inventaire vérifié de ce qui est détectable. |
| [`23_DPIA.md`](23_DPIA.md) | ✅ | Analyse d'impact RGPD : données traitées, ce qui existe, ce qui manque (droit à l'effacement, rétention). |
| [`24_DASHBOARDS_SUPERVISION.md`](24_DASHBOARDS_SUPERVISION.md) | ✅ | Supervision technique (santé, sécurité, intégrité d'audit) — distincte du dashboard métier du front. Rien n'est déployé. |
| [`02_roles_et_permissions.md`](02_roles_et_permissions.md) | 📌 | Conception **ABAC**, jamais implémentée. Le code applique un RBAC à 5 rôles. |
| [`01_analyse_authentification.md`](01_analyse_authentification.md) | 📌 | Analyse comparative des solutions d'authentification. |
| [`03_plan_implementation_auth.md`](03_plan_implementation_auth.md) | 📌 | Plan d'authentification. La partie ABAC et trois routes n'existent pas. |
| [`09_SECURITY_DECISION_MATRIX.md`](09_SECURITY_DECISION_MATRIX.md) | 🛑 | Matrice bâtie sur un flux clé API sans cloisonnement — **supprimé**. |
| [`README_SECURITY.md`](README_SECURITY.md) | 🛑 | Même modèle périmé. |
| [`07_logistics_security_implementation.md`](07_logistics_security_implementation.md) | 🛑 | Rôles `logistics_*` et écriture par clé API : rien de tout cela n'existe. |
| [`08_IMPLEMENTATION_GUIDE.md`](08_IMPLEMENTATION_GUIDE.md) | 🛑 | Compagnon du précédent, même modèle. |

## Intégration

| Doc | Statut | Contenu |
|---|:--:|---|
| [`14_sync_mobile_offline.md`](14_sync_mobile_offline.md) | ✅ | Synchronisation mobile hors-ligne, idempotence. |
| [`16_invitation_register_flow.md`](16_invitation_register_flow.md) | ✅ | Invitation et inscription. |
| [`frontend_integration.md`](frontend_integration.md) | 📌 | Guide d'intégration front. Antérieur au durcissement de la clé API. |
| [`logistics-api-endpoints.md`](logistics-api-endpoints.md) | 📌 | Exemples curl du module logistique. |
| [`HANDOVER_SESSION_TRACEABILITY.md`](HANDOVER_SESSION_TRACEABILITY.md) | 📌 | Passation du module traçabilité. |

---

> **La référence qui prime sur tout** : le code, et la documentation d'API générée depuis les
> routes (`/api-docs`). Un document qui contredit le code a tort — signalez-le plutôt que de le
> suivre.
