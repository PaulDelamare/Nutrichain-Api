import { describe, it, expect } from 'vitest';
import { prisma } from '../../configs/prismaClient.config';
import { nextSsccSerial } from './ssccSerial';

/**
 * `nextval` sur une séquence PostgreSQL réelle : un mock Prisma ne peut ni la posséder ni prouver
 * qu'elle réserve un numéro (jamais deux appels concurrents ne reçoivent la même valeur) — c'est
 * exactement ce qu'un `count()` mocké laisserait passer à tort (#124, #150).
 */
describe('nextSsccSerial — réservation de série SSCC (PostgreSQL réel)', () => {
  it('attribue une valeur STRICTEMENT distincte à chaque appel concurrent, sans doublon', async () => {
    const CONCURRENCY = 25;

    const serials = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => nextSsccSerial(prisma))
    );

    expect(new Set(serials).size).toBe(CONCURRENCY);
    for (const serial of serials) {
      expect(Number.isInteger(serial)).toBe(true);
      expect(serial).toBeGreaterThan(0);
    }
  });
});
