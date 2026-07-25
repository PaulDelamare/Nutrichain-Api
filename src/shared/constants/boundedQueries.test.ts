import { describe, it, expect } from 'vitest';
import vine from '@vinejs/vine';
import { receiptQuerySchema } from '../../modules/logistics/receipts/middlewares/receiptQuery.schema';
import { telemetryHistoryQuerySchema } from '../../modules/iot/middlewares/telemetryHistoryQuery.schema';
import { catalogQuerySchema } from '../../modules/traceability/catalog/middlewares/catalogQuery.schema';
import { shipmentSchema } from '../../modules/logistics/shipments/middlewares/shipmentPayload.schema';
import { MAX_PAGE_SIZE, MAX_PAGE_NUMBER, MAX_SEARCH_LENGTH } from './pagination.constants';

const validate = async (schema: Parameters<typeof vine.validate>[0]['schema'], data: unknown) => {
  try {
    return { ok: true as const, out: await vine.validate({ schema, data }) };
  } catch {
    return { ok: false as const };
  }
};

/**
 * Ces bornes ne sont pas cosmétiques : chacune correspond à une requête qui, sans elle, sortait en
 * 500 ou chargeait un volume arbitraire. Un 400 explicite vaut mieux qu'un serveur qui s'étrangle.
 */
describe('bornes des lectures paginées', () => {
  describe('GET /logistics/receipts', () => {
    it('refuse une limite au-delà du plafond de volumétrie', async () => {
      expect((await validate(receiptQuerySchema, { limit: MAX_PAGE_SIZE + 1 })).ok).toBe(false);
      expect((await validate(receiptQuerySchema, { limit: 100000000 })).ok).toBe(false);
    });

    it('refuse une limite non numérique, qui produisait un `take: NaN` (500)', async () => {
      expect((await validate(receiptQuerySchema, { limit: 'abc' })).ok).toBe(false);
    });

    it('refuse une page nulle ou négative, qui produisait un `skip` négatif (500)', async () => {
      expect((await validate(receiptQuerySchema, { page: 0 })).ok).toBe(false);
      expect((await validate(receiptQuerySchema, { page: -3 })).ok).toBe(false);
    });

    it('accepte une requête sans paramètre : les défauts restent applicables', async () => {
      expect((await validate(receiptQuerySchema, {})).ok).toBe(true);
    });

    /**
     * ⚠️ Le trou symétrique. Borner `limit` ne suffit pas : `skip = (page - 1) * limit`. Un
     * `?page=1e19` produisait un `skip` de 2e21 refusé par Prisma — le même 500 que `?page=0`,
     * de l'autre côté de l'axe. Et la réponse d'erreur recopiait le message Prisma au client.
     */
    it('refuse un numéro de page démesuré, qui produisait un `skip` hors limites', async () => {
      expect((await validate(receiptQuerySchema, { page: '1e19' })).ok).toBe(false);
      expect((await validate(receiptQuerySchema, { page: '99999999999999999999' })).ok).toBe(false);
      expect((await validate(receiptQuerySchema, { page: String(MAX_PAGE_NUMBER + 1) })).ok).toBe(
        false
      );
    });

    it('exige des entiers : une demi-page ou une demi-ligne ne veut rien dire', async () => {
      expect((await validate(receiptQuerySchema, { limit: '5.7' })).ok).toBe(false);
      expect((await validate(receiptQuerySchema, { page: '1.9' })).ok).toBe(false);
    });

    /** `req.query` livre des CHAÎNES : la coercition doit marcher pour un appel légitime. */
    it('coerce les chaînes de la query string, comme Express les livre', async () => {
      const r = await validate(receiptQuerySchema, { page: '2', limit: '50' });

      expect(r.ok).toBe(true);
      expect(r.ok && r.out).toEqual({ page: 2, limit: 50 });
    });
  });

  describe('GET /telemetry/:sensor_id/history', () => {
    it('borne la lecture de la série temporelle (rétention 1 an)', async () => {
      expect((await validate(telemetryHistoryQuerySchema, { limit: MAX_PAGE_SIZE })).ok).toBe(true);
      expect((await validate(telemetryHistoryQuerySchema, { limit: MAX_PAGE_SIZE + 1 })).ok).toBe(
        false
      );
      expect((await validate(telemetryHistoryQuerySchema, { limit: 'abc' })).ok).toBe(false);
      // Une limite décimale partirait dans un `.limit()` Mongoose : seul consommateur non-Prisma.
      expect((await validate(telemetryHistoryQuerySchema, { limit: '10.5' })).ok).toBe(false);
    });
  });

  describe('GET /traceability/batches', () => {
    /** `?q=a&q=b` produit un tableau, transmis tel quel au `contains` de Prisma → 500. */
    it('refuse un terme de recherche répété (tableau) au lieu de sortir en 500', async () => {
      expect((await validate(catalogQuerySchema, { q: ['a', 'b'] })).ok).toBe(false);
    });

    it('borne la longueur du terme de recherche', async () => {
      expect((await validate(catalogQuerySchema, { q: 'x'.repeat(MAX_SEARCH_LENGTH) })).ok).toBe(
        true
      );
      expect(
        (await validate(catalogQuerySchema, { q: 'x'.repeat(MAX_SEARCH_LENGTH + 1) })).ok
      ).toBe(false);
    });

    /**
     * La route est devenue paginée pour qu'un lot au-delà des 100 plus récents reste atteignable
     * (issue #32) : elle hérite des mêmes bornes que les autres lectures paginées, sinon elle
     * réintroduit les `take: NaN` et `skip` hors limites que celles-ci ont fermés.
     */
    it('borne la pagination comme les autres lectures paginées', async () => {
      expect((await validate(catalogQuerySchema, { page: '3', limit: '50' })).ok).toBe(true);
      expect((await validate(catalogQuerySchema, { page: 0 })).ok).toBe(false);
      expect((await validate(catalogQuerySchema, { page: String(MAX_PAGE_NUMBER + 1) })).ok).toBe(
        false
      );
      expect((await validate(catalogQuerySchema, { limit: MAX_PAGE_SIZE + 1 })).ok).toBe(false);
      expect((await validate(catalogQuerySchema, { limit: 'abc' })).ok).toBe(false);
      expect((await validate(catalogQuerySchema, { limit: '5.7' })).ok).toBe(false);
    });
  });

  describe('POST /logistics/shipments', () => {
    const shipment = (lots: number, address = '12 rue de la Laiterie') => ({
      id_client: '123e4567-e89b-12d3-a456-426614174000',
      shipment_id: 'SHIP-001',
      transporteur: 'Transporteur',
      destination_adresse: address,
      lots: Array.from({ length: lots }, () => ({
        id_lot: '123e4567-e89b-12d3-a456-426614174001',
        quantite_expediee: 1,
      })),
    });

    it('refuse une expédition à des dizaines de milliers de lignes (transaction géante)', async () => {
      expect((await validate(shipmentSchema, shipment(500))).ok).toBe(true);
      expect((await validate(shipmentSchema, shipment(501))).ok).toBe(false);
    });

    it("borne l'adresse de destination, seule chaîne sans plafond", async () => {
      expect((await validate(shipmentSchema, shipment(1, 'a'.repeat(255)))).ok).toBe(true);
      expect((await validate(shipmentSchema, shipment(1, 'a'.repeat(256)))).ok).toBe(false);
    });
  });
});
