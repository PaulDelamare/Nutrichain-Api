import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';

/**
 * Déplacement d'un lot vers un autre emplacement. Le seul champ est le matériel cible :
 * l'existence, le cloisonnement et le type (stockage) sont vérifiés dans le service.
 */
export const moveBatchSchema = vine.object({
  id_materiel: vine.string().uuid(),
});

export type MoveBatchPayload = Infer<typeof moveBatchSchema>;
