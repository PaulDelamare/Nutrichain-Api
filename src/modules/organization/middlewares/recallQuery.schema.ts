import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';
import {
  MAX_PAGE_SIZE,
  MAX_PAGE_NUMBER,
  DEFAULT_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
} from '../../../shared/constants/pagination.constants';

/**
 * Query params de `GET /organization/recalls`.
 *
 * `page` / `limit` : mêmes bornes que les autres lectures paginées — la page des rappels chargeait
 * TOUTES les alertes pour n'en garder que les rappels côté front.
 *
 * `q` : recherche libre sur le message du rappel (motif, lot source). `statut` : `en_cours` (alerte
 * ACTIVE) ou `cloture` (résolue). Bornés côté serveur — une valeur hors énumération est un 400, pas
 * un filtre muet.
 */
export const recallQuerySchema = vine.object({
  page: vine.number().withoutDecimals().min(1).max(MAX_PAGE_NUMBER).optional(),
  limit: vine.number().withoutDecimals().min(1).max(MAX_PAGE_SIZE).optional(),
  q: vine.string().trim().maxLength(MAX_SEARCH_LENGTH).optional(),
  statut: vine.enum(['en_cours', 'cloture']).optional(),
});

export type RecallQuery = Infer<typeof recallQuerySchema>;

export const RECALL_PAGE_DEFAULTS = { page: 1, limit: DEFAULT_PAGE_SIZE } as const;
