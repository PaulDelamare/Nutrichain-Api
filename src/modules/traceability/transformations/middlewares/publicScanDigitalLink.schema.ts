import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';

/**
 * Paramètres du scan public par GS1 Digital Link (`/gs1/01/{gtin}/10/{lot}`). Même contraintes
 * que la saisie d'un GTIN et d'un lot_number à la création (`customerProduct.schema.ts`,
 * `receiptPayload.schema.ts`) : un canal public non authentifié ne doit jamais laisser passer un
 * paramètre hors format jusqu'à la requête Prisma.
 */
export const publicScanDigitalLinkSchema = vine.object({
  gtin: vine
    .string()
    .trim()
    .regex(/^\d{8,14}$/),
  lot: vine
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{1,20}$/),
});

export type PublicScanDigitalLinkParams = Infer<typeof publicScanDigitalLinkSchema>;
