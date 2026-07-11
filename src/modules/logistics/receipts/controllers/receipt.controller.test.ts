import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Response } from 'express';
import { createReceiptController } from './receipt.controller';
import { receiptService } from '../services/receipt.service';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';

vi.mock('../services/receipt.service', () => ({
  receiptService: {
    createReceipt: vi.fn(),
  },
}));

vi.mock('../../../../shared/utils/returnSuccess/returnSuccess', () => ({
  sendSuccess: vi.fn(),
}));

describe('ReceiptController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createReceiptController', () => {
    it("doit forcer received_by avec l'utilisateur de la SESSION, jamais celui du body", async () => {
      // La route passe par `mixedAuth`, qui remplit `req.auth.user` — et NON `req.user`, que
      // seul `requireAuth` pose. L'ancien test mockait `req.user`, un état que la route ne
      // produit jamais : il était vert sur du code cassé, et le champ du body gagnait
      // toujours. L'auteur scellé dans la chaîne d'audit était donc choisi par le client.
      const req = {
        activeOrgId: 'org-1',
        auth: { user: { id: 'user-auth-123' } },
        validatedReceipt: {
          id_fournisseur: 'supp-1',
          received_by: 'VALEUR_USURPEE',
        },
      } as unknown as AuthenticatedRequest;
      const res = {} as Response;

      await createReceiptController(req, res);

      expect(receiptService.createReceipt).toHaveBeenCalledWith(
        expect.objectContaining({
          received_by: 'user-auth-123',
          organization_id: 'org-1',
        })
      );
    });

    it('doit garder received_by du body quand aucune session ne porte la requête (M2M)', async () => {
      // Les intégrations machine (connecteurs, IoT) n'ont pas de session : le payload reste
      // leur seul moyen de désigner l'opérateur. Le service vérifie ensuite son appartenance
      // à l'organisation.
      const req = {
        activeOrgId: 'org-1',
        validatedReceipt: {
          id_fournisseur: 'supp-1',
          received_by: 'external-system-id',
        },
      } as unknown as AuthenticatedRequest;
      const res = {} as Response;

      await createReceiptController(req, res);

      expect(receiptService.createReceipt).toHaveBeenCalledWith(
        expect.objectContaining({
          received_by: 'external-system-id',
        })
      );
    });
  });
});
