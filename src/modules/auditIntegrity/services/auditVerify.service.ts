import { prisma } from '../../../shared/configs/prismaClient.config';
import { computeAuditHash, GENESIS_PREV_HASH } from '../../../shared/utils/audit/auditHash.util';

/**
 * Raisons possibles d'une chaîne d'audit cassée.
 *
 * - `prev_hash_mismatch` : une ligne référence un `prev_hash` qui n'est pas le
 *   `signature_hash` de la ligne précédente (rupture de liens).
 * - `signature_mismatch` : le `signature_hash` stocké ne matche pas le recompute
 *   (les valeurs persistées ont été altérées après écriture).
 * - `truncation` : le nombre de lignes courant est inférieur au `last_row_count`
 *   du checkpoint persistant — la fin de la chaîne a été supprimée silencieusement.
 */
export type BrokenReason = 'prev_hash_mismatch' | 'signature_mismatch' | 'truncation';

export interface VerifyChainResult {
  valid: boolean;
  rowsChecked: number;
  lastSignatureHash: string | null;
  lastHorodatage: Date | null;
  lastId: number | null;
  brokenAtId: number | null;
  brokenAtReason: BrokenReason | null;
  /** Renseignés uniquement quand `brokenAtReason === 'truncation'`. */
  expectedRowCount: number | null;
  actualRowCount: number | null;
}

const BATCH_SIZE = 1000;

/**
 * Service de vérification d'intégrité de la chaîne d'audit WORM.
 *
 * `verifyChain` recompute le SHA256 de chaque ligne et compare au stocké, vérifie
 * également les liens `prev_hash → signature_hash` et la non-régression du nombre
 * de lignes (anti-troncature via checkpoint).
 *
 * **Lecture seule** : aucune écriture sur `Audit_Log`. WORM intact.
 * Écrit uniquement sur `Audit_Checkpoint` (table dédiée, mutable par design)
 * via `recordCheckpoint`, appelé par le cron sur résultat valide uniquement.
 */
export const auditVerifyService = {
  async verifyChain(params: { organizationId: string }): Promise<VerifyChainResult> {
    const { organizationId } = params;
    const checkpoint = await prisma.audit_Checkpoint.findUnique({
      where: { organization_id: organizationId },
    });

    let previousSignature = GENESIS_PREV_HASH;
    let rowsChecked = 0;
    let cursorId = 0;
    let lastSignatureHash: string | null = null;
    let lastHorodatage: Date | null = null;
    let lastId: number | null = null;

    for (;;) {
      const batch = await prisma.audit_Log.findMany({
        where: { organization_id: organizationId, id: { gt: cursorId } },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
      });
      if (batch.length === 0) {
        break;
      }
      for (const row of batch) {
        if (row.prev_hash !== previousSignature) {
          return broken(row.id, 'prev_hash_mismatch', rowsChecked);
        }
        const recomputed = computeAuditHash({
          organizationId: row.organization_id,
          userId: row.id_user,
          action: row.action,
          entity: row.entity,
          entityId: row.entity_id,
          oldValue: row.ancienne_valeur as Record<string, unknown> | null,
          newValue: row.nouvelle_valeur as Record<string, unknown> | null,
          prevHash: row.prev_hash,
          timestamp: row.horodatage.toISOString(),
        });
        if (recomputed !== row.signature_hash) {
          return broken(row.id, 'signature_mismatch', rowsChecked);
        }
        previousSignature = row.signature_hash;
        lastSignatureHash = row.signature_hash;
        lastHorodatage = row.horodatage;
        lastId = row.id;
        cursorId = row.id;
        rowsChecked++;
      }
    }

    // Truncation check via checkpoint persistant
    if (checkpoint && rowsChecked < checkpoint.last_row_count) {
      return {
        valid: false,
        rowsChecked,
        lastSignatureHash,
        lastHorodatage,
        lastId,
        brokenAtId: null,
        brokenAtReason: 'truncation',
        expectedRowCount: checkpoint.last_row_count,
        actualRowCount: rowsChecked,
      };
    }

    return {
      valid: true,
      rowsChecked,
      lastSignatureHash,
      lastHorodatage,
      lastId,
      brokenAtId: null,
      brokenAtReason: null,
      expectedRowCount: null,
      actualRowCount: null,
    };
  },

  /**
   * Persiste un checkpoint après une verify valide. Appelé par le cron uniquement.
   * Si `result.valid === false`, la fonction est no-op (n'écrase pas un checkpoint
   * valide avec un état broken).
   */
  async recordCheckpoint(organizationId: string, result: VerifyChainResult): Promise<void> {
    if (!result.valid || result.lastId === null || result.lastSignatureHash === null) {
      return;
    }
    await prisma.audit_Checkpoint.upsert({
      where: { organization_id: organizationId },
      create: {
        organization_id: organizationId,
        last_id: result.lastId,
        last_signature_hash: result.lastSignatureHash,
        last_row_count: result.rowsChecked,
      },
      update: {
        last_id: result.lastId,
        last_signature_hash: result.lastSignatureHash,
        last_row_count: result.rowsChecked,
        verified_at: new Date(),
      },
    });
  },
};

function broken(id: number, reason: BrokenReason, rowsChecked: number): VerifyChainResult {
  return {
    valid: false,
    rowsChecked,
    lastSignatureHash: null,
    lastHorodatage: null,
    lastId: null,
    brokenAtId: id,
    brokenAtReason: reason,
    expectedRowCount: null,
    actualRowCount: null,
  };
}
