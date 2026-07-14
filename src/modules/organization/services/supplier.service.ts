import { prisma } from '../../../shared/configs/prismaClient.config';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../shared/utils/audit/audit.service';

export interface SupplierInput {
  nom_ferme: string;
  adresse_siege: string;
  type_produit?: string;
  contact_qualite?: string;
}

const introuvable = () =>
  new APIError(404, {
    error: [{ field: 'id', message: 'Fournisseur introuvable ou accès refusé.' }],
  });

// La lecture (liste) vit dans `organizationService.listSuppliers`, enrichie du filtre `is_active` :
// une seule source. Ce service porte uniquement les écritures.
export const supplierService = {
  async create(input: SupplierInput, organizationId: string, actorUserId: string) {
    const supplier = await prisma.supplier.create({
      data: { ...input, organization_id: organizationId },
    });

    await auditService.logAction({
      organizationId,
      userId: actorUserId,
      action: 'CREATE_SUPPLIER',
      entity: 'Supplier',
      entityId: supplier.id,
      newValue: supplier as unknown as Record<string, unknown>,
    });

    return supplier;
  },

  async update(
    id: string,
    input: Partial<SupplierInput>,
    organizationId: string,
    actorUserId: string
  ) {
    const existant = await prisma.supplier.findFirst({
      where: { id, organization_id: organizationId },
    });
    if (!existant) throw introuvable();

    const supplier = await prisma.supplier.update({ where: { id }, data: input });

    await auditService.logAction({
      organizationId,
      userId: actorUserId,
      action: 'UPDATE_SUPPLIER',
      entity: 'Supplier',
      entityId: id,
      oldValue: existant as unknown as Record<string, unknown>,
      newValue: supplier as unknown as Record<string, unknown>,
    });

    return supplier;
  },

  /**
   * Archive (`false`) ou réactive (`true`). Un fournisseur archivé disparaît des sélections ET ne
   * peut plus recevoir de marchandise (garde dans receipt.service) — la désactivation a un effet
   * réel, pas seulement cosmétique. On ne supprime jamais : des réceptions passées le référencent.
   */
  async setActive(id: string, active: boolean, organizationId: string, actorUserId: string) {
    const existant = await prisma.supplier.findFirst({
      where: { id, organization_id: organizationId },
    });
    if (!existant) throw introuvable();

    // Idempotent : archiver un fournisseur déjà archivé n'ajoute pas une 2e ligne à l'audit WORM.
    if (existant.is_active === active) return existant;

    const supplier = await prisma.supplier.update({ where: { id }, data: { is_active: active } });

    await auditService.logAction({
      organizationId,
      userId: actorUserId,
      action: active ? 'REACTIVATE_SUPPLIER' : 'ARCHIVE_SUPPLIER',
      entity: 'Supplier',
      entityId: id,
    });

    return supplier;
  },
};
