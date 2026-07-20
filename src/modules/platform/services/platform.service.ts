import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { auditService } from '../../../shared/utils/audit/audit.service';
import { retryableTransaction } from '../../../shared/utils/db/withWriteConflictRetry';
import { createAndSendInvitation } from '../../identity/services/invitation.service';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { ROLES } from '../../identity/constants/roles.constants';

interface CreateOrganizationInput {
  name: string;
  slug: string;
  gs1_company_prefix?: string;
}

interface PlatformActor {
  id: string;
  email: string;
}

const slugDejaPris = () =>
  new APIError(409, {
    error: [{ field: 'slug', message: 'Ce libellé court (slug) est déjà utilisé.' }],
  });

export const platformService = {
  /**
   * Crée une organisation cliente et journalise l'acte dans SA PROPRE chaîne d'audit.
   *
   * L'audit WORM est chaîné par organisation (organization_id NOT NULL) : l'acte fondateur d'une
   * organisation est donc la première ligne de sa propre chaîne (prev_hash = GENESIS). Écriture et
   * journalisation sont dans la MÊME transaction — sinon on risque une organisation sans trace, ou
   * une trace pointant vers une organisation qui a été annulée par un rollback.
   */
  async createOrganization(input: CreateOrganizationInput, actorUserId: string) {
    // Pré-vérification pour un message immédiat. Elle ne SUFFIT pas : deux créations concurrentes
    // du même slug la passeraient toutes les deux — l'unicité réelle est la contrainte `@@unique`,
    // dont on traduit la violation (P2002) en 409 plutôt qu'en 500.
    const existant = await prisma.organization.findUnique({ where: { slug: input.slug } });
    if (existant) throw slugDejaPris();

    try {
      return await retryableTransaction(async (tx) => {
        const org = await tx.organization.create({
          data: {
            id: crypto.randomUUID(),
            name: input.name,
            slug: input.slug,
            createdAt: new Date(),
            metadata: '{}',
            gs1_company_prefix: input.gs1_company_prefix ?? null,
          },
        });

        await auditService.logAction(
          {
            organizationId: org.id,
            userId: actorUserId,
            action: 'CREATE_ORGANIZATION',
            entity: 'Organization',
            entityId: org.id,
            newValue: { name: org.name, slug: org.slug },
          },
          tx
        );

        return org;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw slugDejaPris();
      throw e;
    }
  },

  async listOrganizations() {
    const orgs = await prisma.organization.findMany({
      select: { id: true, name: true, slug: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    // Le nombre de membres, pas leur identité : l'admin de plateforme ne voit pas l'annuaire.
    return Promise.all(
      orgs.map(async (org) => ({
        ...org,
        membersCount: await prisma.member.count({ where: { organizationId: org.id } }),
      }))
    );
  },

  /**
   * Invite le PREMIER owner d'une organisation. C'est le seul chemin qui pose un rôle `owner` :
   * le flux d'invitation d'un admin d'organisation en est volontairement incapable
   * (`INVITABLE_ROLES` exclut owner).
   */
  async inviteOwner(organizationId: string, email: string, actor: PlatformActor) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) {
      throw new APIError(404, {
        error: [{ field: 'organizationId', message: "L'organisation demandée n'existe pas." }],
      });
    }

    // Un pilote unique : ni membre déjà en place, ni invitation d'owner encore en attente.
    // Sans le second test, on inviterait plusieurs owners (emails distincts) avant qu'aucun
    // n'accepte — l'org se retrouverait avec plusieurs propriétaires légitimes.
    const [membres, ownerEnAttente] = await Promise.all([
      prisma.member.count({ where: { organizationId } }),
      prisma.invitation.count({
        where: { organizationId, role: ROLES.OWNER, status: 'pending' },
      }),
    ]);

    if (membres > 0 || ownerEnAttente > 0) {
      throw new APIError(409, {
        error: [
          {
            field: 'organizationId',
            message:
              'Cette organisation a déjà un pilote (membre en place ou invitation en attente).',
          },
        ],
      });
    }

    return createAndSendInvitation({
      organizationId,
      inviterId: actor.id,
      inviterEmail: actor.email,
      email,
      role: ROLES.OWNER,
    });
  },
};
