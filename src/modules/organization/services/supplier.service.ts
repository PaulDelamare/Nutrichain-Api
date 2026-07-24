import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../shared/utils/audit/audit.service';
import { retryableTransaction } from '../../../shared/utils/db/withWriteConflictRetry';

export interface SupplierInput {
  nom_ferme: string;
  adresse_siege: string;
  type_produit?: string;
  contact_qualite?: string;
}

const notFound = () =>
  new APIError(404, {
    error: [{ field: 'id', message: 'Fournisseur introuvable ou accès refusé.' }],
  });

// La lecture (liste) vit dans `organizationService.listSuppliers`, enrichie du filtre `is_active` :
// une seule source. Ce service porte uniquement les écritures.
export const supplierService = {
  async create(input: SupplierInput, organizationId: string, actorUserId: string) {
    // Écriture et audit dans une SEULE transaction : une donnée de référence ne doit jamais
    // exister sans sa trace WORM, ni une trace désigner une entité qui n'existe pas.
    return retryableTransaction(async (tx) => {
      const supplier = await tx.supplier.create({
        data: { ...input, organization_id: organizationId },
      });

      await auditService.logAction(
        {
          organizationId,
          userId: actorUserId,
          action: 'CREATE_SUPPLIER',
          entity: 'Supplier',
          entityId: supplier.id,
          newValue: supplier as unknown as Record<string, unknown>,
        },
        tx
      );

      return supplier;
    });
  },

  async update(
    id: string,
    input: Partial<SupplierInput>,
    organizationId: string,
    actorUserId: string
  ) {
    // La LECTURE est dans la transaction : l'état journalisé est celui sur lequel l'écriture a
    // porté, et un échec de l'audit annule la modification. (Ce n'est pas un verrou : en Read
    // Committed, la ligne n'est pas figée entre le `findFirst` et l'`update`.)
    return retryableTransaction(async (tx) => {
      const existing = await tx.supplier.findFirst({
        where: { id, organization_id: organizationId },
      });
      if (!existing) throw notFound();

      const supplier = await tx.supplier.update({ where: { id }, data: input });

      await auditService.logAction(
        {
          organizationId,
          userId: actorUserId,
          action: 'UPDATE_SUPPLIER',
          entity: 'Supplier',
          entityId: id,
          oldValue: existing as unknown as Record<string, unknown>,
          newValue: supplier as unknown as Record<string, unknown>,
        },
        tx
      );

      return supplier;
    });
  },

  /**
   * Archive (`false`) ou réactive (`true`). Un fournisseur archivé disparaît des sélections ET ne
   * peut plus recevoir de marchandise (garde dans receipt.service) — la désactivation a un effet
   * réel, pas seulement cosmétique. On ne supprime jamais : des réceptions passées le référencent.
   */
  async setActive(id: string, active: boolean, organizationId: string, actorUserId: string) {
    return retryableTransaction(async (tx) => {
      const existing = await tx.supplier.findFirst({
        where: { id, organization_id: organizationId },
      });
      if (!existing) throw notFound();

      // Idempotent : archiver un fournisseur déjà archivé n'ajoute pas une 2e ligne à l'audit WORM.
      if (existing.is_active === active) return existing;

      const supplier = await tx.supplier.update({ where: { id }, data: { is_active: active } });

      await auditService.logAction(
        {
          organizationId,
          userId: actorUserId,
          action: active ? 'REACTIVATE_SUPPLIER' : 'ARCHIVE_SUPPLIER',
          entity: 'Supplier',
          entityId: id,
        },
        tx
      );

      return supplier;
    });
  },
};
