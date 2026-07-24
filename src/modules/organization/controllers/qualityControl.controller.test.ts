import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Response } from 'express';
import {
  createQualityControlController,
  listPendingQualityControlController,
} from './qualityControl.controller';
import { qualityControlService } from '../services/qualityControl.service';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';

vi.mock('../services/qualityControl.service', () => ({
  qualityControlService: {
    createQualityControl: vi.fn(),
    listPendingQualityControl: vi.fn(),
  },
}));

vi.mock('../../../shared/utils/returnSuccess/returnSuccess', () => ({
  sendSuccess: vi.fn(),
}));

// Payload tel que le validateur VineJS le pose sur `req.validatedQualityControl` : ni auteur, ni
// organisation — ces deux-là viennent de la session, jamais du corps.
const validPayload = {
  id_lot: '11111111-1111-4111-8111-111111111111',
  type_test: 'STERILITE',
  resultat: 'CONFORME',
  notes: 'RAS',
};

describe('QualityControlController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createQualityControlController', () => {
    it("transmet au service le tenant (activeOrgId) et l'auteur (auth.user.id) de la SESSION, avec le payload validé", async () => {
      // Service mocké : ce test prouve la SOURCE des valeurs transmises (session vs corps), pas le
      // cloisonnement effectif ni la table d'états — ceux-ci vivent dans le service, testé ailleurs.
      vi.mocked(qualityControlService.createQualityControl).mockResolvedValue({
        control: { id: 'qc-1' },
      } as never);
      const req = {
        validatedQualityControl: validPayload,
        activeOrgId: 'org-1',
        auth: { user: { id: 'labo-user' } },
        body: {},
      } as unknown as AuthenticatedRequest;

      await createQualityControlController(req, {} as Response);

      expect(qualityControlService.createQualityControl).toHaveBeenCalledWith({
        ...validPayload,
        resultat: 'CONFORME',
        organization_id: 'org-1',
        id_user_labo: 'labo-user',
      });
    });

    it("ne lit ni l'auteur ni le tenant depuis le corps : des champs homonymes glissés dans req.body sont ignorés", async () => {
      // Le contrôleur source l'auteur et l'organisation dans la SESSION, jamais dans le corps. Des
      // champs `id_user_labo`/`organization_id` glissés dans `req.body` ne doivent rien changer :
      // c'est la garantie anti-falsification de l'auteur scellé dans l'audit.
      vi.mocked(qualityControlService.createQualityControl).mockResolvedValue({
        control: { id: 'qc-1' },
      } as never);
      const req = {
        validatedQualityControl: validPayload,
        activeOrgId: 'org-1',
        auth: { user: { id: 'labo-user' } },
        body: {
          id_user_labo: 'responsable-usurpe',
          organization_id: 'org-etrangere',
        },
      } as unknown as AuthenticatedRequest;

      await createQualityControlController(req, {} as Response);

      expect(qualityControlService.createQualityControl).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: 'org-1',
          id_user_labo: 'labo-user',
        })
      );
    });

    it('délègue à sendSuccess le code 201 et le résultat du service', async () => {
      // sendSuccess est mocké : on vérifie le contrat passé (code, message, données), pas
      // l'écriture HTTP réelle, portée par ce util partagé et testée ailleurs.
      const result = { control: { id: 'qc-1' }, statut_lot: 'EN_STOCK' };
      vi.mocked(qualityControlService.createQualityControl).mockResolvedValue(result as never);
      const res = {} as Response;
      const req = {
        validatedQualityControl: validPayload,
        activeOrgId: 'org-1',
        auth: { user: { id: 'labo-user' } },
        body: {},
      } as unknown as AuthenticatedRequest;

      await createQualityControlController(req, res);

      expect(sendSuccess).toHaveBeenCalledWith(res, 201, 'Contrôle qualité enregistré', result);
    });

    it("refuse (401) sans utilisateur de session et n'appelle pas le service", async () => {
      // Branche défensive du contrôleur : une décision qualité scelle un auteur dans l'audit, elle
      // exige donc une session humaine. Sous le câblage actuel `sessionAuth` garantit cette session
      // en amont ; ce test verrouille la défense en profondeur du contrôleur (mutation : retirer le
      // garde `if (!userId)` fait rougir ce cas). L'absence d'auteur est fabriquée uniquement pour
      // exercer cette branche — pas pour prouver une sécurité que le mock effacerait.
      const req = {
        validatedQualityControl: validPayload,
        activeOrgId: 'org-1',
        auth: {},
        body: {},
      } as unknown as AuthenticatedRequest;

      await expect(createQualityControlController(req, {} as Response)).rejects.toMatchObject({
        status: 401,
      });
      expect(qualityControlService.createQualityControl).not.toHaveBeenCalled();
    });
  });

  describe('listPendingQualityControlController', () => {
    it("transmet l'organisation active de la session au service", async () => {
      vi.mocked(qualityControlService.listPendingQualityControl).mockResolvedValue([] as never);
      const req = {
        activeOrgId: 'org-1',
        auth: { user: { id: 'labo-user' } },
      } as unknown as AuthenticatedRequest;

      await listPendingQualityControlController(req, {} as Response);

      expect(qualityControlService.listPendingQualityControl).toHaveBeenCalledWith('org-1');
    });

    it('délègue à sendSuccess le code 200 et la liste renvoyée par le service', async () => {
      const batches = [{ id: 'batch-1', lot_number: 'LOT-1' }];
      vi.mocked(qualityControlService.listPendingQualityControl).mockResolvedValue(batches as never);
      const res = {} as Response;
      const req = {
        activeOrgId: 'org-1',
        auth: { user: { id: 'labo-user' } },
      } as unknown as AuthenticatedRequest;

      await listPendingQualityControlController(req, res);

      expect(sendSuccess).toHaveBeenCalledWith(
        res,
        200,
        'Lots en attente de contrôle qualité récupérés',
        batches
      );
    });
  });
});
