import { Response } from 'express';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { TelemetryModel } from '../models/telemetry.model';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { iotAlertService } from '../services/iotAlert.service';
import { logger } from '../../../shared/utils/logger/logger';

/**
 * Ingest new telemetry ping from an IoT device.
 */
export const ingestTelemetry = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const { sensor_id, temperature, humidity, battery_level } = req.body;
  const organization_id = req.activeOrgId;

  if (!organization_id) {
    throw new APIError(400, {
      error: [{ field: 'auth', message: "ID Organisation manquant pour l'ingestion IoT." }],
    });
  }

  // Ensure payload is complete.
  if (
    !sensor_id ||
    temperature === undefined ||
    humidity === undefined ||
    battery_level === undefined
  ) {
    throw new APIError(400, {
      error: [{ field: 'payload', message: 'Format de trame IoT invalide.' }],
    });
  }

  // Insert in MongoDB Time-Series Collection with mandatory isolation
  const timestamp = new Date();
  await TelemetryModel.create({
    metadata: { sensor_id, organization_id },
    timestamp,
    temperature,
    humidity,
    battery_level,
  });

  // Détection d'excursion thermique synchrone (Objectif SMART n°2, ~50ms cache miss).
  // Encapsulé dans try/catch : une alerte qui échoue ne doit pas faire perdre l'ingest IoT.
  try {
    await iotAlertService.checkAndAlert({
      sensorId: sensor_id,
      organizationId: organization_id,
      currentTemp: temperature,
      timestamp,
    });
  } catch (err) {
    logger.error(`[IoT] checkAndAlert failed for ${sensor_id}: ${(err as Error).message}`);
  }

  sendSuccess(res, 202, 'Telemetry ingested successfully.', { sensor_id });
});

/**
 * Get recent historical data for a specific sensor.
 */
export const getSensorHistory = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const { sensor_id } = req.params;
  const organization_id = req.activeOrgId;
  const limit = parseInt((req.query.limit as string) || '100', 10);

  if (!organization_id) {
    throw new APIError(400, {
      error: [{ field: 'auth', message: 'Accès impossible sans organisation active.' }],
    });
  }

  // Querying MongoDB TS efficiently by time index and metaField (isolated by organization)
  const history = await TelemetryModel.find({
    'metadata.sensor_id': sensor_id,
    'metadata.organization_id': organization_id,
  })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();

  sendSuccess(res, 200, 'Historical data retrieved.', {
    sensor_id,
    points: history.length,
    data: history,
  });
});
