import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';

/**
 * Payload de mise au rebut d'un lot (POST /logistics/batches/:id/scrap).
 * Le motif est obligatoire : une destruction est une décision tracée dans l'audit WORM,
 * seule preuve de destruction opposable en cas de contrôle sanitaire.
 */
export const scrapSchema = vine.object({
  motif: vine.string().trim().minLength(3).maxLength(500),
});

export type ScrapPayload = Infer<typeof scrapSchema>;
