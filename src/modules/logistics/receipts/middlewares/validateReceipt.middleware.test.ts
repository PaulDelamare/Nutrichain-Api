import { describe, it, expect, vi } from 'vitest';
import { Response } from 'express';
import { validateReceiptParams } from './validateReceipt.middleware';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';

describe('validateReceiptParams Middleware', () => {
  it('doit valider un payload correct et appeler next()', async () => {
    const req = {
      body: {
        id_fournisseur: '123e4567-e89b-12d3-a456-426614174000',
        shipment_id: 'SHIP-12345',
        id_produit: '123e4567-e89b-12d3-a456-426614174001',
        quantite_actuelle: 100.5,
        unite_code: 'KG',
        statut_controle: 'OK',
        received_by: '123e4567-e89b-12d3-a456-426614174002',
      },
    } as unknown as AuthenticatedRequest;
    const res = {} as Response;
    const next = vi.fn();

    await validateReceiptParams(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.validatedReceipt).toBeDefined();
    expect(req.validatedReceipt.quantite_actuelle).toBe(100.5);
  });

  it('doit rejeter un payload avec une quantité négative', async () => {
    const req = {
      body: {
        id_fournisseur: '123e4567-e89b-12d3-a456-426614174000',
        shipment_id: 'SHIP-12345',
        id_produit: '123e4567-e89b-12d3-a456-426614174001',
        quantite_actuelle: -10,
        unite_code: 'KG',
        statut_controle: 'OK',
        received_by: '123e4567-e89b-12d3-a456-426614174002',
      },
    } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn();

    await validateReceiptParams(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Object));
    const error = next.mock.calls[0][0];
    expect(error.status).toEqual(400);
    expect(error.error).toBeDefined();
    expect(Array.isArray(error.error)).toBe(true);
  });

  it('doit rejeter un statut_controle invalide', async () => {
    const req = {
      body: {
        id_fournisseur: '123e4567-e89b-12d3-a456-426614174000',
        shipment_id: 'SHIP-12345',
        id_produit: '123e4567-e89b-12d3-a456-426614174001',
        quantite_actuelle: 10,
        unite_code: 'KG',
        statut_controle: 'PAS_BON',
        received_by: '123e4567-e89b-12d3-a456-426614174002',
      },
    } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn();

    await validateReceiptParams(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBeDefined();
  });
});
