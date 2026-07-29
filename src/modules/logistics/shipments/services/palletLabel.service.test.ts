import { describe, it, expect, vi, beforeEach } from 'vitest';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { palletLabelService } from './palletLabel.service';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    shipment: { findFirst: vi.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prismaMock = (await import('../../../../shared/configs/prismaClient.config')).prisma as any;

const ORG = 'org-1';
const AUTRE_ORG = 'org-2';
const SSCC = '034567890000000422';

const expedition = {
  id: 'exp-1',
  organization_id: ORG,
  shipment_id: SSCC,
  transporteur: 'Transports Martin',
  date_envoi: new Date('2026-07-29T08:00:00Z'),
  statut_livraison: 'EN_TRANSIT',
  client: { nom_enseigne: 'Carrefour Rennes' },
  liaisons: [
    {
      quantite_expediee: 120,
      unite: 'KG',
      lot: {
        id: 'lot-1',
        lot_number: '260729-ABC123',
        statut: 'EXPEDIE',
        date_peremption: new Date('2026-08-29T21:59:59Z'),
        produit: { nom: 'Yaourt nature', code_gtin: '3042040209789' },
      },
    },
  ],
};

describe('palletLabelService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateLabel', () => {
    it('encode l AI 00 suivi du SSCC — le format que le parseur du mobile attend', async () => {
      prismaMock.shipment.findFirst.mockResolvedValue(expedition);

      const { png, code } = await palletLabelService.generateLabel('exp-1', ORG);

      expect(code).toBe(`00${SSCC}`);
      const image = PNG.sync.read(png);
      const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
      expect(decoded?.data).toBe(`00${SSCC}`);
    });

    it('rend un QR carre et decodable — meme exigence que l etiquette de lot (#272, #277)', async () => {
      prismaMock.shipment.findFirst.mockResolvedValue(expedition);

      const { png } = await palletLabelService.generateLabel('exp-1', ORG);
      const image = PNG.sync.read(png);

      expect(image.width).toBe(image.height);
      expect(jsQR(new Uint8ClampedArray(image.data), image.width, image.height)).not.toBeNull();
    });

    // Le filtre d'organisation est passé à Prisma, pas appliqué après coup : une expédition d'un
    // autre tenant ne doit pas être lue puis écartée, elle ne doit pas être lue.
    it('filtre par organisation dans la requete', async () => {
      prismaMock.shipment.findFirst.mockResolvedValue(expedition);

      await palletLabelService.generateLabel('exp-1', ORG);

      expect(prismaMock.shipment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'exp-1', organization_id: ORG } })
      );
    });

    it('leve un 404 quand l expedition appartient a une autre organisation', async () => {
      prismaMock.shipment.findFirst.mockResolvedValue(null);

      await expect(palletLabelService.generateLabel('exp-1', AUTRE_ORG)).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('resolveBySscc', () => {
    it('rend l expedition et les lots que la palette transporte', async () => {
      prismaMock.shipment.findFirst.mockResolvedValue(expedition);

      const resultat = await palletLabelService.resolveBySscc(SSCC, ORG);

      expect(resultat.sscc).toBe(SSCC);
      expect(resultat.client).toBe('Carrefour Rennes');
      expect(resultat.lots).toHaveLength(1);
      expect(resultat.lots[0]).toMatchObject({
        numero_lot: '260729-ABC123',
        produit: 'Yaourt nature',
        quantite: 120,
        unite: 'KG',
        statut: 'EXPEDIE',
      });
    });

    // Le SSCC arrive d'une caméra : `00` fait partie de l'element string, pas de l'identifiant.
    // Sans ce retrait, un scan parfaitement valide ne trouvait rien.
    it('accepte le code scanne avec son prefixe AI 00', async () => {
      prismaMock.shipment.findFirst.mockResolvedValue(expedition);

      await palletLabelService.resolveBySscc(`00${SSCC}`, ORG);

      expect(prismaMock.shipment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ shipment_id: SSCC, organization_id: ORG }),
        })
      );
    });

    // Le SSCC est un identifiant MONDIAL : sans filtre d'organisation, scanner la palette d'un
    // concurrent rendrait son client, ses produits et ses quantités. Le filtre est dans la
    // requête, pas appliqué après lecture.
    it('filtre par organisation dans la requete — un SSCC d un autre tenant ne se lit pas', async () => {
      prismaMock.shipment.findFirst.mockResolvedValue(expedition);

      await palletLabelService.resolveBySscc(SSCC, ORG);

      expect(prismaMock.shipment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { shipment_id: SSCC, organization_id: ORG } })
      );
    });

    it('leve un 404 orientee champ quand le SSCC est inconnu', async () => {
      prismaMock.shipment.findFirst.mockResolvedValue(null);

      let caught: unknown;
      try {
        await palletLabelService.resolveBySscc(SSCC, ORG);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(APIError);
      expect((caught as APIError).status).toBe(404);
      expect((caught as APIError).body.error[0].field).toBe('sscc');
    });

    // Un lot rappelé APRÈS l'expédition reste dans la palette : c'est précisément ce que le
    // destinataire doit voir en scannant, sinon le rappel ne devient jamais actionnable chez lui.
    it('remonte le statut ALERTE d un lot rappele apres coup', async () => {
      prismaMock.shipment.findFirst.mockResolvedValue({
        ...expedition,
        liaisons: [
          {
            ...expedition.liaisons[0],
            lot: { ...expedition.liaisons[0].lot, statut: 'ALERTE' },
          },
        ],
      });

      const resultat = await palletLabelService.resolveBySscc(SSCC, ORG);

      expect(resultat.lots[0].statut).toBe('ALERTE');
      expect(resultat.contient_lot_rappele).toBe(true);
    });

    it('ne signale aucun rappel quand tous les lots sont sains', async () => {
      prismaMock.shipment.findFirst.mockResolvedValue(expedition);

      const resultat = await palletLabelService.resolveBySscc(SSCC, ORG);

      expect(resultat.contient_lot_rappele).toBe(false);
    });
  });
});
