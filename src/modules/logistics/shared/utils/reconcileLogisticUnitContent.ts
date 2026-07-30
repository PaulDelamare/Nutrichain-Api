import { Prisma } from '@prisma/client';

/**
 * Aligne ce qu'une palette déclare d'un lot sur ce qui reste réellement en stock.
 *
 * À appeler dans la MÊME transaction que toute déduction de stock (expédition, transformation,
 * rebut). Deux problèmes distincts se règlent ici :
 *
 * - **Stock épuisé** : la ligne disparaît. Sans ça, rien ne vide jamais `Logistic_Unit_Content` —
 *   la palette déclare à vie une marchandise partie ou détruite, et devient irrangeable puisque la
 *   garde de rangement exige que tout son contenu soit déplaçable.
 * - **Stock partiel** : la quantité est ramenée au reste. Sans ça, une palette qui déclarait 30 kg
 *   d'un lot tombé à 10 continue d'afficher 30 au scan, et `moveLogisticUnit` scelle un mouvement
 *   de 30 kg — un chiffre faux dans la frise du lot.
 *
 * Le filtre d'organisation est posé via la relation : `id_lot` seul suffirait à démonter la palette
 * d'un tenant voisin si l'identifiant fuitait.
 */
export async function reconcileLogisticUnitContent(
  tx: Prisma.TransactionClient,
  params: { batchId: string; organizationId: string; remainingQuantity: number }
): Promise<void> {
  const scope = {
    id_lot: params.batchId,
    unite_logistique: { organization_id: params.organizationId },
  };

  if (params.remainingQuantity <= 0) {
    await tx.logistic_Unit_Content.deleteMany({ where: scope });
    return;
  }

  await tx.logistic_Unit_Content.updateMany({
    where: { ...scope, quantite: { gt: params.remainingQuantity } },
    data: { quantite: params.remainingQuantity },
  });
}
