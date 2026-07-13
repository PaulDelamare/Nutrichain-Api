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

    it('en M2M, l acteur declare doit etre membre de l organisation', async () => {
      // Avant : le `received_by` du corps de requête était scellé tel quel dans l'audit WORM,
      // sans AUCUNE vérification d'appartenance — n'importe quel utilisateur, y compris d'une
      // autre organisation, pouvait être désigné comme auteur d'une réception.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.member.findFirst).mockResolvedValue({ id: 'member-1' } as any);

      const req = {
        activeOrgId: 'org-1',
        validatedReceipt: {
          id_fournisseur: 'supp-1',
          actorUserId: 'operateur-de-l-org',
        },
      } as unknown as AuthenticatedRequest;

      await createReceiptController(req, {} as Response);

      expect(prisma.member.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'operateur-de-l-org',
            organizationId: 'org-1',
          }),
        })
      );
      expect(receiptService.createReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ received_by: 'operateur-de-l-org' })
      );
    });

    it('en M2M, un acteur qui n appartient PAS a l organisation est refuse (403)', async () => {
      vi.mocked(prisma.member.findFirst).mockResolvedValue(null);

      const req = {
        activeOrgId: 'org-1',
        validatedReceipt: {
          id_fournisseur: 'supp-1',
          actorUserId: 'utilisateur-d-une-autre-org',
        },
      } as unknown as AuthenticatedRequest;

      await expect(createReceiptController(req, {} as Response)).rejects.toMatchObject({
        status: 403,
      });
      expect(receiptService.createReceipt).not.toHaveBeenCalled();
    });
  });
});
