import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';
import {
  MAX_PAGE_SIZE,
  MAX_PAGE_NUMBER,
  DEFAULT_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
} from '../../../shared/constants/pagination.constants';

/**
 * Query params de `GET /organization/audit-logs`.
 *
 * `page` / `limit` : mêmes bornes que les autres lectures paginées — le journal renvoyait ses N
 * dernières lignes en bloc, non paginées.
 *
 * `action` / `entity` : filtres de colonnes appliqués dans la requête. Ce sont des chaînes bornées,
 * PAS une énumération figée : le vocabulaire d'audit s'enrichit avec le métier, et un `entity`
 * légitime mais absent d'une liste blanche ne doit pas devenir un 400. `entity_id` : recherche
 * libre sur l'identifiant tracé.
 *
 * `from` / `to` : borne le créneau sur `horodatage`, au format `datetime-local` (`YYYY-MM-DDTHH:mm`).
 * Une valeur malformée est un 400, pas un filtre muet.
 */
const DATETIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export const auditLogQuerySchema = vine.object({
  page: vine.number().withoutDecimals().min(1).max(MAX_PAGE_NUMBER).optional(),
  limit: vine.number().withoutDecimals().min(1).max(MAX_PAGE_SIZE).optional(),
  action: vine.string().trim().maxLength(MAX_SEARCH_LENGTH).optional(),
  entity: vine.string().trim().maxLength(MAX_SEARCH_LENGTH).optional(),
  entity_id: vine.string().trim().maxLength(MAX_SEARCH_LENGTH).optional(),
  from: vine.string().trim().regex(DATETIME_LOCAL).optional(),
  to: vine.string().trim().regex(DATETIME_LOCAL).optional(),
});

export type AuditLogQuery = Infer<typeof auditLogQuerySchema>;

export const AUDIT_LOG_PAGE_DEFAULTS = { page: 1, limit: DEFAULT_PAGE_SIZE } as const;
