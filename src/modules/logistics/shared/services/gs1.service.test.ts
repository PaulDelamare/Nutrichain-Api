import { describe, it, expect } from 'vitest';
import { gs1Service } from './gs1.service';

describe('gs1Service', () => {
  describe('calculateCheckDigit', () => {
    it('devrait calculer le bon chiffre de contrôle pour un SSCC (exemple GS1)', () => {
      // Exemple GS1 : 33761011111111111 -> Check Digit 7
      const base = '33761011111111111';
      expect(gs1Service.calculateCheckDigit(base)).toBe(7);
    });

    it('devrait calculer le bon chiffre de contrôle pour un GTIN-13', () => {
      // Exemple : 400638133393 -> Check Digit 1
      const base = '400638133393';
      expect(gs1Service.calculateCheckDigit(base)).toBe(1);
    });
  });

  describe('generateSSCC', () => {
    it('devrait générer un SSCC complet de 18 chiffres', () => {
      const extension = 3;
      const prefix = '3761011';
      const serial = '111111111';
      const sscc = gs1Service.generateSSCC(extension, prefix, serial);

      expect(sscc).toHaveLength(18);
      expect(sscc).toBe('337610111111111117');
    });

    it('devrait échouer si la base ne fait pas 17 caractères', () => {
      expect(() => gs1Service.generateSSCC(1, '123', '456')).toThrow();
    });
  });
});
