import { prisma } from '../../../shared/configs/prismaClient.config';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../shared/utils/audit/audit.service';

export interface ProductInput {
  nom: string;
  code_gtin: string;
  categorie: string;
  duree_conservation_defaut: number;
  seuil_alerte_stock: number;
  unite_reference: string;
}

const introuvable = () =>
  new APIError(404, {
    error: [{ field: 'id', message: 'Produit introuvable ou accès refusé.' }],
  });

// La lecture (liste) vit dans `catalogService.getAllProducts`, enrichie du filtre `is_active`.
export const productService = {
  async create(input: ProductInput, organizationId: string, actorUserId: string) {
    // Le GTIN identifie le produit (URN GS1, clé d'idempotence de l'import CSV). Il n'a pas de
    // contrainte d'unicité en base : on la vérifie applicativement, sinon deux produits pourraient
    // partager un GTIN et l'import n'en mettrait qu'un à jour, arbitrairement.
    const doublon = await prisma.product.findFirst({
      where: { organization_id: organizationId, code_gtin: input.code_gtin },
      select: { id: true },
    });
    if (doublon) {
      throw new APIError(409, {
        error: [{ field: 'code_gtin', message: 'Un produit avec ce GTIN existe déjà.' }],
      });
    }

    const product = await prisma.product.create({
      data: { ...input, organization_id: organizationId },
    });

    await auditService.logAction({
      organizationId,
      userId: actorUserId,
      action: 'CREATE_PRODUCT',
      entity: 'Product',
      entityId: product.id,
      newValue: product as unknown as Record<string, unknown>,
    });

    return product;
  },

  async update(
    id: string,
    input: Partial<ProductInput>,
    organizationId: string,
    actorUserId: string
  ) {
    const existant = await prisma.product.findFirst({
      where: { id, organization_id: organizationId },
    });
    if (!existant) throw introuvable();

    // Changer l'unité d'un produit déjà utilisé mélangerait des lots en L et en kg sans conversion
    // (le stock n'applique aucun facteur) : on l'interdit tant qu'un lot existe.
    if (input.unite_reference && input.unite_reference !== existant.unite_reference) {
      const lots = await prisma.batch.count({ where: { id_produit: id } });
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

    const product = await prisma.product.update({ where: { id }, data: input });

    await auditService.logAction({
      organizationId,
      userId: actorUserId,
      action: 'UPDATE_PRODUCT',
      entity: 'Product',
      entityId: id,
      oldValue: existant as unknown as Record<string, unknown>,
      newValue: product as unknown as Record<string, unknown>,
    });

    return product;
  },

  /**
   * Archive ou réactive. Un produit archivé disparaît des sélections ET n'accepte plus ni réception
   * ni production (gardes dans receipt.service et transformation.service).
   */
  async setActive(id: string, active: boolean, organizationId: string, actorUserId: string) {
    const existant = await prisma.product.findFirst({
      where: { id, organization_id: organizationId },
    });
    if (!existant) throw introuvable();

    if (existant.is_active === active) return existant;

    const product = await prisma.product.update({ where: { id }, data: { is_active: active } });

    await auditService.logAction({
      organizationId,
      userId: actorUserId,
      action: active ? 'REACTIVATE_PRODUCT' : 'ARCHIVE_PRODUCT',
      entity: 'Product',
      entityId: id,
    });

    return product;
  },
};
