import crypto from 'crypto';

/**
 * Inputs canoniques d'une ligne d'audit, format figé de la signature.
 *
 * IMPORTANT : la forme exacte de cet objet (clés + ordre) constitue le **contrat
 * cryptographique** de la hash chain WORM. Tout changement de la formule invalide
 * rétroactivement la totalité des `signature_hash` déjà persistés en DB.
 *
 * Le test "golden vector" dans `auditHash.util.test.ts` ancre la formule via un
 * SHA256 hex literal — si la formule bouge, ce test pète bruyamment et l'auteur
 * doit consciemment décider d'une migration de la chain (re-signature offline).
 */
export interface AuditHashInputs {
  organizationId: string;
  userId?: string | null;
  action: string;
  entity: string;
  entityId: string;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  prevHash: string;
  timestamp: string;
}

/**
 * Hash WORM canonique d'une ligne d'audit (SHA256 hex).
 *
 * Helper extrait de `audit.service.ts` pour être consommé symétriquement par :
 * - `auditService.logAction` (écriture)
 * - `auditVerifyService.verifyChain` (vérification)
 *
 * Garantit que la formule est UNIQUE — pas de risque de drift entre l'écriture
 * et la vérification après refactor.
 *
 * Sémantique des champs nullables (verrouillée par tests) :
 * - `userId` `undefined`, `null` OU empty string `''` → remplacé par `'system'`.
 *   (le `||` traite tous les falsy comme tels — confirmé par test #7).
 * - `oldValue` / `newValue` `null` → sérialisé `null` dans le JSON.
 * - `oldValue` / `newValue` `undefined` → DROPPÉ par JSON.stringify (hash différent).
 *   `audit.service.ts` normalise `undefined → null` AVANT d'appeler ce helper, pour
 *   éviter une divergence write/verify quand Postgres persiste NULL pour undefined.
 */
export function computeAuditHash(inputs: AuditHashInputs): string {
  const dataToHash = JSON.stringify({
    organizationId: inputs.organizationId,
    userId: inputs.userId || 'system',
    action: inputs.action,
    entity: inputs.entity,
    entityId: inputs.entityId,
    oldValue: inputs.oldValue,
    newValue: inputs.newValue,
    prevHash: inputs.prevHash,
    timestamp: inputs.timestamp,
  });

  return crypto.createHash('sha256').update(dataToHash).digest('hex');
}

/**
 * Constante exportée pour la valeur "genesis" de `prev_hash` (1ère ligne d'une chain).
 * 64 zéros hex == `crypto.createHash('sha256').digest('hex').length`.
 */
export const GENESIS_PREV_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
