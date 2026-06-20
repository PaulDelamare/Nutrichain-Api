import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';
import {
  EPCIS_EVENT_TYPES,
  EPCIS_RELATED_ENTITIES,
} from '../../../../shared/constants/epcis.constants';

/**
 * Schéma de validation des query params de GET /api/traceability/events.
 * `page`/`limit` sont coercés depuis leurs valeurs string (query string).
 * Le plafond 500 applique la règle de volumétrie projet ; le défaut (20)
 * est appliqué côté service, pas ici (champs optionnels).
 */
export const eventsQuerySchema = vine.object({
  page: vine.number().min(1).optional(),
  limit: vine.number().min(1).max(500).optional(),
  event_type: vine.enum(EPCIS_EVENT_TYPES).optional(),
  related_entity: vine.enum(EPCIS_RELATED_ENTITIES).optional(),
});

export type EventsQuery = Infer<typeof eventsQuerySchema>;
