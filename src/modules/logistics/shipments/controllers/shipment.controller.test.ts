import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Response } from 'express';
import { createShipmentController } from './shipment.controller';
import { shipmentService } from '../services/shipment.service';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';

vi.mock('../services/shipment.service', () => ({
  shipmentService: { createShipment: vi.fn() },
}));

vi.mock('../../../../shared/utils/returnSuccess/returnSuccess', () => ({
  sendSuccess: vi.fn(),
}));

const PAYLOAD = {
  id_client: 'client-1',
  shipment_id: 'EXP-001',
  transporteur: 'Transports Martin',
  destination_adresse: '12 rue des Halles, Paris',
  lots: [{ id_lot: 'lot-1', quantite_expediee: 10 }],
};

describe('createShipmentController', () => {
  beforeEach(() => vi.clearAllMocks());

  it("identifie l'auteur depuis la SESSION, sans exiger created_by dans le corps", async () => {
    // La route passe par `sessionAuth`, qui remplit `req.auth.user` — et NON `req.user`, que
    // seul `requireAuth` pose. Le contrôleur ne lisait que `req.user` : AUCUNE session ne
    // pouvait être identifiée, et toute expédition partait en 401. L'endpoint était de fait
    // inutilisable — ce qui explique qu'il n'ait jamais eu le moindre appelant.
    const req = {
      activeOrgId: 'org-1',
      auth: { user: { id: 'user-session' } },
      validatedShipment: PAYLOAD,
    } as unknown as AuthenticatedRequest;

    await createShipmentController(req, {} as Response);

    expect(shipmentService.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({ created_by: 'user-session', organization_id: 'org-1' })
    );
  });

  it('ignore le created_by du corps quand une session porte la requête', async () => {
    // Sinon l'opérateur pourrait faire signer son expédition par quelqu'un d'autre.
    const req = {
      activeOrgId: 'org-1',
      auth: { user: { id: 'user-session' } },
      validatedShipment: { ...PAYLOAD, created_by: 'usurpateur' },
    } as unknown as AuthenticatedRequest;

    await createShipmentController(req, {} as Response);

    expect(shipmentService.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({ created_by: 'user-session' })
    );
  });

  it('refuse un created_by déclaré par le client, même sans session', async () => {
    // Ce test affirmait l'inverse (« accepte created_by en machine-à-machine »). C'est la
    // signature d'une expédition offerte à qui la demande : le champ n'existe plus au schéma, et
    // même s'il revenait, l'auteur reste introuvable sans session.
    const req = {
      activeOrgId: 'org-1',
      validatedShipment: { ...PAYLOAD, created_by: 'connecteur-erp' },
    } as unknown as AuthenticatedRequest;

    await expect(createShipmentController(req, {} as Response)).rejects.toMatchObject({
      status: 401,
    });
    expect(shipmentService.createShipment).not.toHaveBeenCalled();
  });

  it('refuse une expédition dont l’auteur ne peut pas être établi', async () => {
    const req = {
      activeOrgId: 'org-1',
      validatedShipment: PAYLOAD,
    } as unknown as AuthenticatedRequest;

    await expect(createShipmentController(req, {} as Response)).rejects.toMatchObject({
      status: 401,
    });
    expect(shipmentService.createShipment).not.toHaveBeenCalled();
  });
});
