import { describe, it, expect, vi } from 'vitest';
import { Response } from 'express';
import { validateTelemetryPing } from './validateTelemetryPing.middleware';
import { AuthenticatedRequest } from '../../identity/types/auth.types';

const tramme = (patch: Record<string, unknown> = {}) => ({
  sensor_id: 'SENSOR-FROID-A1',
  temperature: 4.2,
  humidity: 55,
  battery_level: 87,
  ...patch,
});

const buildReq = (body: unknown): AuthenticatedRequest =>
  ({ body }) as unknown as AuthenticatedRequest;

const refus = async (body: unknown) => {
  const req = buildReq(body);
  const next = vi.fn();
  await validateTelemetryPing(req, {} as Response, next);
  return next.mock.calls[0][0] as
    | { status?: number; error?: { field: string; message: string }[] }
    | undefined;
};

describe('validateTelemetryPing', () => {
  it('accepte une trame valide et la typé sur req.validatedTelemetryPing', async () => {
    const req = buildReq(tramme());
    const next = vi.fn();

    await validateTelemetryPing(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.validatedTelemetryPing).toEqual({
      sensor_id: 'SENSOR-FROID-A1',
      temperature: 4.2,
      humidity: 55,
      battery_level: 87,
    });
  });

  /**
   * ⚠️ LE test de ce correctif. `true` est la trame la plus dangereuse : sans mode strict, VineJS
   * ET Mongoose la coercent en `1`. Elle ressemble alors à une mesure valide de 1 °C, la
   * surveillance tourne, et AUCUNE excursion n'est jamais détectée. Un rejet bruyant vaut mille
   * fois mieux qu'un capteur qu'on croit surveillé.
   */
  it('refuse un booléen, qui serait sinon coercé en 1 °C et masquerait toute excursion', async () => {
    const err = await refus(tramme({ temperature: true }));

    expect(err?.status).toBe(400);
    expect(err?.error?.[0]?.field).toBe('temperature');
  });

  it('refuse une température non numérique au lieu de laisser Mongoose lever un 500', async () => {
    for (const valeur of ['n/a', null, [], {}]) {
      const err = await refus(tramme({ temperature: valeur }));
      expect(err?.status).toBe(400);
    }
  });

  it("refuse l'infini, que Mongoose enregistrerait en `null` tout en alertant sur la valeur brute", async () => {
    const err = await refus(tramme({ temperature: Infinity }));

    expect(err?.status).toBe(400);
  });

  it('refuse une température physiquement impossible', async () => {
    expect((await refus(tramme({ temperature: 9999 })))?.status).toBe(400);
    expect((await refus(tramme({ temperature: -9999 })))?.status).toBe(400);
  });

  /**
   * Une sonde 1-Wire déconnectée renvoie -127 °C, et +85 °C après un reset. Ces valeurs sont
   * ANORMALES, pas impossibles : les rejeter en 400 les ferait disparaître, alors qu'elles doivent
   * être enregistrées et déclencher l'alerte de seuil. On ne filtre pas une panne de capteur.
   */
  it('accepte les valeurs sentinelles de sonde en panne, pour qu elles alertent au lieu d etre perdues', async () => {
    for (const valeur of [-127, 85]) {
      const req = buildReq(tramme({ temperature: valeur }));
      const next = vi.fn();
      await validateTelemetryPing(req, {} as Response, next);
      expect(next).toHaveBeenCalledWith();
      expect(req.validatedTelemetryPing?.temperature).toBe(valeur);
    }
  });

  it("borne l'humidité et le niveau de batterie à un pourcentage", async () => {
    expect((await refus(tramme({ humidity: 101 })))?.status).toBe(400);
    expect((await refus(tramme({ humidity: -1 })))?.status).toBe(400);
    expect((await refus(tramme({ battery_level: 101 })))?.status).toBe(400);
    expect((await refus(tramme({ battery_level: -1 })))?.status).toBe(400);
  });

  it('exige un sensor_id non vide et borné', async () => {
    expect((await refus(tramme({ sensor_id: '' })))?.status).toBe(400);
    expect((await refus(tramme({ sensor_id: '   ' })))?.status).toBe(400);
    // 100 caractères : la borne d'`equipment.schema.ts`. Au-delà, le matériel ne serait de toute
    // façon pas enregistrable — mais en deçà, on rejetterait les trames d'un capteur pourtant créé.
    expect((await refus(tramme({ sensor_id: 'S'.repeat(101) })))?.status).toBe(400);
    const req = buildReq(tramme({ sensor_id: 'S'.repeat(100) }));
    const next = vi.fn();
    await validateTelemetryPing(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('refuse une trame incomplète', async () => {
    expect((await refus({ sensor_id: 'S1' }))?.status).toBe(400);
    expect((await refus({}))?.status).toBe(400);
  });

  it('rend les messages en français', async () => {
    const err = await refus(tramme({ temperature: 'n/a' }));

    expect(err?.error?.[0]?.message).toBe('Ce champ doit être un nombre.');
  });
});
