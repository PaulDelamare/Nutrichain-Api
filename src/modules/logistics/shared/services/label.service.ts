import bwipjs from 'bwip-js';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';

/**
 * Taille minimale d'une étiquette, en pixels de côté (≈ 16 mm à 300 ppp).
 *
 * Mesurée en dégradant l'étiquette réelle comme le ferait une photo prise en atelier (réduction,
 * rotation, flou, compression) : elle se décode encore à 180 px et échoue à 110. Le symbole fait
 * 66 modules de côté — en dessous, un module ne couvre plus assez de pixels pour survivre à un
 * angle ou à un flou. `scale: 3` produit 222 px, marge comprise.
 */
export const MIN_LABEL_PX = 180;

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
   * Construit l'element string GS1 d'un SSCC : son AI `00` suivi des 18 chiffres.
   *
   * **Pas un Digital Link**, contrairement à l'étiquette de lot, et ce n'est pas un choix de
   * style : le parseur de l'application mobile (`src/lib/gs1.ts`, `parseDigitalLink`) ne rend un
   * résultat que si l'URL porte un GTIN ou un numéro de lot. Une URL ne portant qu'un SSCC lui
   * renvoie `null` — l'étiquette passerait pour un code inconnu dans notre propre application.
   * L'element string, lui, est décodé par `parseElementString`, qui reconnaît l'AI `00`.
   *
   * C'est aussi ce que porte une étiquette logistique du commerce : le SSCC identifie le
   * contenant pour les opérations, là où le Digital Link s'adresse au consommateur.
   */
  generateSsccElementString(sscc: string): string {
    const SSCC_AI = '00';
    // Une lecture d'étiquette fournisseur conserve parfois l'AI : le redoubler fabriquerait un
    // code de 22 chiffres que plus aucun lecteur ne résout.
    const digits = sscc.startsWith(SSCC_AI) && sscc.length === 20 ? sscc.slice(2) : sscc;

    if (!/^\d{18}$/.test(digits)) {
      throw new APIError(400, {
        error: [
          {
            field: 'sscc',
            message: 'Un SSCC compte exactement 18 chiffres : aucune étiquette ne peut être émise.',
          },
        ],
      });
    }

    return SSCC_AI + digits;
  },

  /**
   * Génère un QR Code GS1 Digital Link sous forme de Buffer (PNG)
   *
   * Ni `height` ni `width` : pour un symbole 2D, bwip-js les interprète en millimètres et étire
   * l'image. `height: 10` produisait un rendu de 198x66 — un QR étiré n'est plus décodable (ses
   * motifs de repérage supposent le même pas en X et en Y), donc chaque étiquette imprimée était
   * un rectangle noir qu'aucune caméra ne lisait. Sans ces options, `scale` seul fixe la taille du
   * module et le symbole reste carré.
   *
   * `backgroundcolor` : sans lui, bwip-js rend le fond TRANSPARENT. Le symbole reste correct sur
   * une page blanche, mais dès qu'il est aplati sur du noir — impression, PDF, visionneuse, ou
   * simplement un décodeur travaillant sur les pixels bruts — il devient noir sur noir, donc
   * illisible (#277). Une étiquette doit porter son propre contraste, pas l'emprunter à son support.
   *
   * `padding: 4` : la zone calme exigée par la norme, quatre modules de blanc tout autour. Un
   * décodeur a besoin de cette bordure pour isoler le symbole de ce qui l'entoure.
   */
  async generateQRCode(text: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      bwipjs.toBuffer(
        {
          bcid: 'qrcode', // Type de code
          text: text, // Contenu
          scale: 3, // Taille d'un module, en pixels
          backgroundcolor: 'FFFFFF',
          // 12 px = 4 modules à cette échelle, la zone calme normative.
          paddingwidth: 12,
          paddingheight: 12,
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
