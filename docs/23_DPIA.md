# 23 — Analyse d'impact relative à la protection des données (DPIA)

Document honnête : ce qui existe est décrit, ce qui n'existe pas est assumé — pas de case
cochée à tort ([`20_PRESENTATION_PROJET.md`](20_PRESENTATION_PROJET.md) applique la même règle
sur les objectifs SMART).

## 1. Périmètre et responsable de traitement

NutriChain est un logiciel multi-tenant : chaque organisation cliente (`Organization`) est
responsable de traitement pour ses propres données. NutriChain, en tant qu'éditeur, est
sous-traitant au sens RGPD. Ce document couvre le traitement tel qu'implémenté dans l'API,
pas un contrat de sous-traitance (absent — aucun déploiement client réel à ce stade).

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
il ne renvoie aucune donnée personnelle (pas de contact fournisseur ni d'adresse), seulement le
lot, sa généalogie produit et le **nom commercial de la ferme** (`Supplier.nom_ferme`) —
décision produit issue #51 Front / transparence B2C, sans exposer les coordonnées.

## 3. Ce qui existe déjà

- **Empreinte, pas texte clair** : l'email utilisé pour le verrou anti-bruteforce n'est jamais
  stocké en clair, seulement son HMAC (`LoginAttempt.email_hash`), purgé quotidiennement
  (cf. `20_PRESENTATION_PROJET.md` §6).
- **Logs applicatifs bornés dans le temps** : les logs Winston (dont l'IP de chaque requête)
  tournent avec une rétention explicite — 14 jours (`LOG_RETENTION_DAYS`) pour les logs
  applicatifs, 90 jours pour les logs d'erreur (`src/shared/utils/logger/logger.ts`).
- **Droit à l'effacement, par anonymisation** : `DELETE /api/identity/me` remplace l'e-mail et le
  nom par des valeurs génériques et coupe sessions et identifiants de connexion. Le `User.id` est
  **conservé** : il est référencé par les tables métier et par l'audit WORM, qui ne doit jamais
  perdre un maillon. C'est précisément l'arbitrage entre l'article 17 du RGPD et la traçabilité
  HACCP — l'action reste imputable à un identifiant, plus à une personne nommée.
  L'opération est refusée en **409** tant que l'appelant est propriétaire d'une organisation : il
  doit d'abord transférer la propriété, faute de quoi l'organisation resterait sans responsable.
- **Minimisation par conception** sur la route de scan public.
- **Chiffrement en transit** (HTTPS attendu en déploiement) et secrets (mot de passe, TOTP)
  jamais journalisés en clair.

## 4. Ce qui n'existe pas — assumé, pas caché

- ~~**Aucun droit à l'effacement.**~~ **Livré depuis** (vérifié le 03/08/2026) : voir §3.
  Reste hors périmètre de cet endpoint : les personnes physiques référencées comme **contacts
  clients ou fournisseurs** (`Customer.email`, `Supplier.contact_qualite`) — elles n'ont pas de
  compte, donc aucun moyen de faire valoir leur droit à l'oubli. C'est le manque restant.
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
| Impossibilité d'honorer une demande d'effacement (art. 17 RGPD) | ~~Élevée~~ **Faible pour les comptes** — `DELETE /api/identity/me` livré | Élevé si client réel | ✅ Fait pour les comptes. **Reste ouvert** pour les contacts clients/fournisseurs, qui n'ont pas de compte : il faudrait une anonymisation déclenchée par l'organisation responsable |
| Conservation indéfinie de données personnelles hors WORM | Élevée | Moyen | Politique de rétention explicite sur `Customer`/`Member` inactifs (l'audit WORM, lui, reste volontairement permanent) |
| Absence de base légale documentée pour le client final | Moyenne | Moyen | Registre des traitements + mention dans un contrat de sous-traitance (hors périmètre technique) |

## 6. Conclusion

En l'état, ce logiciel **ne serait pas conforme** pour un déploiement avec des données
personnelles réelles. Le droit à l'effacement, longtemps le manque principal, est **traité pour
les comptes utilisateurs** depuis `DELETE /api/identity/me` (anonymisation, §3). Ce qui reste :

1. **Les contacts clients et fournisseurs** — des personnes physiques sans compte, donc sans aucun
   moyen d'exercer leur droit. C'est aujourd'hui le manque le plus sérieux.
2. **Aucune durée de conservation** en base hors journaux applicatifs.
3. **Aucune politique de confidentialité** publiée, alors qu'une route publique existe.

La conception audit-WORM, elle-même une exigence de traçabilité HACCP, entre en tension directe
avec la conservation limitée du RGPD — l'anonymisation, qui garde l'identifiant et efface
l'identité, est la façon dont cette tension a été tranchée ici. Tension à assumer et documenter,
pas à masquer.
