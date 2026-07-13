import { describe, it, expect, vi, beforeEach } from 'vitest';
import { qualityControlService } from './qualityControl.service';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { APIError } from '../../../shared/utils/errorHandler/APIError';

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    batch: { findFirst: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    qualityControl: { create: vi.fn() },
    batch_Mouvement: { create: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: vi.fn(async (cb: any) => cb(prisma)),
  },
}));

vi.mock('../../../shared/utils/audit/audit.service', () => ({
  auditService: { logAction: vi.fn() },
}));

function lot(statut: string) {
  return {
    id: 'lot-1',
    organization_id: 'org-1',
    statut,
    quantite_actuelle: 100,
    unite_code: 'L',
    version: 3,
  };
}

const input = {
  organization_id: 'org-1',
  id_lot: 'lot-1',
  type_test: 'Analyse microbiologique',
  id_user_labo: 'user-qualite',
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(prisma.qualityControl.create).mockResolvedValue({ id: 'qc-1' } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(prisma.batch.updateMany).mockResolvedValue({ count: 1 } as any);
});

describe('createQualityControl — la table d’états', () => {
  it('un contrôle CONFORME libère le lot qui attendait son contrôle de sortie', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(lot('EN_ATTENTE_QC') as any);

    const res = await qualityControlService.createQualityControl({
      ...input,
      resultat: 'CONFORME',
    });

    expect(res.statut_lot).toBe('EN_STOCK');
    expect(prisma.batch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ version: 3 }),
        data: expect.objectContaining({ statut: 'EN_STOCK' }),
      })
    );
  });

  it('un contrôle NON CONFORME place le lot en quarantaine', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(lot('EN_ATTENTE_QC') as any);

    const res = await qualityControlService.createQualityControl({
      ...input,
      resultat: 'NON_CONFORME',
    });

    expect(res.statut_lot).toBe('BLOQUE');
  });

  // ⚠️ LE test de cette feature. Un rappel produit est IRRÉVERSIBLE : si un contrôle qualité
  // pouvait libérer un lot rappelé, il suffirait d'un formulaire pour annuler un rappel sanitaire.
  it('un contrôle CONFORME ne libère JAMAIS un lot sous rappel', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(lot('ALERTE') as any);

    await expect(
      qualityControlService.createQualityControl({ ...input, resultat: 'CONFORME' })
    ).rejects.toThrow(APIError);

    expect(prisma.batch.updateMany).not.toHaveBeenCalled();
    expect(prisma.qualityControl.create).not.toHaveBeenCalled();
  });

  it('un contrôle NON CONFORME ne rétrograde PAS un lot sous rappel en simple quarantaine', async () => {
    // Sinon : ALERTE (irréversible) → BLOQUE (levable) → levée → le lot rappelé ressort.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(lot('ALERTE') as any);

    await expect(
      qualityControlService.createQualityControl({ ...input, resultat: 'NON_CONFORME' })
    ).rejects.toThrow(APIError);
  });

  it('un contrôle CONFORME ne lève PAS une quarantaine (elle a sa propre décision, avec motif)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(lot('BLOQUE') as any);

    await expect(
      qualityControlService.createQualityControl({ ...input, resultat: 'CONFORME' })
    ).rejects.toThrow(APIError);
  });

  it('sur un lot déjà en stock, le contrôle est enregistré sans changer son statut', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(lot('EN_STOCK') as any);

    const res = await qualityControlService.createQualityControl({
      ...input,
      resultat: 'CONFORME',
    });

    expect(res.statut_lot).toBe('EN_STOCK');
    expect(prisma.batch.updateMany).not.toHaveBeenCalled();
    expect(prisma.qualityControl.create).toHaveBeenCalled();
  });

  it('refuse si le statut du lot a changé pendant la saisie (verrou optimiste)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(lot('EN_ATTENTE_QC') as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.updateMany).mockResolvedValue({ count: 0 } as any);

    await expect(
      qualityControlService.createQualityControl({ ...input, resultat: 'CONFORME' })
    ).rejects.toThrow(APIError);
  });

  it('refuse un lot d’une autre organisation', async () => {
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(null);

    await expect(
      qualityControlService.createQualityControl({ ...input, resultat: 'CONFORME' })
    ).rejects.toThrow(APIError);
  });

  it('trace le contrôle dans l’historique du lot', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(lot('EN_ATTENTE_QC') as any);

    await qualityControlService.createQualityControl({ ...input, resultat: 'CONFORME' });

    expect(prisma.batch_Mouvement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type_action: 'CONTROLE_QUALITE',
        id_user: 'user-qualite',
        metadata: expect.objectContaining({
          resultat: 'CONFORME',
          statut_precedent: 'EN_ATTENTE_QC',
          statut_resultant: 'EN_STOCK',
        }),
      }),
    });
  });
});
