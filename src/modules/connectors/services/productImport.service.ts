import { validateData } from '../../../shared/utils/validateData/validateData';
import { auditService } from '../../../shared/utils/audit/audit.service';
import { retryableTransaction } from '../../../shared/utils/db/withWriteConflictRetry';
import { productImportRowSchema } from '../schemas/productImport.schema';
import { ImportReport, runCsvUpsertImport } from '../importHelpers';
import { isValidUnit, normalizeUnitCode } from '../../../shared/constants/units.constants';

export const productImportService = {
  /**
   * Importe un catalogue produit depuis un CSV (connecteur ERP entrant).
   * Succès partiel ligne à ligne : validation VineJS, vérification de l'unité (FK Unit),
   * upsert idempotent par (organisation, code_gtin). Strictement cloisonné à l'organisation.
   *
   * Chaque ligne est traitée dans SA transaction — recherche, écriture et journalisation
   * comprises. Sans cela, un simple CSV réécrivait le catalogue en masse sans laisser la moindre
   * trace, et `duree_conservation_defaut` pilote la DLC des lots reçus : on pouvait fausser des
   * dates de péremption en silence.
   */
  async importProducts(
    organizationId: string,
    csvText: string,
    actorUserId: string
  ): Promise<ImportReport> {
    return runCsvUpsertImport(csvText, {
      validateRow: (row) => validateData(productImportRowSchema, row),
      // Le référentiel est la source unique (units.constants), tolérant à la casse : un ERP qui
      // envoie `kg` n'est pas rejeté, la valeur est normalisée en `KG` au stockage.
      checkRow: (data) =>
        isValidUnit(data.unite_reference)
          ? null
          : `Unité inconnue : ${data.unite_reference}`,
      upsertRow: (data) =>
        retryableTransaction(async (tx) => {
          const champs = {
            nom: data.nom,
            categorie: data.categorie,
            duree_conservation_defaut: data.duree_conservation_defaut,
            seuil_alerte_stock: data.seuil_alerte_stock,
            unite_reference: normalizeUnitCode(data.unite_reference),
          };

          // Lu DANS la transaction : l'état journalisé est celui sur lequel l'écriture a porté.
          const existant = await tx.product.findFirst({
            where: { organization_id: organizationId, code_gtin: data.code_gtin },
          });

          if (existant) {
            const product = await tx.product.update({ where: { id: existant.id }, data: champs });

            await auditService.logAction(
              {
                organizationId,
                userId: actorUserId,
                action: 'IMPORT_UPDATE_PRODUCT',
                entity: 'Product',
                entityId: existant.id,
                oldValue: existant as unknown as Record<string, unknown>,
                newValue: product as unknown as Record<string, unknown>,
              },
              tx
            );

            return 'updated' as const;
          }

          // La course entre deux imports concurrents est arbitrée par la contrainte
          // `@@unique([organization_id, code_gtin])` : le perdant remonte en erreur de ligne
          // plutôt que de créer un doublon silencieux.
          const product = await tx.product.create({
            data: { organization_id: organizationId, code_gtin: data.code_gtin, ...champs },
          });

          await auditService.logAction(
            {
              organizationId,
              userId: actorUserId,
              action: 'IMPORT_CREATE_PRODUCT',
              entity: 'Product',
              entityId: product.id,
              newValue: product as unknown as Record<string, unknown>,
            },
            tx
          );

          return 'created' as const;
        }),
      refOf: (data) => data.code_gtin,
    });
  },
};
