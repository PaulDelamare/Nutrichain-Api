import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Response } from 'express';
import { createReceiptController } from './receipt.controller';
import { receiptService } from '../services/receipt.service';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';
import { prisma } from '../../../../shared/configs/prismaClient.config';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: { member: { findFirst: vi.fn() } },
}));

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

    it("ignore un auteur déclaré dans le corps, même vraisemblable", async () => {
      // Vérifier que l'acteur déclaré est bien membre avec le bon rôle — ce que faisait la garde
      // précédente — empêche de désigner un ÉTRANGER, mais pas d'usurper un COLLÈGUE légitime.
      // Or la seule pièce d'identité de ce mode était une clé API… compilée dans le bundle mobile.
      // Le champ n'existe donc plus : ce qui n'existe pas ne se falsifie pas.
      const req = {
        activeOrgId: 'org-1',
        auth: { user: { id: 'olivia-operatrice' } },
        validatedReceipt: {
          id_fournisseur: 'supp-1',
          actorUserId: 'le-patron',
        },
      } as unknown as AuthenticatedRequest;

      await createReceiptController(req, {} as Response);

      expect(receiptService.createReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ received_by: 'olivia-operatrice' })
      );
    });

    it("refuse une réception sans session : une machine ne signe rien", async () => {
      const req = {
        activeOrgId: 'org-1',
        validatedReceipt: { id_fournisseur: 'supp-1', actorUserId: 'le-patron' },
      } as unknown as AuthenticatedRequest;

      await expect(createReceiptController(req, {} as Response)).rejects.toMatchObject({
        status: 401,
      });
      expect(receiptService.createReceipt).not.toHaveBeenCalled();
    });
  });
});
