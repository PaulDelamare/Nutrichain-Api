import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeAuditHash, GENESIS_PREV_HASH } from '../../../shared/utils/audit/auditHash.util';

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    audit_Log: {
      findMany: vi.fn(),
    },
    audit_Checkpoint: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { auditVerifyService } from './auditVerify.service';
import { prisma } from '../../../shared/configs/prismaClient.config';

const orgId = 'org-1';
const otherOrgId = 'org-2';

interface AuditRow {
  id: number;
  organization_id: string;
  id_user: string | null;
  action: string;
  entity: string;
  entity_id: string;
  ancienne_valeur: Record<string, unknown> | null;
  nouvelle_valeur: Record<string, unknown> | null;
  prev_hash: string;
  signature_hash: string;
  horodatage: Date;
}

const buildRow = (overrides: Partial<AuditRow> & { id: number; prev_hash: string }): AuditRow => {
  const base: AuditRow = {
    id: overrides.id,
    organization_id: orgId,
    id_user: 'u1',
    action: 'CREATE',
    entity: 'Receipt',
    entity_id: `r${overrides.id}`,
    ancienne_valeur: null,
    nouvelle_valeur: { x: overrides.id },
    prev_hash: overrides.prev_hash,
    signature_hash: '', // calculé ci-dessous
    horodatage: new Date(2026, 0, 1, 0, 0, overrides.id),
    ...overrides,
  };
  base.signature_hash = computeAuditHash({
    organizationId: base.organization_id,
    userId: base.id_user,
    action: base.action,
    entity: base.entity,
    entityId: base.entity_id,
    oldValue: base.ancienne_valeur,
    newValue: base.nouvelle_valeur,
    prevHash: base.prev_hash,
    timestamp: base.horodatage.toISOString(),
  });
  return base;
};

// Helper pour mocker findMany par batch (cursor-based)
const mockFindManyBatched = (allRows: AuditRow[], batchSize = 1000) => {
  const batches: AuditRow[][] = [];
  for (let i = 0; i < allRows.length; i += batchSize) {
    batches.push(allRows.slice(i, i + batchSize));
  }
  batches.push([]); // dernier appel retourne vide pour stopper la boucle
  const mock = vi.mocked(prisma.audit_Log.findMany);
  batches.forEach((b) => mock.mockResolvedValueOnce(b as never));
};

describe('auditVerifyService.verifyChain', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.audit_Checkpoint.findUnique).mockResolvedValue(null);
  });

  it('1. Genesis OK : 1 ligne avec prev_hash genesis et hash valide → valid:true', async () => {
    const row = buildRow({ id: 1, prev_hash: GENESIS_PREV_HASH });
    mockFindManyBatched([row]);

    const result = await auditVerifyService.verifyChain({ organizationId: orgId });

    expect(result.valid).toBe(true);
    expect(result.rowsChecked).toBe(1);
    expect(result.lastSignatureHash).toBe(row.signature_hash);
    expect(result.brokenAtId).toBeNull();
  });

  it('2. Chain valide multi-lignes : 3 lignes chaînées → valid:true rowsChecked:3', async () => {
    const r1 = buildRow({ id: 1, prev_hash: GENESIS_PREV_HASH });
    const r2 = buildRow({ id: 2, prev_hash: r1.signature_hash });
    const r3 = buildRow({ id: 3, prev_hash: r2.signature_hash });
    mockFindManyBatched([r1, r2, r3]);

    const result = await auditVerifyService.verifyChain({ organizationId: orgId });

    expect(result.valid).toBe(true);
    expect(result.rowsChecked).toBe(3);
    expect(result.lastSignatureHash).toBe(r3.signature_hash);
  });

  it('3. prev_hash mismatch : ligne 2 a prev_hash différent → broken prev_hash_mismatch', async () => {
    const r1 = buildRow({ id: 1, prev_hash: GENESIS_PREV_HASH });
    const r2Bad = buildRow({ id: 2, prev_hash: 'WRONG_PREV_HASH_xxxxxxxxxxxxxx' });
    mockFindManyBatched([r1, r2Bad]);

    const result = await auditVerifyService.verifyChain({ organizationId: orgId });

    expect(result.valid).toBe(false);
    expect(result.brokenAtId).toBe(2);
    expect(result.brokenAtReason).toBe('prev_hash_mismatch');
  });

  it('4. signature_mismatch : signature_hash stocké ≠ recompute → broken signature_mismatch', async () => {
    const r1 = buildRow({ id: 1, prev_hash: GENESIS_PREV_HASH });
    // Tampering : on garde un prev_hash correct mais on altère nouvelle_valeur après signature
    const r2 = buildRow({ id: 2, prev_hash: r1.signature_hash });
    const r2Tampered: AuditRow = { ...r2, nouvelle_valeur: { x: 999 } }; // payload modifié, hash inchangé
    mockFindManyBatched([r1, r2Tampered]);

    const result = await auditVerifyService.verifyChain({ organizationId: orgId });

    expect(result.valid).toBe(false);
    expect(result.brokenAtId).toBe(2);
    expect(result.brokenAtReason).toBe('signature_mismatch');
  });

  it('5. Genesis avec prev_hash incorrect → broken prev_hash_mismatch dès la 1ère ligne', async () => {
    const r1Bad = buildRow({ id: 1, prev_hash: 'NOT_GENESIS' });
    mockFindManyBatched([r1Bad]);

    const result = await auditVerifyService.verifyChain({ organizationId: orgId });

    expect(result.valid).toBe(false);
    expect(result.brokenAtId).toBe(1);
    expect(result.brokenAtReason).toBe('prev_hash_mismatch');
  });

  it('6. Empty chain (org sans log) → valid:true rowsChecked:0 lastSignatureHash:null', async () => {
    mockFindManyBatched([]);

    const result = await auditVerifyService.verifyChain({ organizationId: orgId });

    expect(result.valid).toBe(true);
    expect(result.rowsChecked).toBe(0);
    expect(result.lastSignatureHash).toBeNull();
    expect(result.brokenAtId).toBeNull();
  });

  it('7. Multi-tenant isolation : findMany filtré par organization_id', async () => {
    const row = buildRow({ id: 1, prev_hash: GENESIS_PREV_HASH });
    mockFindManyBatched([row]);

    await auditVerifyService.verifyChain({ organizationId: orgId });

    expect(prisma.audit_Log.findMany).toHaveBeenCalled();
    const firstCall = vi.mocked(prisma.audit_Log.findMany).mock.calls[0][0];
    expect(firstCall?.where).toMatchObject({ organization_id: orgId });
    expect(firstCall?.where).not.toMatchObject({ organization_id: otherOrgId });
  });

  it('8. Batching : 2500 lignes valides → 3 batchs (taille 1000), rowsChecked:2500', async () => {
    const rows: AuditRow[] = [];
    let prev = GENESIS_PREV_HASH;
    for (let i = 1; i <= 2500; i++) {
      const r = buildRow({ id: i, prev_hash: prev });
      rows.push(r);
      prev = r.signature_hash;
    }
    mockFindManyBatched(rows, 1000);

    const result = await auditVerifyService.verifyChain({ organizationId: orgId });

    expect(result.valid).toBe(true);
    expect(result.rowsChecked).toBe(2500);
    // 3 batchs effectifs + 1 batch vide pour stopper = 4 appels
    expect(prisma.audit_Log.findMany).toHaveBeenCalledTimes(4);
  });

  it('9. Truncation détectée via checkpoint : last_row_count:100 vs current:80 → broken truncation', async () => {
    vi.mocked(prisma.audit_Checkpoint.findUnique).mockResolvedValue({
      organization_id: orgId,
      last_id: 100,
      last_signature_hash: 'h100',
      last_row_count: 100,
      verified_at: new Date(),
    } as never);
    // La chain de 80 lignes elle-même est valide
    const rows: AuditRow[] = [];
    let prev = GENESIS_PREV_HASH;
    for (let i = 1; i <= 80; i++) {
      const r = buildRow({ id: i, prev_hash: prev });
      rows.push(r);
      prev = r.signature_hash;
    }
    mockFindManyBatched(rows, 1000);

    const result = await auditVerifyService.verifyChain({ organizationId: orgId });

    expect(result.valid).toBe(false);
    expect(result.brokenAtReason).toBe('truncation');
    expect(result.expectedRowCount).toBe(100);
    expect(result.actualRowCount).toBe(80);
  });

  it('10. Pas de checkpoint encore → verify nominale sans crash retourne valid:true', async () => {
    vi.mocked(prisma.audit_Checkpoint.findUnique).mockResolvedValue(null);
    const row = buildRow({ id: 1, prev_hash: GENESIS_PREV_HASH });
    mockFindManyBatched([row]);

    const result = await auditVerifyService.verifyChain({ organizationId: orgId });

    expect(result.valid).toBe(true);
    expect(result.rowsChecked).toBe(1);
  });

  it('11. Growth case (checkpoint < rowsChecked actuel) → valid:true (pas de truncation)', async () => {
    vi.mocked(prisma.audit_Checkpoint.findUnique).mockResolvedValue({
      organization_id: orgId,
      last_id: 50,
      last_signature_hash: 'h50',
      last_row_count: 50,
      verified_at: new Date(),
    } as never);
    const rows: AuditRow[] = [];
    let prev = GENESIS_PREV_HASH;
    for (let i = 1; i <= 80; i++) {
      const r = buildRow({ id: i, prev_hash: prev });
      rows.push(r);
      prev = r.signature_hash;
    }
    mockFindManyBatched(rows, 1000);

    const result = await auditVerifyService.verifyChain({ organizationId: orgId });

    expect(result.valid).toBe(true);
    expect(result.rowsChecked).toBe(80);
  });
});

describe('auditVerifyService.recordCheckpoint', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('11. upsert checkpoint avec last_id, last_signature_hash, last_row_count', async () => {
    await auditVerifyService.recordCheckpoint(orgId, {
      valid: true,
      rowsChecked: 42,
      lastSignatureHash: 'final-hash-abc',
      lastHorodatage: new Date('2026-05-29T11:00:00.000Z'),
      lastId: 42,
      brokenAtId: null,
      brokenAtReason: null,
      expectedRowCount: null,
      actualRowCount: null,
    });

    expect(prisma.audit_Checkpoint.upsert).toHaveBeenCalledWith({
      where: { organization_id: orgId },
      create: {
        organization_id: orgId,
        last_id: 42,
        last_signature_hash: 'final-hash-abc',
        last_row_count: 42,
      },
      update: {
        last_id: 42,
        last_signature_hash: 'final-hash-abc',
        last_row_count: 42,
        verified_at: expect.any(Date),
      },
    });
  });

  it("12. recordCheckpoint avec valid:false → ne fait PAS l'upsert (guard interne)", async () => {
    await auditVerifyService.recordCheckpoint(orgId, {
      valid: false,
      rowsChecked: 10,
      lastSignatureHash: null,
      lastHorodatage: null,
      lastId: null,
      brokenAtId: 5,
      brokenAtReason: 'signature_mismatch',
      expectedRowCount: null,
      actualRowCount: null,
    });

    expect(prisma.audit_Checkpoint.upsert).not.toHaveBeenCalled();
  });
});
