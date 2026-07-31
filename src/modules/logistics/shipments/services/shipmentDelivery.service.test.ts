import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shipmentService } from './shipment.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { auditService } from '../../../../shared/utils/audit/audit.service';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    shipment: { findFirst: vi.fn(), updateMany: vi.fn() },
    audit_Log: { findFirst: vi.fn() },
    liaison_Shipment: { findMany: vi.fn() },
    batch_Mouvement: { createMany: vi.fn() },
    ePCIS_Event: { create: vi.fn() },
    $transaction: vi.fn(async (cb) => cb(prisma)),
  },
}));

vi.mock('../../../../shared/utils/audit/audit.service', () => ({
  auditService: { logAction: vi.fn() },
}));

const ORG = 'org-1';
const USER = 'user-1';
const DEPART = new Date('2026-07-28T09:00:00Z');

const expedition = (overrides: Record<string, unknown> = {}) => ({
  id: 'exp-1',
  organization_id: ORG,
  shipment_id: 'BL-2026-001',
  date_envoi: DEPART,
  statut_livraison: 'EN_ROUTE',
  date_livraison: null,
  delivered_by: null,
  delivered_by_label: null,
  ...overrides,
});

const liaisons = () => [
  { id_lot: 'lot-1', quantite_expediee: 30, unite: 'kg' },
  { id_lot: 'lot-2', quantite_expediee: 20, unite: 'kg' },
];

describe('shipmentService.confirmDelivery — constater une arrivée', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.shipment.updateMany).mockResolvedValue({ count: 1 } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.liaison_Shipment.findMany).mockResolvedValue(liaisons() as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch_Mouvement.createMany).mockResolvedValue({ count: 2 } as any);
  });

  describe('cloisonnement', () => {
    it('refuse en 404 une expédition absente, et cherche AVEC son organisation', async () => {
      vi.mocked(prisma.shipment.findFirst).mockResolvedValue(null);

      await expect(
        shipmentService.confirmDelivery('exp-1', ORG, { userId: USER })
      ).rejects.toMatchObject({ status: 404 });

      expect(prisma.shipment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'exp-1', organization_id: ORG }),
        })
      );
    });

    it("marque la livraison en filtrant sur l'organisation ET sur l'état attendu", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.shipment.findFirst).mockResolvedValue(expedition() as any);

      await shipmentService.confirmDelivery('exp-1', ORG, { userId: USER });

      expect(prisma.shipment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'exp-1', organization_id: ORG, statut_livraison: 'EN_ROUTE' },
        })
      );
    });

    it('relit les lignes du bon en filtrant par la relation, pas par le seul identifiant', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.shipment.findFirst).mockResolvedValue(expedition() as any);

      await shipmentService.confirmDelivery('exp-1', ORG, { userId: USER });

      expect(prisma.liaison_Shipment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id_expedition: 'exp-1',
            expedition: { organization_id: ORG },
          }),
        })
      );
    });
  });

  describe('gardes', () => {
    it('refuse une date de livraison antérieure au départ', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.shipment.findFirst).mockResolvedValue(expedition() as any);

      await expect(
        shipmentService.confirmDelivery('exp-1', ORG, {
          userId: USER,
          dateLivraison: new Date('2026-07-27T09:00:00Z'),
        })
      ).rejects.toMatchObject({ status: 400 });

      expect(prisma.shipment.updateMany).not.toHaveBeenCalled();
    });

    it('refuse une date de livraison dans le futur', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.shipment.findFirst).mockResolvedValue(expedition() as any);

      await expect(
        shipmentService.confirmDelivery('exp-1', ORG, {
          userId: USER,
          dateLivraison: new Date(Date.now() + 86_400_000),
        })
      ).rejects.toMatchObject({ status: 400 });
    });

    it('refuse en 409 quand une confirmation concurrente a gagné, sans rien sceller', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.shipment.findFirst).mockResolvedValue(expedition() as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.shipment.updateMany).mockResolvedValue({ count: 0 } as any);

      await expect(
        shipmentService.confirmDelivery('exp-1', ORG, { userId: USER })
      ).rejects.toMatchObject({ status: 409 });

      expect(auditService.logAction).not.toHaveBeenCalled();
      expect(prisma.batch_Mouvement.createMany).not.toHaveBeenCalled();
    });
  });

  describe('rejeu', () => {
    const dejaLivree = () =>
      expedition({
        statut_livraison: 'LIVRE',
        date_livraison: new Date('2026-07-29T14:00:00Z'),
        delivered_by: USER,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;

    it('le même auteur rejoue sans rien resceller — un double appui n’est pas une erreur', async () => {
      vi.mocked(prisma.shipment.findFirst).mockResolvedValue(dejaLivree());

      const resultat = await shipmentService.confirmDelivery('exp-1', ORG, { userId: USER });

      expect(resultat).toMatchObject({ date_livraison: new Date('2026-07-29T14:00:00Z') });
      expect(prisma.shipment.updateMany).not.toHaveBeenCalled();
      expect(auditService.logAction).not.toHaveBeenCalled();
    });

    /**
     * Un AUTRE acteur qui confirme une livraison déjà constatée n'est pas un double appui : c'est
     * un désaccord, et c'est exactement ce qu'on veut retrouver lors d'un litige transporteur.
     */
    it('un autre auteur laisse une trace, sans changer la date retenue', async () => {
      vi.mocked(prisma.shipment.findFirst).mockResolvedValue(dejaLivree());
      vi.mocked(prisma.audit_Log.findFirst).mockResolvedValue(null);

      await shipmentService.confirmDelivery('exp-1', ORG, { userId: 'user-9' });

      expect(prisma.shipment.updateMany).not.toHaveBeenCalled();
      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CONFIRM_SHIPMENT_DELIVERY_REJOUEE',
          userId: 'user-9',
        }),
        expect.anything()
      );
    });

    /**
     * Un maillon par DÉSACCORD, pas un par appel. Sans dédoublonnage, n'importe quel `operator`
     * remplissait la chaîne WORM de l'organisation à coups de requêtes sans effet — et comme cette
     * chaîne est unique et sérialisée, les écritures légitimes finissaient par épuiser leurs
     * tentatives de rejeu.
     */
    it('ne rescelle pas le même désaccord à chaque appel', async () => {
      vi.mocked(prisma.shipment.findFirst).mockResolvedValue(dejaLivree());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.audit_Log.findFirst).mockResolvedValue({ id: 1 } as any);

      await shipmentService.confirmDelivery('exp-1', ORG, { userId: 'user-9' });

      expect(auditService.logAction).not.toHaveBeenCalled();
    });

    it('borne et normalise le nom d’un confirmant sans compte', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.shipment.findFirst).mockResolvedValue(expedition() as any);

      await shipmentService.confirmDelivery('exp-1', ORG, { label: `  ${'M'.repeat(200)}  ` });

      const appel = vi.mocked(prisma.shipment.updateMany).mock.calls[0][0];
      // Ce champ finit dans une colonne texte ET dans un maillon WORM indélébile : il se borne au
      // commit qui l'introduit, pas au premier appelant qui le branchera.
      expect((appel.data as { delivered_by_label: string }).delivered_by_label).toHaveLength(120);
    });
  });

  describe('effets', () => {
    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.shipment.findFirst).mockResolvedValue(expedition() as any);
    });

    it('écrit la date, l’auteur et le statut ensemble', async () => {
      await shipmentService.confirmDelivery('exp-1', ORG, { userId: USER });

      const appel = vi.mocked(prisma.shipment.updateMany).mock.calls[0][0];
      expect(appel.data).toMatchObject({ statut_livraison: 'LIVRE', delivered_by: USER });
      expect(appel.data).toHaveProperty('date_livraison');
    });

    it('accepte un confirmant sans compte, nommé — c’est ce que le transporteur sera', async () => {
      await shipmentService.confirmDelivery('exp-1', ORG, { label: 'Transports Martin' });

      const appel = vi.mocked(prisma.shipment.updateMany).mock.calls[0][0];
      expect(appel.data).toMatchObject({
        delivered_by: null,
        delivered_by_label: 'Transports Martin',
      });
    });

    it('refuse une confirmation sans aucun auteur', async () => {
      await expect(shipmentService.confirmDelivery('exp-1', ORG, {})).rejects.toMatchObject({
        status: 400,
      });
    });

    /**
     * Sans ce maillon, la frise d'un lot s'arrête à EXPEDITION : le décideur qui l'ouvre pendant un
     * rappel ne sait pas si la marchandise est arrivée. C'est le défaut #283, un cran plus bas.
     */
    it('écrit un mouvement LIVRAISON par lot du bon', async () => {
      await shipmentService.confirmDelivery('exp-1', ORG, { userId: USER });

      const appel = vi.mocked(prisma.batch_Mouvement.createMany).mock.calls[0][0];
      expect(appel.data).toHaveLength(2);
      expect(appel.data[0]).toMatchObject({
        id_lot: 'lot-1',
        type_action: 'LIVRAISON',
        id_expedition: 'exp-1',
        quantite: 30,
      });
    });

    it('scelle le maillon d’audit DANS la transaction', async () => {
      await shipmentService.confirmDelivery('exp-1', ORG, { userId: USER });

      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG,
          userId: USER,
          action: 'CONFIRM_SHIPMENT_DELIVERY',
          entity: 'Shipment',
          entityId: 'exp-1',
        }),
        expect.anything()
      );
    });

    /**
     * Aucun événement GS1 : un `receiving` émis par l'EXPÉDITEUR dirait « cette organisation a reçu
     * la marchandise » alors qu'elle vient de s'en séparer, et il ne pourrait porter ni epcList ni
     * parentID — rien ne persiste si la référence d'expédition est un SSCC que nous avons émis.
     */
    it('n’émet aucun événement EPCIS', async () => {
      await shipmentService.confirmDelivery('exp-1', ORG, { userId: USER });

      expect(prisma.ePCIS_Event.create).not.toHaveBeenCalled();
    });
  });
});
