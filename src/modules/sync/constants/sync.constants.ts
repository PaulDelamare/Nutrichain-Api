import { WRITE_ROLES } from '../../identity/constants/roles.constants';

/**
 * Rôles autorisés à écrire via /api/sync/scans, en session ou comme `actorUserId` en M2M.
 * Écritures métier = mêmes rôles que la réception directe (owner/admin/operator).
 */
export const SYNC_WRITE_ROLES: string[] = [...WRITE_ROLES];

/**
 * Durée de vie des clés d'idempotency : 7 jours.
 * Compromis entre robustesse du retry mobile et volume DB.
 */
const IDEMPOTENCY_TTL_DAYS = 7;
export const IDEMPOTENCY_TTL_MS = IDEMPOTENCY_TTL_DAYS * 24 * 60 * 60 * 1000;
