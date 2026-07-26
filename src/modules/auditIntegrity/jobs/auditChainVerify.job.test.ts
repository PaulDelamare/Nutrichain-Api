import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `$transaction` reçoit le callback du job et lui passe un client transactionnel : c'est sur CE
 * client que le verrou doit être pris. Le mock le matérialise pour qu'un test puisse distinguer un
 * verrou pris dans la transaction d'un verrou pris par une requête isolée (#238).
 */
const txQueryRawUnsafe = vi.fn();

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
    $transaction: vi.fn(),
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

/** Toutes les requêtes brutes émises, transaction comprise. */
const allRawQueries = (): string[] => [
  ...vi.mocked(prisma.$queryRawUnsafe).mock.calls.map((c) => String(c[0])),
  ...txQueryRawUnsafe.mock.calls.map((c) => String(c[0])),
];

const lockQueries = (): string[] =>
  txQueryRawUnsafe.mock.calls.map((c) => String(c[0])).filter((q) => q.includes('advisory'));

/**
 * Branche `$transaction` sur le vrai callback du job. `locked` décide de la réponse du
 * `pg_try_advisory_xact_lock` — par organisation, dans l'ordre d'appel.
 */
const runTransactions = (locked: boolean[] | boolean = true) => {
  let call = 0;
  txQueryRawUnsafe.mockImplementation(async (sql: string) => {
    if (String(sql).includes('advisory')) {
      const verrou = Array.isArray(locked) ? (locked[call++] ?? true) : locked;
      return [{ locked: verrou }];
    }
    return [];
  });
  vi.mocked(prisma.$transaction).mockImplementation((async (
    fn: (tx: { $queryRawUnsafe: typeof txQueryRawUnsafe }) => Promise<unknown>
  ) => fn({ $queryRawUnsafe: txQueryRawUnsafe })) as never);
};

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
    txQueryRawUnsafe.mockReset();
  });

  it('1. Verify OK toutes orgs : aucun error, info pour chaque + recordCheckpoint appelé', async () => {
    runTransactions();
    mockOrgs(['org-a', 'org-b']);
    vi.mocked(auditVerifyService.verifyChain).mockResolvedValue(buildValid(5));

    await runAuditChainVerifyOnce();

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('OK org=org-a'));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('OK org=org-b'));
    expect(auditVerifyService.recordCheckpoint).toHaveBeenCalledTimes(2);
  });

  it('2. Verify broken sur 1 org / 3 : 1 error + recordCheckpoint NON appelé pour broken org', async () => {
    runTransactions();
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

    await runAuditChainVerifyOnce();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('org=org-broken'));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('brokenAtId=42'));
    expect(auditVerifyService.recordCheckpoint).toHaveBeenCalledTimes(2);
    expect(auditVerifyService.recordCheckpoint).not.toHaveBeenCalledWith(
      'org-broken',
      expect.anything()
    );
  });

  it("3. Aucune org en DB : pas de crash, pas d'error, aucune transaction ouverte", async () => {
    runTransactions();
    mockOrgs([]);

    await expect(runAuditChainVerifyOnce()).resolves.toBeUndefined();
    expect(logger.error).not.toHaveBeenCalled();
    expect(auditVerifyService.verifyChain).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('4. Verrou déjà tenu sur une org : elle est sautée, les autres sont traitées', async () => {
    runTransactions([false, true]);
    mockOrgs(['org-prise', 'org-libre']);
    vi.mocked(auditVerifyService.verifyChain).mockResolvedValue(buildValid(2));

    await runAuditChainVerifyOnce();

    expect(auditVerifyService.verifyChain).toHaveBeenCalledTimes(1);
    expect(auditVerifyService.verifyChain).toHaveBeenCalledWith(
      { organizationId: 'org-libre' },
      expect.anything()
    );
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('OK org=org-libre'));
  });

  it("5. Per-org timeout dépassé : warn 'per-org budget exceeded', job continue avec org suivante", async () => {
    runTransactions();
    mockOrgs(['org-slow', 'org-fast']);
    vi.mocked(auditVerifyService.verifyChain)
      .mockImplementationOnce(
        () =>
          new Promise<never>(() => {
            // ne résout jamais → déclenche le timeout du Promise.race
          })
      )
      .mockResolvedValueOnce(buildValid(2));

    vi.useFakeTimers();
    const promise = runAuditChainVerifyOnce();
    await vi.advanceTimersByTimeAsync(60_001);
    await promise;
    vi.useRealTimers();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Skip org=org-slow'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('budget exceeded'));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('OK org=org-fast'));
  });

  // --- #238 : affinité de connexion du verrou consultatif ---

  it('6. Le verrou est un xact lock pris DANS la transaction, pas un lock de session', async () => {
    runTransactions();
    mockOrgs(['org-a']);
    vi.mocked(auditVerifyService.verifyChain).mockResolvedValue(buildValid(1));

    await runAuditChainVerifyOnce();

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(lockQueries()).toHaveLength(1);
    expect(lockQueries()[0]).toContain('pg_try_advisory_xact_lock');
    // Un lock de SESSION appartient à la connexion qui l'a pris : c'est le défaut corrigé.
    expect(lockQueries()[0]).not.toContain('pg_try_advisory_lock(');
  });

  it("7. Aucun déverrouillage explicite n'est émis (le xact lock tombe au commit/rollback)", async () => {
    runTransactions();
    mockOrgs(['org-a', 'org-b']);
    vi.mocked(auditVerifyService.verifyChain).mockResolvedValue(buildValid(1));

    await runAuditChainVerifyOnce();

    expect(allRawQueries().some((q) => q.includes('pg_advisory_unlock'))).toBe(false);
  });

  it('8. Une clé de verrou distincte par organisation (pas un verrou global unique)', async () => {
    runTransactions();
    mockOrgs(['org-a', 'org-b']);
    vi.mocked(auditVerifyService.verifyChain).mockResolvedValue(buildValid(1));

    await runAuditChainVerifyOnce();

    const cles = lockQueries();
    expect(cles).toHaveLength(2);
    expect(cles[0]).not.toEqual(cles[1]);
  });

  it('9. Le verrou reste tenu pendant toute la vérification de son organisation', async () => {
    runTransactions();
    mockOrgs(['org-a']);
    let verrouPrisAvantVerify = false;
    vi.mocked(auditVerifyService.verifyChain).mockImplementation(async () => {
      verrouPrisAvantVerify = lockQueries().length === 1;
      return buildValid(1);
    });

    await runAuditChainVerifyOnce();

    // La vérification se déroule à l'intérieur de la transaction qui détient le verrou : si elle
    // s'exécutait après le commit, le verrou serait déjà retombé et n'exclurait plus rien.
    expect(verrouPrisAvantVerify).toBe(true);
    expect(vi.mocked(prisma.$transaction).mock.calls).toHaveLength(1);
  });
});
