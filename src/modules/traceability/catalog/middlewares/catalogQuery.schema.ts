import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';
import {
  MAX_PAGE_NUMBER,
  MAX_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
} from '../../../../shared/constants/pagination.constants';
import { BATCH_STATUSES } from '../../../logistics/constants/logistics.constants';

/**
 * Query params de `GET /traceability/batches`.
 *
 * `q` était casté en `string` sans vérification : `?q=a&q=b` produit un TABLEAU, transmis tel quel
 * au `contains` de Prisma, qui échouait en 500. Une requête malformée doit se voir répondre 400.
 *
 * `page` / `limit` : mêmes bornes que les autres lectures paginées. Sans elles, la route servait
 * les 100 lots les plus récents et rien d'autre — un lot plus ancien était introuvable.
 *
 * `statut` / `produit` / `site` / `lot` / `gtin` : filtres de colonnes, appliqués dans la requête
 * Prisma (et non plus sur la page reçue côté front, où un lot d'une autre page échappait au filtre).
 * `statut` est borné à l'énumération de l'API — une valeur hors liste est une requête malformée
 * (400), pas un filtre qui ne renvoie rien en silence.
 */
export const catalogQuerySchema = vine.object({
  q: vine.string().trim().maxLength(MAX_SEARCH_LENGTH).optional(),
  page: vine.number().withoutDecimals().min(1).max(MAX_PAGE_NUMBER).optional(),
  limit: vine.number().withoutDecimals().min(1).max(MAX_PAGE_SIZE).optional(),
  statut: vine.enum(Object.values(BATCH_STATUSES)).optional(),
  produit: vine.string().trim().maxLength(MAX_SEARCH_LENGTH).optional(),
  site: vine.string().trim().maxLength(MAX_SEARCH_LENGTH).optional(),
  lot: vine.string().trim().maxLength(MAX_SEARCH_LENGTH).optional(),
  gtin: vine.string().trim().maxLength(MAX_SEARCH_LENGTH).optional(),
});

export type CatalogQuery = Infer<typeof catalogQuerySchema>;

/**
 * Taille de page par défaut alignée sur l'ancien `take: 100` : un appelant qui ne pagine pas
 * (sélecteurs de lot, tableau de bord) reçoit exactement le même volume qu'avant, et gagne en plus
 * le `total` réel pour savoir ce qu'il ne voit pas.
 */
export const CATALOG_PAGE_DEFAULTS = { page: 1, limit: 100 } as const;
