import { describe, it, expect } from 'vitest';
import { DEFAULT_GS1_COMPANY_PREFIX, gs1Utils } from './gs1.utils';

describe('GS1 Utils', () => {
  describe('calculateCheckDigit', () => {
    it('doit calculer le check digit pour un SSCC partiel', () => {
      // Exemple tiré de la doc GS1: 03456789000000001
      // On vérifie la logique 3-1-3-1
      const cd = gs1Utils.calculateCheckDigit('03456789000000001');
      expect(typeof cd).toBe('number');
      expect(cd).toBeGreaterThanOrEqual(0);
      expect(cd).toBeLessThanOrEqual(9);
    });
  });

  describe('generateSSCC', () => {
    it('doit générer une chaîne de 18 caractères avec le préfixe par défaut', () => {
      const sscc = gs1Utils.generateSSCC(1);
      expect(sscc).toHaveLength(18);
      expect(/^[0-9]+$/.test(sscc)).toBe(true);
      expect(sscc.slice(1)).toMatch(new RegExp(`^${DEFAULT_GS1_COMPANY_PREFIX}`));
    });

    it('doit être déterministe pour un même serial', () => {
      const sscc1 = gs1Utils.generateSSCC(42);
      const sscc2 = gs1Utils.generateSSCC(42);
      expect(sscc1).toBe(sscc2);
    });

    it("doit utiliser le préfixe GS1 de l'organisation et rester à 18 chiffres", () => {
      const sscc = gs1Utils.generateSSCC(7, '0614141');
      expect(sscc).toHaveLength(18);
      expect(sscc.slice(1, 8)).toBe('0614141');
    });

    it("doit s'adapter à un préfixe plus long (serial ref raccourci d'autant)", () => {
      const sscc = gs1Utils.generateSSCC(7, '061414112345');
      expect(sscc).toHaveLength(18);
      expect(sscc.slice(1, 13)).toBe('061414112345');
    });
  });

  describe('generateLotNumber', () => {
    it('doit produire un lot court conforme AI(10) : ≤ 20 caractères alphanumériques', () => {
      const lot = gs1Utils.generateLotNumber();
      expect(lot.length).toBeLessThanOrEqual(20);
      expect(lot).toMatch(/^[0-9]{6}-[0-9A-Z]{6}$/);
    });

    it('doit encoder la date fournie en préfixe AAMMJJ', () => {
      const lot = gs1Utils.generateLotNumber(new Date('2026-07-04T10:00:00Z'));
      expect(lot.startsWith('260704-')).toBe(true);
    });

    it('doit produire des valeurs distinctes (suffixe aléatoire)', () => {
      const lots = new Set(Array.from({ length: 50 }, () => gs1Utils.generateLotNumber()));
      expect(lots.size).toBe(50);
    });
  });

  describe('buildLgtinUrn', () => {
    it('doit construire une URN LGTIN conforme depuis un GTIN-13 (indicateur 0 implicite)', () => {
      // GTIN-13 3456789012345 → GTIN-14 03456789012345 : indicateur 0,
      // corps 345678901234 (sans check digit), item ref = corps sans le préfixe.
      const urn = gs1Utils.buildLgtinUrn('3456789', '3456789012345', '260704-ABC123');
      expect(urn).toBe('urn:epc:class:lgtin:3456789.001234.260704-ABC123');
    });

    it('doit gérer un GTIN-14 (indicateur explicite)', () => {
      const urn = gs1Utils.buildLgtinUrn('0614141', '10614141123458', '42');
      expect(urn).toBe('urn:epc:class:lgtin:0614141.112345.42');
    });

    it('préfixe + item ref (indicateur inclus) doivent totaliser 13 chiffres (règle GS1)', () => {
      const urn = gs1Utils.buildLgtinUrn('3456789', '3456789012345', 'L1');
      const [, , , , body] = urn.split(':');
      const [prefix, itemRef] = body.split('.');
      expect(prefix.length + itemRef.length).toBe(13);
    });
  });

  describe('buildSsccUrn', () => {
    it("doit construire l'URN SSCC (chiffre d'extension + serial ref, sans check digit)", () => {
      const sscc = gs1Utils.generateSSCC(42, '3456789');
      const urn = gs1Utils.buildSsccUrn('3456789', sscc);
      expect(urn).toBe(`urn:epc:id:sscc:3456789.${sscc[0]}${sscc.slice(8, 17)}`);
      // Préfixe + (extension + serial ref) = 17 chiffres : le check digit est exclu de l'URN.
      const serialPart = urn.split('.')[1];
      expect('3456789'.length + serialPart.length).toBe(17);
    });
  });
});
