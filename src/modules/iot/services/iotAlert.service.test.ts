import { describe, it, expect, vi, beforeEach } from 'vitest';
import { iotAlertService, _clearThresholdCacheForTests } from './iotAlert.service';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { auditService } from '../../../shared/utils/audit/audit.service';
import { sendEmail } from '../../../shared/utils/mailer/mailer';
import { logger } from '../../../shared/utils/logger/logger';
import { TelemetryModel } from '../models/telemetry.model';

// vi.hoisted pour partager le mock du tx client entre la factory $transaction et les tests
const { txClient } = vi.hoisted(() => ({
  txClient: {
    alert: { create: vi.fn() },
    batch: { updateMany: vi.fn() },
    batch_Mouvement: { createMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    equipment: { findFirst: vi.fn() },
    alert: { findFirst: vi.fn(), create: vi.fn() },
    member: { findMany: vi.fn() },
    $queryRawUnsafe: vi.fn(),
    $transaction: vi.fn(async (fn: unknown, _opts?: unknown) =>
      (fn as (tx: typeof txClient) => Promise<unknown>)(txClient)
    ),
  },
}));

vi.mock('../../../shared/utils/audit/audit.service', () => ({
  auditService: { logAction: vi.fn() },
}));

vi.mock('../../../shared/utils/mailer/mailer', () => ({
  sendEmail: vi.fn(),
}));

vi.mock('../../../shared/utils/logger/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('../models/telemetry.model', () => ({
  TelemetryModel: {
    find: vi.fn(),
  },
}));

const buildEquipment = (
  overrides: { id?: string; orgId?: string; threshold?: number | null; sensorId?: string } = {}
) => ({
  id: overrides.id ?? 'equip-1',
  organization_id: overrides.orgId ?? 'org-1',
  nom: 'Frigo A',
  type: 'FRIGO',
  id_lieu: 'loc-1',
  statut: 'PRET',
  temp_actuelle: null,
  temp_seuil_max: overrides.threshold === undefined ? 4 : overrides.threshold,
  qr_code_id: null,
  sensor_id: overrides.sensorId ?? 'sensor-A',
  last_cleaned_at: null,
});

const buildPoint = (minutesAgo: number, temperature: number) => ({
  timestamp: new Date(Date.now() - minutesAgo * 60_000),
  temperature,
  humidity: 50,
  battery_level: 80,
});

const mockMongoFind = (points: ReturnType<typeof buildPoint>[]) => {
  // Chain: find() → { limit } → { lean } → Promise<docs[]>
  const lean = vi.fn().mockResolvedValue(points);
  const limit = vi.fn().mockReturnValue({ lean });
  vi.mocked(TelemetryModel.find).mockReturnValue({ limit } as never);
};

beforeEach(() => {
  vi.clearAllMocks();
  _clearThresholdCacheForTests();
  // Defaults : equipment trouvé, lock OK, dédup OK (pas d'alert), member admin
  vi.mocked(prisma.equipment.findFirst).mockResolvedValue(buildEquipment() as never);
  vi.mocked(prisma.alert.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.member.findMany).mockResolvedValue([
    { user: { email: 'admin@nutrichain.local', name: 'Admin' } },
  ] as never);
  // advisory lock acquis par défaut (renvoie true)
  vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([{ locked: true }] as never);
  vi.mocked(txClient.alert.create).mockResolvedValue({ id: 'alert-1' } as never);
  vi.mocked(txClient.$queryRaw).mockResolvedValue([] as never);
  vi.mocked(txClient.batch_Mouvement.createMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(auditService.logAction).mockResolvedValue({} as never);
  vi.mocked(sendEmail).mockResolvedValue(undefined as never);
  mockMongoFind(Array.from({ length: 10 }, (_, i) => buildPoint(i + 1, 8))); // tous au-dessus de 4
  // Resynchroniser $transaction (clearAllMocks vide aussi son impl)
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) =>
    (fn as (tx: typeof txClient) => Promise<unknown>)(txClient)
  );
});

describe('iotAlertService.checkAndAlert', () => {
  const baseParams = {
    sensorId: 'sensor-A',
    organizationId: 'org-1',
    currentTemp: 8,
    timestamp: new Date(),
  };

  it("sensor sans mapping Equipment → logger.warn(sensorId), pas d'Alert", async () => {
    vi.mocked(prisma.equipment.findFirst).mockResolvedValue(null);

    await iotAlertService.checkAndAlert(baseParams);

    expect(logger.warn).toHaveBeenCalled();
    const warnArg = vi.mocked(logger.warn).mock.calls.flat().join(' ');
    expect(warnArg).toContain('sensor-A');
    // Aucun PII (ni température ni adresse) dans le warn
    expect(warnArg).not.toMatch(/\d+°/);
    expect(prisma.alert.create).not.toHaveBeenCalled();
    expect(txClient.alert.create).not.toHaveBeenCalled();
  });

  it("cross-tenant : sensor d'org B + activeOrgId d'org A → findFirst null → exit", async () => {
    vi.mocked(prisma.equipment.findFirst).mockResolvedValue(null);

    await iotAlertService.checkAndAlert({ ...baseParams, organizationId: 'org-A' });

    // Le findFirst doit avoir été appelé avec organization_id=org-A
    expect(prisma.equipment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sensor_id: 'sensor-A', organization_id: 'org-A' }),
      })
    );
    expect(txClient.alert.create).not.toHaveBeenCalled();
  });

  it('Equipment sans temp_seuil_max (null) → exit immédiat, pas de query Mongo', async () => {
    vi.mocked(prisma.equipment.findFirst).mockResolvedValue(
      buildEquipment({ threshold: null }) as never
    );

    await iotAlertService.checkAndAlert(baseParams);

    expect(TelemetryModel.find).not.toHaveBeenCalled();
    expect(txClient.alert.create).not.toHaveBeenCalled();
  });

  it('currentTemp <= threshold → exit fast path sans query Mongo', async () => {
    await iotAlertService.checkAndAlert({ ...baseParams, currentTemp: 3 });

    expect(TelemetryModel.find).not.toHaveBeenCalled();
    expect(txClient.alert.create).not.toHaveBeenCalled();
  });

  it('currentTemp === threshold (boundary strict >) → exit fast path', async () => {
    await iotAlertService.checkAndAlert({ ...baseParams, currentTemp: 4 });

    expect(TelemetryModel.find).not.toHaveBeenCalled();
    expect(txClient.alert.create).not.toHaveBeenCalled();
  });

  it("détection ne confirme pas (ratio < 80%) → pas d'Alert", async () => {
    // 10 points dont 5 au-dessus + 5 en-dessous (ratio 0.5)
    mockMongoFind([
      ...Array.from({ length: 5 }, (_, i) => buildPoint(i + 1, 8)),
      ...Array.from({ length: 5 }, (_, i) => buildPoint(i + 6, 2)),
    ]);

    await iotAlertService.checkAndAlert(baseParams);

    expect(txClient.alert.create).not.toHaveBeenCalled();
  });

  it("détection confirme + pas d'Alert ACTIVE → Alert créée + audit dans tx + email envoyé", async () => {
    await iotAlertService.checkAndAlert(baseParams);

    expect(txClient.alert.create).toHaveBeenCalledTimes(1);
    expect(txClient.alert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organization_id: 'org-1',
          type: 'TEMP_EXCURSION',
          niveau_gravite: 'PANIC',
          id_materiel: 'equip-1',
          statut: 'ACTIVE',
          // (issue #57) Le pic et le seuil sont exposés en champs STRUCTURÉS sur l'alerte —
          // plus seulement noyés dans le message. Points à 8°C, seuil 4°C → pic 8, seuil 4.
          peak_temp: 8,
          temp_seuil: 4,
        }),
      })
    );
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        action: 'TEMP_EXCURSION_DETECTED',
        entity: 'Alert',
      }),
      txClient
    );
    expect(sendEmail).toHaveBeenCalled();
  });

  it('excursion → lots EN_STOCK de cet équipement mis en quarantaine (BLOQUE)', async () => {
    vi.mocked(txClient.$queryRaw).mockResolvedValue([
      { id: 'lot-1', quantite_actuelle: 10, unite_code: 'KG' },
      { id: 'lot-2', quantite_actuelle: 20, unite_code: 'KG' },
      { id: 'lot-3', quantite_actuelle: 30, unite_code: 'KG' },
    ] as never);

    await iotAlertService.checkAndAlert(baseParams);

    // Le blocage est un UPDATE ... RETURNING : une seule requête, pas de lecture préalable
    // (pas de fenêtre TOCTOU), et il renvoie les lots réellement bloqués.
    expect(txClient.$queryRaw).toHaveBeenCalled();

    // Le nombre de lots bloqués est tracé dans l'audit.
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        newValue: expect.objectContaining({ quarantinedBatchesCount: 3 }),
      }),
      txClient
    );
  });

  it('chaque lot mis en quarantaine garde la trace de la CAUSE dans son historique', async () => {
    vi.mocked(txClient.$queryRaw).mockResolvedValue([
      { id: 'lot-1', quantite_actuelle: 10, unite_code: 'KG' },
    ] as never);

    await iotAlertService.checkAndAlert(baseParams);

    // Sans ce mouvement, un lot passe en quarantaine sans que personne ne puisse dire
    // pourquoi ni quand : la fiche du lot n'aurait aucune explication à montrer.
    expect(txClient.batch_Mouvement.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          id_lot: 'lot-1',
          type_action: 'QUARANTAINE_FROID',
          quantite: 10,
          unite: 'KG',
          metadata: expect.objectContaining({ id_alerte: 'alert-1', sensorId: 'sensor-A' }),
        }),
      ],
    });
  });

  it('aucun lot bloqué → aucun mouvement écrit', async () => {
    vi.mocked(txClient.$queryRaw).mockResolvedValue([] as never);

    await iotAlertService.checkAndAlert(baseParams);

    expect(txClient.batch_Mouvement.createMany).not.toHaveBeenCalled();
  });

  it('dédup : Alert ACTIVE existe → skip création (anti-spam)', async () => {
    vi.mocked(prisma.alert.findFirst).mockResolvedValue({ id: 'existing-active' } as never);

    await iotAlertService.checkAndAlert(baseParams);

    expect(txClient.alert.create).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('cache hit : 2 appels sur même sensor → 1 seul findFirst Equipment', async () => {
    await iotAlertService.checkAndAlert(baseParams);
    await iotAlertService.checkAndAlert(baseParams);

    expect(prisma.equipment.findFirst).toHaveBeenCalledTimes(1);
  });

  it('cache key org-scoped : même sensorId dans 2 orgs → 2 findFirst distincts', async () => {
    await iotAlertService.checkAndAlert({ ...baseParams, organizationId: 'org-A' });
    await iotAlertService.checkAndAlert({ ...baseParams, organizationId: 'org-B' });

    expect(prisma.equipment.findFirst).toHaveBeenCalledTimes(2);
  });

  it('advisory lock pris (locked=false) → exit silencieux', async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([{ locked: false }] as never);

    await iotAlertService.checkAndAlert(baseParams);

    expect(txClient.alert.create).not.toHaveBeenCalled();
    expect(TelemetryModel.find).not.toHaveBeenCalled();
  });

  it('advisory lock relâché en finally même en cas de throw', async () => {
    vi.mocked(prisma.alert.findFirst).mockRejectedValueOnce(new Error('DB error'));

    // L'appel doit gracieusement gérer l'erreur (catch interne ou propage)
    await expect(iotAlertService.checkAndAlert(baseParams)).rejects.toThrow();

    // Le unlock a été appelé : 1er appel lock, 2e appel unlock
    const calls = vi.mocked(prisma.$queryRawUnsafe).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(String(calls[0][0])).toMatch(/pg_try_advisory_lock/);
    expect(String(calls[1][0])).toMatch(/pg_advisory_unlock/);
  });

  it('email recipients filtrés par equipment.organization_id (defense-in-depth)', async () => {
    await iotAlertService.checkAndAlert(baseParams);

    expect(prisma.member.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-1', // org de l'equipment, pas activeOrgId passé en param
          role: { in: ['owner', 'admin'] },
        }),
      })
    );
  });

  it('email failure (.catch logger.error) — alert quand même persistée', async () => {
    vi.mocked(sendEmail).mockRejectedValue(new Error('SMTP down'));

    await iotAlertService.checkAndAlert(baseParams);
    // notifyAdmins est appelé en void, on flush la microtask queue pour récupérer le .catch
    await new Promise((resolve) => setImmediate(resolve));

    expect(txClient.alert.create).toHaveBeenCalled(); // alert créée
    expect(logger.error).toHaveBeenCalled(); // erreur logguée
  });

  // ===== Tests round 2 (ajout post-review) =====
  it('lock release sur Mongo throw : unlock appelé même si TelemetryModel.find rejette', async () => {
    const lean = vi.fn().mockRejectedValue(new Error('Mongo down'));
    const limit = vi.fn().mockReturnValue({ lean });
    vi.mocked(TelemetryModel.find).mockReturnValue({ limit } as never);

    await expect(iotAlertService.checkAndAlert(baseParams)).rejects.toThrow('Mongo down');

    // 1er $queryRawUnsafe = lock, 2e = unlock
    const calls = vi.mocked(prisma.$queryRawUnsafe).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(String(calls[0][0])).toMatch(/pg_try_advisory_lock/);
    expect(String(calls[calls.length - 1][0])).toMatch(/pg_advisory_unlock/);
  });

  it('cache TTL expiry : après 60s+ on re-fetch Equipment depuis Postgres', async () => {
    vi.useFakeTimers();
    try {
      await iotAlertService.checkAndAlert(baseParams);
      expect(prisma.equipment.findFirst).toHaveBeenCalledTimes(1);

      // Avance de 30s : encore dans le TTL (60s)
      vi.advanceTimersByTime(30_000);
      await iotAlertService.checkAndAlert(baseParams);
      expect(prisma.equipment.findFirst).toHaveBeenCalledTimes(1); // cache hit

      // Avance de 31s supplémentaires (total 61s) : TTL expiré
      vi.advanceTimersByTime(31_000);
      await iotAlertService.checkAndAlert(baseParams);
      expect(prisma.equipment.findFirst).toHaveBeenCalledTimes(2); // cache miss → re-fetch
    } finally {
      vi.useRealTimers();
    }
  });

  it("audit rollback : si auditService.logAction throw, l'alert n'est PAS créée (atomicité tx)", async () => {
    // Le mock $transaction propage les throws : si auditService throw,
    // la promise $transaction rejette, et toute la tx est rollback en prod.
    vi.mocked(auditService.logAction).mockRejectedValue(new Error('Audit hash chain failed'));

    await expect(iotAlertService.checkAndAlert(baseParams)).rejects.toThrow(
      'Audit hash chain failed'
    );

    // alert.create a bien été tenté dans le callback de tx, mais la tx complète est rollback côté DB.
    // En unit-test avec mock $transaction qui ne simule pas le rollback DB, on vérifie au moins
    // que le throw remonte (preuve que l'auditService est dans la tx, pas après).
    expect(auditService.logAction).toHaveBeenCalled();
  });
});
