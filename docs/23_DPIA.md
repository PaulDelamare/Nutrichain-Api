# 21 — Analyse d'impact relative à la protection des données (DPIA)

Document honnête : ce qui existe est décrit, ce qui n'existe pas est assumé — pas de case
cochée à tort ([`20_DOSSIER_SOUTENANCE.md`](20_DOSSIER_SOUTENANCE.md) applique la même règle
sur les objectifs SMART).

## 1. Périmètre et responsable de traitement

NutriChain est un logiciel multi-tenant : chaque organisation cliente (`Organization`) est
responsable de traitement pour ses propres données. NutriChain, en tant qu'éditeur, est
sous-traitant au sens RGPD. Ce document couvre le traitement tel qu'implémenté dans l'API,
pas un contrat de sous-traitance (absent — projet d'école, aucun client réel).

## 2. Données à caractère personnel traitées

| Donnée | Modèle | Finalité | Base légale |
|---|---|---|---|
| Email, nom | `User` | Authentification, attribution des actions | Exécution du contrat |
| Secret TOTP, codes de secours | `TwoFactor` | Authentification à deux facteurs | Exécution du contrat |
| Adresse IP de chaque requête | logs applicatifs (Winston) | Sécurité, débogage | Intérêt légitime |
| Empreinte HMAC de l'email | `LoginAttempt` (`email_hash`) | Verrou anti-bruteforce par compte | Intérêt légitime |
| Email, contact d'urgence, adresse | `Customer` | Expédition, traçabilité GS1/EPCIS | Exécution du contrat |
| Nom, email (invitation) | `Invitation` | Invitation à rejoindre une organisation | Exécution du contrat |
| Auteur d'une action (`received_by`, `created_by`, `id_user`…) | tables métier + `Audit_Log` | Traçabilité HACCP, imputabilité | Obligation légale (HACCP) |

Le scan public B2C (`/api/gs1/01/:gtin/10/:lot`, cf. #139/#146) est correctement minimisé :
il ne renvoie aucune donnée personnelle, seulement le lot et sa généalogie produit.

## 3. Ce qui existe déjà

- **Empreinte, pas texte clair** : l'email utilisé pour le verrou anti-bruteforce n'est jamais
  stocké en clair, seulement son HMAC (`LoginAttempt.email_hash`), purgé quotidiennement
  (cf. `20_DOSSIER_SOUTENANCE.md` §6).
- **Logs applicatifs bornés dans le temps** : les logs Winston (dont l'IP de chaque requête)
  tournent avec une rétention explicite — 14 jours (`LOG_RETENTION_DAYS`) pour les logs
  applicatifs, 90 jours pour les logs d'erreur (`src/shared/utils/logger/logger.ts`).
- **Minimisation par conception** sur la route de scan public.
- **Chiffrement en transit** (HTTPS attendu en déploiement) et secrets (mot de passe, TOTP)
  jamais journalisés en clair.

## 4. Ce qui n'existe pas — assumé, pas caché

- **Aucun droit à l'effacement.** Il n'existe aucun endpoint de suppression ou d'anonymisation
  de compte (`User`, `Member`, `Customer`). Un `onDelete: Cascade` supprime les lignes liées
  si l'organisation entière est supprimée, mais rien ne permet à un individu de faire valoir
  son droit à l'oubli isolément (voir issue #107 du depot).
- **Aucune pseudonymisation** des données métier : `Customer.email`, `Supplier.contact_qualite`,
  les noms d'utilisateurs, restent en clair dans la base et dans l'audit WORM.
- **Aucune durée de conservation** pour les données en base (contrairement aux logs Winston) :
  `User`, `Member`, `Customer`, `Audit_Log` sont conservés **indéfiniment**. C'est un choix de
  conception assumé pour l'audit WORM (une entrée d'audit ne doit jamais disparaître, par
  construction), mais il n'a **pas** été pensé comme choix RGPD pour les données personnelles
  qui y transitent — l'auteur d'une action reste nommé dans une chaîne qui ne s'efface jamais.
- **Aucune page de politique de confidentialité**, alors qu'une route publique existe déjà
  (scan B2C).
- **Pas de registre des sous-traitants** (hébergeur, etc.) — aucun déploiement réel.

## 5. Risques et mitigation proposée

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Impossibilité d'honorer une demande d'effacement (art. 17 RGPD) | Élevée (aucun endpoint) | Élevé si client réel | Endpoint d'anonymisation qui remplace `email`/`nom` par une valeur générique, conserve l'ID pour l'intégrité référentielle et l'audit |
| Conservation indéfinie de données personnelles hors WORM | Élevée | Moyen | Politique de rétention explicite sur `Customer`/`Member` inactifs (l'audit WORM, lui, reste volontairement permanent) |
| Absence de base légale documentée pour le client final | Moyenne | Moyen | Registre des traitements + mention dans un contrat de sous-traitance (hors périmètre technique) |

## 6. Conclusion

En l'état, ce logiciel **ne serait pas conforme** pour un déploiement avec des données
personnelles réelles : le principal manque est le droit à l'effacement (#107), qui conditionne
plusieurs des autres points. La conception audit-WORM, elle-même une exigence de traçabilité
HACCP, entre en tension directe avec la conservation limitée du RGPD — tension à assumer et
documenter, pas à masquer.
