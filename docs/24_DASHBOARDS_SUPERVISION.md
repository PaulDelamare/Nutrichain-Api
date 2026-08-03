# 24 — Tableaux de bord de supervision (technique, pas métier)

Le front a son dashboard **métier** (lots suivis, alertes, rappels en cours — destiné à un
utilisateur opérationnel). Ce document couvre un besoin différent : la supervision
**technique** de l'API elle-même, destinée à qui exploite le service, pas à qui l'utilise.

**Mise à jour du 03/08/2026 — un tableau de bord existe désormais dans l'API.** Le module
`observability` expose deux routes, toutes deux réservées à `ADMIN_ROLES` (`owner`, `admin`) :

| Route | Ce qu'elle rend |
|---|---|
| `GET /api/observability/metrics` | JSON : latence par route (p50/p95/p99, tampon circulaire en mémoire **depuis le dernier redémarrage**), entrées d'audit et alertes des dernières 24 h |
| `GET /api/observability/dashboard` | Les mêmes données rendues en **page HTML**, consultable directement |

Deux limites à garder en tête : les latences vivent **en mémoire** et repartent de zéro à chaque
redémarrage — ce n'est pas un historique ; et le format n'est pas du Prometheus/OpenMetrics, donc
aucun collecteur ne s'y branche tel quel.

Le reste de ce document décrit les autres sources de données déjà présentes dans le code, et les
panneaux qu'elles permettraient de construire — cela, **aucun outil externe ne le fait aujourd'hui**.

## Ce qui existe déjà comme source

| Source | Ce qu'elle donne | Limite connue |
|---|---|---|
| `GET /api/health` | Liveness : le process répond | Aucune information sur les dépendances |
| `GET /api/health/ready` | Readiness : PostgreSQL, **MongoDB**, migrations appliquées, répertoire de logs inscriptible | Publie un **statut par sonde, et rien d'autre** : ni message d'exception, ni chemin, ni nom de migration. Cette route ne demande aucune authentification, le diagnostic part donc dans `logs/` (#258) |
| Logs applicatifs (`logs/app-*.log`, `logs/error-*.log`) | Requêtes, erreurs, événements de sécurité inventoriés dans `22_JOURNALISATION_SIEM.md` | Format texte, local à l'hôte, pas d'expédition |
| Job planifié de vérification d'audit (`auditChainVerify.job.ts`) | Intégrité de la chaîne WORM (`[AuditVerify] OK` / `CORROMPUE`) | Résultat seulement journalisé, pas exposé par une route |
| `EPCIS_Event` (PostgreSQL) | Volumétrie d'événements par organisation/type/date | Jamais lue par aucun client (#159) — vaut aussi bien comme source de dashboard technique qu'agenda de démonstration |

## Panneaux recommandés, par source déjà disponible

1. **Disponibilité** : statut `/health/ready` dans le temps (PostgreSQL, MongoDB, migrations,
   logs). Mongo y a été ajouté depuis (#158) : le panneau ne ment plus par omission sur la chaîne
   du froid. Pour savoir POURQUOI une sonde est tombée, il faut le journal — la réponse ne porte
   que le statut, à dessein (#258).
2. **Sécurité** : volumétrie des lignes `warn`/`error` de `22_JOURNALISATION_SIEM.md`, en
   particulier les deux manques identifiés (429 et verrouillage de compte, qui aujourd'hui
   n'émettent rien à afficher).
3. **Intégrité de l'audit** : dernier résultat du job de vérification de chaîne, par
   organisation — vert/rouge, pas de zone grise possible par construction (chaînage par hash).
4. **Activité EPCIS** : nombre d'événements par type (`ObjectEvent`/`TransformationEvent`/
   `AggregationEvent`) et par organisation sur une fenêtre glissante — sert aussi de preuve de
   vie pour la conformité GS1/EPCIS.

## Ce qu'il manque pour que ça devienne un vrai tableau de bord

- Aucun outil de visualisation externe n'est branché (pas de Grafana/Metabase connecté) : la page
  `/api/observability/dashboard` est rendue par l'API elle-même.
- Aucune de ces sources n'est exposée en **Prometheus/OpenMetrics** — la route d'agrégation
  existe (`GET /api/observability/metrics`, gardée par `ADMIN_ROLES`) mais elle rend du JSON maison ;
  brancher un collecteur demanderait un exporteur au format attendu.
- **Pas d'historique** : les latences sont conservées en mémoire et disparaissent au redémarrage.
  Aucune série temporelle n'est persistée.
- Le point 1 dépend directement de la correction de #158.

Ce document liste la matière réellement disponible ; construire l'outil au-dessus est un travail
distinct, non fait ici.
