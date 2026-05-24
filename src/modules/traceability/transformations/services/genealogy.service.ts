import { prisma } from '../../../../shared/configs/prismaClient.config';
import { Batch } from '@prisma/client';

export interface GenealogyNode {
  batch: Batch;
  level: number;
}

export const genealogyService = {
  /**
   * Récupère tous les lots enfants (descendance) de manière récursive.
   * Utile pour les rappels produits (traçabilité descendante).
   */
  async getDownstream(batchId: string, organizationId: string): Promise<Batch[]> {
    const descendants: Batch[] = [];
    const queue = [batchId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      // Trouver les transformations où ce lot était un parent
      const childTransformations = await prisma.transformationComposition.findMany({
        where: { id_lot_parent: currentId },
        include: {
          transformation: {
            include: {
              lot_enfant: true,
            },
          },
        },
      });

      for (const comp of childTransformations) {
        const childBatch = comp.transformation.lot_enfant;
        if (childBatch && childBatch.organization_id === organizationId) {
          descendants.push(childBatch);
          queue.push(childBatch.id);
        }
      }
    }

    return descendants;
  },

  /**
   * Récupère tous les lots parents (ascendance) de manière récursive.
   * Utile pour trouver la cause d'une contamination (traçabilité ascendante).
   */
  async getUpstream(batchId: string, organizationId: string): Promise<Batch[]> {
    const ancestors: Batch[] = [];
    const queue = [batchId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      // Trouver la transformation qui a généré ce lot
      const transformation = await prisma.transformation.findFirst({
        where: { id_lot_enfant: currentId },
        include: {
          compositions: {
            include: {
              lot_parent: true,
            },
          },
        },
      });

      if (transformation) {
        for (const comp of transformation.compositions) {
          const parentBatch = comp.lot_parent;
          if (parentBatch && parentBatch.organization_id === organizationId) {
            ancestors.push(parentBatch);
            queue.push(parentBatch.id);
          }
        }
      }
    }

    return ancestors;
  },
};
