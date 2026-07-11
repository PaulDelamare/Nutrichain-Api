import crypto from 'crypto';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../shared/utils/audit/audit.service';

export interface CreateEquipmentData {
  organization_id: string;
  created_by: string;
  nom: string;
  type: string;
  id_lieu: string;
  temp_seuil_max?: number;
  sensor_id?: string;
}

/**
 * Étiquette apposée physiquement sur le matériel. L'opérateur la scanne pour déclarer où il
 * range un lot : le scan a lieu devant le frigo, donc l'emplacement ne peut pas être inventé.
 */
function generateScannableCode(): string {
  return `EQP-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

export const equipmentService = {
  async createEquipment(data: CreateEquipmentData) {
    const lieu = await prisma.location.findFirst({
      where: { id: data.id_lieu, organization_id: data.organization_id },
    });

    if (!lieu) {
      throw new APIError(400, {
        error: [{ field: 'id_lieu', message: 'Lieu introuvable ou accès refusé' }],
      });
    }

    const equipment = await prisma.equipment.create({
      data: {
        organization_id: data.organization_id,
        nom: data.nom,
        type: data.type,
        id_lieu: data.id_lieu,
        temp_seuil_max: data.temp_seuil_max,
        sensor_id: data.sensor_id,
        // Généré dès la création : un matériel sans étiquette est un matériel qu'aucun
        // opérateur ne peut désigner, donc un lot dont on ignorera toujours l'emplacement.
        qr_code_id: generateScannableCode(),
      },
    });

    await auditService.logAction({
      organizationId: data.organization_id,
      userId: data.created_by,
      action: 'CREATE_EQUIPMENT',
      entity: 'Equipment',
      entityId: equipment.id,
      newValue: equipment as unknown as Record<string, unknown>,
    });

    return equipment;
  },

  /**
   * Rend le code à imprimer sur l'étiquette du matériel, et l'attribue au passage s'il n'en a
   * pas : les matériels créés avant cette fonctionnalité n'en ont aucun, et un parc à deux
   * vitesses obligerait l'opérateur à deviner lesquels sont scannables.
   */
  async getScannableLabel(organizationId: string, equipmentId: string) {
    const equipment = await prisma.equipment.findFirst({
      where: { id: equipmentId, organization_id: organizationId },
    });

    if (!equipment) {
      throw new APIError(404, {
        error: [{ field: 'id', message: 'Matériel introuvable ou accès refusé' }],
      });
    }

    if (equipment.qr_code_id) {
      return { code: equipment.qr_code_id, nom: equipment.nom };
    }

    const updated = await prisma.equipment.update({
      where: { id: equipment.id },
      data: { qr_code_id: generateScannableCode() },
    });

    return { code: updated.qr_code_id as string, nom: updated.nom };
  },

  async listLocations(organizationId: string) {
    return prisma.location.findMany({
      where: { organization_id: organizationId },
      orderBy: { nom: 'asc' },
    });
  },
};
