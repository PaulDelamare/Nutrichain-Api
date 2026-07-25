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
  // DLC du produit fini. Un JOUR, pas un instant — le service l'ancre en fin de journée UTC et
  // refuse un jour inexistant (cf. #120, même garde que la réception : `receiptPayload.schema.ts`).
  date_peremption: vine
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  note_technique: vine.record(vine.any()).optional(),
  // Clé d'idempotence optionnelle : si le mobile la fournit, un rejeu (coupure réseau) renvoie le
  // résultat du premier appel au lieu de re-prélever les lots parents. Absente = comportement direct.
  client_op_id: vine.string().uuid().optional(),

  // Liste des composants utilisés (limité à 50 pour éviter les DoS).
  // Pas de `lot_parent_epuise` ici : l'épuisement est dérivé du stock restant côté serveur
  // (transformation.service.ts), jamais déclaré par l'appelant (cf. #123).
  inputs: vine
    .array(
      vine.object({
        id_lot_parent: vine.string().uuid(),
        quantite_prelevee: vine.number().positive().decimal([0, 2]),
        unite: vine.enum(VALID_UNITS),
      })
    )
    .minLength(1)
    .maxLength(50),
});

export type TransformationPayload = Infer<typeof transformationSchema>;
