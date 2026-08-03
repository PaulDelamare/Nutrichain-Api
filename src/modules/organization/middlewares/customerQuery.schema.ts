import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';
import {
  MAX_PAGE_SIZE,
  MAX_PAGE_NUMBER,
  DEFAULT_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
} from '../../../shared/constants/pagination.constants';

/**
 * Query params de `GET /organization/customers`.
 *
 * Pagination OPTIONNELLE : la page Configuration envoie `page` et reçoit `{ data, pagination }` ;
 * les sélecteurs (expédition…) n'envoient rien et gardent le tableau simple. Le contrôleur bascule
 * sur la présence de `page`. `includeArchived` reste pour le chemin non paginé.
 *
 * Filtres du chemin paginé : `nom` (recherche libre sur `nom_enseigne`) et `statut`
 * (`actif`/`archive` → `is_active`). Le filtre `archive` n'est honoré que pour l'administration
 * (le service force les actifs seuls pour un rôle terrain).
 */
export const customerQuerySchema = vine.object({
  page: vine.number().withoutDecimals().min(1).max(MAX_PAGE_NUMBER).optional(),
  limit: vine.number().withoutDecimals().min(1).max(MAX_PAGE_SIZE).optional(),
  nom: vine.string().trim().maxLength(MAX_SEARCH_LENGTH).optional(),
  statut: vine.enum(['actif', 'archive']).optional(),
  includeArchived: vine.boolean().optional(),
});

export type CustomerQuery = Infer<typeof customerQuerySchema>;

export const CUSTOMER_PAGE_DEFAULTS = { page: 1, limit: DEFAULT_PAGE_SIZE } as const;
