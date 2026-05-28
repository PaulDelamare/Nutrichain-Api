import { LOGISTICS_ROLES } from '../../logistics/constants/logistics.constants';

/**
 * Rôles autorisés à écrire via /api/sync/scans, en session ou comme `actorUserId` en M2M.
 * Inclut les rôles d'org (Better-Auth) et les rôles métier logistiques.
 */
export const SYNC_WRITE_ROLES: string[] = [
  'owner',
  'admin',
  LOGISTICS_ROLES.OPERATOR,
  LOGISTICS_ROLES.ADMIN,
  LOGISTICS_ROLES.OWNER,
];

/**
 * Durée de vie des clés d'idempotency : 7 jours.
 * Compromis entre robustesse du retry mobile et volume DB.
 */
export const IDEMPOTENCY_TTL_DAYS = 7;
export const IDEMPOTENCY_TTL_MS = IDEMPOTENCY_TTL_DAYS * 24 * 60 * 60 * 1000;
