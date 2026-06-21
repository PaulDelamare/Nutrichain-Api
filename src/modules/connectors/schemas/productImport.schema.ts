import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';

/**
 * Schéma d'une ligne de catalogue produit importée depuis un ERP (CSV).
 * Les valeurs arrivent en chaînes (CSV) ; VineJS coerce les nombres.
 */
export const productImportRowSchema = vine.object({
  nom: vine.string().trim().minLength(1).maxLength(200),
  code_gtin: vine.string().trim().minLength(8).maxLength(14),
  categorie: vine.string().trim().minLength(1).maxLength(100),
  duree_conservation_defaut: vine.number().positive(),
  seuil_alerte_stock: vine.number().min(0),
  unite_reference: vine.string().trim().minLength(1).maxLength(10),
});

export type ProductImportRow = Infer<typeof productImportRowSchema>;
