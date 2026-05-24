import { Request } from 'express';
import { Batch, Receipt } from '@prisma/client';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  validatedReceipt?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  validatedBatch?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  validatedShipment?: any;
}
