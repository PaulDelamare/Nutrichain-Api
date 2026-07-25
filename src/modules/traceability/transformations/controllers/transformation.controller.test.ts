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

// Payload minimal accepté par le schéma VineJS. Les champs d'auteur/tenant greffés plus bas sont
// déjà éliminés en amont — `vine.object` ne restitue que les clés déclarées — donc le contrôleur ne
// les verra jamais par la route. On les injecte quand même : c'est le seul moyen de figer l'ordre
// du spread, qui est ce qui rendrait l'usurpation possible si le middleware sautait un jour.
const basePayload = {
  id_produit_fini: 'prod-1',
  id_materiel: 'mat-1',
  quantite_produite: 10,
  unite_code: 'kg',
  inputs: [{ id_lot_parent: 'lot-1', quantite_prelevee: 5, unite: 'kg' }],
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
        'Transformation enregistrée avec succès. Stock et généalogie mis à jour.',
        expect.objectContaining({ id: 'trans-1' })
      );
    });

    it("se replie sur req.auth.activeOrgId — branche defensive, non atteignable par la route", async () => {
      // À la date de ce test, AUCUN middleware ne produit cet état : `requireOrgRole` pose
      // `req.auth.activeOrgId` ET `req.activeOrgId` (requireOrgRole.middleware.ts:55-62), et
      // `checkApiKey`/`machineAuth` posent `req.activeOrgId` sans `req.auth`. Le repli du
      // contrôleur est donc du code défensif : on le fige tel quel plutôt que de laisser croire
      // qu'il couvre un scénario réel.
      const req = {
        auth: { activeOrgId: 'org-auth', user: { id: 'user-session' } },
        validatedTransformation: { ...basePayload },
      } as unknown as AuthenticatedRequest;

      await createTransformation(req, {} as Response);

      expect(transformationService.createTransformation).toHaveBeenCalledWith(
        expect.objectContaining({ organization_id: 'org-auth' })
      );
    });

    // Les deux refus ci-dessous sont des gardes de dernier recours : par la route, `requireOrgRole`
    // répond 400 sans organisation active et 401 sans session, bien avant le contrôleur. Ils valent
    // pour un montage futur qui oublierait la garde, pas comme description du comportement observé.
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
      // Valeur littérale, et non `new Date('2026-07-20').toISOString()` : reconstruire l'attendu
      // avec l'expression de production rend l'assertion increvable, un décalage de fuseau se
      // refléterait des deux côtés.
      expect((passed.date_peremption as Date).toISOString()).toBe('2026-07-20T00:00:00.000Z');

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
