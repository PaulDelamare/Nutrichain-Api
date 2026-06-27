import { prisma } from '../../../shared/configs/prismaClient.config';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { customerImportRowSchema } from '../schemas/customerImport.schema';
import { ImportReport, runCsvUpsertImport, blankToUndefined } from '../importHelpers';

export const customerImportService = {
  /**
   * Importe des tiers (clients) depuis un CSV (connecteur ERP entrant).
   * Succès partiel ligne à ligne, validation VineJS (email vérifié), upsert idempotent par
   * (organisation, external_ref). Alimente `Customer.email` → un rappel notifie ensuite ces
   * clients (cf. #20). Strictement cloisonné à l'organisation active (multi-tenant).
   */
  async importCustomers(organizationId: string, csvText: string): Promise<ImportReport> {
    return runCsvUpsertImport(csvText, {
      // blankToUndefined : une cellule vide = champ absent (ignoré par Prisma à l'update,
      // n'écrase pas une valeur existante).
      validateRow: (row) => validateData(customerImportRowSchema, blankToUndefined(row)),
      findExisting: (data) =>
        prisma.customer.findFirst({
          where: { organization_id: organizationId, external_ref: data.external_ref },
          select: { id: true },
        }),
      update: (id, data) =>
        prisma.customer.update({
          where: { id },
          data: {
            nom_enseigne: data.nom_enseigne,
            email: data.email,
            contact_urgence: data.contact_urgence,
            adresse_livraison: data.adresse_livraison,
            notes: data.notes,
          },
        }),
      create: (data) =>
        prisma.customer.create({
          data: {
            organization_id: organizationId,
            external_ref: data.external_ref,
            nom_enseigne: data.nom_enseigne,
            email: data.email,
            contact_urgence: data.contact_urgence,
            adresse_livraison: data.adresse_livraison,
            notes: data.notes,
          },
        }),
      refOf: (data) => data.external_ref,
    });
  },
};
