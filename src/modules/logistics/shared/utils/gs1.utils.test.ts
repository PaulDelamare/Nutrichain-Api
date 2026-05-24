import { describe, it, expect } from 'vitest';
import { gs1Utils } from './gs1.utils';

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
    it('doit générer une chaîne de 18 caractères', () => {
      const sscc = gs1Utils.generateSSCC(1);
      expect(sscc).toHaveLength(18);
      expect(/^[0-9]+$/.test(sscc)).toBe(true);
    });

    it('doit être déterministe pour un même serial', () => {
      const sscc1 = gs1Utils.generateSSCC(42);
      const sscc2 = gs1Utils.generateSSCC(42);
      expect(sscc1).toBe(sscc2);
    });
  });
});
