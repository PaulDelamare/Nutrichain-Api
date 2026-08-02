import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';
import {
  MAX_PAGE_SIZE,
  MAX_PAGE_NUMBER,
  DEFAULT_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
} from '../../../shared/constants/pagination.constants';
import { ROLES } from '../../identity/constants/roles.constants';

/**
 * Query params de `GET /organization/members`.
 *
 * `page` / `limit` : mêmes bornes que les autres lectures paginées — l'annuaire renvoyait tout d'un
 * bloc, non paginé.
 *
 * `email` / `role` / `mfa` : filtres de colonnes appliqués dans la requête Prisma (et non plus côté
 * front sur la page reçue). `role` est borné au vocabulaire canonique — `owner` inclus, c'est un
 * membre réel — et `mfa` à un booléen : une valeur malformée est un 400, pas un filtre muet.
 */
export const memberQuerySchema = vine.object({
  page: vine.number().withoutDecimals().min(1).max(MAX_PAGE_NUMBER).optional(),
  limit: vine.number().withoutDecimals().min(1).max(MAX_PAGE_SIZE).optional(),
  email: vine.string().trim().maxLength(MAX_SEARCH_LENGTH).optional(),
  role: vine.enum(Object.values(ROLES)).optional(),
  mfa: vine.boolean().optional(),
});

export type MemberQuery = Infer<typeof memberQuerySchema>;

export const MEMBER_PAGE_DEFAULTS = { page: 1, limit: DEFAULT_PAGE_SIZE } as const;
