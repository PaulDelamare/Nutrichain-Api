import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';
import {
  MAX_PAGE_SIZE,
  MAX_PAGE_NUMBER,
  DEFAULT_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
} from '../../../shared/constants/pagination.constants';
import { SHIPMENT_DELIVERY_STATUSES } from '../../logistics/constants/logistics.constants';

/**
 * Query params de `GET /organization/shipments`.
 *
 * `page` / `limit` : mêmes bornes que les autres lectures paginées — la liste renvoyait tout d'un
 * bloc, non paginé.
 *
 * `ref` / `client` / `statut` / `date` : filtres de colonnes appliqués dans la requête Prisma (et
 * non plus côté front sur la page reçue). `statut` est borné à l'énumération de l'API et `date` à un
 * jour ISO — une valeur malformée est un 400, pas un filtre muet.
 */
export const shipmentQuerySchema = vine.object({
  page: vine.number().withoutDecimals().min(1).max(MAX_PAGE_NUMBER).optional(),
  limit: vine.number().withoutDecimals().min(1).max(MAX_PAGE_SIZE).optional(),
  ref: vine.string().trim().maxLength(MAX_SEARCH_LENGTH).optional(),
  client: vine.string().trim().maxLength(MAX_SEARCH_LENGTH).optional(),
  statut: vine.enum(Object.values(SHIPMENT_DELIVERY_STATUSES)).optional(),
  date: vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export type ShipmentQuery = Infer<typeof shipmentQuerySchema>;

export const SHIPMENT_PAGE_DEFAULTS = { page: 1, limit: DEFAULT_PAGE_SIZE } as const;
