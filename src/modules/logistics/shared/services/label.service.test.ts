import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { labelService, MIN_LABEL_PX } from './label.service';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';

// Signature PNG (magic bytes) : un vrai rendu bwip-js doit commencer par ces 8 octets.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('labelService', () => {
  const ORIGINAL_BASE_URL = process.env.API_URL;

  beforeEach(() => {
    // Chaque test part d'un environnement propre : le defaut ne doit pas fuir d'un test a l'autre.
    delete process.env.API_URL;
  });

  afterAll(() => {
    if (ORIGINAL_BASE_URL === undefined) {
      delete process.env.API_URL;
    } else {
      process.env.API_URL = ORIGINAL_BASE_URL;
    }
  });

  describe('generateDigitalLink', () => {
    it('assemble une URI GS1 Digital Link avec les AI 01 (GTIN) et 10 (lot) aux bonnes positions', () => {
      const uri = labelService.generateDigitalLink('03400000000000', 'LOT-XYZ');

      expect(uri).toBe('https://api.nutrichain.fr/api/gs1/01/03400000000000/10/LOT-XYZ');
    });

    it('utilise API_URL comme base quand la variable est definie', () => {
      process.env.API_URL = 'https://example.test';

      const uri = labelService.generateDigitalLink('12345678', 'B42');

      expect(uri).toBe('https://example.test/api/gs1/01/12345678/10/B42');
    });

    it('retombe sur le domaine par defaut quand API_URL est absente', () => {
      const uri = labelService.generateDigitalLink('99', 'L1');

      expect(uri.startsWith('https://api.nutrichain.fr/api/gs1/01/')).toBe(true);
    });

    // Le lien doit correspondre à une route RÉELLEMENT montée (`/api/gs1/01/:gtin/10/:lot`,
    // transformation.routes.ts) — sans ce préfixe, chaque étiquette imprimée encodait un lien mort
    // (404 au premier scan réel, cf. #139).
    it('pointe sous /api, comme TOUTES les routes montées par ce serveur (app.ts)', () => {
      const uri = labelService.generateDigitalLink('03400000000000', 'LOT-XYZ');

      expect(uri).toContain('/api/gs1/01/03400000000000/10/LOT-XYZ');
    });
  });

  describe('generateSsccElementString', () => {
    it('prefixe le SSCC de son AI 00, sans separateur', () => {
      expect(labelService.generateSsccElementString('034567890000000606')).toBe(
        '00034567890000000606'
      );
    });

    it('refuse ce qui n est pas un SSCC de 18 chiffres', () => {
      // Un SSCC tronque ou porteur de lettres produirait une etiquette que le lecteur decode
      // sans erreur mais qui ne resout aucune palette — un carton scanne dans le vide.
      for (const invalide of ['12345', '03456789000000060', '0345678900000006061', 'ABC']) {
        expect(() => labelService.generateSsccElementString(invalide)).toThrow(APIError);
      }
    });

    it('accepte un SSCC deja prefixe de son AI, sans le doubler', () => {
      // La lecture d'une etiquette fournisseur conserve parfois le prefixe : le redoubler
      // fabriquerait un code de 22 chiffres, illisible pour tout le monde.
      expect(labelService.generateSsccElementString('00034567890000000606')).toBe(
        '00034567890000000606'
      );
    });
  });

  describe('generateQRCode', () => {
    it('rend un vrai PNG (Buffer non vide portant la signature PNG) via bwip-js', async () => {
      const png = await labelService.generateQRCode(
        'https://api.nutrichain.fr/gs1/01/03400000000000/10/LOT-XYZ'
      );

      expect(Buffer.isBuffer(png)).toBe(true);
      expect(png.length).toBeGreaterThan(0);
      expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    });

    // Un QR code est carré par définition : ses trois motifs de repérage et son quadrillage de
    // modules supposent le même pas en X et en Y. Une image étirée n'est plus décodable par une
    // caméra — l'étiquette imprimée devient un rectangle noir sans effet. Le rendu sortait en
    // 198x66 : la suite ne regardait que la signature PNG, jamais les dimensions.
    it('rend un QR CARRE — une image etiree est indecodable par un lecteur reel', async () => {
      const png = await labelService.generateQRCode(
        'https://api.nutrichain.fr/api/gs1/01/03400000000000/10/LOT-XYZ'
      );

      // En-tête PNG : largeur et hauteur en big-endian aux offsets 16 et 20.
      const width = png.readUInt32BE(16);
      const height = png.readUInt32BE(20);

      expect(width).toBeGreaterThan(0);
      expect(height).toBe(width);
    });

    // Mesuré en dégradant l'étiquette réelle comme le ferait une photo d'atelier (réduction,
    // rotation, flou, compression) : elle se décode jusqu'à 180 px, et échoue à 110. Le symbole
    // fait 66 modules de côté — en dessous de ce seuil, un module ne couvre plus assez de pixels.
    // Baisser `scale` est donc un geste à conséquence terrain, et ce test le rend visible.
    it('rend au moins 180 px de cote — sous ce seuil le QR ne se decode plus une fois photographie', async () => {
      const png = await labelService.generateQRCode(
        labelService.generateDigitalLink('03400000000000', 'LOT-XYZ')
      );

      expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(MIN_LABEL_PX);
    });

    // Le seul test qui prouve qu'une etiquette est SCANNABLE : jsQR est le decodeur employe par
    // les lecteurs QR en JavaScript, il travaille sur les pixels, comme une camera. Verifier la
    // signature PNG ne disait rien du motif — le rendu est sorti successivement etire (#272) puis
    // sur fond transparent, donc aplati en noir sur noir et indecodable (#277), sans qu'aucun test
    // ne rougisse.
    it('produit un QR REELLEMENT DECODABLE, portant exactement le Digital Link', async () => {
      const link = labelService.generateDigitalLink('03400000000000', 'LOT-XYZ');

      const png = await labelService.generateQRCode(link);
      const image = PNG.sync.read(png);
      const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);

      expect(decoded).not.toBeNull();
      expect(decoded?.data).toBe(link);
    });

    /**
     * L'etiquette de palette encode un ELEMENT STRING (`00` + SSCC), pas un Digital Link.
     * Ce n'est pas un detail de forme : le parseur du mobile (`src/lib/gs1.ts`) refuse un Digital
     * Link qui ne porte qu'un SSCC — il exige un GTIN ou un numero de lot pour rendre un resultat.
     * Une etiquette en Digital Link serait donc lue comme un code inconnu par notre propre
     * application.
     */
    it('produit un QR REELLEMENT DECODABLE, portant exactement l element string SSCC', async () => {
      const elementString = labelService.generateSsccElementString('034567890000000606');

      const png = await labelService.generateQRCode(elementString);
      const image = PNG.sync.read(png);
      const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);

      expect(decoded).not.toBeNull();
      expect(decoded?.data).toBe('00034567890000000606');
    });

    it('rejette avec une APIError 500 orientee champ "qrcode" quand bwip-js echoue', async () => {
      // Un texte vide fait echouer le vrai encodeur ("bar code text not specified") :
      // on prouve la branche d'erreur reelle, sans mocker bwip-js.
      let caught: unknown;
      try {
        await labelService.generateQRCode('');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(APIError);
      const apiError = caught as APIError;
      expect(apiError.status).toBe(500);
      expect(apiError.body.error).toHaveLength(1);
      expect(apiError.body.error[0].field).toBe('qrcode');
    });
  });
});
