import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';

/**
 * Validation du déclenchement d'un rappel produit — l'action la plus critique de l'application.
 *
 * `reason` est recopié dans `Alert.message`, l'e-mail envoyé aux clients, `Batch_Mouvement.metadata`
 * et l'audit WORM, et injecté en `::text` dans la requête SQL de blocage : il DOIT être une chaîne
 * bornée. `id` (le lot source) doit être un UUID, sinon Prisma lève un 500 (P2023) au lieu d'un 404.
 */
export const recallSchema = vine.object({
  id: vine.string().uuid(),
  reason: vine.string().trim().minLength(5).maxLength(500),
});

export type RecallPayload = Infer<typeof recallSchema>;

/**
 * Simulation d'un rappel : seul le lot source est reçu, et il vient de l'URL. Aucun motif — rien
 * n'est écrit, donc il n'y a rien à justifier.
 */
export const recallSimulationSchema = vine.object({
  id: vine.string().uuid(),
});

export type RecallSimulationParams = Infer<typeof recallSimulationSchema>;
