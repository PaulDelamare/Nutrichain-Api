import { prisma } from '../../../shared/configs/prismaClient.config';

export const organizationService = {
  async getMembers(organizationId: string) {
    return prisma.member.findMany({
      where: { organizationId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            twoFactorEnabled: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  },

  async getAlerts(organizationId: string, activeOnly = true) {
    return prisma.alert.findMany({
      where: {
        organization_id: organizationId,
        ...(activeOnly ? { statut: 'ACTIVE' } : {}),
      },
      orderBy: { created_at: 'desc' },
    });
  },

  async getAuditLogs(organizationId: string, limit = 30) {
    return prisma.audit_Log.findMany({
      where: { organization_id: organizationId },
      orderBy: { horodatage: 'desc' },
      take: limit,
    });
  },

  async getQualityControls(organizationId: string) {
    return prisma.qualityControl.findMany({
      where: {
        organization_id: organizationId,
        resultat: { not: 'CONFORME' },
      },
      include: {
        lot: {
          include: {
            produit: { select: { nom: true } },
          },
        },
        user: { select: { name: true } },
      },
      orderBy: { date_test: 'desc' },
    });
  },

  async getQuarantineBatches(organizationId: string) {
    return prisma.batch.findMany({
      where: {
        organization_id: organizationId,
        statut: { in: ['QUARANTAINE', 'QUARANTINE', 'BLOQUE'] },
      },
      include: { produit: { select: { nom: true } } },
      orderBy: { date_creation: 'desc' },
    });
  },

  async getEquipment(organizationId: string) {
    return prisma.equipment.findMany({
      where: { organization_id: organizationId },
      include: { lieu: { select: { nom: true, type: true } } },
      orderBy: { nom: 'asc' },
    });
  },

  async getMovements(organizationId: string, limit = 15, lotId?: string) {
    return prisma.batch_Mouvement.findMany({
      where: {
        lot: {
          organization_id: organizationId,
          ...(lotId ? { id: lotId } : {}),
        },
      },
      include: {
        lot: {
          include: { produit: { select: { nom: true } } },
        },
        user: { select: { name: true } },
      },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
  },

  async getSuppliers(organizationId: string) {
    return prisma.supplier.findMany({
      where: { organization_id: organizationId },
      orderBy: { nom_ferme: 'asc' },
    });
  },

  async getCustomers(organizationId: string) {
    return prisma.customer.findMany({
      where: { organization_id: organizationId },
      orderBy: { nom_enseigne: 'asc' },
    });
  },

  async getShipments(organizationId: string, limit = 20) {
    return prisma.shipment.findMany({
      where: { organization_id: organizationId },
      include: {
        client: { select: { nom_enseigne: true } },
        liaisons: { include: { lot: { select: { id: true } } } },
      },
      orderBy: { date_envoi: 'desc' },
      take: limit,
    });
  },
};
