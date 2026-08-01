# 18 — PCA / PRA + Intégrité Audit WORM (Objectif SMART n°7)

> **Branche** : `feat/audit-verify-pca-pra`
> **Statut** : MVP livré — vérification d'intégrité de la hash chain (endpoint + cron + checkpoint) + scripts backup/restore + runbook.
> **Cibles SLA** : **RPO < 15 min**, **RTO 60-120 min**.

## 1. Pourquoi

L'objectif SMART n°7 du projet Nutrichain (cf. `docs/00_contexte_projet.md`) exige :
- **Logs immuables avec hash chain** : déjà couvert par `auditService.logAction` (`src/shared/utils/audit/audit.service.ts`) — SHA256 chaînés, `FOR UPDATE` lock, `Restrict` sur cascade.
- **PCA/PRA** : aucune mécanique opérationnelle livrée jusqu'ici. Cette PR ajoute :
  - Un endpoint et un cron qui vérifient activement l'intégrité.
  - Des scripts de backup/restore et un runbook documenté.
  - Un mécanisme anti-troncature (high-water mark) pour détecter une suppression silencieuse de lignes Audit_Log.

## 2. Endpoint `GET /api/audit/verify`

**Auth** : session + `requireOrgRole(['owner','admin'])`.

**Réponse 200** (que la chaîne soit valide ou non — un état "broken" est une information, pas une erreur serveur) :
```json
{
  "status": 200,
  "message": "Chaîne d'audit vérifiée.",
  "data": {
    "organizationId": "org-uuid",
    "valid": true,
    "rowsChecked": 1287,
    "lastSignatureHash": "abc123...",
    "lastHorodatage": "2026-05-29T11:30:00.000Z",
    "lastId": 1287,
    "brokenAtId": null,
    "brokenAtReason": null,
    "expectedRowCount": null,
    "actualRowCount": null
  }
}
```

Header `Cache-Control: no-store` systématique (le résultat dépend de l'état mutable de la chain).

**Codes de rupture** :
- `prev_hash_mismatch` : une ligne référence un `prev_hash` qui n'est pas le `signature_hash` de la précédente.
- `signature_mismatch` : recompute SHA256 différent du `signature_hash` stocké.
- `truncation` : `current_row_count` < `Audit_Checkpoint.last_row_count` (suppression silencieuse de lignes de fin).

## 3. Cron `auditChainVerify.job.ts`

- `0 4 * * *` (4h00 chaque jour, après les cleanups de 0h et 3h).
- **Advisory lock single-instance** : `pg_try_advisory_lock(ADVISORY_LOCK_KEY)` au démarrage. Si déjà tenu (autre pod multi-réplique), skip silencieux.
- **Budget per-org** : 60s via `Promise.race`. Au-delà, l'org est skippée avec `logger.warn`, le job continue.
- **WORM-safe** : aucun `auditService.logAction` créé par le job. Lecture Audit_Log + écriture `Audit_Checkpoint` uniquement.
- Sur résultat valide : `recordCheckpoint` upsert. Sur broken : `logger.error` (à connecter à votre alerting ops — Slack/PagerDuty hors scope code).

## 4. Modèle de données

### `Audit_Checkpoint` (nouveau)

```prisma
model Audit_Checkpoint {
  organization_id     String       @id
  organization        Organization @relation(fields: [organization_id], references: [id], onDelete: Cascade)
  last_id             Int
  last_signature_hash String       @db.Char(64)
  last_row_count      Int
  verified_at         DateTime     @default(now())
}
```

**Pourquoi pas WORM** : la hash chain elle-même reste WORM (`Audit_Log` + `Restrict`). Le `Audit_Checkpoint` est un index mutable du dernier état observé valide — pas un journal. Supprimer une ligne `Audit_Checkpoint` ne dégrade pas la chain, juste la capacité à détecter une troncature future jusqu'à la prochaine verify OK.

### `auditHash.util.ts` (nouveau helper partagé)

`computeAuditHash(inputs)` est la **fonction unique** consommée à la fois par :
- `auditService.logAction` (écriture)
- `auditVerifyService.verifyChain` (vérification)

Garantit que la formule reste byte-identique entre les 2 usages. Des tests "**golden vector**" verrouillent la stabilité — inputs figés → SHA256 hex literal exact. Si la formule bouge, ils pètent bruyamment et l'auteur doit consciemment décider du sort des lignes déjà écrites (cf. §9.0).

⚠️ **Le premier de ces vecteurs ne portait qu'une seule clé** (`newValue: { x: 1 }`), donc la canonicalisation de #294 l'a laissé vert : le garde-fou décrit ici était muet pour exactement le changement qu'il devait attraper. Un second vecteur, aux clés désordonnées à la racine, dans un objet imbriqué et dans les objets d'un tableau, a été ajouté. Ne jamais se reposer sur un vecteur à clé unique.

## 5. Backup / Restore — Scripts npm

| Script | Effet |
|---|---|
| `npm run backup:postgres` | `pg_dump -Fc` vers `<BACKUP_DIR>/postgres-<stamp>.dump` |
| `npm run backup:mongo` | `mongodump --archive --gzip` vers `<BACKUP_DIR>/mongo-<stamp>.archive` |
| `npm run restore:postgres <dumpPath>` | `pg_restore --clean --if-exists` après garde-fous (cf. §6) |
| `npm run verify:audit-chain` | Itère toutes les orgs, exit 1 si une chain est broken |

Variables d'env :
- `BACKUP_DIR` (optionnel, défaut `./backups`)
- `RESTORE_CONFIRM_DB=<dbname>` (REQUIS pour `restore:postgres`, matchant le dbname parsé depuis `DATABASE_URL`)
- `RESTORE_ALLOW_PROD=YES` (REQUIS si `NODE_ENV=production`)
- `NODE_ENV`, `DATABASE_URL`, `MONGO_URI` (déjà existants)

Les binaires `pg_dump`, `pg_restore`, `mongodump` doivent être installés localement côté ops — pas embarqués dans le code.

## 6. Garde-fous `restore-postgres.ts`

3 reviewers indépendants ont insisté sur ces garde-fous (sans flag, un opérateur fatigué peut écraser la prod). Ils sont enforcés ET testés (`scripts/restore-postgres.test.ts`) :

1. **`NODE_ENV === 'production'`** sans `RESTORE_ALLOW_PROD=YES` → refus + exit 1.
2. **`RESTORE_CONFIRM_DB`** absent OU différent du dbname parsé depuis `DATABASE_URL` → refus + exit 1.
3. **Affichage host + dbname** sur stdout AVANT toute action (visibilité ops).

Exemple usage prod (interdit par défaut) :
```bash
NODE_ENV=production RESTORE_ALLOW_PROD=YES RESTORE_CONFIRM_DB=nutrichain \
  npm run restore:postgres ./backups/postgres-20260530-040000.dump
```

## 7. Runbook PCA/PRA — RTO 60-120 min

### Scénario A : restore d'un dump quotidien

1. Identifier le dump cible (`<BACKUP_DIR>` rangé par stamp).
2. **Stopper l'API** (drain du trafic en amont, fenêtre de maintenance).
3. `RESTORE_CONFIRM_DB=<dbname> npm run restore:postgres <dumpPath>`.
4. `npm run verify:audit-chain` → **doit** retourner exit 0.
5. Si exit 1 → cf. §8 "Recovery si verify fail post-restore".
6. Redémarrer l'API.
7. Smoke test : `GET /api/health` + `GET /api/audit/verify` côté admin.

**RPO** : la fenêtre de perte est le temps écoulé depuis le dernier backup. Pour un RPO < 15 min, le backup doit tourner toutes les 15 min (cron crontab externe ou scheduler infra) — **hors scope code, à configurer côté ops**.

**RTO** : `pg_restore` d'un dump nominal Nutrichain prend typiquement 5-30 min selon le volume. + verify + smoke = 60-120 min de fenêtre confortable.

### Scénario B : restore Mongo

Symétrique. `mongorestore --archive=<file> --gzip --drop`. La télémétrie IoT (`TelemetryModel`) a une TTL de 1 an — on peut accepter une perte partielle.

## 8. Recovery si `verify` fail POST-restore

Si après un restore, `GET /api/audit/verify` ou `npm run verify:audit-chain` retourne `valid: false` :

1. **NE PAS** réouvrir le trafic. La chaîne d'audit est notre garantie de conformité.
2. Lire `brokenAtId` et `brokenAtReason` :
   - `prev_hash_mismatch` → un maillon a été inséré, supprimé ou réordonné. C'est structurel : le dump est vraisemblablement corrompu. Rejouer le restore avec un dump **antérieur** au tampering présumé.
   - `signature_mismatch` → **ne rien détruire avant d'avoir écarté le faux positif.** Ce motif seul, sur une chaîne dont les `prev_hash` s'enchaînent tous, désigne bien plus souvent une divergence entre la formule d'écriture et celle de vérification qu'une falsification. C'est arrivé (#294 : la signature était calculée sur l'ordre d'insertion des clés, la vérification sur l'ordre rendu par `jsonb`), et **222 maillons authentiques sur 257 étaient déclarés falsifiés**. Contrôler d'abord que le premier maillon porte le `prev_hash` GENESIS et que la séquence est continue : si oui, la chaîne est structurellement intacte et le défaut est dans le code de vérification. Un restore effacerait des données saines.
   - `truncation` → le dump est plus court que le checkpoint persistant. **Solution** : 
     - Vérifier que le dump est bien le dernier complet.
     - Si oui (par ex. backup pris en pleine écriture), supprimer le `Audit_Checkpoint` corrompu (`DELETE FROM "Audit_Checkpoint" WHERE organization_id = '...'`) puis re-verify : si la chaîne est valide intrinsèquement, accepter la perte et recréer un checkpoint propre.
3. Documenter dans une investigation interne. Impact RTO : peut dépasser 120 min — à arbitrer avec le métier.

## 9.0 ⚠️ Changement de la formule de hash — ce qu'il faut faire des lignes antérieures

La formule sérialise désormais `ancienne_valeur` / `nouvelle_valeur` de manière **canonique** : clés triées récursivement, tableaux non réordonnés (#294). Sans ça, la signature dépendait de l'ordre d'insertion de l'objet en mémoire alors que la vérification travaille sur l'objet relu de `jsonb`, qui réordonne les clés.

**Conséquence** : toute ligne écrite avant ce changement dont les clés n'étaient pas déjà triées ne peut plus être vérifiée. Ce sont des **faux positifs** sur des données jamais altérées.

**Aucun script de re-signature n'est livré, et c'est délibéré.** Deux raisons :

1. **Il ne pourrait pas prouver ce qu'il prétend.** Pour re-signer sans risquer de sceller une ligne falsifiée, il faudrait retrouver l'ordre d'écriture d'origine. Cet ordre est irrécupérable autrement que par recherche exhaustive, et plusieurs services journalisent l'entité Prisma entière (`receipt.service.ts`), voire `oldValue` **et** `newValue` (les imports) : l'espace de recherche est le produit des factorielles, soit ~10¹¹ candidats pour une seule ligne d'import client.
2. **Ce serait le premier `UPDATE` sur `Audit_Log`.** Le modèle de menace ci-dessous repose sur le fait qu'aucun code ne réécrit ce journal. Un script de re-signature versionné dans le dépôt est un outil de falsification prêt à l'emploi — qui, en prime, remettrait le voyant d'intégrité au vert.

**Ce qu'on fait à la place :**

- **Environnement de développement** : `npx prisma migrate reset` puis `npx prisma db seed && npm run seed:demo`. Les anciennes lignes disparaissent avec le reset. C'est le seul environnement concerné aujourd'hui.
- **Si de l'historique devait un jour être conservé** : colonne **additive** `signature_hash_v2` + `signature_version`, `signature_hash` jamais touché, et la borne « lignes ≤ N non vérifiables sous v2 » consignée explicitement. La preuve d'origine survit — c'est la définition du WORM.

⚠️ **Ne pas utiliser `prisma db push`** pour réinitialiser : les migrations sont versionnées (règle 7 de `CLAUDE.md`).

### Limite connue du vérificateur

`Audit_Checkpoint.last_signature_hash` est **écrit** à chaque vérification (`auditVerify.service.ts`) mais **jamais relu pour comparaison** : seul `last_row_count` sert, contre la troncature. Une réécriture intégrale et cohérente d'une chaîne resterait donc indétectable — le nombre de lignes ne bouge pas et la seule empreinte qui la trahirait n'est pas confrontée. À fermer séparément.

## 9. Threat model assumé

- **Acteur malveillant local sur le serveur DB** : il a write access aux fichiers, donc peut modifier `Audit_Log`. La hash chain le détecte (`signature_mismatch`). Il peut aussi tronquer la fin (`truncation` détecté via checkpoint), ou supprimer le checkpoint lui-même (acceptable v1 — il faudrait alors signer le checkpoint, P3).
- **Acteur app-level (API)** : ne peut pas écrire dans `Audit_Log` autrement que via `auditService.logAction`. Aucune route ne `UPDATE` ou `DELETE` Audit_Log (vérifié par `audit.schema.test.ts`).
- **PII dans les dumps** : `pg_dump` exporte la totalité des tables, donc PII inclus. **`Audit_Log` lui-même contient potentiellement des PII** : `recall.service.ts:208` persiste `customerName` (et `shipmentRefs` jusqu'à 100 par rappel) dans `nouvelle_valeur`. Les backups sont donc des "PII repositories" au sens GDPR Art. 5. Doit être **chiffré au repos** côté ops (GPG, age, `pg_dump --encrypt`, ou stockage chiffré). Hors scope code. Règle de codage applicable : **minimiser les PII dans les payloads `auditService.logAction`** — préférer des IDs aux noms quand c'est possible.
- **`BACKUP_DIR` redirection** : un actor avec write access sur le filesystem peut rediriger les dumps ailleurs. Acceptable v1 — qui a write access sur le box owns aussi la DB.

## 10. Tests

- **Unit** :
  - `auditHash.util.test.ts` (10 cas dont 2 golden vectors — celui a cle unique ne prouve rien, cf. 9.0)
  - `auditVerify.service.test.ts` (12 cas dont truncation + checkpoint)
  - `auditVerify.controller.test.ts` (3 cas dont Cache-Control no-store + broken shape complet)
  - `audit.routes.test.ts` (4 cas supertest)
  - `auditChainVerify.job.test.ts` (5 cas dont advisory lock + per-org timeout)
  - `backup-postgres.test.ts` + `restore-postgres.test.ts` (10 cas, `child_process` mocké)
- **Régression** : 4 tests existants de `audit.service.test.ts` continuent de passer (formule byte-identique préservée par le helper).
- **E2E réel** `npm run e2e:audit-verify` : org éphémère + 3 audits, verify valide, recordCheckpoint, tampering UPDATE → signature_mismatch détecté, truncation DELETE → truncation détectée. Cleanup ordering respecte `onDelete: Restrict`.

## 11. Hors scope confirmé P3

- Export CSV/JSON Audit_Log pour archivage froid externe (S3 lifecycle)
- Réplication Postgres streaming
- Restic / borg / stockage S3 versionné automatique
- `GET /api/audit/logs` paginé pour consultation interne
- Métriques Prometheus du cron verify (rate, durée, broken_at_ratio)
- Signature électronique additionnelle (eIDAS / horodatage qualifié)
- Sharding multi-base
- Signature du `Audit_Checkpoint` lui-même (anti-attaque "delete checkpoint + truncate")
- Backup chiffré en application (déléguée ops via GPG/age)

## See also

- `docs/00_contexte_projet.md` §Objectif 7 — exigences originelles
- `src/shared/utils/audit/audit.service.ts` — écriture WORM
- `src/shared/utils/audit/audit.schema.test.ts` — invariants schéma WORM
- `src/modules/auditIntegrity/` — implémentation verify + cron
- Swagger : `/api-docs` → tag `Audit`
- Bruno : folder "Audit" → "Verify Chain"

---

*Branche `feat/audit-verify-pca-pra`. Multi-agent review du plan v1 → v2 (3 reviewers). Multi-agent review du code après implémentation.*
