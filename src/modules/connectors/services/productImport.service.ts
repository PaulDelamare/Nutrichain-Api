import { prisma } from '../../../shared/configs/prismaClient.config';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { productImportRowSchema } from '../schemas/productImport.schema';
import { ImportReport, runCsvUpsertImport } from '../importHelpers';

export const productImportService = {
  /**
   * Importe un catalogue produit depuis un CSV (connecteur ERP entrant).
   * Succès partiel ligne à ligne : validation VineJS, vérification de l'unité (FK Unit),
   * upsert idempotent par (organisation, code_gtin). Strictement cloisonné à l'organisation.
   */
  async importProducts(organizationId: string, csvText: string): Promise<ImportReport> {
    // Référentiel d'unités chargé une fois (FK partagée), réutilisé par chaque ligne.
    const validUnits = new Set(
      (await prisma.unit.findMany({ select: { code: true } })).map((u) => u.code)
    );

    return runCsvUpsertImport(csvText, {
      validateRow: (row) => validateData(productImportRowSchema, row),
      checkRow: (data) =>
        validUnits.has(data.unite_reference) ? null : `Unité inconnue : ${data.unite_reference}`,
      findExisting: (data) =>
        prisma.product.findFirst({
          where: { organization_id: organizationId, code_gtin: data.code_gtin },
          select: { id: true },
        }),
      update: (id, data) =>
        prisma.product.update({
          where: { id },
          data: {
            nom: data.nom,
            categorie: data.categorie,
            duree_conservation_defaut: data.duree_conservation_defaut,
            seuil_alerte_stock: data.seuil_alerte_stock,
            unite_reference: data.unite_reference,
          },
        }),
      create: (data) =>
        prisma.product.create({
          data: {
            organization_id: organizationId,
            nom: data.nom,
            code_gtin: data.code_gtin,
            categorie: data.categorie,
            duree_conservation_defaut: data.duree_conservation_defaut,
            seuil_alerte_stock: data.seuil_alerte_stock,
            unite_reference: data.unite_reference,
          },
        }),
      refOf: (data) => data.code_gtin,
    });
  },
};
