import { prisma } from '../../../shared/configs/prismaClient.config';
import { BATCH_STATUSES } from '../../logistics/constants/logistics.constants';

/**
 * Façade de lecture pour le frontend : expose les référentiels de l'organisation
 * (membres, alertes, journal d'audit, qualité, quarantaine, matériel, mouvements,
 * fournisseurs, clients, expéditions). Les formes de réponse suivent le contrat
 * du front SvelteKit (src/lib/Api/organization.server.ts) — lecture seule,
 * cloisonnée par organisation.
 */
export const organizationService = {
  async listMembers(organizationId: string) {
    return prisma.member.findMany({
      // Modèle Better-Auth : la clé de tenant est organizationId (camelCase).
      where: { organizationId },
      include: {
        user: { select: { id: true, email: true, name: true, twoFactorEnabled: true } },
      },
    });
  },

  async listAlerts(organizationId: string) {
    return prisma.alert.findMany({
      where: { organization_id: organizationId },
      orderBy: { created_at: 'desc' },
    });
  },

  async listAuditLogs(organizationId: string, limit: number) {
    return prisma.audit_Log.findMany({
      where: { organization_id: organizationId },
      orderBy: { horodatage: 'desc' },
      take: limit,
    });
  },

  async listQualityControls(organizationId: string) {
    return prisma.qualityControl.findMany({
      where: { organization_id: organizationId },
      include: { lot: { select: { id: true, produit: { select: { nom: true } } } } },
      orderBy: { date_test: 'desc' },
    });
  },

  async listQuarantineBatches(organizationId: string) {
    return prisma.batch.findMany({
      where: { organization_id: organizationId, statut: BATCH_STATUSES.BLOCKED },
      include: { produit: { select: { nom: true } } },
      orderBy: { date_creation: 'desc' },
    });
  },

  async listEquipment(organizationId: string) {
    return prisma.equipment.findMany({
      where: { organization_id: organizationId },
      include: { lieu: { select: { nom: true } } },
    });
  },

  async listMovements(
    organizationId: string,
    opts: { lotId?: string; limit?: number; revealAuthor?: boolean } = {}
  ) {
    return prisma.batch_Mouvement.findMany({
      // Batch_Mouvement n'a pas d'organization_id : le cloisonnement passe par le lot.
      where: {
        lot: { organization_id: organizationId },
        ...(opts.lotId ? { id_lot: opts.lotId } : {}),
      },
      include: {
        lot: { select: { id: true, produit: { select: { nom: true } } } },
        // L'identité de l'auteur n'est jointe que pour l'administration : un `select` conditionnel
        // au niveau de la requête, pour ne pas la faire remonter puis l'oublier en aval.
        ...(opts.revealAuthor ? { user: { select: { name: true } } } : {}),
      },
      orderBy: { created_at: 'desc' },
      ...(opts.limit ? { take: opts.limit } : {}),
    });
  },

  // Actifs seulement par défaut : un fournisseur archivé ne doit plus être proposé (réception).
  // `includeArchived` sert l'écran d'administration, qui doit les voir pour les réactiver.
  //
  // `revealPersonalData` : sans lui (opérateur terrain), on ne renvoie que l'identité métier
  // { id, nom } — ce dont la liste déroulante de réception a besoin. Le contact et l'adresse du
  // siège (données personnelles) restent réservés à l'administration.
  async listSuppliers(
    organizationId: string,
    { includeArchived = false, revealPersonalData = false } = {}
  ) {
    return prisma.supplier.findMany({
      where: includeArchived
        ? { organization_id: organizationId }
        : { organization_id: organizationId, is_active: true },
      ...(revealPersonalData ? {} : { select: { id: true, nom_ferme: true } }),
      orderBy: { nom_ferme: 'asc' },
    });
  },

  // Actifs seulement par défaut : un client archivé ne doit plus être proposé (expédition).
  //
  // `revealPersonalData` : sans lui (opérateur terrain), on renvoie { id, nom, adresse_livraison }.
  // L'adresse de livraison est une donnée d'EXPLOITATION — elle pré-remplit la destination de
  // l'expédition, l'opérateur en a besoin. Le contact d'urgence, l'e-mail et les notes (données
  // personnelles nominatives) restent, eux, réservés à l'administration.
  async listCustomers(
    organizationId: string,
    { includeArchived = false, revealPersonalData = false } = {}
  ) {
    return prisma.customer.findMany({
      where: includeArchived
        ? { organization_id: organizationId }
        : { organization_id: organizationId, is_active: true },
      ...(revealPersonalData
        ? {}
        : { select: { id: true, nom_enseigne: true, adresse_livraison: true } }),
      orderBy: { nom_enseigne: 'asc' },
    });
  },

  async listShipments(organizationId: string) {
    return prisma.shipment.findMany({
      where: { organization_id: organizationId },
      // Projection EXPLICITE, et non l'entité entière : `delivered_by` désigne une personne, et
      // cette liste est ouverte à tous les rôles de lecture. Le dépôt a déjà tranché ailleurs que
      // l'identité de l'auteur d'un geste relève de `PERSONAL_DATA_ROLES` — un `findMany` sans
      // `select` l'aurait exposée par le simple ajout d'une colonne.
      select: {
        id: true,
        shipment_id: true,
        date_envoi: true,
        transporteur: true,
        destination_adresse: true,
        statut_livraison: true,
        date_livraison: true,
        client: { select: { nom_enseigne: true } },
        liaisons: { select: { lot: { select: { id: true } } } },
      },
      orderBy: { date_envoi: 'desc' },
    });
  },
};
