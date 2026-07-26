/** Échelle linéaire minimale, sans dépendance (pas de d3) : deux bornes de domaine, deux de range. */
export const linearScale =
  (domain: [number, number], range: [number, number]) =>
  (value: number): number => {
    const [d0, d1] = domain;
    const [r0, r1] = range;
    if (d1 === d0) {
      return r0;
    }
    const t = (value - d0) / (d1 - d0);
    return r0 + t * (r1 - r0);
  };

/**
 * Arrondit vers le haut à une valeur "ronde" pour un plafond d'axe (10, 20, 50, 100, 200, 500...).
 * `0` devient `10` : un axe à hauteur nulle n'a pas de graduation lisible.
 */
export const niceMax = (value: number): number => {
  if (value <= 0) {
    return 10;
  }
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
};
