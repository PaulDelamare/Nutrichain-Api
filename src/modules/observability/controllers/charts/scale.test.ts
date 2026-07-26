import { describe, it, expect } from 'vitest';
import { linearScale, niceMax } from './scale';

describe('linearScale', () => {
  it('1. mappe le domaine sur le range linéairement', () => {
    const scale = linearScale([0, 100], [0, 200]);
    expect(scale(0)).toBe(0);
    expect(scale(50)).toBe(100);
    expect(scale(100)).toBe(200);
  });

  it('2. domaine dégénéré (min === max) : ne divise jamais par zéro, renvoie le début du range', () => {
    const scale = linearScale([10, 10], [0, 200]);
    expect(scale(10)).toBe(0);
    expect(Number.isFinite(scale(10))).toBe(true);
  });

  it('3. range inversé (ex. axe Y SVG, 0 en haut) fonctionne', () => {
    const scale = linearScale([0, 100], [200, 0]);
    expect(scale(0)).toBe(200);
    expect(scale(100)).toBe(0);
  });
});

describe('niceMax', () => {
  it('4. 0 → 10 (jamais un axe à hauteur nulle)', () => {
    expect(niceMax(0)).toBe(10);
  });

  it('5. arrondit au-dessus vers une valeur ronde (paliers 1/2/5/10)', () => {
    expect(niceMax(42)).toBe(50);
    expect(niceMax(123)).toBe(200);
    expect(niceMax(999)).toBe(1000);
  });

  it('6. valeur déjà ronde : reste identique', () => {
    expect(niceMax(100)).toBe(100);
  });
});
