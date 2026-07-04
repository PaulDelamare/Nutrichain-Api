import { Request, Response } from 'express';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { sendSuccess } from '../../../../shared/utils/returnSuccess/returnSuccess';
import { genealogyService } from '../services/genealogy.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';

/**
 * Contrôleur pour le scan public des lots (B2C).
 * Permet à un consommateur de voir l'origine d'un produit via son ID de lot ou son SSCC.
 */
export const publicScanBatch = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  // Scan B2C : seuls les lots déjà commercialisés (EXPEDIE) ou en rappel (ALERTE) sont exposés.
  // Résolution par UUID interne OU par numéro de lot GS1 : l'étiquette Digital Link
  // (AI 10) porte le lot_number court, c'est lui que le consommateur scanne.
  const batch = await prisma.batch.findFirst({
    where: { OR: [{ id }, { lot_number: id }], statut: { in: ['EXPEDIE', 'ALERTE'] } },
    include: {
      produit: {
        select: { nom: true, code_gtin: true },
      },
      organization: {
        select: { name: true },
      },
    },
  });

  if (!batch) {
    throw new APIError(404, {
      error: [{ field: 'id', message: 'Lot introuvable ou code invalide.' }],
    });
  }

  // 2. Récupérer l'origine simplifiée (sans exposer les IDs ou fournisseurs sensibles)
  const ancestors = await genealogyService.getUpstream(batch.id, batch.organization_id);

  // 3. Formater la réponse pour le consommateur final (Données anonymisées et filtrées)
  // On ne renvoie JAMAIS les objets 'ancestors' complets car ils contiennent des IDs internes et des quantités
  const publicData = {
    lot: {
      numero_lot: batch.lot_number,
      date_peremption: batch.date_peremption,
      nom_produit: batch.produit.nom,
      gtin: batch.produit.code_gtin,
      producteur: batch.organization.name,
      statut_sanitaire: batch.statut === 'ALERTE' ? 'RAPPEL_CONSOMMATEUR' : 'CONFORME',
    },
    trace: {
      etapes: ancestors.length,
      message: "Ce produit a été tracé de la ferme jusqu'à vous via NutriChain.",
      // On affiche les ingrédients clés avec leurs noms de produits réels
      etapes_details: ancestors.map((a) => ({
        produit: a.nom_produit,
        date: a.date_creation,
      })),
    },
  };

  sendSuccess(res, 200, 'Informations de traçabilité récupérées', publicData);
});
