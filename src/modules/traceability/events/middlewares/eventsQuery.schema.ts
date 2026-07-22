import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';
import {
  EPCIS_EVENT_TYPES,
  EPCIS_RELATED_ENTITIES,
} from '../../../../shared/constants/epcis.constants';
import {
  MAX_PAGE_SIZE,
  MAX_PAGE_NUMBER,
} from '../../../../shared/constants/pagination.constants';

/**
 * Schéma de validation des query params de GET /api/traceability/events.
 * `page`/`limit` sont coercés depuis leurs valeurs string (query string).
 * Le plafond 500 applique la règle de volumétrie projet ; le défaut (20)
 * est appliqué côté service, pas ici (champs optionnels).
 */
export const eventsQuerySchema = vine.object({
  // `page` est borné EN HAUT aussi : `skip = (page - 1) * limit`, donc un `?page=1e19` produisait
  // un `skip` que Prisma refuse — un 500 symétrique de celui de `?page=0`.
  page: vine.number().withoutDecimals().min(1).max(MAX_PAGE_NUMBER).optional(),
  limit: vine.number().withoutDecimals().min(1).max(MAX_PAGE_SIZE).optional(),
  event_type: vine.enum(EPCIS_EVENT_TYPES).optional(),
  related_entity: vine.enum(EPCIS_RELATED_ENTITIES).optional(),
});

export type EventsQuery = Infer<typeof eventsQuerySchema>;
