import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';
import {
  MAX_PAGE_SIZE,
  MAX_PAGE_NUMBER,
  DEFAULT_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
} from '../../../shared/constants/pagination.constants';

/**
 * Query params de `GET /organization/equipment`.
 *
 * Pagination OPTIONNELLE : la page Configuration envoie `page` et reçoit `{ data, pagination }` ;
 * les autres écrans (chaîne du froid, plan d'usine) n'envoient rien et gardent le tableau simple.
 * Le contrôleur bascule sur la présence de `page`.
 *
 * Filtres du chemin paginé : `nom` (recherche libre) et `type` (label exact, depuis le select des
 * types de matériel). Le matériel ne s'archive pas — pas de filtre statut.
 */
export const equipmentQuerySchema = vine.object({
  page: vine.number().withoutDecimals().min(1).max(MAX_PAGE_NUMBER).optional(),
  limit: vine.number().withoutDecimals().min(1).max(MAX_PAGE_SIZE).optional(),
  nom: vine.string().trim().maxLength(MAX_SEARCH_LENGTH).optional(),
  type: vine.string().trim().maxLength(MAX_SEARCH_LENGTH).optional(),
});

export type EquipmentQuery = Infer<typeof equipmentQuerySchema>;

export const EQUIPMENT_PAGE_DEFAULTS = { page: 1, limit: DEFAULT_PAGE_SIZE } as const;
