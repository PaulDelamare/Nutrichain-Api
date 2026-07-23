import { describe, it, expect } from 'vitest';
import { UNITS, VALID_UNITS, normalizeUnitCode, isValidUnit } from './units.constants';

describe('référentiel d unités', () => {
  it('VALID_UNITS dérive exactement des codes de UNITS (une seule source)', () => {
    expect(VALID_UNITS).toEqual(UNITS.map((u) => u.code));
  });

  it('tous les codes canoniques sont en MAJUSCULES', () => {
    for (const code of VALID_UNITS) {
      expect(code).toBe(code.toUpperCase());
    }
  });

  describe('normalizeUnitCode — tolérant en entrée, strict en stockage', () => {
    it.each([
      ['kg', 'KG'],
      ['Kg', 'KG'],
      ['  kg  ', 'KG'],
      ['KG', 'KG'],
      ['ml', 'ML'],
    ])('normalise %s en %s', (input, attendu) => {
      expect(normalizeUnitCode(input)).toBe(attendu);
    });
  });

  describe('isValidUnit', () => {
    it('accepte une unité du référentiel quelle que soit sa casse', () => {
      expect(isValidUnit('kg')).toBe(true);
      expect(isValidUnit('KG')).toBe(true);
      expect(isValidUnit(' g ')).toBe(true);
    });

    it('rejette une unité hors référentiel', () => {
      expect(isValidUnit('XYZ')).toBe(false);
      // L'ancien code minuscule `u` n'est plus valide : seul `UNIT` l'est.
      expect(isValidUnit('u')).toBe(false);
      expect(isValidUnit('UNIT')).toBe(true);
    });
  });
});
