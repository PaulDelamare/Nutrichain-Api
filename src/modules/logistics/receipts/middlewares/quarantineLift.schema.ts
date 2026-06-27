import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';

/**
 * Payload de levée de quarantaine d'un lot (POST /logistics/batches/:id/release).
 * Le motif est obligatoire : une levée de quarantaine est une décision qualité
 * qui doit être justifiée et tracée dans l'audit WORM.
 */
export const quarantineLiftSchema = vine.object({
  motif: vine.string().trim().minLength(3).maxLength(500),
});

export type QuarantineLiftPayload = Infer<typeof quarantineLiftSchema>;
