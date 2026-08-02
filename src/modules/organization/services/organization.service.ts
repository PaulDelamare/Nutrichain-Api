import { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { BATCH_STATUSES } from '../../logistics/constants/logistics.constants';
import { RECALL_ALERT_TYPES } from '../../alerts/constants/alert.constants';

/**
 * Façade de lecture pour le frontend : expose les référentiels de l'organisation
 * (membres, alertes, journal d'audit, qualité, quarantaine, matériel, mouvements,
 * fournisseurs, clients, expéditions). Les formes de réponse suivent le contrat
 * du front SvelteKit (src/lib/Api/organization.server.ts) — lecture seule,
 * cloisonnée par organisation.
 */
export const organizationService = {
  async listMembers(
    organizationId: string,
    options: {
      page?: number;
      limit?: number;
      // Filtres de colonnes appliqués dans la requête (et non plus sur la page reçue côté front) :
      // chacun restreint sur TOUTE l'organisation. Absents (undefined) ⇒ Prisma les ignore.
      email?: string;
      role?: string;
      mfa?: boolean;
    } = {}
  ) {
    const { page = 1, limit = 20, email, role, mfa } = options;
    const skip = (page - 1) * limit;

    // Filtres portés par le compte joint (email, MFA). `twoFactorEnabled` est nullable (jamais
    // configuré) : « sans MFA » doit donc inclure `null`, pas seulement `false`, sinon un compte
    // neuf échapperait au filtre censé le désigner.
    let userFilter: Prisma.UserWhereInput | undefined;
    if (email || mfa !== undefined) {
      userFilter = {
        email: email ? { contains: email, mode: 'insensitive' } : undefined,
        ...(mfa === true ? { twoFactorEnabled: true } : {}),
        ...(mfa === false ? { OR: [{ twoFactorEnabled: false }, { twoFactorEnabled: null }] } : {}),
      };
    }

    const where: Prisma.MemberWhereInput = {
      // Modèle Better-Auth : la clé de tenant est organizationId (camelCase).
      organizationId,
      role: role || undefined,
      user: userFilter,
    };

    const [total, data] = await prisma.$transaction([
      prisma.member.count({ where }),
      prisma.member.findMany({
        where,
        include: {
          user: { select: { id: true, email: true, name: true, twoFactorEnabled: true } },
        },
        // Même raison que pour le matériel : sans tri, la liste se réordonne dès qu'une ligne est
        // réécrite (changement de rôle, activation 2FA), et l'écran des membres change d'ordre sans
        // qu'on ait rien demandé.
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
    ]);

    return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  },

  // Compteurs des référentiels pour les badges d'onglets de la page Configuration. Un seul appel :
  // la page ne charge que l'onglet actif, mais chaque badge affiche le total de son référentiel.
  async configReferentialCounts(organizationId: string) {
    const where = { organization_id: organizationId };
    const [locations, suppliers, customers, products, equipment] = await prisma.$transaction([
      prisma.location.count({ where }),
      prisma.supplier.count({ where }),
      prisma.customer.count({ where }),
      prisma.product.count({ where }),
      prisma.equipment.count({ where }),
    ]);
    return { locations, suppliers, customers, products, equipment };
  },

  async listAlerts(organizationId: string) {
    return prisma.alert.findMany({
      where: { organization_id: organizationId },
      orderBy: { created_at: 'desc' },
    });
  },

  async listRecalls(
    organizationId: string,
    options: {
      page?: number;
      limit?: number;
      // Filtres de colonnes appliqués dans la requête. Absents (undefined) ⇒ Prisma les ignore.
      q?: string;
      statut?: 'en_cours' | 'cloture';
    } = {}
  ) {
    const { page = 1, limit = 20, q, statut } = options;
    const skip = (page - 1) * limit;

    // `en_cours` = alerte encore ACTIVE ; `cloture` = tout autre statut (rappel résolu). La famille
    // RAPPEL est imposée dans le `where` : cette route ne doit pas exposer les alertes froid/qualité.
    const statutFilter =
      statut === 'en_cours' ? 'ACTIVE' : statut === 'cloture' ? { not: 'ACTIVE' } : undefined;

    const where: Prisma.AlertWhereInput = {
      organization_id: organizationId,
      type: { in: [...RECALL_ALERT_TYPES] },
      statut: statutFilter,
      message: q ? { contains: q, mode: 'insensitive' } : undefined,
    };

    const [total, data] = await prisma.$transaction([
      prisma.alert.count({ where }),
      prisma.alert.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  },

  async listAuditLogs(
    organizationId: string,
    options: {
      page?: number;
      limit?: number;
      // Filtres de colonnes appliqués dans la requête. Absents (undefined) ⇒ Prisma les ignore.
      action?: string;
      entity?: string;
      entityId?: string;
      from?: string;
      to?: string;
    } = {}
  ) {
    const { page = 1, limit = 20, action, entity, entityId, from, to } = options;
    const skip = (page - 1) * limit;

    // Créneau sur l'horodatage : bornes `datetime-local` (`YYYY-MM-DDTHH:mm`) validées en amont.
    let horodatage: { gte?: Date; lte?: Date } | undefined;
    if (from || to) {
      horodatage = {};
      if (from) horodatage.gte = new Date(from);
      if (to) horodatage.lte = new Date(to);
    }

    const where: Prisma.Audit_LogWhereInput = {
      organization_id: organizationId,
      // `action` et `entity` viennent de selects bornés : correspondance exacte. `entity_id` est une
      // recherche libre (un UUID complet ne se retrouve pas par erreur dans un autre).
      action: action || undefined,
      entity: entity || undefined,
      entity_id: entityId ? { contains: entityId, mode: 'insensitive' } : undefined,
      horodatage,
    };

    const [total, data] = await prisma.$transaction([
      prisma.audit_Log.count({ where }),
      prisma.audit_Log.findMany({
        where,
        orderBy: { horodatage: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
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
      // Postgres rend les lignes dans l'ordre physique tant qu'on ne trie pas : chaque mesure IoT
      // réécrit `temp_actuelle` et déplace le matériel mesuré. La liste se réordonnait donc toute
      // seule, et l'écran de la chaîne du froid — qui traçait « le premier capteur » — changeait de
      // chambre au moment même où une excursion était détectée. `id` départage deux homonymes.
      orderBy: [{ nom: 'asc' }, { id: 'asc' }],
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

  async listShipments(
    organizationId: string,
    options: {
      page?: number;
      limit?: number;
      // Filtres de colonnes appliqués dans la requête (et non plus sur la page reçue côté front) :
      // chacun restreint sur TOUTE l'organisation. Absents (undefined) ⇒ Prisma les ignore.
      ref?: string;
      client?: string;
      statut?: string;
      date?: string;
    } = {}
  ) {
    const { page = 1, limit = 20, ref, client, statut, date } = options;
    const skip = (page - 1) * limit;

    // Filtre « un jour » : borne [jour 00:00 UTC, lendemain 00:00 UTC[. `date` est validée `YYYY-MM-DD`.
    let dateEnvoi: { gte: Date; lt: Date } | undefined;
    if (date) {
      const start = new Date(`${date}T00:00:00.000Z`);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      dateEnvoi = { gte: start, lt: end };
    }

    const where: Prisma.ShipmentWhereInput = {
      organization_id: organizationId,
      shipment_id: ref ? { contains: ref, mode: 'insensitive' } : undefined,
      id_client: client || undefined,
      statut_livraison: statut || undefined,
      date_envoi: dateEnvoi,
    };

    const [total, data] = await prisma.$transaction([
      prisma.shipment.count({ where }),
      prisma.shipment.findMany({
        where,
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
        skip,
        take: limit,
      }),
    ]);

    return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  },
};
