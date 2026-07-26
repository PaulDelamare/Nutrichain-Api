import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { sendSuccess } from '../../../../shared/utils/returnSuccess/returnSuccess';
import { genealogyService } from '../services/genealogy.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';

/**
 * Résout un lot pour le scan public (B2C), quel que soit le critère de recherche fourni par
 * l'appelant (UUID interne, lot_number seul, ou paire GTIN+lot_number). Scan B2C : seuls les lots
 * déjà commercialisés (EXPEDIE) ou en rappel (ALERTE) sont exposés.
 *
 * ⚠️ Ce canal public n'a AUCUN contexte d'organisation : `lot_number` seul n'est unique que PAR
 * organisation (`@@unique([organization_id, lot_number])`), et vient d'une étiquette fournisseur
 * saisie à la main — deux organisations peuvent porter le même. La paire (GTIN, lot_number) lève
 * l'ambiguïté à la source (`Product.code_gtin` est lui aussi scopé par organisation, donc pas
 * PROUVABLEMENT unique au niveau mondial — coïncidence astronomiquement improbable, mais on
 * garde la même arbitrage défensif par sécurité plutôt que de le supprimer).
 */
async function resolvePublicBatch(
  where: Prisma.BatchWhereInput,
  notFoundField: string,
  ambiguousMessage: string
) {
  const matches = await prisma.batch.findMany({
    where: { ...where, statut: { in: ['EXPEDIE', 'ALERTE'] } },
    include: {
      produit: { select: { nom: true, code_gtin: true } },
      organization: { select: { name: true } },
    },
  });

  if (matches.length === 0) {
    throw new APIError(404, {
      error: [{ field: notFoundField, message: 'Lot introuvable ou code invalide.' }],
    });
  }

  // Le RAPPEL PRIME : un lot homonyme sous rappel ne doit jamais être masqué par un lot conforme
  // d'une autre organisation — sinon l'alerte disparaît du seul canal dont c'est la raison d'être.
  const recalled = matches.find((b) => b.statut === 'ALERTE');
  const batch = recalled ?? (matches.length === 1 ? matches[0] : null);

  if (!batch) {
    // Plusieurs lots homonymes, aucun rappelé : impossible de désigner le bon producteur sans plus
    // d'information. Le message dépend du canal — il ne doit jamais prétendre que l'appelant a
    // scanné un code incomplet quand ce n'est pas le cas (cf. `publicScanDigitalLink`, qui a DÉJÀ
    // reçu la paire GTIN+lot complète).
    throw new APIError(409, {
      error: [{ field: notFoundField, message: ambiguousMessage }],
    });
  }

  return batch;
}

async function buildPublicScanResponse(
  batch: Awaited<ReturnType<typeof resolvePublicBatch>>
) {
  // Origine simplifiée : généalogie produit + noms de fermes (Batch→Receipt→Supplier).
  // Décision produit (#51) : on expose UNIQUEMENT `nom_ferme` (identité commerciale, comme
  // l'opérateur la voit). Jamais d'id fournisseur, contact qualité ni adresse de siège (DPIA).
  const [ancestors, origins] = await Promise.all([
    genealogyService.getUpstream(batch.id, batch.organization_id),
    genealogyService.getOrigins(batch.id, batch.organization_id),
  ]);

  const fermes = [
    ...new Set(origins.map((o) => o.fournisseur.nom_ferme).filter((n) => n.trim().length > 0)),
  ];

  return {
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
      message:
        fermes.length === 1
          ? `Ce produit a été tracé depuis « ${fermes[0]} » jusqu'à vous via NutriChain.`
          : fermes.length > 1
            ? 'Ce produit a été tracé de la ferme jusqu\'à vous via NutriChain — origines ci-dessous.'
            : "Ce produit a été tracé de la ferme jusqu'à vous via NutriChain.",
      // Ingrédients amont (noms de produits uniquement).
      etapes_details: ancestors.map((a) => ({
        produit: a.nom_produit,
        date: a.date_creation,
      })),
      // Fermes d'entrée matière première — nominatif commercial, pas de coordonnées.
      origines: fermes.map((ferme) => ({ ferme })),
    },
  };
}

/**
 * Contrôleur pour le scan public des lots (B2C) par UUID interne ou lot_number seul.
 * Conservé pour compatibilité (recherche interne) ; le canal GS1 correct est
 * `publicScanDigitalLink` (GTIN + lot), qui lève l'ambiguïté à la source.
 */
export const publicScanBatch = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  const batch = await resolvePublicBatch(
    { OR: [{ id }, { lot_number: id }] },
    'id',
    'Code ambigu : plusieurs lots correspondent. Scannez le code GS1 complet (GTIN et lot).'
  );
  const publicData = await buildPublicScanResponse(batch);

  sendSuccess(res, 200, 'Informations de traçabilité récupérées', publicData);
});

/**
 * Résolution GS1 Digital Link (AI 01 = GTIN, AI 10 = lot) : c'est le lien réellement imprimé sur
 * l'étiquette (`labelService.generateDigitalLink`). Élimine l'ambiguïté inter-organisation à la
 * source — un scan réel ne tombe plus jamais sur le 409 « code ambigu ».
 */
export const publicScanDigitalLink = catchAsync(async (req: Request, res: Response) => {
  const { gtin, lot } = req.params;

  // `lot_number` est stocké en MAJUSCULES (cf. receipt.service.ts) : un lot tapé ou transmis en
  // minuscule matcherait le validateur (regex tolérant la casse) mais ne trouverait rien en base —
  // 404 silencieux sur un scan pourtant valide.
  const batch = await resolvePublicBatch(
    { lot_number: lot.toUpperCase(), produit: { code_gtin: gtin } },
    'lot',
    // Le consommateur a DÉJÀ fourni la paire complète (GTIN + lot) : le lui redemander n'aurait
    // aucun sens. Cette collision (même GTIN, même lot, deux organisations) reste une coïncidence
    // possible mais non tranchable automatiquement — on l'annonce comme telle.
    'Ce code correspond à plusieurs producteurs différents : contactez le support NutriChain.'
  );
  const publicData = await buildPublicScanResponse(batch);

  sendSuccess(res, 200, 'Informations de traçabilité récupérées', publicData);
});
