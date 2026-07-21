import { Prisma } from '@prisma/client';

/**
 * Réserve un numéro de série pour un SSCC généré.
 *
 * `nextval` est une **réservation**, là où le `count()` d'avant n'était qu'une lecture : deux
 * expéditions simultanées obtenaient le même numéro, fabriquaient le même SSCC, et la seconde
 * mourait sur un P2002 — un geste métier parfaitement légitime perdu devant le camion (#124).
 *
 * La séquence est hors transaction : elle ne se rejoue pas sur rollback, et ne crée donc aucun
 * point de contention entre expéditions concurrentes. Elle laisse des trous, sans conséquence :
 * un serial GS1 doit être unique, pas contigu.
 */
export const nextSsccSerial = async (tx: Prisma.TransactionClient): Promise<number> => {
  const [row] = await tx.$queryRaw<{ serial: bigint }[]>`SELECT nextval('sscc_serial_seq') AS serial`;

  return Number(row.serial);
};
