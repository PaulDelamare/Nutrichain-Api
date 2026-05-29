import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
    organization: { findMany: vi.fn() },
  },
}));

vi.mock('../services/auditVerify.service', () => ({
  auditVerifyService: {
    verifyChain: vi.fn(),
    recordCheckpoint: vi.fn(),
  },
}));

vi.mock('../../../shared/utils/logger/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { runAuditChainVerifyOnce } from './auditChainVerify.job';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { auditVerifyService } from '../services/auditVerify.service';
import { logger } from '../../../shared/utils/logger/logger';

const lockHeld = () =>
  vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([{ locked: true }] as never);

const lockBusy = () =>
  vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([{ locked: false }] as never);

const mockOrgs = (ids: string[]) => {
  vi.mocked(prisma.organization.findMany).mockResolvedValue(ids.map((id) => ({ id })) as never);
};

const buildValid = (rows = 1) => ({
  valid: true,
  rowsChecked: rows,
  lastSignatureHash: 'h',
  lastHorodatage: new Date(),
  lastId: rows,
  brokenAtId: null,
  brokenAtReason: null,
  expectedRowCount: null,
  actualRowCount: null,
});

describe('auditChainVerify job', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('1. Verify OK toutes orgs : aucun error, info pour chaque + recordCheckpoint appelé', async () => {
    lockHeld();
    mockOrgs(['org-a', 'org-b']);
    vi.mocked(auditVerifyService.verifyChain).mockResolvedValue(buildValid(5));
    // L'unlock à la fin (queryRawUnsafe append)
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([] as never);

    await runAuditChainVerifyOnce();

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('OK org=org-a'));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('OK org=org-b'));
    expect(auditVerifyService.recordCheckpoint).toHaveBeenCalledTimes(2);
  });

  it('2. Verify broken sur 1 org / 3 : 1 error + recordCheckpoint NON appelé pour broken org', async () => {
    lockHeld();
    mockOrgs(['org-ok-1', 'org-broken', 'org-ok-2']);
    vi.mocked(auditVerifyService.verifyChain)
      .mockResolvedValueOnce(buildValid(3))
      .mockResolvedValueOnce({
        valid: false,
        rowsChecked: 1,
        lastSignatureHash: null,
        lastHorodatage: null,
        lastId: null,
        brokenAtId: 42,
        brokenAtReason: 'signature_mismatch',
        expectedRowCount: null,
        actualRowCount: null,
      })
      .mockResolvedValueOnce(buildValid(7));
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([] as never);

    await runAuditChainVerifyOnce();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('org=org-broken'));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('brokenAtId=42'));
    // recordCheckpoint appelé uniquement pour les 2 valides
    expect(auditVerifyService.recordCheckpoint).toHaveBeenCalledTimes(2);
    expect(auditVerifyService.recordCheckpoint).not.toHaveBeenCalledWith(
      'org-broken',
      expect.anything()
    );
  });

  it("3. Aucune org en DB : pas de crash, pas d'error", async () => {
    lockHeld();
    mockOrgs([]);
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([] as never);

    await expect(runAuditChainVerifyOnce()).resolves.toBeUndefined();
    expect(logger.error).not.toHaveBeenCalled();
    expect(auditVerifyService.verifyChain).not.toHaveBeenCalled();
  });

  it("4. Advisory lock déjà tenu : skip silencieux + info 'Skipped', aucun verify", async () => {
    lockBusy();

    await runAuditChainVerifyOnce();

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Skipped'));
    expect(auditVerifyService.verifyChain).not.toHaveBeenCalled();
  });

  it("5. Per-org timeout dépassé : warn 'per-org budget exceeded', job continue avec org suivante", async () => {
    lockHeld();
    mockOrgs(['org-slow', 'org-fast']);
    vi.mocked(auditVerifyService.verifyChain)
      .mockImplementationOnce(
        () =>
          new Promise<never>(() => {
            // ne résout jamais → déclenche le timeout du Promise.race
          })
      )
      .mockResolvedValueOnce(buildValid(2));
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([] as never);

    // Réduit le budget pour ne pas faire attendre 60s
    vi.useFakeTimers();
    const promise = runAuditChainVerifyOnce();
    await vi.advanceTimersByTimeAsync(60_001);
    await promise;
    vi.useRealTimers();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Skip org=org-slow'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('budget exceeded'));
    // L'org suivante a bien été traitée
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('OK org=org-fast'));
  });
});
