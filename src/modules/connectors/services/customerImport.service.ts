import { validateData } from '../../../shared/utils/validateData/validateData';
import { auditService } from '../../../shared/utils/audit/audit.service';
import { retryableTransaction } from '../../../shared/utils/db/withWriteConflictRetry';
import { customerImportRowSchema } from '../schemas/customerImport.schema';
import { ImportReport, runCsvUpsertImport, blankToUndefined } from '../importHelpers';

export const customerImportService = {
  /**
   * Importe des tiers (clients) depuis un CSV (connecteur ERP entrant).
   * Succès partiel ligne à ligne, validation VineJS (email vérifié), upsert idempotent par
   * (organisation, external_ref). Strictement cloisonné à l'organisation active (multi-tenant).
   *
   * Chaque ligne est traitée dans SA transaction — recherche, écriture et journalisation
   * comprises. `email` et `contact_urgence` sont exactement ce qui sert à joindre un client lors
   * d'un rappel : sans trace, un CSV pouvait saboter la cascade de notification en silence.
   */
  async importCustomers(
    organizationId: string,
    csvText: string,
    actorUserId: string
  ): Promise<ImportReport> {
    return runCsvUpsertImport(csvText, {
      // blankToUndefined : une cellule vide = champ absent (ignoré par Prisma à l'update,
      // n'écrase pas une valeur existante).
      validateRow: (row) => validateData(customerImportRowSchema, blankToUndefined(row)),
      upsertRow: (data) =>
        retryableTransaction(async (tx) => {
          const fields = {
            nom_enseigne: data.nom_enseigne,
            email: data.email,
            contact_urgence: data.contact_urgence,
            adresse_livraison: data.adresse_livraison,
            notes: data.notes,
          };

          // Lu DANS la transaction : l'état journalisé est celui sur lequel l'écriture a porté.
          const existing = await tx.customer.findFirst({
            where: { organization_id: organizationId, external_ref: data.external_ref },
          });

          if (existing) {
            const customer = await tx.customer.update({ where: { id: existing.id }, data: fields });

            await auditService.logAction(
              {
                organizationId,
                userId: actorUserId,
                action: 'IMPORT_UPDATE_CUSTOMER',
                entity: 'Customer',
                entityId: existing.id,
                oldValue: existing as unknown as Record<string, unknown>,
                newValue: customer as unknown as Record<string, unknown>,
              },
              tx
            );

            return 'updated' as const;
          }

          // La course entre deux imports concurrents est arbitrée par la contrainte
          // `@@unique([organization_id, external_ref])`, déjà en base.
          const customer = await tx.customer.create({
            data: { organization_id: organizationId, external_ref: data.external_ref, ...fields },
          });

          await auditService.logAction(
            {
              organizationId,
              userId: actorUserId,
              action: 'IMPORT_CREATE_CUSTOMER',
              entity: 'Customer',
              entityId: customer.id,
              newValue: customer as unknown as Record<string, unknown>,
            },
            tx
          );

          return 'created' as const;
        }),
      refOf: (data) => data.external_ref,
    });
  },
};
