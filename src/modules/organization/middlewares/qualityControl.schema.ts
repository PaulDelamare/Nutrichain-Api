import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';
import { QUALITY_RESULT_VALUES } from '../../logistics/constants/logistics.constants';

/**
 * Saisie d'un contrôle qualité.
 *
 * `resultat` est restreint : il PILOTE le statut du lot (libération ou quarantaine). Un texte
 * libre rendrait la décision sanitaire impilotable — la base contient d'ailleurs encore des
 * valeurs héritées comme « NON_CONFORME — QUARANTAINE », illisibles pour la machine.
 *
 * `id_user_labo` n'est PAS dans le payload : l'auteur d'une décision qualité vient de la session.
 */
export const createQualityControlSchema = vine.object({
  id_lot: vine.string().uuid(),
  type_test: vine.string().trim().minLength(3).maxLength(120),
  resultat: vine.enum(QUALITY_RESULT_VALUES as unknown as string[]),
  notes: vine.string().trim().maxLength(1000).optional(),
  certificat_pdf: vine.string().trim().maxLength(500).optional(),
});

export type CreateQualityControlPayload = Infer<typeof createQualityControlSchema>;
