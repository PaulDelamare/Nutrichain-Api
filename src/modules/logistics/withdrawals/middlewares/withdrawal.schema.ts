import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';

/**
 * Déclaration d'un retrait de rayon.
 *
 * `unite` est volontairement ABSENTE : elle est reprise du lot. L'accepter en entrée permettait de
 * déclarer 500 « g » contre un plafond exprimé en kg — la quantité passait sous le plafond et le
 * consommait à tort. Ce qui n'existe pas dans le corps ne se falsifie pas.
 *
 * `retire_par` est absent pour la même raison : l'auteur vient de la session, jamais du client.
 */
export const withdrawalSchema = vine.object({
  id: vine.string().uuid(),
  id_client: vine.string().uuid(),
  // Bornée des deux côtés : une quantité nulle n'est pas un geste, une négative ferait RECULER le
  // cumul et rouvrirait du plafond.
  quantite: vine.number().positive().min(0.001).max(1_000_000),
  motif: vine.string().trim().minLength(5).maxLength(500),
  // Interlocuteur du magasin, rapporté : il n'a pas de compte et ne signe rien.
  constate_aupres_de: vine.string().trim().maxLength(120).optional(),
});

export type WithdrawalRequest = Infer<typeof withdrawalSchema>;

/** Lecture de l'avancement : seul le lot est reçu, et il vient de l'URL. */
export const withdrawalListSchema = vine.object({
  id: vine.string().uuid(),
});

export type WithdrawalListParams = Infer<typeof withdrawalListSchema>;
