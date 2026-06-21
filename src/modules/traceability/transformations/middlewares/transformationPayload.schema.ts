import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';
import { VALID_UNITS } from '../../../../shared/constants/units.constants';

/**
 * Schéma de validation d'une transformation (POST /traceability/transformations).
 * Un produit fini est créé à partir d'un ou plusieurs composants (lots parents).
 * Source du type `TransformationPayload` consommé via `req.validatedTransformation`.
 */
export const transformationSchema = vine.object({
  id_produit_fini: vine.string().uuid(),
  id_materiel: vine.string().uuid(),
  quantite_produite: vine.number().positive().decimal([0, 2]),
  unite_code: vine.enum(VALID_UNITS),
  date_peremption: vine.string().optional(),
  note_technique: vine.record(vine.any()).optional(),

  // Liste des composants utilisés (limité à 50 pour éviter les DoS)
  inputs: vine
    .array(
      vine.object({
        id_lot_parent: vine.string().uuid(),
        quantite_prelevee: vine.number().positive().decimal([0, 2]),
        unite: vine.enum(VALID_UNITS),
        lot_parent_epuise: vine.boolean(),
      })
    )
    .minLength(1)
    .maxLength(50),
});

export type TransformationPayload = Infer<typeof transformationSchema>;
