import { prisma } from '../../../../shared/configs/prismaClient.config';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { labelService } from '../../shared/services/label.service';

/**
 * Étiquette de palette et résolution d'un SSCC scanné.
 *
 * Le SSCC identifie l'unité logistique — cette palette-ci — là où le numéro de lot identifie la
 * fournée. Il était généré à l'expédition et scellé dans l'AggregationEvent, mais jamais
 * imprimable : une palette quittait le quai sans code scannable, et un client destinataire d'un
 * rappel ne pouvait pas identifier la sienne autrement qu'en ouvrant les cartons (#280).
 */

/** AI 00 : le préfixe de champ GS1 qui annonce un SSCC de 18 chiffres. */
const SSCC_AI = '00';

const PALLET_INCLUDE = {
  client: { select: { nom_enseigne: true } },
  liaisons: {
    include: {
      lot: {
        select: {
          id: true,
          lot_number: true,
          statut: true,
          date_peremption: true,
          produit: { select: { nom: true, code_gtin: true } },
        },
      },
    },
  },
} as const;

export const palletLabelService = {
  /**
   * Rend l'étiquette scannable d'une palette.
   *
   * Le QR porte l'element string GS1 (`00` + SSCC), et non un Digital Link : une étiquette de
   * palette s'adresse à la chaîne logistique, pas au consommateur. C'est le format que le parseur
   * du mobile lit déjà (AI 00, longueur fixe 18).
   */
  async generateLabel(shipmentId: string, activeOrgId: string) {
    const shipment = await prisma.shipment.findFirst({
      where: { id: shipmentId, organization_id: activeOrgId },
      select: { shipment_id: true },
    });

    if (!shipment) {
      throw new APIError(404, {
        error: [{ field: 'id', message: 'Expédition introuvable dans cette organisation' }],
      });
    }

    const code = `${SSCC_AI}${shipment.shipment_id}`;

    return { png: await labelService.generateQRCode(code), code };
  },

  /**
   * Résout un SSCC scanné vers le contenu de sa palette.
   *
   * Authentifiée et cloisonnée : un SSCC expose le client, les produits et les quantités d'une
   * livraison. Le canal public reste celui du lot, qui n'expose que ce qui concerne le consommateur.
   */
  async resolveBySscc(scannedCode: string, activeOrgId: string) {
    // La caméra rend l'element string complet : `00` en fait partie, l'identifiant non.
    // Sans ce retrait, un scan parfaitement valide ne trouvait rien.
    const trimmed = scannedCode.trim();
    const sscc = trimmed.startsWith(SSCC_AI) && trimmed.length === 20 ? trimmed.slice(2) : trimmed;

    const shipment = await prisma.shipment.findFirst({
      where: { shipment_id: sscc, organization_id: activeOrgId },
      include: PALLET_INCLUDE,
    });

    if (!shipment) {
      throw new APIError(404, {
        error: [{ field: 'sscc', message: 'Palette introuvable dans cette organisation' }],
      });
    }

    const lots = shipment.liaisons.map((liaison) => ({
      id: liaison.lot.id,
      numero_lot: liaison.lot.lot_number,
      produit: liaison.lot.produit.nom,
      gtin: liaison.lot.produit.code_gtin,
      quantite: Number(liaison.quantite_expediee),
      unite: liaison.unite,
      statut: liaison.lot.statut,
      date_peremption: liaison.lot.date_peremption,
    }));

    return {
      sscc,
      client: shipment.client.nom_enseigne,
      transporteur: shipment.transporteur,
      date_envoi: shipment.date_envoi,
      statut_livraison: shipment.statut_livraison,
      // Un lot peut être rappelé APRÈS son départ : c'est justement ce que le scan doit révéler,
      // sinon le rappel reste une notification et ne devient jamais un geste sur le quai.
      contient_lot_rappele: lots.some((lot) => lot.statut === 'ALERTE'),
      lots,
    };
  },
};
