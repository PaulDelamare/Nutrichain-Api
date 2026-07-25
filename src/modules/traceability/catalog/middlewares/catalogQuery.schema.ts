import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';
import {
  MAX_PAGE_NUMBER,
  MAX_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
} from '../../../../shared/constants/pagination.constants';

/**
 * Query params de `GET /traceability/batches`.
 *
 * `q` était casté en `string` sans vérification : `?q=a&q=b` produit un TABLEAU, transmis tel quel
 * au `contains` de Prisma, qui échouait en 500. Une requête malformée doit se voir répondre 400.
 *
 * `page` / `limit` : mêmes bornes que les autres lectures paginées. Sans elles, la route servait
 * les 100 lots les plus récents et rien d'autre — un lot plus ancien était introuvable.
 */
export const catalogQuerySchema = vine.object({
  q: vine.string().trim().maxLength(MAX_SEARCH_LENGTH).optional(),
  page: vine.number().withoutDecimals().min(1).max(MAX_PAGE_NUMBER).optional(),
  limit: vine.number().withoutDecimals().min(1).max(MAX_PAGE_SIZE).optional(),
});

export type CatalogQuery = Infer<typeof catalogQuerySchema>;

/**
 * Taille de page par défaut alignée sur l'ancien `take: 100` : un appelant qui ne pagine pas
 * (sélecteurs de lot, tableau de bord) reçoit exactement le même volume qu'avant, et gagne en plus
 * le `total` réel pour savoir ce qu'il ne voit pas.
 */
export const CATALOG_PAGE_DEFAULTS = { page: 1, limit: 100 } as const;
