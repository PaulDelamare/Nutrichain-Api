# 24 — Tableaux de bord de supervision (technique, pas métier)

Le front a son dashboard **métier** (lots suivis, alertes, rappels en cours — destiné à un
utilisateur opérationnel). Ce document couvre un besoin différent : la supervision
**technique** de l'API elle-même, destinée à qui exploite le service, pas à qui l'utilise.

**Aucun de ces tableaux de bord n'est déployé.** Ce qui suit décrit les sources de données déjà
présentes dans le code et directement exploitables, pas un outil livré.

## Ce qui existe déjà comme source

| Source | Ce qu'elle donne | Limite connue |
|---|---|---|
| `GET /api/health` | Liveness : le process répond | Aucune information sur les dépendances |
| `GET /api/health/ready` | Readiness : PostgreSQL, migrations appliquées, répertoire de logs inscriptible | **Ne teste pas MongoDB** — une télémétrie IoT hors service ne remonte nulle part (#158) |
| Logs applicatifs (`logs/app-*.log`, `logs/error-*.log`) | Requêtes, erreurs, événements de sécurité inventoriés dans `22_JOURNALISATION_SIEM.md` | Format texte, local à l'hôte, pas d'expédition |
| Job planifié de vérification d'audit (`auditChainVerify.job.ts`) | Intégrité de la chaîne WORM (`[AuditVerify] OK` / `CORROMPUE`) | Résultat seulement journalisé, pas exposé par une route |
| `EPCIS_Event` (PostgreSQL) | Volumétrie d'événements par organisation/type/date | Jamais lue par aucun client (#159) — vaut aussi bien comme source de dashboard technique qu'agenda de démonstration |

## Panneaux recommandés, par source déjà disponible

1. **Disponibilité** : statut `/health/ready` dans le temps (PostgreSQL, migrations, logs) —
   ajouter Mongo à ce endpoint est un préalable (#158), sans quoi ce panneau ment par omission
   sur la moitié du système (chaîne du froid).
2. **Sécurité** : volumétrie des lignes `warn`/`error` de `22_JOURNALISATION_SIEM.md`, en
   particulier les deux manques identifiés (429 et verrouillage de compte, qui aujourd'hui
   n'émettent rien à afficher).
3. **Intégrité de l'audit** : dernier résultat du job de vérification de chaîne, par
   organisation — vert/rouge, pas de zone grise possible par construction (chaînage par hash).
4. **Activité EPCIS** : nombre d'événements par type (`ObjectEvent`/`TransformationEvent`/
   `AggregationEvent`) et par organisation sur une fenêtre glissante — sert aussi de preuve de
   vie pour la conformité GS1/EPCIS.

## Ce qu'il manque pour que ça devienne un vrai tableau de bord

- Aucun outil de visualisation n'est branché (pas de Grafana/Metabase connecté).
- Aucune de ces sources n'est exposée en Prometheus/OpenMetrics ; il faudrait soit un exporteur,
  soit une route d'agrégation dédiée (`GET /api/admin/metrics`, gardée par rôle `owner`).
- Le point 1 dépend directement de la correction de #158.

Ce document liste la matière réellement disponible ; construire l'outil au-dessus est un travail
distinct, non fait ici.
