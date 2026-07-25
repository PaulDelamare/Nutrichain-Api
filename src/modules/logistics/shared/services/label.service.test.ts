import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { labelService } from './label.service';
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

  describe('generateQRCode', () => {
    it('rend un vrai PNG (Buffer non vide portant la signature PNG) via bwip-js', async () => {
      const png = await labelService.generateQRCode(
        'https://api.nutrichain.fr/gs1/01/03400000000000/10/LOT-XYZ'
      );

      expect(Buffer.isBuffer(png)).toBe(true);
      expect(png.length).toBeGreaterThan(0);
      expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
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
