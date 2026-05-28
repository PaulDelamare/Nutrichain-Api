import { prisma } from '../../../../shared/configs/prismaClient.config';
import { Batch, Prisma } from '@prisma/client';

export interface GenealogyNode {
  batch: Batch;
  level: number;
}

export const genealogyService = {
  /**
   * Récupère tous les lots enfants (descendance) de manière récursive via CTE SQL.
   * Utilise une seule requête pour éviter le problème N+1.
   */
  async getDownstream(
    batchId: string,
    organizationId: string,
    tx?: Prisma.TransactionClient
  ): Promise<(Batch & { nom_produit: string })[]> {
    const db = tx || prisma;

    // Requête récursive (CTE) pour trouver tous les enfants via les transformations
    const descendants = await db.$queryRaw<(Batch & { nom_produit: string })[]>`
      WITH RECURSIVE downstream_trace AS (
        -- Point de départ : les transformations où le lot source est un parent
        SELECT tc.id_lot_parent, t.id_lot_enfant, 1 as depth
        FROM "TransformationComposition" tc
        JOIN "Transformation" t ON tc.id_transformation = t.id
        WHERE tc.id_lot_parent = ${batchId}

        UNION

        -- Récursion : trouver les transformations des lots enfants trouvés
        SELECT tc.id_lot_parent, t.id_lot_enfant, dt.depth + 1
        FROM "TransformationComposition" tc
        JOIN "Transformation" t ON tc.id_transformation = t.id
        JOIN downstream_trace dt ON tc.id_lot_parent = dt.id_lot_enfant
        WHERE dt.depth < 20
      )
      SELECT b.*, p.nom as nom_produit
      FROM "Batch" b
      JOIN "Product" p ON b.id_produit = p.id
      JOIN (SELECT DISTINCT id_lot_enfant FROM downstream_trace) res 
        ON b.id = res.id_lot_enfant
      WHERE b.organization_id = ${organizationId}
      LIMIT 1000;
    `;

    return descendants;
  },

  /**
   * Récupère tous les lots parents (ascendance) de manière récursive via CTE SQL.
   */
  async getUpstream(
    batchId: string,
    organizationId: string,
    tx?: Prisma.TransactionClient
  ): Promise<(Batch & { nom_produit: string })[]> {
    const db = tx || prisma;

    const ancestors = await db.$queryRaw<(Batch & { nom_produit: string })[]>`
      WITH RECURSIVE upstream_trace AS (
        -- Point de départ : la transformation qui a généré le lot enfant
        SELECT t.id_lot_enfant, tc.id_lot_parent, 1 as depth
        FROM "Transformation" t
        JOIN "TransformationComposition" tc ON t.id = tc.id_transformation
        WHERE t.id_lot_enfant = ${batchId}

        UNION

        -- Récursion : trouver les parents des lots parents trouvés
        SELECT t.id_lot_enfant, tc.id_lot_parent, ut.depth + 1
        FROM "Transformation" t
        JOIN "TransformationComposition" tc ON t.id = tc.id_transformation
        JOIN upstream_trace ut ON t.id_lot_enfant = ut.id_lot_parent
        WHERE ut.depth < 20
      )
      SELECT b.*, p.nom as nom_produit
      FROM "Batch" b
      JOIN "Product" p ON b.id_produit = p.id
      JOIN (SELECT DISTINCT id_lot_parent FROM upstream_trace) res 
        ON b.id = res.id_lot_parent
      WHERE b.organization_id = ${organizationId}
      LIMIT 1000;
    `;

    return ancestors;
  },
};
