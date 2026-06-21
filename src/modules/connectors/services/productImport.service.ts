import { prisma } from '../../../shared/configs/prismaClient.config';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { parseCsv } from '../../../shared/utils/csv/csv';
import { productImportRowSchema } from '../schemas/productImport.schema';
import { ImportReport, ImportRowResult, importErrorMessage } from '../importHelpers';

export const productImportService = {
  /**
   * Importe un catalogue produit depuis un CSV (connecteur ERP entrant).
   * Traitement ligne à ligne en succès partiel (une ligne invalide n'annule pas les autres) :
   * - validation VineJS,
   * - vérification de l'unité (FK Unit) au sein du référentiel partagé,
   * - upsert idempotent par (organisation, code_gtin) → ré-importer ne duplique pas.
   * Strictement cloisonné à l'organisation active (multi-tenant).
   */
  async importProducts(organizationId: string, csvText: string): Promise<ImportReport> {
    const { rows, errors: parseErrors } = parseCsv(csvText);
    const validUnits = new Set(
      (await prisma.unit.findMany({ select: { code: true } })).map((u) => u.code)
    );

    const results: ImportRowResult[] = [];
    let created = 0;
    let updated = 0;
    let errors = 0;

    for (let i = 0; i < rows.length; i++) {
      const line = i + 1;
      try {
        const data = await validateData(productImportRowSchema, rows[i]);

        if (!validUnits.has(data.unite_reference)) {
          results.push({
            line,
            status: 'error',
            message: `Unité inconnue : ${data.unite_reference}`,
          });
          errors++;
          continue;
        }

        const existing = await prisma.product.findFirst({
          where: { organization_id: organizationId, code_gtin: data.code_gtin },
          select: { id: true },
        });

        if (existing) {
          await prisma.product.update({
            where: { id: existing.id },
            data: {
              nom: data.nom,
              categorie: data.categorie,
              duree_conservation_defaut: data.duree_conservation_defaut,
              seuil_alerte_stock: data.seuil_alerte_stock,
              unite_reference: data.unite_reference,
            },
          });
          results.push({ line, status: 'updated', ref: data.code_gtin });
          updated++;
        } else {
          await prisma.product.create({
            data: {
              organization_id: organizationId,
              nom: data.nom,
              code_gtin: data.code_gtin,
              categorie: data.categorie,
              duree_conservation_defaut: data.duree_conservation_defaut,
              seuil_alerte_stock: data.seuil_alerte_stock,
              unite_reference: data.unite_reference,
            },
          });
          results.push({ line, status: 'created', ref: data.code_gtin });
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
