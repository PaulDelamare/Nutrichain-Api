import { prisma } from '../../../../shared/configs/prismaClient.config';
import { Batch, Prisma } from '@prisma/client';

export interface GenealogyNode {
  batch: Batch;
  level: number;
}

/**
 * Garde anti-cycle de la récursion généalogique, PAS une limite métier.
 * La CTE utilise `UNION` mais `depth` fait partie du tuple sélectionné : sur des données
 * cycliques (corruption), les arêtes seraient ré-injectées à des profondeurs croissantes et
 * la récursion ne terminerait que grâce à cette borne. Valeur volontairement très au-dessus de
 * toute profondeur de transformation plausible (chaîne agroalimentaire réelle << 50).
 */
export const MAX_GENEALOGY_DEPTH = 50;

/**
 * Plafond des vues LECTURE de généalogie (`getDownstream`/`getUpstream`).
 * Le chemin RAPPEL (write) n'utilise PAS ce plafond : il bloque la descendance de façon
 * exhaustive et set-based (cf. recall.service). Ce cap ne concerne que l'affichage.
 */
export const READ_GENEALOGY_LIMIT = 1000;

/**
 * Fragment SQL partagé : en-tête `WITH RECURSIVE` de la descendance d'un lot.
 * Exposé pour être préfixé à un SELECT (lecture) OU à un UPDATE…RETURNING (rappel exhaustif).
 * Les valeurs interpolées restent paramétrées (anti-injection préservé par Prisma.sql).
 */
export const downstreamTraceCte = (batchId: string, maxDepth: number): Prisma.Sql => Prisma.sql`
  WITH RECURSIVE downstream_trace AS (
    SELECT t.id_lot_enfant, 1 AS depth
    FROM "TransformationComposition" tc
    JOIN "Transformation" t ON tc.id_transformation = t.id
    WHERE tc.id_lot_parent = ${batchId}

    UNION

    SELECT t.id_lot_enfant, dt.depth + 1
    FROM "TransformationComposition" tc
    JOIN "Transformation" t ON tc.id_transformation = t.id
    JOIN downstream_trace dt ON tc.id_lot_parent = dt.id_lot_enfant
    WHERE dt.depth < ${maxDepth}
  )
`;

export const genealogyService = {
  /**
   * Récupère tous les lots enfants (descendance) de manière récursive via CTE SQL.
   * Vue LECTURE plafonnée à READ_GENEALOGY_LIMIT. Pour le blocage exhaustif d'un rappel,
   * voir recall.service (UPDATE set-based sans plafond).
   */
  async getDownstream(
    batchId: string,
    organizationId: string,
    tx?: Prisma.TransactionClient
  ): Promise<(Batch & { nom_produit: string })[]> {
    const db = tx || prisma;

    const descendants = await db.$queryRaw<(Batch & { nom_produit: string })[]>(Prisma.sql`
      ${downstreamTraceCte(batchId, MAX_GENEALOGY_DEPTH)}
      SELECT b.*, p.nom AS nom_produit
      FROM "Batch" b
      JOIN "Product" p ON b.id_produit = p.id
      JOIN (SELECT DISTINCT id_lot_enfant FROM downstream_trace) res
        ON b.id = res.id_lot_enfant
      WHERE b.organization_id = ${organizationId}
      LIMIT ${READ_GENEALOGY_LIMIT}
    `);

    return descendants;
  },

  /**
   * Récupère tous les lots parents (ascendance) de manière récursive via CTE SQL.
   * Vue LECTURE plafonnée à READ_GENEALOGY_LIMIT.
   */
  async getUpstream(
    batchId: string,
    organizationId: string,
    tx?: Prisma.TransactionClient
  ): Promise<(Batch & { nom_produit: string })[]> {
    const db = tx || prisma;

    const ancestors = await db.$queryRaw<(Batch & { nom_produit: string })[]>(Prisma.sql`
      WITH RECURSIVE upstream_trace AS (
        SELECT t.id_lot_enfant, tc.id_lot_parent, 1 AS depth
        FROM "Transformation" t
        JOIN "TransformationComposition" tc ON t.id = tc.id_transformation
        WHERE t.id_lot_enfant = ${batchId}

        UNION

        SELECT t.id_lot_enfant, tc.id_lot_parent, ut.depth + 1
        FROM "Transformation" t
        JOIN "TransformationComposition" tc ON t.id = tc.id_transformation
        JOIN upstream_trace ut ON t.id_lot_enfant = ut.id_lot_parent
        WHERE ut.depth < ${MAX_GENEALOGY_DEPTH}
      )
      SELECT b.*, p.nom AS nom_produit
      FROM "Batch" b
      JOIN "Product" p ON b.id_produit = p.id
      JOIN (SELECT DISTINCT id_lot_parent FROM upstream_trace) res
        ON b.id = res.id_lot_parent
      WHERE b.organization_id = ${organizationId}
      LIMIT ${READ_GENEALOGY_LIMIT}
    `);

    return ancestors;
  },

  /**
   * Origines « ferme » d'un lot : les points d'entrée de matière première dans sa généalogie.
   *
   * Un lot porte un `id_receipt` s'il est né d'une réception (matière première) ; un produit fini
   * issu de transformation n'en a pas. On remonte donc le lot LUI-MÊME (cas d'une réception scannée
   * directement — sans lui, `getUpstream` ne renvoie que les ancêtres et l'origine serait vide) plus
   * tous ses ancêtres, et on ne garde que ceux rattachés à une réception, joints à leur fournisseur.
   */
  async getOrigins(
    batchId: string,
    organizationId: string,
    tx?: Prisma.TransactionClient
  ): Promise<
    {
      lot_number: string;
      date_reception: Date;
      fournisseur: { id: string; nom_ferme: string };
    }[]
  > {
    const db = tx || prisma;
    const ancestors = await this.getUpstream(batchId, organizationId, tx);
    const ids = [batchId, ...ancestors.map((a) => a.id)];

    const roots = await db.batch.findMany({
      where: {
        id: { in: ids },
        organization_id: organizationId,
        id_receipt: { not: null },
        // Cloisonnement en profondeur : la réception liée doit être de la même organisation.
        receipt: { organization_id: organizationId },
      },
      select: {
        lot_number: true,
        receipt: {
          select: {
            date_reception: true,
            fournisseur: { select: { id: true, nom_ferme: true } },
          },
        },
      },
    });

    return roots
      .filter((b) => b.receipt)
      .map((b) => ({
        lot_number: b.lot_number,
        date_reception: b.receipt!.date_reception,
        fournisseur: b.receipt!.fournisseur,
      }));
  },
};
