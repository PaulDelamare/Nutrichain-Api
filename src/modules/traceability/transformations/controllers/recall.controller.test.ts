import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Response } from 'express';
import { getBatchGenealogy, triggerRecall } from './recall.controller';
import { genealogyService } from '../services/genealogy.service';
import { recallService } from '../services/recall.service';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';

vi.mock('../services/genealogy.service', () => ({
  genealogyService: {
    getUpstream: vi.fn(),
    getDownstream: vi.fn(),
    getOrigins: vi.fn(),
  },
}));

vi.mock('../services/recall.service', () => ({
  recallService: {
    triggerRecall: vi.fn(),
  },
}));

// `res` reel plutot que `sendSuccess` mocke : on veut voir le vrai code HTTP et le vrai corps,
// pas seulement l'intention de repondre.
function createRes(): Response {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

const UUID = '11111111-1111-1111-1111-111111111111';

describe('RecallController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getBatchGenealogy', () => {
    // Garde de dernier recours : par la route, `requireOrgRole` repond 400 sans organisation
    // active, bien avant le controleur. Ce 401 vaut pour un montage qui oublierait la garde.
    it("refuse (401) et n'interroge aucune genealogie sans organisation active", async () => {
      const req = { params: { id: UUID } } as unknown as AuthenticatedRequest;

      await expect(getBatchGenealogy(req, createRes())).rejects.toMatchObject({ status: 401 });
      expect(genealogyService.getUpstream).not.toHaveBeenCalled();
      expect(genealogyService.getDownstream).not.toHaveBeenCalled();
      expect(genealogyService.getOrigins).not.toHaveBeenCalled();
    });

    // « transmet », et non « cloisonne » : le filtrage par organisation vit dans genealogy.service,
    // qui est mocké ici. Retirer `organization_id` de ses `where` Prisma ne ferait pas rougir ce
    // fichier — seul un test de service ou de route le verrait.
    it("transmet l'organisation de la SESSION aux trois requetes de genealogie", async () => {
      vi.mocked(genealogyService.getUpstream).mockResolvedValue([]);
      vi.mocked(genealogyService.getDownstream).mockResolvedValue([]);
      vi.mocked(genealogyService.getOrigins).mockResolvedValue([]);

      const req = {
        params: { id: UUID },
        activeOrgId: 'org-1',
      } as unknown as AuthenticatedRequest;
      const res = createRes();

      await getBatchGenealogy(req, res);

      expect(genealogyService.getUpstream).toHaveBeenCalledWith(UUID, 'org-1');
      expect(genealogyService.getDownstream).toHaveBeenCalledWith(UUID, 'org-1');
      expect(genealogyService.getOrigins).toHaveBeenCalledWith(UUID, 'org-1');
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("expose les points d'origine (fournisseur) : sans ce champ, la remontee amont perd la ferme", async () => {
      const origines = [
        { lot_number: 'LAIT-001', fournisseur: { id: 'f-1', nom_ferme: 'Ferme du Val' } },
      ];
      vi.mocked(genealogyService.getUpstream).mockResolvedValue([]);
      vi.mocked(genealogyService.getDownstream).mockResolvedValue([]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(genealogyService.getOrigins).mockResolvedValue(origines as any);

      const req = {
        params: { id: UUID },
        activeOrgId: 'org-1',
      } as unknown as AuthenticatedRequest;
      const res = createRes();

      await getBatchGenealogy(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ batchId: UUID, origines }),
        })
      );
    });

    // Branche defensive, non atteignable par la route : `requireOrgRole` pose `req.auth.activeOrgId`
    // ET `req.activeOrgId` (requireOrgRole.middleware.ts:55-62), et sans organisation active il
    // repond 400 avant meme d'atteindre le controleur. On fige le repli, sans pretendre qu'un
    // middleware le produit.
    it("retombe sur l'organisation de req.auth — branche defensive, non atteignable par la route", async () => {
      vi.mocked(genealogyService.getUpstream).mockResolvedValue([]);
      vi.mocked(genealogyService.getDownstream).mockResolvedValue([]);
      vi.mocked(genealogyService.getOrigins).mockResolvedValue([]);

      const req = {
        params: { id: UUID },
        auth: { activeOrgId: 'org-9' },
      } as unknown as AuthenticatedRequest;
      const res = createRes();

      await getBatchGenealogy(req, res);

      expect(genealogyService.getUpstream).toHaveBeenCalledWith(UUID, 'org-9');
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('triggerRecall', () => {
    it('refuse (401) et ne declenche AUCUN rappel sans utilisateur en session', async () => {
      const req = {
        activeOrgId: 'org-1',
        validatedRecall: { id: UUID, reason: 'Listeria detectee' },
      } as unknown as AuthenticatedRequest;

      await expect(triggerRecall(req, createRes())).rejects.toMatchObject({ status: 401 });
      expect(recallService.triggerRecall).not.toHaveBeenCalled();
    });

    it('refuse (401) et ne declenche AUCUN rappel sans organisation active', async () => {
      const req = {
        auth: { user: { id: 'quality-user' } },
        validatedRecall: { id: UUID, reason: 'Listeria detectee' },
      } as unknown as AuthenticatedRequest;

      await expect(triggerRecall(req, createRes())).rejects.toMatchObject({ status: 401 });
      expect(recallService.triggerRecall).not.toHaveBeenCalled();
    });

    it("l'auteur du rappel vient de la SESSION : passe (lot, org, userId, motif) au service", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(recallService.triggerRecall).mockResolvedValue({ blockedCount: 3 } as any);

      const req = {
        activeOrgId: 'org-1',
        auth: { user: { id: 'quality-user' } },
        validatedRecall: { id: UUID, reason: 'Listeria detectee sur le lot' },
      } as unknown as AuthenticatedRequest;
      const res = createRes();

      await triggerRecall(req, res);

      expect(recallService.triggerRecall).toHaveBeenCalledWith(
        UUID,
        'org-1',
        'quality-user',
        'Listeria detectee sur le lot'
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: { blockedCount: 3 } })
      );
    });
  });
});
