import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';
import {
  MAX_PAGE_SIZE,
  MAX_PAGE_NUMBER,
  DEFAULT_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
} from '../../../shared/constants/pagination.constants';

/**
 * Query params de `GET /organization/locations`.
 *
 * Pagination OPTIONNELLE : la page Configuration envoie `page` et reçoit `{ data, pagination }` ;
 * les sélecteurs (recherche-lots, matériel…) n'envoient rien et gardent le tableau simple. Le
 * contrôleur bascule sur la présence de `page`. `includeArchived` reste pour le chemin non paginé.
 *
 * Filtres du chemin paginé : `nom` (recherche libre), `type` (label exact, depuis le select) et
 * `statut` (`actif`/`archive` → `is_active`).
 */
export const locationQuerySchema = vine.object({
  page: vine.number().withoutDecimals().min(1).max(MAX_PAGE_NUMBER).optional(),
  limit: vine.number().withoutDecimals().min(1).max(MAX_PAGE_SIZE).optional(),
  nom: vine.string().trim().maxLength(MAX_SEARCH_LENGTH).optional(),
  type: vine.string().trim().maxLength(MAX_SEARCH_LENGTH).optional(),
  statut: vine.enum(['actif', 'archive']).optional(),
  includeArchived: vine.boolean().optional(),
});

export type LocationQuery = Infer<typeof locationQuerySchema>;

export const LOCATION_PAGE_DEFAULTS = { page: 1, limit: DEFAULT_PAGE_SIZE } as const;
