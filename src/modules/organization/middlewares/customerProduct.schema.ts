import vine from '@vinejs/vine';
import { makeBodyValidator } from './referenceData.schema';

// Client
const createCustomerSchema = vine.object({
  nom_enseigne: vine.string().trim().minLength(2).maxLength(120),
  adresse_livraison: vine.string().trim().minLength(2).maxLength(200),
  contact_urgence: vine.string().trim().maxLength(120).optional(),
  email: vine.string().trim().email().optional(),
  notes: vine.string().trim().maxLength(500).optional(),
});

const updateCustomerSchema = vine.object({
  nom_enseigne: vine.string().trim().minLength(2).maxLength(120).optional(),
  adresse_livraison: vine.string().trim().minLength(2).maxLength(200).optional(),
  contact_urgence: vine.string().trim().maxLength(120).nullable().optional(),
  email: vine.string().trim().email().nullable().optional(),
  notes: vine.string().trim().maxLength(500).nullable().optional(),
});

// Produit. Tous les champs sont requis à la création (aucun défaut en base).
const createProductSchema = vine.object({
  nom: vine.string().trim().minLength(2).maxLength(120),
  code_gtin: vine
    .string()
    .trim()
    .regex(/^\d{8,14}$/),
  categorie: vine.string().trim().minLength(2).maxLength(80),
  duree_conservation_defaut: vine.number().min(0).max(3650),
  seuil_alerte_stock: vine.number().min(0),
  unite_reference: vine.string().trim().minLength(1).maxLength(20),
});

// Le GTIN et l'unité de référence ne sont PAS éditables : le GTIN est l'identité GS1 du produit,
// et changer l'unité mélangerait des lots (le service le refuse aussi s'il existe des lots).
const updateProductSchema = vine.object({
  nom: vine.string().trim().minLength(2).maxLength(120).optional(),
  categorie: vine.string().trim().minLength(2).maxLength(80).optional(),
  duree_conservation_defaut: vine.number().min(0).max(3650).optional(),
  seuil_alerte_stock: vine.number().min(0).optional(),
});

export const validateCreateCustomer = makeBodyValidator(createCustomerSchema);
export const validateUpdateCustomer = makeBodyValidator(updateCustomerSchema, {
  rejectEmpty: true,
});
export const validateCreateProduct = makeBodyValidator(createProductSchema);
export const validateUpdateProduct = makeBodyValidator(updateProductSchema, { rejectEmpty: true });
