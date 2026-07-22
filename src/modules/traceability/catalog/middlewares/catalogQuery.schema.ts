import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';
import { MAX_SEARCH_LENGTH } from '../../../../shared/constants/pagination.constants';

/**
 * Query params de `GET /traceability/batches`.
 *
 * `q` était casté en `string` sans vérification : `?q=a&q=b` produit un TABLEAU, transmis tel quel
 * au `contains` de Prisma, qui échouait en 500. Une requête malformée doit se voir répondre 400.
 */
export const catalogQuerySchema = vine.object({
  q: vine.string().trim().maxLength(MAX_SEARCH_LENGTH).optional(),
});

export type CatalogQuery = Infer<typeof catalogQuerySchema>;
