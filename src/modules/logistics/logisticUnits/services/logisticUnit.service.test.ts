import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logisticUnitService } from './logisticUnit.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { auditService } from '../../../../shared/utils/audit/audit.service';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    batch: { findMany: vi.fn() },
    logistic_Unit: { create: vi.fn(), findFirst: vi.fn() },
    logistic_Unit_Content: { createMany: vi.fn(), findMany: vi.fn() },
    ePCIS_Event: { create: vi.fn() },
    organization: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (cb) => cb(prisma)),
  },
}));

vi.mock('../../../../shared/utils/audit/audit.service', () => ({
  auditService: { logAction: vi.fn() },
}));

const ORG = 'org-1';
const USER = 'user-1';

const lotBeurre = {
  id: 'lot-1',
  organization_id: ORG,
  lot_number: '260729-AAAAAA',
  statut: 'EN_STOCK',
  quantite_actuelle: 100,
  unite_code: 'kg',
  produit: { code_gtin: '3401234567890' },
};
const lotCreme = {
  ...lotBeurre,
  id: 'lot-2',
  lot_number: '260729-BBBBBB',
  statut: 'EN_ATTENTE_QC',
};

describe('logisticUnitService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Préfixe entreprise GS1 de l'organisation, lu par `resolveGs1Prefix`.
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      gs1_company_prefix: '3801234',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // `nextval` de la séquence SSCC.
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ serial: 42n }] as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.logistic_Unit.create).mockResolvedValue({ id: 'palette-1' } as any);
    // Par défaut aucun lot n'est déjà sur une palette.
    vi.mocked(prisma.logistic_Unit_Content.findMany).mockResolvedValue([] as never);
  });

  describe('createLogisticUnit — constituer une palette', () => {
    it('attribue un SSCC à la palettisation et enregistre son contenu', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.batch.findMany).mockResolvedValue([lotBeurre, lotCreme] as any);

      const result = await logisticUnitService.createLogisticUnit({
        organizationId: ORG,
        userId: USER,
        items: [
          { id_lot: 'lot-1', quantite: 40 },
          { id_lot: 'lot-2', quantite: 25 },
        ],
      });

      // Le SSCC fait 18 chiffres, clé de contrôle comprise — c'est ce qui sera imprimé.
      expect(result.sscc).toMatch(/^\d{18}$/);
      expect(prisma.logistic_Unit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organization_id: ORG,
            created_by: USER,
            source: 'INTERNE',
            sscc: result.sscc,
          }),
        })
      );
      expect(prisma.logistic_Unit_Content.createMany).toHaveBeenCalledWith({
        data: [
          { id_unite_logistique: 'palette-1', id_lot: 'lot-1', quantite: 40, unite: 'kg' },
          { id_unite_logistique: 'palette-1', id_lot: 'lot-2', quantite: 25, unite: 'kg' },
        ],
      });
    });

    it('émet un AggregationEvent au bizStep packing — la palette est agrégée AVANT tout départ', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.batch.findMany).mockResolvedValue([lotBeurre] as any);

      await logisticUnitService.createLogisticUnit({
        organizationId: ORG,
        userId: USER,
        items: [{ id_lot: 'lot-1', quantite: 10 }],
      });

      expect(prisma.ePCIS_Event.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organization_id: ORG,
            event_type: 'AggregationEvent',
            payload: expect.objectContaining({
              action: 'ADD',
              bizStep: 'urn:epcglobal:cbv:bizstep:packing',
              parentID: expect.stringContaining('urn:epc:id:sscc:'),
            }),
          }),
        })
      );
    });

    it('scelle un maillon d’audit dans la MÊME transaction', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.batch.findMany).mockResolvedValue([lotBeurre] as any);

      await logisticUnitService.createLogisticUnit({
        organizationId: ORG,
        userId: USER,
        items: [{ id_lot: 'lot-1', quantite: 10 }],
      });

      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG,
          userId: USER,
          action: 'CREATE_LOGISTIC_UNIT',
          entity: 'Logistic_Unit',
          entityId: 'palette-1',
        }),
        expect.anything()
      );
    });

    it('refuse (404) un lot qui n’appartient pas à l’organisation active', async () => {
      // La requête filtre par organisation : le lot d'un autre tenant ne remonte pas.
      vi.mocked(prisma.batch.findMany).mockResolvedValue([] as never);

      const action = logisticUnitService.createLogisticUnit({
        organizationId: ORG,
        userId: USER,
        items: [{ id_lot: 'lot-autre-org', quantite: 10 }],
      });

      await expect(action).rejects.toMatchObject({ status: 404 });
      expect(prisma.logistic_Unit.create).not.toHaveBeenCalled();
    });

    it('refuse (409) un lot bloqué : une palette ne mélange pas du sain et du consigné', async () => {
      vi.mocked(prisma.batch.findMany).mockResolvedValue([
        { ...lotBeurre, statut: 'BLOQUE' },
      ] as never);

      const action = logisticUnitService.createLogisticUnit({
        organizationId: ORG,
        userId: USER,
        items: [{ id_lot: 'lot-1', quantite: 10 }],
      });

      await expect(action).rejects.toMatchObject({ status: 409 });
      expect(prisma.logistic_Unit.create).not.toHaveBeenCalled();
    });

    it('refuse (400) une quantité supérieure à ce que le lot porte', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.batch.findMany).mockResolvedValue([lotBeurre] as any);

      const action = logisticUnitService.createLogisticUnit({
        organizationId: ORG,
        userId: USER,
        items: [{ id_lot: 'lot-1', quantite: 999 }],
      });

      await expect(action).rejects.toMatchObject({ status: 400 });
      expect(prisma.logistic_Unit.create).not.toHaveBeenCalled();
    });

    /**
     * La position d'un lot est UNE valeur. Un lot présent sur deux palettes rangées dans deux
     * frigos déclarerait la position de la dernière rangée alors qu'une partie est ailleurs, et
     * l'excursion sur l'autre frigo ne le mettrait pas en quarantaine — faux négatif sanitaire,
     * silencieux. Aucune garde applicative ne peut le rattraper : deux palettes ne portant que le
     * même lot sont indiscernables dans ce modèle. D'où la contrainte en base, doublée ici d'un
     * message exploitable.
     */
    it('refuse (409) un lot déjà posé sur une autre palette, en nommant laquelle', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.batch.findMany).mockResolvedValue([lotBeurre] as any);
      vi.mocked(prisma.logistic_Unit_Content.findMany).mockResolvedValue([
        {
          id_lot: 'lot-1',
          unite_logistique: { sscc: '380123400000000411' },
          lot: { lot_number: '260729-AAAAAA' },
        },
      ] as never);

      const action = logisticUnitService.createLogisticUnit({
        organizationId: ORG,
        userId: USER,
        items: [{ id_lot: 'lot-1', quantite: 10 }],
      });

      await expect(action).rejects.toMatchObject({
        status: 409,
        // Le message doit dire OÙ est le lot : un 409 nu n'aide pas l'opérateur.
        body: { error: [{ message: expect.stringContaining('380123400000000411') }] },
      });
      expect(prisma.logistic_Unit.create).not.toHaveBeenCalled();
    });

    it('refuse (400) le même lot deux fois — la clé primaire composite l’interdirait en base', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.batch.findMany).mockResolvedValue([lotBeurre] as any);

      const action = logisticUnitService.createLogisticUnit({
        organizationId: ORG,
        userId: USER,
        items: [
          { id_lot: 'lot-1', quantite: 10 },
          { id_lot: 'lot-1', quantite: 5 },
        ],
      });

      await expect(action).rejects.toMatchObject({ status: 400 });
      expect(prisma.logistic_Unit.create).not.toHaveBeenCalled();
    });
  });

  describe('resolveBySscc — scanner une palette', () => {
    it('rend la palette et son contenu', async () => {
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue({
        id: 'palette-1',
        sscc: '380123400000000428',
        source: 'INTERNE',
        created_at: new Date('2026-07-29T10:00:00Z'),
        contenu: [
          {
            quantite: 40,
            unite: 'kg',
            lot: {
              id: 'lot-1',
              lot_number: '260729-AAAAAA',
              statut: 'EN_STOCK',
              date_peremption: null,
              produit: { nom: 'Beurre doux', code_gtin: '3401234567890' },
            },
          },
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = await logisticUnitService.resolveBySscc('380123400000000428', ORG);

      expect(result.sscc).toBe('380123400000000428');
      expect(result.lots).toHaveLength(1);
      expect(result.lots[0].numero_lot).toBe('260729-AAAAAA');
      expect(result.contient_lot_rappele).toBe(false);
    });

    it('signale un lot passé en rappel après la palettisation', async () => {
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue({
        id: 'palette-1',
        sscc: '380123400000000428',
        source: 'INTERNE',
        created_at: new Date(),
        contenu: [
          {
            quantite: 40,
            unite: 'kg',
            lot: {
              id: 'lot-1',
              lot_number: '260729-AAAAAA',
              statut: 'ALERTE',
              date_peremption: null,
              produit: { nom: 'Beurre doux', code_gtin: '3401234567890' },
            },
          },
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = await logisticUnitService.resolveBySscc('380123400000000428', ORG);

      expect(result.contient_lot_rappele).toBe(true);
    });

    /**
     * Après avoir rangé, l'opérateur rescanne le SSCC pour vérifier. Sans la position dans la
     * réponse, il n'a aucun moyen de lever le doute — l'écran lui affiche un contenu, pas un lieu.
     */
    it('rend la position de la palette quand tous ses lots la partagent', async () => {
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue({
        id: 'palette-1',
        sscc: '380123400000000428',
        source: 'INTERNE',
        created_at: new Date(),
        contenu: [
          {
            quantite: 40,
            unite: 'kg',
            lot: {
              id: 'lot-1',
              lot_number: '260729-AAAAAA',
              statut: 'EN_STOCK',
              date_peremption: null,
              id_materiel_actuel: 'frigo-B',
              produit: { nom: 'Beurre doux', code_gtin: '3401234567890' },
            },
          },
          {
            quantite: 10,
            unite: 'kg',
            lot: {
              id: 'lot-2',
              lot_number: '260729-BBBBBB',
              statut: 'EN_STOCK',
              date_peremption: null,
              id_materiel_actuel: 'frigo-B',
              produit: { nom: 'Beurre demi-sel', code_gtin: '3401234567891' },
            },
          },
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = await logisticUnitService.resolveBySscc('380123400000000428', ORG);

      expect(result.id_materiel).toBe('frigo-B');
      expect(result.positions_divergentes).toBe(false);
    });

    it('signale des positions divergentes plutôt que d’en inventer une', async () => {
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue({
        id: 'palette-1',
        sscc: '380123400000000428',
        source: 'INTERNE',
        created_at: new Date(),
        contenu: [
          {
            quantite: 40,
            unite: 'kg',
            lot: {
              id: 'lot-1',
              lot_number: '260729-AAAAAA',
              statut: 'EN_STOCK',
              date_peremption: null,
              id_materiel_actuel: 'frigo-B',
              produit: { nom: 'Beurre doux', code_gtin: '3401234567890' },
            },
          },
          {
            quantite: 10,
            unite: 'kg',
            lot: {
              id: 'lot-2',
              lot_number: '260729-BBBBBB',
              statut: 'EN_STOCK',
              date_peremption: null,
              id_materiel_actuel: 'frigo-C',
              produit: { nom: 'Beurre demi-sel', code_gtin: '3401234567891' },
            },
          },
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = await logisticUnitService.resolveBySscc('380123400000000428', ORG);

      expect(result.id_materiel).toBeNull();
      expect(result.positions_divergentes).toBe(true);
    });

    it('filtre par organisation : le SSCC d’un autre tenant est introuvable (404)', async () => {
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(null);

      const action = logisticUnitService.resolveBySscc('380123400000000428', ORG);

      await expect(action).rejects.toMatchObject({ status: 404 });
      expect(prisma.logistic_Unit.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organization_id: ORG }),
        })
      );
    });
  });

  describe('getSsccById — ce que l’étiquette doit encoder', () => {
    it('rend le SSCC de la palette', async () => {
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue({
        sscc: '380123400000000428',
      } as never);

      const sscc = await logisticUnitService.getSsccById('palette-1', ORG);

      expect(sscc).toBe('380123400000000428');
    });

    it('cloisonne : la palette d’un autre tenant est introuvable (404)', async () => {
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(null);

      const action = logisticUnitService.getSsccById('palette-1', ORG);

      await expect(action).rejects.toMatchObject({ status: 404 });
      // Sans ce filtre, un identifiant de palette deviné imprimerait le SSCC d'un voisin.
      expect(prisma.logistic_Unit.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'palette-1', organization_id: ORG } })
      );
    });
  });
});
