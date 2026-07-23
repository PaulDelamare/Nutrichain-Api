import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';

/**
 * Types de matériel du plan d'usine. Restreints : le type pilote la surveillance IoT
 * (un FRIGO ou un CONGELATEUR a un seuil de température, pas une étagère).
 */
export const EQUIPMENT_TYPES = ['FRIGO', 'CONGELATEUR', 'CUVE', 'ETAGERE', 'MIXEUR'] as const;

/**
 * Matériel où un lot se STOCKE (donc où on peut le déplacer). CUVE et MIXEUR sont des équipements de
 * transformation : un lot n'y « est rangé » que le temps d'une transformation, jamais par un
 * déplacement manuel de stock.
 */
export const STORAGE_EQUIPMENT_TYPES: readonly (typeof EQUIPMENT_TYPES)[number][] = [
  'FRIGO',
  'CONGELATEUR',
  'ETAGERE',
];

export const createEquipmentSchema = vine.object({
  nom: vine.string().trim().minLength(3).maxLength(100),
  type: vine.enum(EQUIPMENT_TYPES),
  id_lieu: vine.string().uuid(),
  temp_seuil_max: vine.number().optional(),
  sensor_id: vine.string().trim().maxLength(100).optional(),
});

export type CreateEquipmentPayload = Infer<typeof createEquipmentSchema>;
