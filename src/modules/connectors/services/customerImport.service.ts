import { prisma } from '../../../shared/configs/prismaClient.config';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { parseCsv } from '../../../shared/utils/csv/csv';
import { customerImportRowSchema } from '../schemas/customerImport.schema';
import {
  ImportReport,
  ImportRowResult,
  importErrorMessage,
  blankToUndefined,
} from '../importHelpers';

export const customerImportService = {
  /**
   * Importe des tiers (clients) depuis un CSV (connecteur ERP entrant).
   * Succès partiel ligne à ligne, validation VineJS (email vérifié), upsert idempotent par
   * (organisation, external_ref) — l'identifiant ERP évite les doublons au ré-import.
   * Permet d'alimenter `Customer.email` → un rappel notifie ensuite ces clients (cf. #20).
   * Strictement cloisonné à l'organisation active (multi-tenant).
   */
  async importCustomers(organizationId: string, csvText: string): Promise<ImportReport> {
    const { rows, errors: parseErrors } = parseCsv(csvText);

    const results: ImportRowResult[] = [];
    let created = 0;
    let updated = 0;
    let errors = 0;

    for (let i = 0; i < rows.length; i++) {
      const line = i + 1;
      try {
        const data = await validateData(customerImportRowSchema, blankToUndefined(rows[i]));

        const existing = await prisma.customer.findFirst({
          where: { organization_id: organizationId, external_ref: data.external_ref },
          select: { id: true },
        });

        if (existing) {
          // Champs absents (undefined) ignorés par Prisma → on n'efface pas une valeur existante.
          await prisma.customer.update({
            where: { id: existing.id },
            data: {
              nom_enseigne: data.nom_enseigne,
              email: data.email,
              contact_urgence: data.contact_urgence,
              adresse_livraison: data.adresse_livraison,
              notes: data.notes,
            },
          });
          results.push({ line, status: 'updated', ref: data.external_ref });
          updated++;
        } else {
          await prisma.customer.create({
            data: {
              organization_id: organizationId,
              external_ref: data.external_ref,
              nom_enseigne: data.nom_enseigne,
              email: data.email,
              contact_urgence: data.contact_urgence,
              adresse_livraison: data.adresse_livraison,
              notes: data.notes,
            },
          });
          results.push({ line, status: 'created', ref: data.external_ref });
          created++;
        }
      } catch (err) {
        results.push({ line, status: 'error', message: importErrorMessage(err) });
        errors++;
      }
    }

    return { total: rows.length, created, updated, errors, parseErrors, results };
  },
};
