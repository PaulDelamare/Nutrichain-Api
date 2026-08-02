import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../shared/utils/audit/audit.service';
import { retryableTransaction } from '../../../shared/utils/db/withWriteConflictRetry';

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
    const location = await prisma.location.findFirst({
      where: { id: data.id_lieu, organization_id: data.organization_id },
    });

    if (!location) {
      throw new APIError(400, {
        error: [{ field: 'id_lieu', message: 'Lieu introuvable ou accès refusé' }],
      });
    }
    // Un lieu archivé n'accueille pas de nouveau matériel (le matériel déjà placé reste valable).
    if (!location.is_active) {
      throw new APIError(409, {
        error: [{ field: 'id_lieu', message: 'Cet emplacement est archivé.' }],
      });
    }

    // Création + audit dans une seule transaction : un matériel ne doit jamais exister sans sa
    // trace WORM (ni l'inverse). Rejouée sur conflit de chaîne d'audit (retryableTransaction).
    return retryableTransaction(async (tx) => {
      const equipment = await tx.equipment.create({
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

      await auditService.logAction(
        {
          organizationId: data.organization_id,
          userId: data.created_by,
          action: 'CREATE_EQUIPMENT',
          entity: 'Equipment',
          entityId: equipment.id,
          newValue: equipment as unknown as Record<string, unknown>,
        },
        tx
      );

      return equipment;
    });
  },

  /**
   * Rend le code à imprimer sur l'étiquette du matériel.
   *
   * LECTURE SEULE : un GET ne doit jamais muter la base. Le code est posé à la création
   * (`createEquipment`), par le seed, ou par la migration de rattrapage — jamais ici. Avant, cette
   * fonction faisait un `update` paresseux : un compte lecture seule mutait la base, sur un GET,
   * sans audit (issue #99).
   */
  async getScannableLabel(organizationId: string, equipmentId: string) {
    const equipment = await prisma.equipment.findFirst({
      where: { id: equipmentId, organization_id: organizationId },
      select: { qr_code_id: true, nom: true },
    });

    if (!equipment) {
      throw new APIError(404, {
        error: [{ field: 'id', message: 'Matériel introuvable ou accès refusé' }],
      });
    }

    return { code: equipment.qr_code_id, nom: equipment.nom };
  },

  // Actifs seulement par défaut : un lieu archivé ne doit plus être proposé (création de matériel).
  async listLocations(organizationId: string, includeArchived = false) {
    return prisma.location.findMany({
      where: includeArchived
        ? { organization_id: organizationId }
        : { organization_id: organizationId, is_active: true },
      orderBy: { nom: 'asc' },
    });
  },

  // Chemin paginé de l'écran Configuration (le tableau + ses filtres). Le chemin non paginé
  // ci-dessus reste pour les sélecteurs de l'app, qui n'envoient pas de `page`.
  async listLocationsPaginated(
    organizationId: string,
    options: {
      page?: number;
      limit?: number;
      nom?: string;
      type?: string;
      statut?: 'actif' | 'archive';
    } = {}
  ) {
    const { page = 1, limit = 20, nom, type, statut } = options;
    const skip = (page - 1) * limit;

    const where: Prisma.LocationWhereInput = {
      organization_id: organizationId,
      nom: nom ? { contains: nom, mode: 'insensitive' } : undefined,
      type: type || undefined,
      is_active: statut === 'actif' ? true : statut === 'archive' ? false : undefined,
    };

    const [total, data] = await prisma.$transaction([
      prisma.location.count({ where }),
      prisma.location.findMany({ where, orderBy: { nom: 'asc' }, skip, take: limit }),
    ]);

    return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  },
};
