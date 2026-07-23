import { WRITE_ROLES } from '../../identity/constants/roles.constants';

/**
 * Rôles autorisés à écrire via /api/sync/scans, en session ou comme `actorUserId` en M2M.
 * Écritures métier = mêmes rôles que la réception directe (owner/admin/operator).
 */
export const SYNC_WRITE_ROLES: string[] = [...WRITE_ROLES];

// La durée de vie des clés d'idempotence (IDEMPOTENCY_TTL_MS) vit désormais dans le mécanisme
// partagé : src/shared/utils/idempotency/idempotency.service.ts.
