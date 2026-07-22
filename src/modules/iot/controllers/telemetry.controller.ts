import { Response } from 'express';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { TelemetryModel } from '../models/telemetry.model';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { iotAlertService } from '../services/iotAlert.service';

/**
 * Ingest new telemetry ping from an IoT device.
 */
export const ingestTelemetry = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  // La trame est validée en amont par `validateTelemetryPing` : elle est déjà typée, bornée, et
  // garantie NUMÉRIQUE. La garde manuelle qui vivait ici testait `=== undefined` et laissait donc
  // passer `null`, `"n/a"` ou `true` — cette dernière, coercée en 1 °C, éteignait la détection.
  const { sensor_id, temperature, humidity, battery_level } = req.validatedTelemetryPing!;
  const organization_id = req.activeOrgId;

  if (!organization_id) {
    throw new APIError(400, {
      error: [{ field: 'auth', message: "ID Organisation manquant pour l'ingestion IoT." }],
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
  //
  // C'est une décision SANITAIRE : si elle échoue, on ne répond PAS « succès ». Sinon le capteur
  // croit l'excursion traitée alors que l'alerte n'est pas créée et que les lots ne sont PAS mis en
  // quarantaine (ils restent expédiables) — une rupture de chaîne du froid passerait inaperçue.
  // On laisse donc l'erreur remonter (500) pour que le capteur ré-émette. Le point brut est déjà
  // persisté ci-dessus. Les conflits de sérialisation transitoires sont rejoués dans checkAndAlert.
  const detection = await iotAlertService.checkAndAlert({
    sensorId: sensor_id,
    organizationId: organization_id,
    currentTemp: temperature,
    timestamp,
  });

  // La trame est persistée dans tous les cas, mais la surveillance ne tourne QUE si le capteur est
  // rattaché à un matériel doté d'un seuil. Le taire derrière un « success » laissait une
  // installation entière se croire surveillée alors qu'aucune alerte n'était possible (#93).
  sendSuccess(res, 202, 'Telemetry ingested successfully.', { sensor_id, detection });
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
