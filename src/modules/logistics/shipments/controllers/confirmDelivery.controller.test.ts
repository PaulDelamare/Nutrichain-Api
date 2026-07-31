import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import { confirmDeliveryController } from './shipment.controller';
import { shipmentService } from '../services/shipment.service';
import type { AuthenticatedRequest } from '../../../identity/types/auth.types';

vi.mock('../services/shipment.service', () => ({
  shipmentService: { confirmDelivery: vi.fn() },
}));

const confirmer = vi.mocked(shipmentService.confirmDelivery);

function reponse() {
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
  vi.mocked(res.status).mockReturnValue(res);
  vi.mocked(res.json).mockReturnValue(res);
  return res;
}

function requete(overrides: Record<string, unknown> = {}): AuthenticatedRequest {
  return {
    params: { id: 'exp-1' },
    validatedShipmentIdParam: { id: 'exp-1' },
    validatedConfirmDelivery: {},
    activeOrgId: 'org-1',
    auth: { user: { id: 'user-1' } },
    ...overrides,
  } as unknown as AuthenticatedRequest;
}

const suivant = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  confirmer.mockResolvedValue({ id: 'exp-1', lots_livres: 1 } as any);
});

/**
 * Le contrôleur n'était couvert par RIEN : le test de route mocke le contrôleur, le test de service
 * l'appelle en direct. Une mutation l'a prouvé — remplacer la date transmise par `undefined` et
 * l'organisation par une valeur de repli laissait 227 tests verts. Tout le chemin d'entrée de
 * `date_livraison` était donc affirmé par le Swagger et prouvé par personne.
 */
describe('confirmDeliveryController — ce qui arrive réellement au service', () => {
  it("transmet l'identifiant VALIDÉ, pas le paramètre brut", async () => {
    const req = requete({ params: { id: 'brut' }, validatedShipmentIdParam: { id: 'valide' } });

    await confirmDeliveryController(req, reponse(), suivant);

    expect(confirmer).toHaveBeenCalledWith('valide', expect.anything(), expect.anything());
  });

  it("transmet l'organisation de la session", async () => {
    await confirmDeliveryController(requete(), reponse(), suivant);

    expect(confirmer).toHaveBeenCalledWith('exp-1', 'org-1', expect.anything());
  });

  // Sans ce cas, le contrôleur pouvait jeter la date : les bornes du service n'étaient jamais
  // atteintes par une requête HTTP, et le Swagger annonçait une garantie inexistante.
  it('transmet la date de livraison saisie', async () => {
    const date = new Date('2026-07-30T14:00:00Z');
    const req = requete({ validatedConfirmDelivery: { date_livraison: date } });

    await confirmDeliveryController(req, reponse(), suivant);

    expect(confirmer).toHaveBeenCalledWith(
      'exp-1',
      'org-1',
      expect.objectContaining({ dateLivraison: date })
    );
  });

  it("transmet l'auteur de la session, et jamais un auteur du corps", async () => {
    const req = requete({
      body: { delivered_by: 'usurpateur', delivered_by_label: 'Transports Pirate' },
    });

    await confirmDeliveryController(req, reponse(), suivant);

    const passe = confirmer.mock.calls[0][2];
    expect(passe.userId).toBe('user-1');
    expect(passe).not.toHaveProperty('label');
  });

  // `catchAsync` ne rejette pas : il relaie au gestionnaire d'erreurs global. C'est `next` qu'il
  // faut interroger, sinon le test passerait sur un contrôleur qui n'échoue jamais.
  it('refuse en 401 sans utilisateur de session', async () => {
    await confirmDeliveryController(requete({ auth: undefined }), reponse(), suivant);

    expect(suivant).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
    expect(confirmer).not.toHaveBeenCalled();
  });

  it('refuse en 500 si la validation n’a pas tourné — la route est mal câblée', async () => {
    await confirmDeliveryController(
      requete({ validatedShipmentIdParam: undefined }),
      reponse(),
      suivant
    );

    expect(suivant).toHaveBeenCalledWith(expect.objectContaining({ status: 500 }));
    expect(confirmer).not.toHaveBeenCalled();
  });
});
