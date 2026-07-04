import { randomInt } from 'node:crypto';

/**
 * Préfixe entreprise GS1 de repli pour les organisations sans
 * `gs1_company_prefix` renseigné (préfixe fictif — projet exercice,
 * aucun préfixe réel acheté auprès de GS1).
 */
export const DEFAULT_GS1_COMPANY_PREFIX = '3456789';

const SSCC_LENGTH_WITHOUT_CHECK = 17;
const LOT_RANDOM_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOT_RANDOM_LENGTH = 6;

/**
 * Utilitaires GS1 (SSCC, URN EPC, numéros de lot) — fonctions pures,
 * partagées entre les modules logistics et traceability.
 */
export const gs1Utils = {
  /**
   * Génère un SSCC (Serial Shipping Container Code) valide (18 chiffres).
   * Format: Extension Digit (1) + GS1 Company Prefix + Serial Reference + Check Digit
   */
  generateSSCC(serial: number, companyPrefix: string = DEFAULT_GS1_COMPANY_PREFIX): string {
    const extensionDigit = '0';
    const serialRefLength = SSCC_LENGTH_WITHOUT_CHECK - 1 - companyPrefix.length;
    // padStart ne tronque pas : sans cette garde, un serial trop grand (préfixe long
    // + volume élevé) produirait silencieusement un SSCC > 18 chiffres, invalide GS1.
    if (serial.toString().length > serialRefLength) {
      throw new Error(
        `Capacité SSCC épuisée pour le préfixe ${companyPrefix} (serial ${serial} > ${serialRefLength} chiffres).`
      );
    }
    const serialRef = serial.toString().padStart(serialRefLength, '0');

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

  /**
   * Génère un numéro de lot court conforme à l'AI (10) GS1 (max 20 caractères) :
   * `AAMMJJ-XXXXXX`, suffixe aléatoire cryptographique. L'unicité est garantie
   * en base par la contrainte (organization_id, lot_number).
   */
  generateLotNumber(date: Date = new Date()): string {
    const datePart = date.toISOString().slice(2, 10).replace(/-/g, '');
    let randomPart = '';
    for (let i = 0; i < LOT_RANDOM_LENGTH; i++) {
      randomPart += LOT_RANDOM_ALPHABET[randomInt(LOT_RANDOM_ALPHABET.length)];
    }
    return `${datePart}-${randomPart}`;
  },

  /**
   * Construit l'URN EPC de classe LGTIN (`urn:epc:class:lgtin:...`) identifiant
   * un lot d'un produit : préfixe entreprise + item ref (indicateur inclus,
   * 13 chiffres au total) + numéro de lot.
   *
   * Le GTIN est normalisé en GTIN-14 et son check digit est retiré (règle GS1 :
   * le check digit ne figure jamais dans une URN EPC).
   *
   * Hypothèse assumée (projet exercice) : l'item ref est découpé positionnellement
   * à la longueur du préfixe déclaré, SANS vérifier que le GTIN encode réellement
   * ce préfixe — les GTIN de démo sont fictifs. Un déploiement réel validerait la
   * correspondance préfixe/GTIN (et la longueur GTIN-13/14) à l'enregistrement produit.
   */
  buildLgtinUrn(companyPrefix: string, gtin: string, lotNumber: string): string {
    const gtin14 = gtin.padStart(14, '0');
    const indicator = gtin14[0];
    const bodyWithoutCheckDigit = gtin14.slice(1, 13);
    const itemRef = bodyWithoutCheckDigit.slice(companyPrefix.length);
    return `urn:epc:class:lgtin:${companyPrefix}.${indicator}${itemRef}.${lotNumber}`;
  },

  /**
   * Construit l'URN EPC d'un SSCC (`urn:epc:id:sscc:...`) : préfixe entreprise +
   * chiffre d'extension + serial reference (sans le check digit).
   */
  buildSsccUrn(companyPrefix: string, sscc: string): string {
    const extensionDigit = sscc[0];
    const serialRef = sscc.slice(1 + companyPrefix.length, SSCC_LENGTH_WITHOUT_CHECK);
    return `urn:epc:id:sscc:${companyPrefix}.${extensionDigit}${serialRef}`;
  },
};
