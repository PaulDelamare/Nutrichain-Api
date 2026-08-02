import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';
import {
  MAX_PAGE_SIZE,
  MAX_PAGE_NUMBER,
  DEFAULT_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
} from '../../../../shared/constants/pagination.constants';
import { RECEIPT_STATUSES } from '../../constants/logistics.constants';

/**
 * Query params de `GET /logistics/receipts`.
 *
 * `page` et `limit` étaient lus par `parseInt` sans borne : `?limit=100000000` chargeait toutes les
 * réceptions avec leur jointure fournisseur, `?limit=abc` donnait `take: NaN` (500) et `?page=0`
 * un `skip` négatif (500). Trois symptômes du même manque de contrat.
 *
 * `ref` / `fournisseur` / `statut` / `date` : filtres de colonnes appliqués dans la requête Prisma
 * (et non plus côté front sur la page reçue). `statut` est borné à l'énumération de l'API et `date`
 * à un jour ISO — une valeur malformée est un 400, pas un filtre muet.
 */
export const receiptQuerySchema = vine.object({
  // `withoutDecimals` : `?limit=5.7` était accepté et partait tel quel dans `take`, la pagination
  // cessait d'être déterministe. Une page et une taille de page sont des entiers.
  page: vine.number().withoutDecimals().min(1).max(MAX_PAGE_NUMBER).optional(),
  limit: vine.number().withoutDecimals().min(1).max(MAX_PAGE_SIZE).optional(),
  ref: vine.string().trim().maxLength(MAX_SEARCH_LENGTH).optional(),
  fournisseur: vine.string().trim().maxLength(MAX_SEARCH_LENGTH).optional(),
  statut: vine.enum(Object.values(RECEIPT_STATUSES)).optional(),
  date: vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export type ReceiptQuery = Infer<typeof receiptQuerySchema>;

export const RECEIPT_PAGE_DEFAULTS = { page: 1, limit: DEFAULT_PAGE_SIZE } as const;
