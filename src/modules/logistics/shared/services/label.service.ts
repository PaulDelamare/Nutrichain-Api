import bwipjs from 'bwip-js';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';

/**
 * Service dédié à la génération d'étiquettes GS1 Digital Link
 * Supporte la génération d'URI standards et le rendu en images (QR/DataMatrix)
 */
export const labelService = {
  /**
   * Génère une URI GS1 Digital Link standard
   * Format: https://nutrichain.api/01/{gtin}/10/{batchId}
   * 01 = GTIN (Code produit)
   * 10 = Batch (Numéro de lot)
   */
  generateDigitalLink(gtin: string, batchId: string): string {
    const baseUrl = process.env.API_BASE_URL || 'https://api.nutrichain.fr';
    // Le standard GS1 Digital Link utilise des clés identifiées par des AI (Application Identifiers)
    return `${baseUrl}/gs1/01/${gtin}/10/${batchId}`;
  },

  /**
   * Génère un QR Code GS1 Digital Link sous forme de Buffer (PNG)
   */
  async generateQRCode(text: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      bwipjs.toBuffer(
        {
          bcid: 'qrcode', // Type de code
          text: text, // Contenu
          scale: 3, // Résolution
          height: 10, // Dimensions
          includetext: false, // Pas de texte sous le code
          textxalign: 'center',
        },
        (err, png) => {
          if (err) {
            reject(
              new APIError(500, {
                error: [{ field: 'qrcode', message: 'Erreur lors de la génération du QR Code' }],
              })
            );
          } else {
            resolve(png);
          }
        }
      );
    });
  },

  /**
   * Génère un DataMatrix GS1 (Standard industriel compact)
   */
  async generateDataMatrix(text: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      bwipjs.toBuffer(
        {
          bcid: 'gs1datamatrix',
          text: text,
          scale: 3,
          includetext: true,
          alttext: text.length > 20 ? text.substring(0, 20) + '...' : text,
        },
        (err, png) => {
          if (err) {
            reject(
              new APIError(500, {
                error: [{ field: 'datamatrix', message: 'Erreur lors de la génération du DataMatrix' }],
              })
            );
          } else {
            resolve(png);
          }
        }
      );
    });
  },
};
