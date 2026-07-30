import { describe, it, expect } from 'vitest';
import { stripSsccAi, SSCC_PATTERN } from './sscc';

describe('stripSsccAi', () => {
  it('retire l AI 00 que la camera conserve sur l element string', () => {
    expect(stripSsccAi('00034567890000000606')).toBe('034567890000000606');
  });

  it('laisse intact un SSCC deja nu', () => {
    expect(stripSsccAi('034567890000000606')).toBe('034567890000000606');
  });

  /**
   * Un SSCC de 18 chiffres peut commencer par `00` : c'est un chiffre d'extension, pas un AI.
   * Le distinguer par la LONGUEUR, jamais par le prefixe — sinon on tronque un identifiant valide.
   */
  it('ne tronque pas un SSCC de 18 chiffres qui commence par 00', () => {
    expect(stripSsccAi('003456789000000060')).toBe('003456789000000060');
  });
});

describe('SSCC_PATTERN', () => {
  it('accepte 18 chiffres, avec ou sans son AI', () => {
    expect(SSCC_PATTERN.test('034567890000000606')).toBe(true);
    expect(SSCC_PATTERN.test('00034567890000000606')).toBe(true);
  });

  it('refuse ce qui n en est pas un', () => {
    for (const invalide of ['', '12345', '3401234567890', '0345678900000006061', 'ABCDEFGHIJKLMNOPQR']) {
      expect(SSCC_PATTERN.test(invalide)).toBe(false);
    }
  });
});
