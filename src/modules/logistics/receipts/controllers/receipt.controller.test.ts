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
    it('doit forcer received_by avec req.user.id si présent (Flux Web)', async () => {
      const req = {
        activeOrgId: 'org-1',
        user: { id: 'user-auth-123' },
        body: {
          id_fournisseur: 'supp-1',
          received_by: 'IGNORED_VALUE',
        },
        validatedReceipt: {
           id_fournisseur: 'supp-1',
           received_by: 'IGNORED_VALUE',
        }
      } as unknown as AuthenticatedRequest;
      const res = {} as Response;

      await createReceiptController(req, res);

      expect(receiptService.createReceipt).toHaveBeenCalledWith(expect.objectContaining({
        received_by: 'user-auth-123',
        organization_id: 'org-1'
      }));
    });

    it('doit garder received_by du body si req.user est absent (Flux M2M)', async () => {
      const req = {
        activeOrgId: 'org-1',
        body: {
          id_fournisseur: 'supp-1',
          received_by: 'external-system-id',
        },
        validatedReceipt: {
           id_fournisseur: 'supp-1',
           received_by: 'external-system-id',
        }
      } as unknown as AuthenticatedRequest;
      const res = {} as Response;

      await createReceiptController(req, res);

      expect(receiptService.createReceipt).toHaveBeenCalledWith(expect.objectContaining({
        received_by: 'external-system-id',
      }));
    });
  });
});
