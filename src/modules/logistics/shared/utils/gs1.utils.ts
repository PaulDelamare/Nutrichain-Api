/**
 * Utilitaire pour la gestion des standards GS1 (SSCC, GTIN, etc.)
 */
export const gs1Utils = {
  /**
   * Génère un SSCC (Serial Shipping Container Code) valide (18 chiffres).
   * Format: Extension Digit (1) + GS1 Company Prefix + Serial Reference + Check Digit
   *
   * Note: Pour Nutrichain (exercice), on simule un prefix fixe.
   */
  generateSSCC(serial: number): string {
    const extensionDigit = '0';
    const companyPrefix = '3456789'; // Préfixe fictif GS1 France
    const serialRef = serial.toString().padStart(9, '0');

    const partialSscc = extensionDigit + companyPrefix + serialRef;
    const checkDigit = this.calculateCheckDigit(partialSscc);

    return partialSscc + checkDigit;
  },

  /**
   * Calcule le Check Digit GS1 (algorithme Modulo 10 pondéré 3-1-3-1).
   */
  calculateCheckDigit(payload: string): number {
    let sum = 0;
    const digits = payload.split('').map(Number).reverse();

    digits.forEach((digit, index) => {
      const multiplier = index % 2 === 0 ? 3 : 1;
      sum += digit * multiplier;
    });

    const remainder = sum % 10;
    return remainder === 0 ? 0 : 10 - remainder;
  },
};
