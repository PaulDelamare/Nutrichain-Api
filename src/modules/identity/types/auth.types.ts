import { Request } from 'express';

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
 * Interface pour les données de requête authentifiée (Web ou M2M)
 */
export interface AuthenticatedRequest extends Request {
  auth?: {
    user: AuthUser;
    session: AuthSession;
    activeOrgId?: string;
  };
  user?: AuthUser;
  session?: AuthSession;
  activeOrgId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  validatedReceipt?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  validatedBatch?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  receipt?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  batch?: any;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  batch?: any; 
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  receipt?: any;
}
