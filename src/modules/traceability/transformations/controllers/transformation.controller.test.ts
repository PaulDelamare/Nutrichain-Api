import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Response } from 'express';
import { createTransformation } from './transformation.controller';
import { transformationService } from '../services/transformation.service';
import { AuthenticatedRequest } from '../../../identity/middlewares/requireAuth.middleware';
import { sendSuccess } from '../../../../shared/utils/returnSuccess/returnSuccess';

vi.mock('../services/transformation.service', () => ({
  transformationService: {
    createTransformation: vi.fn(),
  },
}));

vi.mock('../../../../shared/utils/returnSuccess/returnSuccess', () => ({
  sendSuccess: vi.fn(),
}));

// Payload minimal accepté par le schéma VineJS ; on y greffe des champs d'auteur/tenant usurpés
// pour prouver qu'ils ne franchissent pas le contrôleur.
const basePayload = {
  id_produit_fini: 'prod-1',
  id_materiel: 'mat-1',
  quantite_produite: 10,
  unite_code: 'kg',
  inputs: [{ id_lot_parent: 'lot-1', quantite_prelevee: 5, unite: 'kg', lot_parent_epuise: false }],
};

describe('TransformationController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(transformationService.createTransformation).mockResolvedValue({ id: 'trans-1' } as never);
  });

  describe('createTransformation', () => {
    it("scelle l'organisation et l'auteur depuis la SESSION, jamais depuis le corps", async () => {
      // Le lot produit et sa généalogie sont écrits dans l'audit WORM : si le client pouvait
      // choisir `organization_id` ou `created_by`, il choisirait qui signe et pour quel tenant.
      // Le contrôleur étale le payload PUIS réécrit ces deux champs — l'ordre est la garde.
      const req = {
        activeOrgId: 'org-1',
        auth: { user: { id: 'user-session' } },
        validatedTransformation: {
          ...basePayload,
          organization_id: 'org-USURPEE',
          created_by: 'usurpateur',
        },
      } as unknown as AuthenticatedRequest;

      await createTransformation(req, {} as Response);

      expect(transformationService.createTransformation).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: 'org-1',
          created_by: 'user-session',
        })
      );
      expect(sendSuccess).toHaveBeenCalledWith(
        {},
        201,
        expect.any(String),
        expect.objectContaining({ id: 'trans-1' })
      );
    });

    it("se replie sur req.auth.activeOrgId quand req.activeOrgId est absent", async () => {
      // requireOrgRole peut poser l'organisation dans req.auth sans renseigner req.activeOrgId ;
      // la lecture doit couvrir les deux canaux, sinon une transformation légitime part en 401.
      const req = {
        auth: { activeOrgId: 'org-auth', user: { id: 'user-session' } },
        validatedTransformation: { ...basePayload },
      } as unknown as AuthenticatedRequest;

      await createTransformation(req, {} as Response);

      expect(transformationService.createTransformation).toHaveBeenCalledWith(
        expect.objectContaining({ organization_id: 'org-auth' })
      );
    });

    it('refuse en 401 sans organisation active, sans rien écrire', async () => {
      const req = {
        auth: { user: { id: 'user-session' } },
        validatedTransformation: { ...basePayload },
      } as unknown as AuthenticatedRequest;

      await expect(createTransformation(req, {} as Response)).rejects.toMatchObject({ status: 401 });
      expect(transformationService.createTransformation).not.toHaveBeenCalled();
    });

    it('refuse en 401 sans utilisateur de session : une machine ne signe aucune généalogie', async () => {
      const req = {
        activeOrgId: 'org-1',
        auth: {},
        validatedTransformation: { ...basePayload },
      } as unknown as AuthenticatedRequest;

      await expect(createTransformation(req, {} as Response)).rejects.toMatchObject({ status: 401 });
      expect(transformationService.createTransformation).not.toHaveBeenCalled();
    });

    it('refuse en 500 si le payload validé est absent : la garde de câblage du middleware', async () => {
      // Un contrôleur monté sans son middleware de validation ne doit pas écrire à l'aveugle.
      const req = {
        activeOrgId: 'org-1',
        auth: { user: { id: 'user-session' } },
      } as unknown as AuthenticatedRequest;

      await expect(createTransformation(req, {} as Response)).rejects.toMatchObject({ status: 500 });
      expect(transformationService.createTransformation).not.toHaveBeenCalled();
    });

    it('convertit date_peremption (string) en Date pour le service, et laisse undefined si absente', async () => {
      // Le schéma valide une string ; le service attend une Date. La conversion est ici, au
      // contrôleur. (L'ancrage en fin de journée UTC, lui, relève du service — cf. #120.)
      const withDate = {
        activeOrgId: 'org-1',
        auth: { user: { id: 'user-session' } },
        validatedTransformation: { ...basePayload, date_peremption: '2026-07-20' },
      } as unknown as AuthenticatedRequest;

      await createTransformation(withDate, {} as Response);

      const passed = vi.mocked(transformationService.createTransformation).mock.calls[0][0];
      expect(passed.date_peremption).toBeInstanceOf(Date);
      expect((passed.date_peremption as Date).toISOString()).toBe(new Date('2026-07-20').toISOString());

      vi.mocked(transformationService.createTransformation).mockClear();

      const withoutDate = {
        activeOrgId: 'org-1',
        auth: { user: { id: 'user-session' } },
        validatedTransformation: { ...basePayload },
      } as unknown as AuthenticatedRequest;

      await createTransformation(withoutDate, {} as Response);

      expect(vi.mocked(transformationService.createTransformation).mock.calls[0][0].date_peremption).toBeUndefined();
    });
  });
});
