import { describe, it, expect } from 'vitest';
import { parseExpiryDay } from './expiryDate';
import { APIError } from '../errorHandler/APIError';

describe('parseExpiryDay', () => {
  const farFutureDay = () => new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString().slice(0, 10);

  it('ancre en fin de journée UTC : un lot dont la DLC est ce jour reste consommable jusqu au soir', () => {
    const day = farFutureDay();

    expect(parseExpiryDay(day).toISOString()).toBe(`${day}T23:59:59.999Z`);
  });

  it("rejette (400) un jour inexistant comme 2026-02-30 au lieu de le reporter silencieusement au 2 mars", () => {
    let caught: unknown;
    try {
      parseExpiryDay('2099-02-30');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(APIError);
    expect((caught as APIError).status).toBe(400);
    expect((caught as APIError).body.error[0].message).toContain('inexistante');
  });

  it('rejette (400) une DLC déjà passée', () => {
    let caught: unknown;
    try {
      parseExpiryDay('2020-01-01');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(APIError);
    expect((caught as APIError).status).toBe(400);
    expect((caught as APIError).body.error[0].message).toContain('déjà périmé');
  });
});
