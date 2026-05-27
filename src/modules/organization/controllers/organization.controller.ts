import { Response } from 'express';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { organizationService } from '../services/organization.service';
import { resolveActiveOrgId } from '../../identity/utils/resolveActiveOrgId';

export const getMembers = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const members = await organizationService.getMembers(await resolveActiveOrgId(req));
  sendSuccess(res, 200, 'Membres récupérés', members);
});

export const getAlerts = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const activeOnly = req.query.active !== 'false';
  const alerts = await organizationService.getAlerts(await resolveActiveOrgId(req), activeOnly);
  sendSuccess(res, 200, 'Alertes récupérées', alerts);
});

export const getAuditLogs = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 30;
  const logs = await organizationService.getAuditLogs(await resolveActiveOrgId(req), limit);
  sendSuccess(res, 200, "Journal d'audit récupéré", logs);
});

export const getQualityControls = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const rows = await organizationService.getQualityControls(await resolveActiveOrgId(req));
  sendSuccess(res, 200, 'Contrôles qualité récupérés', rows);
});

export const getQuarantineBatches = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const batches = await organizationService.getQuarantineBatches(await resolveActiveOrgId(req));
  sendSuccess(res, 200, 'Lots en quarantaine récupérés', batches);
});

export const getEquipment = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const equipment = await organizationService.getEquipment(await resolveActiveOrgId(req));
  sendSuccess(res, 200, 'Équipements récupérés', equipment);
});

export const getMovements = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 15;
  const lotId = typeof req.query.lotId === 'string' ? req.query.lotId : undefined;
  const movements = await organizationService.getMovements(
    await resolveActiveOrgId(req),
    limit,
    lotId
  );
  sendSuccess(res, 200, 'Mouvements récupérés', movements);
});

export const getSuppliers = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const suppliers = await organizationService.getSuppliers(await resolveActiveOrgId(req));
  sendSuccess(res, 200, 'Fournisseurs récupérés', suppliers);
});

export const getCustomers = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const customers = await organizationService.getCustomers(await resolveActiveOrgId(req));
  sendSuccess(res, 200, 'Clients récupérés', customers);
});

export const getShipments = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const shipments = await organizationService.getShipments(await resolveActiveOrgId(req));
  sendSuccess(res, 200, 'Expéditions récupérées', shipments);
});
