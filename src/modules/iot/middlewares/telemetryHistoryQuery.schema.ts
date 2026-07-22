import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';
import { MAX_PAGE_SIZE } from '../../../shared/constants/pagination.constants';

/**
 * Query params de `GET /telemetry/:sensor_id/history`.
 *
 * Le plafond compte double ici : la collection est une série temporelle conservée un an, alimentée
 * à chaque ping de capteur. Un `limit` non borné y ramenait un volume sans commune mesure avec les
 * autres lectures du projet.
 */
export const telemetryHistoryQuerySchema = vine.object({
  limit: vine.number().withoutDecimals().min(1).max(MAX_PAGE_SIZE).optional(),
});

export type TelemetryHistoryQuery = Infer<typeof telemetryHistoryQuerySchema>;

export const TELEMETRY_HISTORY_DEFAULT_LIMIT = 100;
