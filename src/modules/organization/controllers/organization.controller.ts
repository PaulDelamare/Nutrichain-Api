import { Response } from 'express';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { organizationService } from '../services/organization.service';
import {
  ADMIN_ROLES,
  PERSONAL_DATA_ROLES,
  type Role,
} from '../../identity/constants/roles.constants';

const DEFAULT_AUDIT_LOGS_LIMIT = 30;

export const listMembersController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const members = await organizationService.listMembers(req.activeOrgId as string);
    sendSuccess(res, 200, "Membres de l'organisation récupérés", members);
  }
);

export const listAlertsController = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const alerts = await organizationService.listAlerts(req.activeOrgId as string);
  sendSuccess(res, 200, 'Alertes récupérées', alerts);
});

export const listAuditLogsController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const limit = req.validatedOrganizationQuery?.limit ?? DEFAULT_AUDIT_LOGS_LIMIT;
    const logs = await organizationService.listAuditLogs(req.activeOrgId as string, limit);
    sendSuccess(res, 200, "Journal d'audit récupéré", logs);
  }
);

export const listQualityControlsController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const controls = await organizationService.listQualityControls(req.activeOrgId as string);
    sendSuccess(res, 200, 'Contrôles qualité récupérés', controls);
  }
);

export const listQuarantineBatchesController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const batches = await organizationService.listQuarantineBatches(req.activeOrgId as string);
    sendSuccess(res, 200, 'Lots en quarantaine récupérés', batches);
  }
);

export const listEquipmentController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const equipment = await organizationService.listEquipment(req.activeOrgId as string);
    sendSuccess(res, 200, 'Matériel récupéré', equipment);
  }
);

export const listMovementsController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const { limit, lotId } = req.validatedOrganizationQuery ?? {};
    // Le nom de l'auteur d'un mouvement est une donnée personnelle : seule l'administration le voit.
    // L'opérateur garde tout l'historique métier du lot, sans savoir QUI a fait chaque geste.
    const revealAuthor = ADMIN_ROLES.includes(req.auth?.role as Role);
    const movements = await organizationService.listMovements(req.activeOrgId as string, {
      limit,
      lotId,
      revealAuthor,
    });
    sendSuccess(res, 200, 'Mouvements de lots récupérés', movements);
  }
);

export const listSuppliersController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    // L'opérateur terrain lit la liste pour réceptionner, mais ne voit que { id, nom }.
    // Le contact et l'adresse (données personnelles) sont réservés à l'administration, qui
    // seule peut aussi demander les archivés (écran de configuration).
    const revealPersonalData = PERSONAL_DATA_ROLES.includes(req.auth?.role as Role);
    const suppliers = await organizationService.listSuppliers(req.activeOrgId as string, {
      includeArchived: revealPersonalData && req.query.includeArchived === 'true',
      revealPersonalData,
    });
    sendSuccess(res, 200, 'Fournisseurs récupérés', suppliers);
  }
);

export const listCustomersController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    // Même règle : l'opérateur expédie et voit { id, nom, adresse_livraison } (donnée
    // d'exploitation) ; contact, e-mail et notes restent réservés à l'administration.
    const revealPersonalData = PERSONAL_DATA_ROLES.includes(req.auth?.role as Role);
    const customers = await organizationService.listCustomers(req.activeOrgId as string, {
      includeArchived: revealPersonalData && req.query.includeArchived === 'true',
      revealPersonalData,
    });
    sendSuccess(res, 200, 'Clients récupérés', customers);
  }
);

export const listShipmentsController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const shipments = await organizationService.listShipments(req.activeOrgId as string);
    sendSuccess(res, 200, 'Expéditions récupérées', shipments);
  }
);
