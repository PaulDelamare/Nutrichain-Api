import type { ClientSession } from 'mongoose';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { auditService } from '../../../shared/utils/audit/audit.service';
import { advisoryLockKey } from '../../../shared/utils/db/advisoryLockKey';
import { retryableTransaction } from '../../../shared/utils/db/withWriteConflictRetry';
import { notifyOrgAdmins } from '../../../shared/utils/mailer/notifyOrgAdmins';
import { escapeHtml } from '../../../shared/utils/html/escapeHtml';
import { logger } from '../../../shared/utils/logger/logger';
import { TelemetryModel } from '../models/telemetry.model';
import { detectExcursion, TelemetryPoint } from './excursionDetection.service';
import {
  BATCH_STATUSES,
  COLD_QUARANTINABLE_STATUSES,
  MOVEMENT_TYPES,
} from '../../logistics/constants/logistics.constants';

/**
 * Service d'alerte chaîne du froid (Objectif SMART n°2).
 *
 * Sécurité :
 * - Multi-tenant strict : Equipment lookup par (sensor_id, organization_id).
 * - Email recipients filtrés par equipment.organization_id (defense-in-depth).
 * - Audit WORM dans la même transaction Serializable que l'Alert.create.
 * - Aucun PII ni température dans les logger.warn (uniquement sensorId).
 *
 * Performance :
 * - Cache des thresholds en mémoire (TTL 60s) par (orgId, sensorId).
 * - Verrou consultatif Postgres per-equipment, pris DANS la transaction, contre la race TOCTOU
 *   sur la dédup (un verrou de session fuirait entre deux connexions du pool).
 * - Fast path : si currentTemp <= threshold → exit sans query Mongo.
 * - Notification owner/admin via notifyOrgAdmins en fire-and-forget — hors path critique.
 */

const WINDOW_MINUTES = 15;
const MONGO_SAFETY_LIMIT = 1000;
const CACHE_TTL_MS = 60_000;

interface CachedThreshold {
  equipmentId: string;
  equipmentOrgId: string; // org du Equipment (defense-in-depth vs param organizationId)
  threshold: number | null;
  expiresAt: number;
}

const thresholdCache = new Map<string, CachedThreshold>();
const cacheKey = (orgId: string, sensorId: string) => `${orgId}:${sensorId}`;

/** Helper testing uniquement — réinitialise le cache entre les tests. */
export const _clearThresholdCacheForTests = (): void => {
  thresholdCache.clear();
};

export interface CheckAndAlertParams {
  sensorId: string;
  organizationId: string;
  currentTemp: number;
  timestamp: Date;
  /** Session Mongo à cohérence causale du point qui vient d'être écrit (cf. #226). */
  mongoSession?: ClientSession;
}

/**
 * Ce que la détection a RÉELLEMENT pu faire de la trame. Renvoyé au controller pour que la réponse
 * cesse de mentir : une trame d'un capteur non rattaché à un matériel était acceptée en 202
 * « Telemetry ingested successfully » alors qu'aucune surveillance n'était possible (issue #93).
 */
export type DetectionOutcome = 'MONITORED' | 'NO_EQUIPMENT' | 'NO_THRESHOLD';

export const iotAlertService = {
  /**
   * Détecte une excursion de température et crée une Alert + email.
   * Appelé depuis le controller telemetry, synchrone, ~50ms cache miss.
   * Multi-tenant safe : l'organizationId est celui de la passerelle (`machineAuth`),
   * le sensor_id est résolu dans cette org uniquement.
   */
  async checkAndAlert(params: CheckAndAlertParams): Promise<DetectionOutcome> {
    const { sensorId, organizationId, currentTemp, mongoSession } = params;

    // 1-2. Cache lookup + Postgres findFirst si miss
    const cached = await resolveThreshold(sensorId, organizationId);
    if (!cached) {
      return 'NO_EQUIPMENT'; // sensor sans mapping (déjà loggué dans resolveThreshold)
    }

    // Dernier relevé du matériel, pour l'affichage temps réel (fiche frigo). Écrit à CHAQUE ping,
    // avant tout fast-path : sans lui, le front lisait une valeur figée du seed — un frigo affichait
    // 3,2°C pendant une alerte PANIC, cachant justement la température coupable. updateMany cloisonné
    // par organisation : count 0 (sans erreur) si le cache pointe un matériel entre-temps supprimé.
    await prisma.equipment.updateMany({
      where: { id: cached.equipmentId, organization_id: cached.equipmentOrgId },
      data: { temp_actuelle: currentTemp },
    });

    // 3. Pas de seuil défini → on ne peut pas détecter
    if (cached.threshold === null) {
      return 'NO_THRESHOLD';
    }

    // 4. Fast path : sous le seuil (cas le plus fréquent → ~99% des pings)
    if (currentTemp <= cached.threshold) {
      return 'MONITORED';
    }

    const threshold = cached.threshold; // narrow définitif (évite cached!)
    const lockKey = advisoryLockKey(cached.equipmentOrgId, cached.equipmentId);

    // 5. Query Mongo : derniers points sur la fenêtre 15min, filtrés multi-tenant.
    //    Lecture seule : elle n'a pas besoin d'être sérialisée, et la garder hors transaction
    //    évite de tenir une transaction Postgres ouverte pendant une I/O Mongo.
    const points = await fetchRecentPoints(sensorId, organizationId, mongoSession);

    // 6. Détection (logique pure)
    const result = detectExcursion(points, threshold);
    if (!result.isExcursion) {
      return 'MONITORED';
    }

    // 7. Atomique : verrou + dédup + quarantaine des lots + Alert.create + Audit, dans une seule
    //    tx Serializable.
    //
    //    Le verrou est pris DANS la transaction (`pg_try_advisory_xact_lock`), et non par une
    //    requête isolée : un verrou consultatif de session appartient à la connexion qui l'a pris,
    //    or `prisma.$queryRawUnsafe` ne garantit aucune affinité de connexion — le relâchement
    //    partait sur une autre connexion du pool, le verrou restait détenu, et TOUTE détection
    //    ultérieure sur ce matériel sortait sans rien détecter. Un verrou de transaction est
    //    relâché par Postgres au COMMIT comme au ROLLBACK : il ne peut plus fuiter.
    //    La dédup passe du même coup sous le verrou, ce qui ferme réellement la fenêtre TOCTOU.
    const alert = await retryableTransaction(
      async (tx) => {
        const lockResult = await tx.$queryRawUnsafe<{ locked: boolean }[]>(
          `SELECT pg_try_advisory_xact_lock(${lockKey}) AS locked`
        );
        if (!lockResult[0]?.locked) {
          return null; // une autre détection est déjà en cours pour ce matériel
        }

        const existing = await tx.alert.findFirst({
          where: {
            organization_id: cached.equipmentOrgId,
            id_materiel: cached.equipmentId,
            type: 'TEMP_EXCURSION',
            statut: 'ACTIVE',
          },
          select: { id: true },
        });

        // Sûreté sanitaire : les lots EN_STOCK rangés dans l'équipement en excursion
        // sont placés en quarantaine (BLOQUE) — un incident matériel ne doit pas laisser
        // un produit potentiellement altéré partir en transformation ou en expédition.
        //
        // ⚠️ Rejouée à CHAQUE détection confirmée, y compris quand une alerte est déjà ouverte
        // (#266). L'anti-spam sortait ici, AVANT cet UPDATE : tant qu'une alerte restait ouverte —
        // et elle le reste jusqu'à ce qu'un humain la résolve — un lot rangé dans le frigo ENSUITE
        // n'était plus jamais bloqué. Il restait EN_STOCK, donc expédiable, dans un équipement dont
        // on savait la chaîne du froid rompue. L'anti-spam protège la boîte mail de l'exploitant,
        // pas la barrière sanitaire.
        //
        // UPDATE ... RETURNING (et non SELECT puis UPDATE) : on obtient en UNE requête les
        // lots réellement bloqués, sans fenêtre TOCTOU, et avec leur quantité — nécessaire
        // pour tracer le mouvement (quantite/unite sont NOT NULL).
        const quarantined = await tx.$queryRaw<
          { id: string; quantite_actuelle: Prisma.Decimal; unite_code: string }[]
        >`
          UPDATE "Batch"
             SET statut = ${BATCH_STATUSES.BLOCKED},
                 statut_avant_blocage = statut,
                 version = version + 1
           WHERE organization_id = ${cached.equipmentOrgId}
             AND id_materiel_actuel = ${cached.equipmentId}
             AND statut = ANY(${COLD_QUARANTINABLE_STATUSES as string[]})
         RETURNING id, quantite_actuelle, unite_code
        `;

        // Cas de loin le plus fréquent : le frigo est toujours en panne, le capteur continue de
        // pinger, et il n'y a plus rien à bloquer. Rien à écrire — sinon le journal WORM se
        // remplirait d'une entrée par ping.
        if (existing && quarantined.length === 0) {
          return null;
        }

        const alerte =
          existing ??
          (await tx.alert.create({
            data: {
              organization_id: cached.equipmentOrgId,
              type: 'TEMP_EXCURSION',
              niveau_gravite: 'PANIC',
              message: `Excursion thermique détectée sur ${sensorId} : pic ${result.peakTemp}°C (seuil ${threshold}°C, ratio ${(result.ratioOverThreshold * 100).toFixed(0)}% sur ${WINDOW_MINUTES}min). ${quarantined.length} lot(s) mis en quarantaine.`,
              id_materiel: cached.equipmentId,
              related_entity: 'Equipment',
              related_id: cached.equipmentId,
              statut: 'ACTIVE',
              // ⚠️ La donnée sanitaire N°1 (de combien la chaîne du froid a rompu) en champs
              // STRUCTURÉS, plus seulement dans le message. Le mobile la lisait sur
              // `equipment.temp_actuelle` — jamais renseigné par l'ingestion IoT → « — » à l'écran.
              peak_temp: result.peakTemp,
              temp_seuil: threshold,
            },
            select: { id: true },
          }));

        // Chaque lot bloqué garde la trace de la CAUSE : sans ça, un lot passe en
        // quarantaine sans que personne ne puisse dire pourquoi ni quand.
        // Volume borné : les lots d'un seul équipement, pas une descendance de rappel.
        if (quarantined.length > 0) {
          await tx.batch_Mouvement.createMany({
            data: quarantined.map((b) => ({
              id_lot: b.id,
              type_action: MOVEMENT_TYPES.COLD_QUARANTINE,
              quantite: b.quantite_actuelle,
              unite: b.unite_code,
              metadata: {
                // L'alerte OUVERTE quand une seconde vague de lots est bloquée : le lot pointe
                // l'incident qui l'a mis en quarantaine, pas une alerte créée pour la forme.
                id_alerte: alerte.id,
                sensorId,
                peakTemp: result.peakTemp,
                threshold,
              },
            })),
          });
        }

        await auditService.logAction(
          {
            organizationId: cached.equipmentOrgId,
            action: 'TEMP_EXCURSION_DETECTED',
            entity: 'Alert',
            entityId: alerte.id,
            newValue: {
              sensorId,
              equipmentId: cached.equipmentId,
              threshold,
              peakTemp: result.peakTemp,
              ratioOverThreshold: result.ratioOverThreshold,
              windowMinutes: WINDOW_MINUTES,
              quarantinedBatchesCount: quarantined.length,
              // Distingue l'ouverture de l'incident d'une vague de lots bloqués sous un incident
              // déjà ouvert : sans ce champ, le journal ne raconte pas la même histoire.
              alerteDejaOuverte: Boolean(existing),
            },
          },
          tx
        );

        return { id: alerte.id, estNouvelle: !existing };
      },
      {
        timeout: 10_000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    );

    // Verrou non obtenu, ou rien de neuf sous une alerte déjà ouverte : rien à notifier.
    // On ne prévient QUE sur l'ouverture d'un incident : des lots bloqués en seconde vague
    // relèvent du même incident, déjà signalé (#266).
    if (!alert || !alert.estNouvelle) {
      return 'MONITORED';
    }

    // 8. Notification email — vraiment fire-and-forget (pas d'await ici).
    // L'org utilisée pour résoudre les recipients est equipmentOrgId (defense-in-depth).
    void notifyAdmins(
      cached.equipmentOrgId,
      cached.equipmentId,
      alert.id,
      sensorId,
      result.peakTemp,
      threshold
    );

    return 'MONITORED';
  },
};

/**
 * Résout l'Equipment et son seuil depuis le cache ou la DB.
 * Retourne null si le sensor n'a pas de mapping (cross-tenant ou drift référentiel).
 *
 * Le cache key est `${orgId}:${sensorId}` — strictement org-scoped pour éviter
 * la pollution cross-tenant. L'`equipmentOrgId` retourné est celui DE L'EQUIPMENT
 * (re-lu depuis la DB ou caché), utilisé en aval pour le filtre defense-in-depth
 * sur les recipients email et l'audit.
 */
async function resolveThreshold(
  sensorId: string,
  organizationId: string
): Promise<CachedThreshold | null> {
  const key = cacheKey(organizationId, sensorId);
  const existing = thresholdCache.get(key);
  if (existing && existing.expiresAt >= Date.now()) {
    return existing;
  }

  const equipment = await prisma.equipment.findFirst({
    where: { sensor_id: sensorId, organization_id: organizationId },
    select: { id: true, organization_id: true, temp_seuil_max: true },
  });

  if (!equipment) {
    // Sensor sans mapping Equipment (drift de référentiel ou ping cross-tenant).
    // Log uniquement le sensorId (jamais de PII : ni contact, ni adresse, ni temp).
    logger.warn(`[IoT] Sensor sans mapping Equipment: ${sensorId}`);
    return null;
  }

  const cached: CachedThreshold = {
    equipmentId: equipment.id,
    equipmentOrgId: equipment.organization_id,
    threshold: equipment.temp_seuil_max === null ? null : Number(equipment.temp_seuil_max),
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  thresholdCache.set(key, cached);
  return cached;
}

async function fetchRecentPoints(
  sensorId: string,
  organizationId: string,
  mongoSession?: ClientSession
): Promise<TelemetryPoint[]> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);
  const docs = await TelemetryModel.find({
    'metadata.sensor_id': sensorId,
    'metadata.organization_id': organizationId,
    timestamp: { $gte: since },
  })
    .session(mongoSession ?? null)
    .limit(MONGO_SAFETY_LIMIT)
    .lean();

  return docs.map((d) => ({ timestamp: d.timestamp, temperature: d.temperature }));
}

async function notifyAdmins(
  equipmentOrgId: string,
  equipmentId: string,
  alertId: string,
  sensorId: string,
  peakTemp: number,
  threshold: number
): Promise<void> {
  const safeSensorId = escapeHtml(sensorId);
  const safeEquipmentId = escapeHtml(equipmentId);
  const safeAlertId = escapeHtml(alertId);
  const subject = `[ALERTE PANIC] Excursion thermique — ${safeSensorId}`;
  const html = `
      <h2>Excursion thermique détectée</h2>
      <p>Capteur : <strong>${safeSensorId}</strong></p>
      <p>Pic de température : <strong>${peakTemp}°C</strong> (seuil ${threshold}°C)</p>
      <p>Equipment ID : ${safeEquipmentId}</p>
      <p>Alert ID : ${safeAlertId}</p>
      <p>Connectez-vous à NutriChain pour résoudre l'alerte.</p>
    `;

  // Résolution des destinataires (owner/admin de l'org) + envoi délégués au util partagé,
  // qui encapsule le fire-and-forget et la capture d'erreur par destinataire.
  await notifyOrgAdmins(equipmentOrgId, { subject, html });
}
