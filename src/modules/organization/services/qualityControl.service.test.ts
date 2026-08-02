import { describe, it, expect, vi, beforeEach } from 'vitest';
import { qualityControlService } from './qualityControl.service';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../shared/utils/audit/audit.service';

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    batch: { findFirst: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    qualityControl: { create: vi.fn() },
    batch_Mouvement: { create: vi.fn() },
    member: { findFirst: vi.fn() },
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
    // `Batch.created_by` est NOT NULL en base : un mock sans lui testerait un monde imaginaire.
    created_by: 'operateur-2',
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
  // Par défaut l'organisation compte un second décideur : la séparation des tâches s'applique.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(prisma.member.findFirst).mockResolvedValue({ id: 'membre-qualite' } as any);
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

  /**
   * La contre-analyse d'un lot en quarantaine s'ENREGISTRE — c'est la preuve que la levée exigera —
   * mais elle ne libère rien : la levée est une décision distincte, tracée avec son motif.
   */
  it('un contrôle CONFORME s’enregistre sur un lot bloqué sans lever la quarantaine', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(lot('BLOQUE') as any);

    const res = await qualityControlService.createQualityControl({
      ...input,
      resultat: 'CONFORME',
    });

    expect(res.statut_lot).toBe('BLOQUE');
    expect(prisma.qualityControl.create).toHaveBeenCalled();
    expect(prisma.batch.updateMany).not.toHaveBeenCalled();
  });

  /**
   * Une SECONDE non-conformité sur un lot déjà bloqué ne doit rien réécrire : mémoriser `BLOQUE`
   * comme statut d'avant ferait restaurer le lot… en quarantaine, à la levée suivante.
   */
  it('ne réécrit pas le statut d’avant blocage sur un lot déjà bloqué', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(lot('BLOQUE') as any);

    const res = await qualityControlService.createQualityControl({
      ...input,
      resultat: 'NON_CONFORME',
    });

    expect(res.statut_lot).toBe('BLOQUE');
    expect(prisma.batch.updateMany).not.toHaveBeenCalled();
  });

  /**
   * Sans ce champ, la levée qualité ne sait pas où rendre le lot : un produit fini qui attendait son
   * contrôle de sortie repartirait EN_STOCK, donc expédiable sans avoir franchi la barrière HACCP.
   */
  it('mémorise le statut d’avant blocage quand un contrôle non conforme met en quarantaine', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(lot('EN_ATTENTE_QC') as any);

    await qualityControlService.createQualityControl({ ...input, resultat: 'NON_CONFORME' });

    expect(vi.mocked(prisma.batch.updateMany).mock.calls[0][0].data).toMatchObject({
      statut: 'BLOQUE',
      statut_avant_blocage: 'EN_ATTENTE_QC',
    });
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

  /**
   * Séparation des tâches HACCP : celui qui produit ne signe pas la libération de sa propre
   * production. La garde ne vise QUE la décision libératoire — un producteur doit rester
   * capable de bloquer son lot, sinon on décourage la remontée d'une non-conformité.
   */
  it("refuse qu'un lot soit libéré par celui qui l'a produit", async () => {
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...lot('EN_ATTENTE_QC'), created_by: 'user-qualite' } as any
    );

    await expect(
      qualityControlService.createQualityControl({ ...input, resultat: 'CONFORME' })
    ).rejects.toMatchObject({ status: 403 });

    expect(prisma.qualityControl.create).not.toHaveBeenCalled();
    expect(prisma.batch.updateMany).not.toHaveBeenCalled();
  });

  it('laisse le producteur déclarer SON lot non conforme', async () => {
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...lot('EN_ATTENTE_QC'), created_by: 'user-qualite' } as any
    );

    const res = await qualityControlService.createQualityControl({
      ...input,
      resultat: 'NON_CONFORME',
    });

    expect(res.statut_lot).toBe('BLOQUE');
  });

  /**
   * Sans cet échappement, une organisation d'un seul membre — l'état de TOUTE organisation à sa
   * création — verrait ses lots définitivement figés. On laisse passer, et l'audit porte la marque.
   */
  it("libère malgré tout, en le traçant, quand personne d'autre ne peut décider", async () => {
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...lot('EN_ATTENTE_QC'), created_by: 'user-qualite' } as any
    );
    vi.mocked(prisma.member.findFirst).mockResolvedValue(null);

    const res = await qualityControlService.createQualityControl({
      ...input,
      resultat: 'CONFORME',
    });

    expect(res.statut_lot).toBe('EN_STOCK');
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        newValue: expect.objectContaining({
          separation_des_taches: 'AUTO_SIGNEE_AUCUN_AUTRE_DECIDEUR',
        }),
      }),
      expect.anything()
    );
  });

  it("n'inscrit aucune mention de séparation quand la décision est prise par un tiers", async () => {
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lot('EN_ATTENTE_QC') as any
    );

    await qualityControlService.createQualityControl({ ...input, resultat: 'CONFORME' });

    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        newValue: expect.not.objectContaining({ separation_des_taches: expect.anything() }),
      }),
      expect.anything()
    );
  });

  it('laisse un tiers libérer le lot', async () => {
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...lot('EN_ATTENTE_QC'), created_by: 'un-autre-operateur' } as any
    );

    const res = await qualityControlService.createQualityControl({
      ...input,
      resultat: 'CONFORME',
    });

    expect(res.statut_lot).toBe('EN_STOCK');
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
