/**
 * Service pour la gestion des standards GS1 (SSCC, GTIN, etc.)
 */
export const gs1Service = {
  /**
   * Calcule le chiffre de contrôle modulo 10 pour un nombre GS1.
   * Utilisé pour les GTIN-8, 12, 13, 14 et le SSCC (18).
   */
  calculateCheckDigit(number: string): number {
    const digits = number.split('').map(Number).reverse();
    const sum = digits.reduce((acc, digit, idx) => {
      // Les positions impaires (en partant de la droite) sont multipliées par 3
      const multiplier = idx % 2 === 0 ? 3 : 1;
      return acc + digit * multiplier;
    }, 0);

    const nextTen = Math.ceil(sum / 10) * 10;
    return (nextTen - sum) % 10;
  },

  /**
   * Génère un SSCC (Serial Shipping Container Code) de 18 chiffres.
   * Format: [Extension Digit (1)][GS1 Company Prefix (7-10)][Serial Reference (6-9)][Check Digit (1)]
   *
   * @param extension Digit d'extension (0-9)
   * @param prefix Préfixe entreprise (ex: '3456789')
   * @param serial Référence série (doit compléter pour arriver à 17 chiffres au total avant check digit)
   */
  generateSSCC(extension: number, prefix: string, serial: string): string {
    const base = `${extension}${prefix}${serial}`;

    if (base.length !== 17) {
      throw new Error(`SSCC base must be 17 characters long (got ${base.length})`);
    }

    const checkDigit = this.calculateCheckDigit(base);
    return `${base}${checkDigit}`;
  },
};
