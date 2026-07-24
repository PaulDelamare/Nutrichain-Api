import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../shared/utils/audit/audit.service';
import { retryableTransaction } from '../../../shared/utils/db/withWriteConflictRetry';

export interface ProductInput {
  nom: string;
  code_gtin: string;
  categorie: string;
  duree_conservation_defaut: number;
  seuil_alerte_stock: number;
  unite_reference: string;
}

const notFound = () =>
  new APIError(404, {
    error: [{ field: 'id', message: 'Produit introuvable ou accès refusé.' }],
  });

// La lecture (liste) vit dans `catalogService.getAllProducts`, enrichie du filtre `is_active`.
export const productService = {
  async create(input: ProductInput, organizationId: string, actorUserId: string) {
    // Écriture et audit dans une SEULE transaction : un produit ne doit jamais exister sans sa
    // trace WORM, ni une trace désigner un produit qui n'existe pas.
    return retryableTransaction(async (tx) => {
      // Contrôle applicatif pour rendre un message clair. L'arbitre de la course, lui, est la
      // contrainte `@@unique([organization_id, code_gtin])` en base : deux créations simultanées
      // franchissaient ce test toutes les deux, et le catalogue se retrouvait avec deux produits
      // pour un même GTIN — après quoi l'import CSV n'en met à jour qu'un, arbitrairement.
      const duplicate = await tx.product.findFirst({
        where: { organization_id: organizationId, code_gtin: input.code_gtin },
        select: { id: true },
      });
      if (duplicate) {
        throw new APIError(409, {
          error: [{ field: 'code_gtin', message: 'Un produit avec ce GTIN existe déjà.' }],
        });
      }

      const product = await tx.product.create({
        data: { ...input, organization_id: organizationId },
      });

      await auditService.logAction(
        {
          organizationId,
          userId: actorUserId,
          action: 'CREATE_PRODUCT',
          entity: 'Product',
          entityId: product.id,
          newValue: product as unknown as Record<string, unknown>,
        },
        tx
      );

      return product;
    });
  },

  async update(
    id: string,
    input: Partial<ProductInput>,
    organizationId: string,
    actorUserId: string
  ) {
    // La LECTURE est dans la transaction : l'état journalisé est celui sur lequel l'écriture a
    // porté, et un échec de l'audit annule la modification. (Ce n'est pas un verrou : en Read
    // Committed, la ligne n'est pas figée entre le `findFirst` et l'`update`.)
    return retryableTransaction(async (tx) => {
      const existing = await tx.product.findFirst({
        where: { id, organization_id: organizationId },
      });
      if (!existing) throw notFound();

      // Changer l'unité d'un produit déjà utilisé mélangerait des lots en L et en kg sans conversion
      // (le stock n'applique aucun facteur) : on l'interdit tant qu'un lot existe.
      if (input.unite_reference && input.unite_reference !== existing.unite_reference) {
        const lots = await tx.batch.count({ where: { id_produit: id } });
        if (lots > 0) {
          throw new APIError(409, {
            error: [
              {
                field: 'unite_reference',
                message:
                  "L'unité de référence ne peut plus changer : des lots de ce produit existent déjà.",
              },
            ],
          });
        }
      }

      const product = await tx.product.update({ where: { id }, data: input });

      await auditService.logAction(
        {
          organizationId,
          userId: actorUserId,
          action: 'UPDATE_PRODUCT',
          entity: 'Product',
          entityId: id,
          oldValue: existing as unknown as Record<string, unknown>,
          newValue: product as unknown as Record<string, unknown>,
        },
        tx
      );

      return product;
    });
  },

  /**
   * Archive ou réactive. Un produit archivé disparaît des sélections ET n'accepte plus ni réception
   * ni production (gardes dans receipt.service et transformation.service).
   */
  async setActive(id: string, active: boolean, organizationId: string, actorUserId: string) {
    return retryableTransaction(async (tx) => {
      const existing = await tx.product.findFirst({
        where: { id, organization_id: organizationId },
      });
      if (!existing) throw notFound();

      if (existing.is_active === active) return existing;

      const product = await tx.product.update({ where: { id }, data: { is_active: active } });

      await auditService.logAction(
        {
          organizationId,
          userId: actorUserId,
          action: active ? 'REACTIVATE_PRODUCT' : 'ARCHIVE_PRODUCT',
          entity: 'Product',
          entityId: id,
        },
        tx
      );

      return product;
    });
  },
};
