import bwipjs from 'bwip-js';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';

/**
 * Service dédié à la génération d'étiquettes GS1 Digital Link
 * Supporte la génération d'URI standards et le rendu en image (QR Code)
 */
export const labelService = {
  /**
   * Génère une URI GS1 Digital Link standard
   * Format: https://nutrichain.api/api/gs1/01/{gtin}/10/{lotNumber}
   * 01 = GTIN (Code produit)
   * 10 = Numéro de lot court GS1 (Batch.lot_number, ≤ 20 caractères)
   *
   * Sous `/api`, comme TOUTES les routes de ce serveur (`app.ts`) : un lien qui pointait ailleurs
   * ne correspondait à AUCUNE route montée — chaque étiquette imprimée encodait un lien mort,
   * 404 au premier scan réel (cf. #139).
   *
   * `API_URL`, pas `API_BASE_URL` : cette dernière n'était déclarée nulle part
   * (`.env.example`, `docker-compose.yml`, `env.validator.ts`) — le repli s'appliquait donc
   * TOUJOURS, vers un domaine qui ne résout même pas (NXDOMAIN, cf. #146). `API_URL` est la
   * variable déjà utilisée pour ce même concept ailleurs (`auth.config.ts`, `swagger.config.ts`,
   * `server.ts`) — une seule source de vérité pour l'URL publique de ce serveur.
   */
  generateDigitalLink(gtin: string, lotNumber: string): string {
    const baseUrl = process.env.API_URL || 'https://api.nutrichain.fr';
    // Le standard GS1 Digital Link utilise des clés identifiées par des AI (Application Identifiers)
    return `${baseUrl}/api/gs1/01/${gtin}/10/${lotNumber}`;
  },

  /**
   * Génère un QR Code GS1 Digital Link sous forme de Buffer (PNG)
   *
   * Ni `height` ni `width` : pour un symbole 2D, bwip-js les interprète en millimètres et étire
   * l'image. `height: 10` produisait un rendu de 198x66 — un QR étiré n'est plus décodable (ses
   * motifs de repérage supposent le même pas en X et en Y), donc chaque étiquette imprimée était
   * un rectangle noir qu'aucune caméra ne lisait. Sans ces options, `scale` seul fixe la taille du
   * module et le symbole reste carré.
   */
  async generateQRCode(text: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      bwipjs.toBuffer(
        {
          bcid: 'qrcode', // Type de code
          text: text, // Contenu
          scale: 3, // Taille d'un module, en pixels
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
};
