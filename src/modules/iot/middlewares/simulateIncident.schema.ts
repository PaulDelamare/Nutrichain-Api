import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';

/**
 * Corps de `POST /api/telemetry/simulate-incident`.
 *
 * `equipmentId` est OPTIONNEL : fourni, il cible un frigo précis ; absent, le service choisit
 * automatiquement un matériel apte (bouton one-click en démonstration). On valide tout de même son
 * format quand il est présent — un identifiant malformé est refusé à la frontière, en 400 et en
 * français, plutôt que de partir en requête base pour rien.
 */
export const simulateIncidentSchema = vine.object({
  equipmentId: vine.string().uuid().optional(),
});

export type SimulateIncidentPayload = Infer<typeof simulateIncidentSchema>;
