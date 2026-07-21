import { randomBytes } from 'crypto';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../shared/utils/audit/audit.service';
import { retryableTransaction } from '../../../shared/utils/db/withWriteConflictRetry';
import { hashGatewayKey } from '../../../shared/utils/iotGateway/iotGateway';

const introuvable = () =>
  new APIError(404, {
    error: [{ field: 'id', message: 'Passerelle introuvable ou accès refusé.' }],
  });

/** 48 octets : la clé n'est jamais devinable, et ne transite pas en base64 non-URL-safe. */
const genererCle = () => randomBytes(48).toString('base64url');

/**
 * Passerelles IoT d'une organisation.
 *
 * Sans ce service, la chaîne du froid restait inutilisable pour toute organisation créée après le
 * seed : la clé n'existe qu'en base et personne ne pouvait l'y écrire (#93).
 *
 * La clé en clair n'est **rendue qu'une fois**, à la création. La base n'en garde que l'empreinte :
 * la retrouver plus tard est donc impossible — on en génère une nouvelle et on révoque l'ancienne.
 */
export const iotGatewayService = {
  async list(organizationId: string) {
    return prisma.iotGateway.findMany({
      where: { organization_id: organizationId },
      select: { id: true, nom: true, revoked_at: true, created_at: true },
      orderBy: { created_at: 'desc' },
    });
  },

  async create(nom: string, organizationId: string, actorUserId: string) {
    const cle = genererCle();

    // Création et audit dans la MÊME transaction : sinon un échec du chaînage WORM laisserait
    // exister une clé capable de mettre des lots en quarantaine, sans aucune trace de qui l'a créée.
    const gateway = await retryableTransaction(async (tx) => {
      const created = await tx.iotGateway.create({
        data: { organization_id: organizationId, nom, key_hash: hashGatewayKey(cle) },
        select: { id: true, nom: true, created_at: true },
      });

      // L'audit porte l'existence de la passerelle, JAMAIS la clé ni son empreinte : un journal
      // consultable ne doit pas contenir de quoi rejouer une authentification.
      await auditService.logAction(
        {
          organizationId,
          userId: actorUserId,
          action: 'CREATE_IOT_GATEWAY',
          entity: 'IotGateway',
          entityId: created.id,
          newValue: { nom: created.nom },
        },
        tx
      );

      return created;
    });

    return { ...gateway, cle };
  },

  async revoke(id: string, organizationId: string, actorUserId: string) {
    return retryableTransaction(async (tx) => {
      const existante = await tx.iotGateway.findFirst({
        where: { id, organization_id: organizationId },
        select: { id: true, nom: true, revoked_at: true },
      });
      if (!existante) throw introuvable();

      // Idempotent : révoquer deux fois ne rejoue pas l'action dans l'audit. Le contrôle est DANS la
      // transaction — hors d'elle, deux révocations simultanées écrivaient deux lignes d'audit.
      if (existante.revoked_at) return existante;

      const gateway = await tx.iotGateway.update({
        where: { id },
        data: { revoked_at: new Date() },
        select: { id: true, nom: true, revoked_at: true },
      });

      await auditService.logAction(
        {
          organizationId,
          userId: actorUserId,
          action: 'REVOKE_IOT_GATEWAY',
          entity: 'IotGateway',
          entityId: id,
          newValue: { nom: gateway.nom },
        },
        tx
      );

      return gateway;
    });
  },
};
