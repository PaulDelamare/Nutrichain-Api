import { Request } from 'express';
import { Alert, Batch, Receipt } from '@prisma/client';
import { SyncScansPayload } from '../../sync/types/sync.types';
import { EventsQuery } from '../../traceability/events/middlewares/eventsQuery.schema';
import type { OrganizationQuery } from '../../organization/middlewares/organizationQuery.schema';
import type { CreateEquipmentPayload } from '../../organization/middlewares/equipment.schema';
import type { ReceiptPayload } from '../../logistics/receipts/middlewares/receiptPayload.schema';
import type { QuarantineLiftPayload } from '../../logistics/receipts/middlewares/quarantineLift.schema';
import type { ShipmentPayload } from '../../logistics/shipments/middlewares/shipmentPayload.schema';
import type { TransformationPayload } from '../../traceability/transformations/middlewares/transformationPayload.schema';

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
  // Levée de quarantaine d'un lot (POST /logistics/batches/:id/release)
  validatedQuarantineLift?: QuarantineLiftPayload;
  validatedShipment?: ShipmentPayload;
  validatedTransformation?: TransformationPayload;
  // Sync mobile offline-first
  validatedSyncScans?: SyncScansPayload;
  // Alert resolve endpoint (PATCH /api/alerts/:id/resolve) — typé proprement
  validatedResolveAlert?: { note?: string };
  // Query params validés de GET /api/traceability/events — typé via Infer du schéma VineJS
  validatedEventsQuery?: EventsQuery;
  // Création d'un matériel de stockage (POST /api/organization/equipment)
  validatedEquipment?: CreateEquipmentPayload;

  validatedOrganizationQuery?: OrganizationQuery;
}
