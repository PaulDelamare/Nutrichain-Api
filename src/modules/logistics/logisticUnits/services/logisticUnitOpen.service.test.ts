import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logisticUnitService } from './logisticUnit.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { auditService } from '../../../../shared/utils/audit/audit.service';
import { logger } from '../../../../shared/utils/logger/logger';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    batch: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    batch_Mouvement: { create: vi.fn(), createMany: vi.fn() },
    equipment: { findFirst: vi.fn() },
    logistic_Unit: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    logistic_Unit_Content: {
      createMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
    ePCIS_Event: { create: vi.fn() },
    organization: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (cb) => cb(prisma)),
  },
}));

vi.mock('../../../../shared/utils/audit/audit.service', () => ({
  auditService: { logAction: vi.fn() },
}));

vi.mock('../../../../shared/utils/logger/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const ORG = 'org-1';
const USER = 'user-1';
const SSCC = '380123400000000428';

const contenu = () => [
  {
    id_lot: 'lot-1',
    quantite: 30,
    unite: 'kg',
    lot: {
      id: 'lot-1',
      lot_number: '260729-AAAAAA',
      statut: 'EN_STOCK',
      produit: { code_gtin: '3401579800012' },
      unite_code: 'kg',
    },
  },
  {
    id_lot: 'lot-2',
    quantite: 20,
    unite: 'kg',
    lot: {
      id: 'lot-2',
      lot_number: '260729-BBBBBB',
      statut: 'EN_STOCK',
      produit: { code_gtin: '3401579800029' },
      unite_code: 'kg',
    },
  },
];

const palette = (overrides: Record<string, unknown> = {}) => ({
  id: 'palette-1',
  organization_id: ORG,
  sscc: SSCC,
  source: 'INTERNE',
  opened_at: null,
  opened_by: null,
  contenu: contenu(),
  liaisons: [],
  ...overrides,
});

describe('logisticUnitService.openLogisticUnit — ouvrir une palette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      gs1_company_prefix: '3456789',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.logistic_Unit.updateMany).mockResolvedValue({ count: 1 } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.logistic_Unit_Content.deleteMany).mockResolvedValue({ count: 2 } as any);
  });

  describe('cloisonnement', () => {
    it('refuse en 404 une palette absente, et cherche AVEC son organisation', async () => {
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(null);

      await expect(logisticUnitService.openLogisticUnit('palette-1', ORG, USER)).rejects.toMatchObject(
        { status: 404 }
      );

      // Sans cette assertion, retirer `organization_id` du where laisserait le test vert : la
      // palette d'un tenant voisin serait ouverte, et rien ne rougirait.
      expect(prisma.logistic_Unit.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'palette-1', organization_id: ORG }),
        })
      );
    });

    it('supprime le contenu en filtrant par la relation, pas par le seul identifiant de palette', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(palette() as any);

      await logisticUnitService.openLogisticUnit('palette-1', ORG, USER);

      expect(prisma.logistic_Unit_Content.deleteMany).toHaveBeenCalledWith({
        where: {
          id_unite_logistique: 'palette-1',
          unite_logistique: { organization_id: ORG },
        },
      });
    });

    it("marque l'ouverture en filtrant sur l'organisation ET sur l'absence d'ouverture", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(palette() as any);

      await logisticUnitService.openLogisticUnit('palette-1', ORG, USER);

      expect(prisma.logistic_Unit.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'palette-1', organization_id: ORG, opened_at: null },
        })
      );
    });
  });

  describe('gardes', () => {
    // Idempotent, pas refusé : sur un quai, un appui suivi d'un timeout réseau est courant, et
    // répondre en erreur à un geste qui a réussi enverrait chercher un problème inexistant.
    it('rejoue une ouverture sans rien resceller, et le dit', async () => {
      const dateOuverture = new Date('2026-07-30T10:00:00Z');
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        palette({ opened_at: dateOuverture, opened_by: 'user-9' }) as any
      );

      const resultat = await logisticUnitService.openLogisticUnit('palette-1', ORG, USER);

      expect(resultat).toMatchObject({ lots_detaches: 0, ouverte_le: dateOuverture });
      expect(prisma.logistic_Unit.updateMany).not.toHaveBeenCalled();
      expect(prisma.logistic_Unit_Content.deleteMany).not.toHaveBeenCalled();
      expect(auditService.logAction).not.toHaveBeenCalled();
      expect(prisma.ePCIS_Event.create).not.toHaveBeenCalled();
    });

    // Contenu NON vide, volontairement : avec une palette vide, ce test resterait vert en
    // demontant la garde « deja expediee », puisque la garde « palette vide » rendrait le meme
    // 409. La mutation l'a demontre — seule cette forme prouve la bonne garde.
    it('refuse en 409 une palette deja partie sur une expedition, en le disant', async () => {
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        palette({ liaisons: [{ id: 'liaison-1' }] }) as any
      );

      const erreur = await logisticUnitService
        .openLogisticUnit('palette-1', ORG, USER)
        .catch((e) => e);

      expect(erreur).toMatchObject({ status: 409 });
      expect(JSON.stringify(erreur.data ?? erreur)).toContain('expédition');
      expect(prisma.logistic_Unit_Content.deleteMany).not.toHaveBeenCalled();
    });

    // Une palette videe lot par lot n'avait AUCUNE issue : ni rangeable, ni expediable, ni
    // supprimable, ni remplissable, et son etiquette restait imprimable. Ouvrir est le geste qui
    // la clot.
    it('ouvre une palette vide — c est la seule sortie d un contenant vide a la main', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(palette({ contenu: [] }) as any);

      const resultat = await logisticUnitService.openLogisticUnit('palette-1', ORG, USER);

      expect(resultat).toMatchObject({ lots_detaches: 0 });
      expect(prisma.logistic_Unit.updateMany).toHaveBeenCalled();
      // Le geste est scelle — c'est un changement d'etat reel — mais aucun evenement GS1 : un
      // AggregationEvent DELETE a liste vide n'annonce rien.
      expect(auditService.logAction).toHaveBeenCalled();
      expect(prisma.ePCIS_Event.create).not.toHaveBeenCalled();
    });

    it('refuse en 409 quand une ouverture concurrente a gagne, sans rien sceller', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(palette() as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.logistic_Unit.updateMany).mockResolvedValue({ count: 0 } as any);

      await expect(
        logisticUnitService.openLogisticUnit('palette-1', ORG, USER)
      ).rejects.toMatchObject({ status: 409 });

      expect(prisma.logistic_Unit_Content.deleteMany).not.toHaveBeenCalled();
      expect(auditService.logAction).not.toHaveBeenCalled();
      expect(prisma.ePCIS_Event.create).not.toHaveBeenCalled();
    });
  });

  describe('effets', () => {
    it('garde une photo du contenu, quantites comprises, avant de le supprimer', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(palette() as any);

      await logisticUnitService.openLogisticUnit('palette-1', ORG, USER);

      const appel = vi.mocked(prisma.logistic_Unit.updateMany).mock.calls[0][0];
      expect(appel.data).toMatchObject({
        opened_by: USER,
        contenu_a_l_ouverture: [
          { id_lot: 'lot-1', lot_number: '260729-AAAAAA', quantite: 30, unite: 'kg' },
          { id_lot: 'lot-2', lot_number: '260729-BBBBBB', quantite: 20, unite: 'kg' },
        ],
      });
      expect(appel.data).toHaveProperty('opened_at');
    });

    it('emet un AggregationEvent DELETE qui ferme la containment ouverte a la palettisation', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(palette() as any);

      await logisticUnitService.openLogisticUnit('palette-1', ORG, USER);

      const evenement = vi.mocked(prisma.ePCIS_Event.create).mock.calls[0][0];
      expect(evenement.data).toMatchObject({
        organization_id: ORG,
        event_type: 'AggregationEvent',
        related_entity: 'Logistic_Unit',
        related_id: 'palette-1',
      });
      // buildSsccUrn recompose l'URN et ne contient PAS le SSCC brut : on attend la forme exacte.
      expect(evenement.data.payload).toMatchObject({
        parentID: 'urn:epc:id:sscc:3456789.3000000042',
        action: 'DELETE',
        bizStep: 'urn:epcglobal:cbv:bizstep:unpacking',
      });
      expect(evenement.data.payload.childQuantityList).toHaveLength(2);
    });

    it('scelle le maillon d audit DANS la transaction, avec les quantites detachees', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(palette() as any);

      await logisticUnitService.openLogisticUnit('palette-1', ORG, USER);

      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG,
          userId: USER,
          action: 'OPEN_LOGISTIC_UNIT',
          entity: 'Logistic_Unit',
          entityId: 'palette-1',
          newValue: expect.objectContaining({
            sscc: SSCC,
            lots: [
              { id_lot: 'lot-1', quantite: 30, unite: 'kg' },
              { id_lot: 'lot-2', quantite: 20, unite: 'kg' },
            ],
          }),
        }),
        expect.anything()
      );
    });

    it('rend le SSCC brut en parentID pour une palette FOURNISSEUR, dont le prefixe n est pas le notre', async () => {
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        palette({ source: 'FOURNISSEUR' }) as any
      );

      await logisticUnitService.openLogisticUnit('palette-1', ORG, USER);

      const evenement = vi.mocked(prisma.ePCIS_Event.create).mock.calls[0][0];
      expect(evenement.data.payload.parentID).toBe(SSCC);
    });

    it('rend le nombre de lots detaches', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(palette() as any);

      const resultat = await logisticUnitService.openLogisticUnit('palette-1', ORG, USER);

      expect(resultat).toMatchObject({ id: 'palette-1', sscc: SSCC, lots_detaches: 2 });
    });
  });

  describe('ce qu une palette ouverte ne permet plus', () => {
    const ouverte = () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      palette({ opened_at: new Date('2026-07-31T08:00:00Z'), opened_by: 'user-9', contenu: [] }) as any;

    it('ne se range plus — et le refus ne dit pas « palette vide », qui serait trompeur', async () => {
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(ouverte());
       
      vi.mocked(prisma.equipment.findFirst).mockResolvedValue({
        id: 'frigo-B',
        organization_id: ORG,
        type: 'FRIGO',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      await expect(
        logisticUnitService.moveLogisticUnit('palette-1', ORG, USER, 'frigo-B')
      ).rejects.toMatchObject({ status: 409 });

      const erreur = await logisticUnitService
        .moveLogisticUnit('palette-1', ORG, USER, 'frigo-B')
        .catch((e) => e);
      expect(JSON.stringify(erreur.data ?? erreur)).toContain('ouverte');
    });

    it("n'emet plus d'etiquette : deux supports pour un meme SSCC n'auraient aucun sens", async () => {
       
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue({
        sscc: SSCC,
        opened_at: new Date('2026-07-31T08:00:00Z'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      await expect(logisticUnitService.getSsccById('palette-1', ORG)).rejects.toMatchObject({
        status: 409,
      });
    });
  });

  describe('scan d une palette ouverte', () => {
    const paletteOuverte = () =>
      palette({
        contenu: [],
        opened_at: new Date('2026-07-31T08:00:00Z'),
        opened_by: 'user-9',
        contenu_a_l_ouverture: [
          { id_lot: 'lot-1', lot_number: '260729-AAAAAA', quantite: 30, unite: 'kg' },
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;

    const lotActuel = (overrides: Record<string, unknown> = {}) => [
      {
        id: 'lot-1',
        lot_number: '260729-AAAAAA',
        statut: 'EN_STOCK',
        date_peremption: null,
        id_materiel_actuel: 'frigo-A',
        produit: { nom: 'Lait 1L', code_gtin: '3401579800012' },
        contenus_palette: [],
        ...overrides,
      },
    ];

    it('rend la trace dans un champ DISTINCT du contenu, la palette ne portant plus rien', async () => {
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(paletteOuverte());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.batch.findMany).mockResolvedValue(lotActuel() as any);

      const resultat = await logisticUnitService.resolveBySscc(SSCC, ORG);

      expect(resultat.lots).toHaveLength(0);
      expect(resultat.dernier_contenu).toHaveLength(1);
      // La quantité porte son nom : c'est un repère historique, pas un état de stock.
      expect(resultat.dernier_contenu[0]).toMatchObject({ quantite_a_l_ouverture: 30 });
      // Une palette ouverte n'a plus de position : la déduire de sa trace la ferait « suivre »
      // un lot déplacé depuis.
      expect(resultat.id_materiel).toBeNull();
      // L'identité de l'auteur ne sort pas sur une route ouverte à tous les rôles.
      expect(resultat.ouverture).toEqual({ date: new Date('2026-07-31T08:00:00Z') });
    });

    it('signale un lot passe sous rappel APRES l ouverture — sinon c est un angle mort', async () => {
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(paletteOuverte());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.batch.findMany).mockResolvedValue(lotActuel({ statut: 'ALERTE' }) as any);

      const resultat = await logisticUnitService.resolveBySscc(SSCC, ORG);

      expect(resultat.contient_lot_rappele).toBe(true);
    });

    it('ecarte un lot repalettise ailleurs : deux SSCC ne revendiquent pas le meme lot', async () => {
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(paletteOuverte());
      vi.mocked(prisma.batch.findMany).mockResolvedValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lotActuel({ contenus_palette: [{ id_unite_logistique: 'palette-2' }] }) as any
      );

      const resultat = await logisticUnitService.resolveBySscc(SSCC, ORG);

      expect(resultat.dernier_contenu).toHaveLength(0);
    });

    // Le cas le plus dangereux des trois : un lot parti chez un client puis rappele ferait
    // chercher sur un quai une marchandise qui est en rayon.
    it('ecarte un lot expedie : il a quitte le site', async () => {
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(paletteOuverte());
      vi.mocked(prisma.batch.findMany).mockResolvedValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lotActuel({ statut: 'EXPEDIE' }) as any
      );

      const resultat = await logisticUnitService.resolveBySscc(SSCC, ORG);

      expect(resultat.dernier_contenu).toHaveLength(0);
      expect(resultat.contient_lot_rappele).toBe(false);
    });

    it('ecarte un lot mis au rebut : il n y a plus rien a chercher sur le quai', async () => {
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(paletteOuverte());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.batch.findMany).mockResolvedValue(lotActuel({ statut: 'REBUT' }) as any);

      const resultat = await logisticUnitService.resolveBySscc(SSCC, ORG);

      expect(resultat.dernier_contenu).toHaveLength(0);
    });

    // Une trace partiellement illisible fait afficher MOINS de marchandise qu'il n'y en a. On ne
    // casse pas le scan pour autant, mais un affichage sanitaire incomplet ne doit pas etre muet.
    it('signale une trace partiellement illisible au lieu de la degrader en silence', async () => {
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(
        palette({
          contenu: [],
          opened_at: new Date('2026-07-31T08:00:00Z'),
          contenu_a_l_ouverture: [
            { id_lot: 'lot-1', lot_number: '260729-AAAAAA', quantite: 30, unite: 'kg' },
            { casse: true },
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.batch.findMany).mockResolvedValue(lotActuel() as any);

      await logisticUnitService.resolveBySscc(SSCC, ORG);

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(SSCC));
    });

    it('relit les lots DANS leur organisation', async () => {
      vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(paletteOuverte());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.batch.findMany).mockResolvedValue(lotActuel() as any);

      await logisticUnitService.resolveBySscc(SSCC, ORG);

      expect(prisma.batch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organization_id: ORG }),
        })
      );
    });
  });
});
