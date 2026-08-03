import { Request } from 'express';
import { Alert, Batch, Receipt } from '@prisma/client';
import type { TelemetryPingPayload } from '../../iot/middlewares/telemetryPing.schema';
import type { TelemetryHistoryQuery } from '../../iot/middlewares/telemetryHistoryQuery.schema';
import type { ReceiptQuery } from '../../logistics/receipts/middlewares/receiptQuery.schema';
import type { CatalogQuery } from '../../traceability/catalog/middlewares/catalogQuery.schema';
import type { ShipmentQuery } from '../../organization/middlewares/shipmentQuery.schema';
import type { MemberQuery } from '../../organization/middlewares/memberQuery.schema';
import type { RecallQuery } from '../../organization/middlewares/recallQuery.schema';
import type { AuditLogQuery } from '../../organization/middlewares/auditLogQuery.schema';
import type { LocationQuery } from '../../organization/middlewares/locationQuery.schema';
import type { SupplierQuery } from '../../organization/middlewares/supplierQuery.schema';
import { SyncScansPayload } from '../../sync/types/sync.types';
import { EventsQuery } from '../../traceability/events/middlewares/eventsQuery.schema';
import type { OrganizationQuery } from '../../organization/middlewares/organizationQuery.schema';
import type { CreateEquipmentPayload } from '../../organization/middlewares/equipment.schema';
import type { CreateQualityControlPayload } from '../../organization/middlewares/qualityControl.schema';
import type { ReceiptPayload } from '../../logistics/receipts/middlewares/receiptPayload.schema';
import type { QuarantineLiftPayload } from '../../logistics/receipts/middlewares/quarantineLift.schema';
import type { MoveBatchPayload } from '../../logistics/receipts/middlewares/moveBatch.schema';
import type { ScrapPayload } from '../../logistics/receipts/middlewares/scrap.schema';
import type {
  WithdrawalRequest,
  WithdrawalListParams,
} from '../../logistics/withdrawals/middlewares/withdrawal.schema';
import type { BatchResolveQuery } from '../../logistics/receipts/middlewares/validateBatchResolve.middleware';
import type {
  ShipmentPayload,
  ConfirmDeliveryPayload,
  ShipmentIdParam,
} from '../../logistics/shipments/middlewares/shipmentPayload.schema';
import type {
  CreateLogisticUnitPayload,
  MoveLogisticUnitPayload,
  OpenLogisticUnitParams,
  ScanLogisticUnitParams,
} from '../../logistics/logisticUnits/middlewares/logisticUnit.schema';
import type { TransformationPayload } from '../../traceability/transformations/middlewares/transformationPayload.schema';
import type {
  RecallPayload,
  RecallSimulationParams,
} from '../../traceability/transformations/middlewares/recallPayload.schema';
import type {
  CreateOrganizationPayload,
  InviteOwnerPayload,
} from '../../platform/middlewares/platform.schema';

/**
 * Interface standard pour un utilisateur Better-Auth
 */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Ajouté par le plugin `twoFactor` de Better-Auth : présent à l'exécution, il ne figurait pas
   * dans ce type. L'écran 2FA du front en dépend, et il devait donc le récupérer par un cast — un
   * champ que le contrat typé effaçait. Le déclarer ici supprime le cast des deux côtés (#251).
   *
   * Optionnel : un utilisateur créé avant l'activation du plugin ne le porte pas.
   */
  twoFactorEnabled?: boolean;
}

/**
 * Interface standard pour une session Better-Auth
 */
export interface AuthSession {
  id: string;
  userId: string;
  expiresAt: Date;
  token: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  activeOrganizationId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Objet d'authentification injecté dans req.auth
 */
export interface AuthContext {
  user: AuthUser;
  session: AuthSession;
  activeOrgId?: string;
  role?: string;
}

/**
 * Extension de l'objet Request d'Express pour inclure l'authentification
 */
export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
  activeOrgId?: string;
  // Dépréciés mais conservés pour compatibilité transitoire
  user?: AuthUser;
  session?: AuthSession;
  // Champs optionnels injectés par les middlewares métiers (Logistique, etc.)
  batch?: Batch;
  receipt?: Receipt;
  alert?: Alert;
  // Données validées par les middlewares VineJS — typées via Infer du schéma (zéro any)
  validatedReceipt?: ReceiptPayload;
  // Résolution d'un lot par le numéro lu sur son étiquette (GET /logistics/batches/resolve)
  validatedBatchResolve?: BatchResolveQuery;
  // Levée de quarantaine d'un lot (POST /logistics/batches/:id/release)
  validatedQuarantineLift?: QuarantineLiftPayload;
  // Déplacement d'un lot vers un autre emplacement (PATCH /logistics/batches/:id/location)
  validatedMoveBatch?: MoveBatchPayload;
  // Mise au rebut d'un lot (POST /logistics/batches/:id/scrap)
  validatedScrap?: ScrapPayload;
  // Retrait d'un lot du rayon d'un magasin (POST/GET /logistics/batches/:id/withdrawals)
  validatedWithdrawal?: WithdrawalRequest;
  validatedWithdrawalList?: WithdrawalListParams;
  validatedShipment?: ShipmentPayload;
  validatedConfirmDelivery?: ConfirmDeliveryPayload;
  validatedShipmentIdParam?: ShipmentIdParam;
  // Constitution d'une palette (POST /logistics/logistic-units), scan de son SSCC, rangement.
  validatedLogisticUnit?: CreateLogisticUnitPayload;
  validatedLogisticUnitScan?: ScanLogisticUnitParams;
  validatedLogisticUnitMove?: MoveLogisticUnitPayload;
  validatedLogisticUnitOpen?: OpenLogisticUnitParams;
  validatedTransformation?: TransformationPayload;
  // Déclenchement d'un rappel produit (POST /traceability/batches/:id/recall)
  validatedRecall?: RecallPayload;
  // Simulation d'un rappel (GET /traceability/batches/:id/recall-simulation)
  validatedRecallSimulation?: RecallSimulationParams;
  // Sync mobile offline-first
  validatedSyncScans?: SyncScansPayload;
  // Trame de télémétrie IoT (POST /telemetry/ping)
  validatedTelemetryPing?: TelemetryPingPayload;
  // Query params bornés des lectures paginées
  validatedTelemetryHistoryQuery?: TelemetryHistoryQuery;
  validatedReceiptQuery?: ReceiptQuery;
  validatedCatalogQuery?: CatalogQuery;
  validatedShipmentQuery?: ShipmentQuery;
  validatedMemberQuery?: MemberQuery;
  validatedRecallQuery?: RecallQuery;
  validatedAuditLogQuery?: AuditLogQuery;
  validatedLocationQuery?: LocationQuery;
  validatedSupplierQuery?: SupplierQuery;
  // Alert resolve endpoint (PATCH /api/alerts/:id/resolve) — typé proprement
  validatedResolveAlert?: { note?: string };
  // Query params validés de GET /api/traceability/events — typé via Infer du schéma VineJS
  validatedEventsQuery?: EventsQuery;
  // Création d'un matériel de stockage (POST /api/organization/equipment)
  validatedEquipment?: CreateEquipmentPayload;
  validatedQualityControl?: CreateQualityControlPayload;

  validatedOrganizationQuery?: OrganizationQuery;
  // Administration de plateforme (POST /platform/organizations et .../owner) — slug/nom normalisés
  validatedCreateOrganization?: CreateOrganizationPayload;
  validatedInviteOwner?: InviteOwnerPayload;
}
