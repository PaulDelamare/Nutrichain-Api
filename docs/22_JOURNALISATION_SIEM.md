# Journalisation : rétention, collecte, et ce qui est réellement détectable

Ce document dit **où sont les journaux**, **combien de temps ils vivent**, et surtout **quels
événements de sécurité produisent réellement une ligne**. Ce dernier point est le seul qui compte
pour écrire une règle de détection : une règle posée sur un événement qui n'écrit rien ne se
déclenche jamais, et donne l'illusion d'une surveillance.

## Où écrivent les journaux

Deux transports fichiers, en rotation quotidienne (`winston-daily-rotate-file`), plus la console.

| Fichier | Contenu | Rétention |
|---|---|---|
| `logs/app-YYYY-MM-DD.log` | Tout (`info` et au-dessus) | `LOG_RETENTION_DAYS`, défaut **14 j** |
| `logs/error-YYYY-MM-DD.log` | `error` et `crit` seulement | `ERROR_LOG_RETENTION_DAYS`, défaut **90 j** |

Chaque fichier est aussi borné à **5 Mo** (`maxSize`), la rotation prenant le relais avant.

Deux choix expliqués :

- **La rétention est bornée.** Sans `maxFiles`, la rotation empilait indéfiniment : le disque finit
  plein, et l'API cesse d'écrire sans que rien ne le signale — la source de détection meurt en
  silence, au pire moment.
- **Les erreurs vivent plus longtemps que le reste.** Une intrusion se découvre rarement le jour
  même ; à 14 jours, une analyse tardive n'aurait plus rien à examiner. Le volume des `error` étant
  faible, les garder 90 jours ne coûte presque rien.
- **La date est ISO sur les deux fichiers.** `MM-DD-YYYY` ne se trie pas chronologiquement : un
  collecteur qui parcourt le répertoire dans l'ordre alphabétique reconstituait une chronologie
  fausse. Les deux transports divergeaient sur ce point.

## Le point de collecte

**En l'état, la collecte est locale** : le répertoire `logs/` de l'hôte qui exécute l'API (il est
`gitignore`, jamais versionné). C'est le point d'ingestion à déclarer dans un collecteur.

```
<racine du projet>/logs/*.log      ← chemin à surveiller
```

Le format est du **texte ligne à ligne**, pas du JSON :

```
2026-07-24 01:17:17 [ERROR]: [AuditVerify] CORROMPUE org=demo brokenAtId=42 reason=hash_mismatch
2026-07-24 01:17:18 [INFO] [req:0f3c…]: POST /api/logistics/receipts 201
```

Un collecteur doit donc appliquer un motif d'extraction : `timestamp`, `level`, `requestId`
optionnel entre `[req:…]`, puis le message. Le `requestId` est la clé de corrélation — posé par
`requestId.middleware`, il accepte un `X-Request-ID` entrant et le renvoie en en-tête de réponse,
ce qui permet de relier une trace client à ses lignes serveur.

L'identifiant entrant n'est repris que s'il correspond à `^[A-Za-z0-9._-]{8,64}$` ; sinon un UUID
est généré **sans erreur ni avertissement**. Un collecteur qui émet un format plus large (espaces,
ponctuation, au-delà de 64 caractères) perdrait donc le chaînage sans rien voir. Cette valeur ne
sert pas qu'aux journaux : elle est renvoyée dans le corps des réponses 5xx (« Référence : … »),
ce qui interdit d'y laisser passer des caractères de balisage.

## Ce qui est réellement détectable aujourd'hui

Vérifié dans le code, pas déduit.

| Événement | Ligne émise ? | Où |
|---|:--:|---|
| **Chaîne d'audit WORM rompue** | ✅ `error` | `auditChainVerify.job.ts` — `[AuditVerify] CORROMPUE org=… brokenAtId=… reason=…` |
| Vérification d'intégrité réussie | ✅ `info` | `[AuditVerify] OK org=… rows=…` |
| Crash du contrôle d'intégrité | ✅ `error` | `[AuditVerify] Cron crash: …` |
| Invitation déjà consommée / incohérente | ✅ `warn` | `auth.config.ts` — hooks Better-Auth |
| Échec de remise à zéro du throttle | ✅ `error` | `loginThrottle.middleware.ts` |
| **Dépassement de quota (429)** | ❌ **aucune** | `rateLimiter.middleware.ts` répond sans journaliser |
| **Verrouillage de compte après N échecs** | ❌ **aucune** | `loginThrottle.middleware.ts` lève une `APIError`, sans ligne |

Les deux dernières lignes sont des **manques connus**, et ils sont structurants : ce sont
précisément les événements sur lesquels reposeraient une détection de force brute et une détection
d'abus d'API. Les contrôles existent et fonctionnent — ils bloquent — mais ils ne **racontent**
rien. Tant qu'ils n'émettent pas, aucune règle ne peut être écrite au-dessus (cf. issue #84).

## La matière qui n'est pas dans les journaux

Toute écriture sensible est scellée dans **`Audit_Log`** (table PostgreSQL) : action typée,
`id_user`, `organization_id`, chaînage par hash. C'est une source plus riche et plus fiable que les
journaux applicatifs — mais elle vit **en base**, pas dans un fichier. Une détection qui s'appuie
dessus interroge la base ou attend un export ; elle ne lit pas `logs/`.

## Limites assumées

- **Pas d'expédition hors hôte.** Les journaux ne quittent pas la machine. Un attaquant qui
  obtiendrait les droits d'écriture sur l'hôte pourrait les modifier — c'est la raison d'être du
  chaînage par hash de `Audit_Log`, qui, lui, résiste à la réécriture.
- **Pas de contrôle d'intégrité sur les fichiers de journaux** eux-mêmes (pas de signature, pas de
  somme de contrôle). Seule la chaîne d'audit en base est vérifiée, par le job périodique.
- **Format texte, pas JSON.** Un collecteur doit parser plutôt qu'ingérer directement.

Ces trois limites sont acceptables pour un déploiement mono-hôte. Elles ne le seraient pas en
production multi-instances : il faudrait alors un agent d'expédition (Filebeat, Vector, Promtail) et
un format structuré.
