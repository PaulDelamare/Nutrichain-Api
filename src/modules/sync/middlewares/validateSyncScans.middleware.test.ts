import { describe, it, expect, vi } from 'vitest';
import { Response } from 'express';
import { validateSyncScans } from './validateSyncScans.middleware';
import { AuthenticatedRequest } from '../../identity/types/auth.types';

const validReceiptPayload = {
  id_fournisseur: '123e4567-e89b-12d3-a456-426614174000',
  shipment_id: 'SHIP-001',
  id_produit: '123e4567-e89b-12d3-a456-426614174001',
  quantite_actuelle: 100,
  unite_code: 'KG',
  statut_controle: 'OK',
};

const validItem = {
  clientOpId: '550e8400-e29b-41d4-a716-446655440000',
  type: 'receipt',
  payload: validReceiptPayload,
};

const buildReq = (body: unknown): AuthenticatedRequest =>
  ({ body }) as unknown as AuthenticatedRequest;

const runAndCaptureError = async (body: unknown) => {
  const req = buildReq(body);
  const next = vi.fn();
  await validateSyncScans(req, {} as Response, next);
  expect(next).toHaveBeenCalled();
  return next.mock.calls[0][0] as { status?: number; error?: { field: string }[] } | undefined;
};

describe('validateSyncScans Middleware', () => {
  it('valide un payload correct et attache req.validatedSyncScans', async () => {
    const req = buildReq({ items: [validItem] });
    const next = vi.fn();
    await validateSyncScans(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.validatedSyncScans?.items).toHaveLength(1);
    expect(req.validatedSyncScans?.items[0].clientOpId).toBe(validItem.clientOpId);
  });

  it('rejette si items est vide (min 1)', async () => {
    const err = await runAndCaptureError({ items: [] });
    expect(err?.status).toBe(400);
    expect(err?.error?.some((e) => e.field === 'items')).toBe(true);
  });

  it('accepte exactement 100 items (boundary)', async () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      ...validItem,
      clientOpId: '550e8400-e29b-41d4-a716-446655440000'.replace(
        /.{12}$/,
        String(i).padStart(12, '4')
      ),
      payload: { ...validReceiptPayload, shipment_id: `SHIP-${i}` },
    }));
    const req = buildReq({ items });
    const next = vi.fn();
    await validateSyncScans(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('rejette si items dépasse 100 (DoS guard)', async () => {
    const items = Array.from({ length: 101 }, (_, i) => ({
      ...validItem,
      clientOpId: '550e8400-e29b-41d4-a716-446655440000'.replace(
        /.{12}$/,
        String(i).padStart(12, '4')
      ),
      payload: { ...validReceiptPayload, shipment_id: `SHIP-${i}` },
    }));
    const err = await runAndCaptureError({ items });
    expect(err?.status).toBe(400);
  });

  it('rejette si clientOpId est manquant', async () => {
    const err = await runAndCaptureError({
      items: [{ type: 'receipt', payload: validReceiptPayload }],
    });
    expect(err?.status).toBe(400);
  });

  it("rejette si clientOpId n'est pas un UUID", async () => {
    const err = await runAndCaptureError({ items: [{ ...validItem, clientOpId: 'not-a-uuid' }] });
    expect(err?.status).toBe(400);
  });

  it("rejette si type est inconnu (v1 n'accepte que 'receipt')", async () => {
    const err = await runAndCaptureError({ items: [{ ...validItem, type: 'transformation' }] });
    expect(err?.status).toBe(400);
  });

  it('rejette un payload receipt avec quantite_actuelle négative', async () => {
    const err = await runAndCaptureError({
      items: [{ ...validItem, payload: { ...validReceiptPayload, quantite_actuelle: -5 } }],
    });
    expect(err?.status).toBe(400);
  });

  it("ignore un auteur déclaré dans le corps : le payload n'en porte plus", async () => {
    // Le champ a disparu du schéma. VineJS ignore les clés inconnues — l'important est qu'aucun
    // code en aval ne puisse le relire : l'auteur des scans vient de la session, point.
    const err = await runAndCaptureError({
      items: [validItem],
      actorUserId: 'usurpateur',
    });
    expect(err).toBeUndefined();
  });

  it('rejette un statut_controle hors de l enum', async () => {
    const err = await runAndCaptureError({
      items: [{ ...validItem, payload: { ...validReceiptPayload, statut_controle: 'BIDON' } }],
    });
    expect(err?.status).toBe(400);
  });

  /**
   * Protection contre la dérive du shared schema `receiptPayloadFields` :
   * si quelqu'un rend un champ `.optional()` dans le schéma partagé, ces tests
   * cassent immédiatement et signalent la régression côté sync.
   */
  describe('shared receiptPayloadFields — champs requis (regression guards)', () => {
    const requiredFields = [
      'id_fournisseur',
      'shipment_id',
      'id_produit',
      'quantite_actuelle',
      'unite_code',
      'statut_controle',
    ] as const;

    for (const field of requiredFields) {
      it(`rejette si le champ '${field}' est manquant dans payload`, async () => {
        const payload: Record<string, unknown> = { ...validReceiptPayload };
        delete payload[field];
        const err = await runAndCaptureError({
          items: [{ ...validItem, payload }],
        });
        expect(err?.status).toBe(400);
        // On vérifie que VineJS pointe bien sur le champ omis (pas un autre)
        expect(err?.error?.some((e) => e.field.includes(field))).toBe(true);
      });
    }
  });
});
