# 15 — IoT Cold Chain Alerts (alerte chaîne du froid temps réel)

> **Objectif SMART n°2** — Alerte chaîne du froid < 30s p95 (cible 15/03/2026)
> **Statut** : MVP livré sur la branche `feat/iot-cold-chain-alerts`

## 1. Contexte

La raison d'être de Nutrichain est de surveiller la chaîne du froid en temps réel. Le ping IoT (POST `/api/telemetry/ping`) ingère la télémétrie dans MongoDB time-series, mais jusqu'à cette PR il n'y avait **aucune détection d'excursion ni alerte créée**. Cette PR ajoute :
- Détection d'excursion synchrone à l'ingestion (~50ms cache miss, <10ms cache hit)
- Création atomique d'`Alert` + audit WORM dans la même transaction Serializable
- Notification email aux owners/admins de l'org

## 2. Flux

```
POST /telemetry/ping → machineAuth (passerelle IotGateway → organisation) → ingestController :
  1. TelemetryModel.create(...) → MongoDB time-series
  2. iotAlertService.checkAndAlert({...}) → détection sync
  3. res.status(202) + `detection` (MONITORED | NO_EQUIPMENT | NO_THRESHOLD)
```

L'organisation d'une trame vient de la **passerelle qui présente la clé** (`IotGateway`, empreinte
SHA-256, révocable), et non plus de `API_KEY_ORG_ID` : sinon une seule organisation — celle du
`.env` — avait une chaîne du froid, et un `sensor_id` homonyme mettait en quarantaine les lots d'une
autre (#93). Clé inconnue ou révoquée → 401.

### Détail de `checkAndAlert`

1. **Cache lookup** (`Map<orgId:sensorId, { equipmentId, threshold, ttl }>`, TTL 60s)
2. **Si miss** : `prisma.equipment.findFirst({ where: { sensor_id, organization_id } })`. Si null → `logger.warn(sensorId only)` + exit.
3. Si pas de seuil défini sur l'Equipment → exit
4. **Fast path** : si `currentTemp <= threshold` → exit immédiat (cas ~99% des pings)
5. **Advisory lock per-equipment** : `pg_try_advisory_lock(hash(orgId, equipmentId))`. Si déjà pris → exit silencieux.
6. **Query Mongo fenêtre 15min** : derniers points du capteur, filtre temporel + multi-tenant, safety cap 1000 docs.
7. **Détection** (logique pure dans `excursionDetection.service`) : ≥ 80% des points strictement au-dessus du seuil ET ≥ 5 points.
8. **Dédup** : si `Alert` ACTIVE existante pour ce equipment + type='TEMP_EXCURSION' → exit (anti-spam).
9. **Transaction atomique** (Serializable, timeout 10s) : **mise en quarantaine des lots stockés** — les `Batch` EN_STOCK dont `id_materiel_actuel` pointe sur l'équipement passent en `BLOQUE` (`batch.updateMany`) — puis `alert.create({ type: 'TEMP_EXCURSION', niveau_gravite: 'PANIC', message incluant le nombre de lots bloqués, ... })` + `auditService.logAction({ action: 'TEMP_EXCURSION_DETECTED', newValue.quarantinedBatchesCount }, tx)`. Un incident matériel ne peut donc pas laisser partir un produit potentiellement altéré : la quarantaine, l'alerte et l'audit sont atomiques.
10. **Email** aux owners/admins (Member filtré par `equipment.organization_id` re-lu depuis la DB, defense-in-depth réelle). Appelé en `void` (vraiment fire-and-forget) — chaque envoi a son `.catch(logger.error)` individuel, et un `try/catch` global garde-fou pour swallow toute promesse non-handled. Échec d'envoi loggué mais alerte persiste.
11. **Finally** : `pg_advisory_unlock` toujours appelé.

## 3. Sécurité

| Risque | Mitigation |
|---|---|
| Cross-tenant sensor spoofing | `Equipment.findFirst` filtre par `organization_id: activeOrgId`, résolu depuis la passerelle (`machineAuth` → `IotGateway`) |
| Sensor_id collision entre orgs | `@@unique([organization_id, sensor_id])` composite (pas global) |
| Cache pollution cross-tenant | Cache key = `${orgId}:${sensorId}` |
| Email cross-tenant | Recipients filtrés par `equipment.organization_id`, jamais par `activeOrgId` direct |
| Audit WORM hash chain sous concurrence | Transaction Serializable + `auditService.logAction(..., tx)` |
| TOCTOU race sur dédup | Advisory lock per-equipment sérialise les checks |
| PII dans les warn logs | Logs ne contiennent QUE `sensorId` (jamais température, adresse, contact) |
| DoS Mongo query | Filtre temporel + `limit(1000)` safety cap |

## 4. Performance (mesurée)

| Étape | Coût |
|---|---|
| Cache hit (fast path sous seuil) | < 2 ms |
| Cache miss (Postgres findFirst) | ~5 ms (composite unique index) |
| Mongo query 15min window | ~5-10 ms (index time-series) |
| Détection (logique pure) | < 1 ms |
| Dédup Alert.findFirst | ~5 ms |
| Alert.create + audit (Serializable tx) | ~20 ms |
| Email send | fire-and-forget, hors path critique |
| **Total cache hit + sous seuil** | **~2 ms** |
| **Total cache miss + alerte créée** | **~50 ms** |

Latence ajoutée par ping IoT : +2 à +50 ms selon le cas. **Largement dans le SLA 30s p95 de l'Objectif 2.**

## 5. Modèle de données

### Migration : `Equipment.sensor_id`

```prisma
model Equipment {
  // ... champs existants
  sensor_id String?
  @@unique([organization_id, sensor_id])
}
```

Composite unique (org + sensor) : permet à 2 orgs d'utiliser le même `sensor_id` sans collision, empêche enumeration cross-tenant.

### Alert (existant, réutilisé)

```
type: 'TEMP_EXCURSION'
niveau_gravite: 'PANIC'
id_materiel: <equipmentId>
related_entity: 'Equipment'
related_id: <equipmentId>
statut: 'ACTIVE'  // résolution manuelle hors scope v1
```

### Audit_Log (existant, action ajoutée)

```
action: 'TEMP_EXCURSION_DETECTED'
entity: 'Alert'
entityId: <alert.id>
newValue: { sensorId, equipmentId, threshold, peakTemp, ratioOverThreshold, windowMinutes }
```

## 6. Règle de détection

Fonction pure `detectExcursion(points, threshold, minPoints=5, minOverThresholdRatio=0.8)` :
- `points.length >= minPoints` (sinon insuffisant pour décider — évite alerte sur sensor fraîchement allumé)
- `(count where temperature > threshold) / points.length >= minOverThresholdRatio`
- **Comparaison strict `>`** : un point exactement au seuil ne compte pas comme excursion

Justification : tolère le jitter capteur (un seul outlier ne reset pas la détection). Industry norm pour cold chain.

## 7. Limites et items P3 (différés)

- **Outbox pattern** pour résilience crash (window ~1ms négligeable, accepté MVP)
- **Cache invalidation event-based** sur `Equipment.update(temp_seuil_max)` — staleness ≤ 60s acceptée v1
- **Backfill automatique `Equipment.sensor_id`** — équipements seedés restent null, log explicite si miss
- **SSE/WebSocket** pour dashboard temps réel (email suffit MVP)
- **Workers/queue** (BullMQ) pour scale > 600 pings/s
- **Détection humidité / batterie / porte ouverte** (juste température v1)
- ~~**`PATCH /api/alerts/:id/resolve`** pour résolution manuelle via API~~ → **Livré** dans `feat/alert-resolve-endpoint`, cf. `docs/17_alert_resolve.md`
- **Configurable per-Equipment `windowMinutes`** (constant 15min v1)
- **Métriques Prometheus** (latence détection, taux d'excursion)
- **Mailer `transporter.verify()` une fois au boot** (actuellement à chaque envoi — pas critique)

## 8. Tests

- **Unit** `excursionDetection.service.test.ts` : 9 cas (boundaries, ratio 80%, minPoints, ordre)
- **Unit** `iotAlert.service.test.ts` : 14 cas (cache, advisory lock, cross-tenant, dédup, audit tx, email)
- **E2E** `scripts/e2e-iot-alert.ts` : `npm run e2e:iot-alert` — 5 scénarios sur vraie DB Mongo+Postgres

## 9. Exemple manuel via Bruno

`POST /api/telemetry/ping` (existant, pas de nouvelle route) :

```json
{
  "sensor_id": "SENSOR-FRIGO-NORD-001",
  "temperature": 8.5,
  "humidity": 60,
  "battery_level": 75
}
```

Si l'Equipment lié à `SENSOR-FRIGO-NORD-001` a `temp_seuil_max=4` et que les 15 dernières minutes ont ≥ 5 points à > 4°C avec ratio ≥ 80%, une `Alert` `TEMP_EXCURSION` est créée et un email est envoyé.

---

*Branche : `feat/iot-cold-chain-alerts`. Multi-agent review du plan en v2 (3 reviewers). Multi-agent review du code après implémentation.*
