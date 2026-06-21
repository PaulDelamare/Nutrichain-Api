import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';

/**
 * Schéma d'une ligne de tiers (client) importée depuis un ERP (CSV).
 * `external_ref` = identifiant du client côté ERP, clé d'idempotence de l'import.
 * Les champs de contact sont optionnels (cellule CSV vide = absent).
 */
export const customerImportRowSchema = vine.object({
  external_ref: vine.string().trim().minLength(1).maxLength(100),
  nom_enseigne: vine.string().trim().minLength(1).maxLength(200),
  email: vine.string().trim().email().maxLength(200).optional(),
  contact_urgence: vine.string().trim().maxLength(50).optional(),
  adresse_livraison: vine.string().trim().minLength(1).maxLength(300),
  notes: vine.string().trim().maxLength(1000).optional(),
});

export type CustomerImportRow = Infer<typeof customerImportRowSchema>;
