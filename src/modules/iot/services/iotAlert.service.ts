import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { auditService } from '../../../shared/utils/audit/audit.service';
import { sendEmail } from '../../../shared/utils/mailer/mailer';
import { logger } from '../../../shared/utils/logger/logger';
import { TelemetryModel } from '../models/telemetry.model';
import { detectExcursion, TelemetryPoint } from './excursionDetection.service';

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
 * - Postgres advisory lock per-equipment pour empêcher la TOCTOU race sur la dédup.
 * - Fast path : si currentTemp <= threshold → exit sans query Mongo.
 * - sendEmail en fire-and-forget (.catch logger.error) — hors path critique.
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
}

export const iotAlertService = {
  /**
   * Détecte une excursion de température et crée une Alert + email.
   * Appelé depuis le controller telemetry, synchrone, ~50ms cache miss.
   * Multi-tenant safe : l'organizationId est celui injecté par checkApiKey,
   * le sensor_id est résolu dans cette org uniquement.
   */
  async checkAndAlert(params: CheckAndAlertParams): Promise<void> {
    const { sensorId, organizationId, currentTemp } = params;

    // 1-2. Cache lookup + Postgres findFirst si miss
    const cached = await resolveThreshold(sensorId, organizationId);
    if (!cached) {
      return; // sensor sans mapping (déjà loggué dans resolveThreshold)
    }

    // 3. Pas de seuil défini → on ne peut pas détecter
    if (cached.threshold === null) {
      return;
    }

    // 4. Fast path : sous le seuil (cas le plus fréquent → ~99% des pings)
    if (currentTemp <= cached.threshold) {
      return;
    }

    // 5. Advisory lock per-equipment (sérialise les checks concurrents pour ce capteur)
    // L'org utilisée pour le lock est celle DU EQUIPMENT (defense-in-depth), pas params.organizationId.
    const lockKey = advisoryLockKey(cached.equipmentOrgId, cached.equipmentId);
    const lockResult = await prisma.$queryRawUnsafe<{ locked: boolean }[]>(
      `SELECT pg_try_advisory_lock(${lockKey}) AS locked`
    );
    if (!lockResult[0]?.locked) {
      // Une autre détection est déjà en cours pour ce capteur, on laisse faire
      return;
    }

    // try { ... } finally enferme TOUTE la suite, dès la ligne d'après le lock — pas de fenêtre fuite.
    try {
      const threshold = cached.threshold; // narrow définitif (évite cached!)

      // 6. Query Mongo : derniers points sur la fenêtre 15min, filtrés multi-tenant
      const points = await fetchRecentPoints(sensorId, organizationId);

      // 7. Détection (logique pure)
      const result = detectExcursion(points, threshold);
      if (!result.isExcursion) {
        return;
      }

      // 8. Dédup : Alert ACTIVE existante pour ce equipment ?
      const existing = await prisma.alert.findFirst({
        where: {
          organization_id: cached.equipmentOrgId,
          id_materiel: cached.equipmentId,
          type: 'TEMP_EXCURSION',
          statut: 'ACTIVE',
        },
        select: { id: true },
      });
      if (existing) {
        return; // anti-spam : on attend la résolution de l'alerte courante
      }

      // 9. Atomique : Alert.create + Audit dans une seule tx Serializable
      const alert = await prisma.$transaction(
        async (tx) => {
          const created = await tx.alert.create({
            data: {
              organization_id: cached.equipmentOrgId,
              type: 'TEMP_EXCURSION',
              niveau_gravite: 'PANIC',
              message: `Excursion thermique détectée sur ${sensorId} : pic ${result.peakTemp}°C (seuil ${threshold}°C, ratio ${(result.ratioOverThreshold * 100).toFixed(0)}% sur ${WINDOW_MINUTES}min).`,
              id_materiel: cached.equipmentId,
              related_entity: 'Equipment',
              related_id: cached.equipmentId,
              statut: 'ACTIVE',
            },
          });

          await auditService.logAction(
            {
              organizationId: cached.equipmentOrgId,
              action: 'TEMP_EXCURSION_DETECTED',
              entity: 'Alert',
              entityId: created.id,
              newValue: {
                sensorId,
                equipmentId: cached.equipmentId,
                threshold,
                peakTemp: result.peakTemp,
                ratioOverThreshold: result.ratioOverThreshold,
                windowMinutes: WINDOW_MINUTES,
              },
            },
            tx
          );

          return created;
        },
        {
          timeout: 10_000,
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        }
      );

      // 10. Notification email — vraiment fire-and-forget (pas d'await ici).
      // L'org utilisée pour résoudre les recipients est equipmentOrgId (defense-in-depth).
      void notifyAdmins(
        cached.equipmentOrgId,
        cached.equipmentId,
        alert.id,
        sensorId,
        result.peakTemp,
        threshold
      );
    } finally {
      // 11. Toujours relâcher le lock — y compris si étape 6-10 throw.
      await prisma.$queryRawUnsafe<unknown>(`SELECT pg_advisory_unlock(${lockKey})`);
    }
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

/**
 * Génère une clé numérique 64-bit pour `pg_try_advisory_lock`.
 * Hash SHA256 de (orgId, equipmentId) tronqué aux 60 bits de poids faible
 * (Postgres advisory lock prend un BIGINT signé — 63 bits utilisables).
 */
function advisoryLockKey(orgId: string, equipmentId: string): bigint {
  const digest = createHash('sha256').update(`${orgId}:${equipmentId}`).digest();
  // Lire les 8 premiers octets en BigInt signed positive
  const high = BigInt(digest.readUInt32BE(0)) & 0x7fffffffn; // clear sign bit
  const low = BigInt(digest.readUInt32BE(4));
  return (high << 32n) | low;
}

async function fetchRecentPoints(
  sensorId: string,
  organizationId: string
): Promise<TelemetryPoint[]> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);
  const docs = await TelemetryModel.find({
    'metadata.sensor_id': sensorId,
    'metadata.organization_id': organizationId,
    timestamp: { $gte: since },
  })
    .limit(MONGO_SAFETY_LIMIT)
    .lean();

  return docs.map((d) => ({ timestamp: d.timestamp, temperature: d.temperature }));
}

/** Escape HTML pour éviter XSS dans l'inbox admin si un sensorId
 * (ou autre champ injecté) contenait du HTML/JS arbitraire. */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function notifyAdmins(
  equipmentOrgId: string,
  equipmentId: string,
  alertId: string,
  sensorId: string,
  peakTemp: number,
  threshold: number
): Promise<void> {
  try {
    // Defense-in-depth : filtre par equipment.organization_id (re-lu depuis la DB), jamais
    // par le `activeOrgId` du caller — protège contre une régression future où ces deux
    // valeurs divergeraient.
    const recipients = await prisma.member.findMany({
      where: {
        organizationId: equipmentOrgId,
        role: { in: ['owner', 'admin'] },
      },
      include: { user: { select: { email: true, name: true } } },
    });

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

    // Envoi à chaque admin individuellement, chaque échec capté localement.
    // L'ensemble est appelé via `void` au call site → vraiment fire-and-forget
    // (l'alerte est déjà persistée, ne bloque jamais le path critique).
    await Promise.all(
      recipients.map((r) =>
        sendEmail({ to: r.user.email, subject, html }).catch((err) => {
          logger.error(`[IoT] Email failure to ${r.user.email}: ${(err as Error).message}`);
        })
      )
    );
  } catch (err) {
    // Garde-fou pour le `void` au call site — toute erreur de la promise est swallowée.
    logger.error(`[IoT] notifyAdmins failed: ${(err as Error).message}`);
  }
}
