import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';
import { MAX_PAGE_SIZE } from '../../../shared/constants/pagination.constants';

/**
 * Query params des lectures organisation : `limit` (plafond volumétrie projet)
 * et `lotId` (filtre des mouvements d'un lot précis, fiche lot du front).
 */
export const organizationQuerySchema = vine.object({
  limit: vine.number().withoutDecimals().min(1).max(MAX_PAGE_SIZE).optional(),
  lotId: vine.string().uuid().optional(),
});

export type OrganizationQuery = Infer<typeof organizationQuerySchema>;
