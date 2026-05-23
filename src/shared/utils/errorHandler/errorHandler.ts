import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { formatDate } from '../formatDateError/formatDateError';
import { logger } from '../logger/logger';
import { APIError } from './APIError';

/**
 * Converts a Prisma error into a consistent error object containing a status code and an appropriate error message.
 */
const getPrismaErrorMessage = (
  error: Prisma.PrismaClientKnownRequestError
): { status: number; message: string } => {
  switch (error.code) {
    case 'P2002': {
      const field = error.meta?.target || 'inconnu';
      return {
        status: 400,
        message: `Erreur : le champ ${field} doit être unique. La valeur fournie est déjà utilisée.`,
      };
    }
    case 'P2003':
      return {
        status: 400,
        message:
          'Erreur : violation de contrainte de clé étrangère. Veuillez vérifier les références.',
      };
    case 'P2025':
      return {
        status: 404,
        message:
          "Erreur : Une opération a échoué car elle dépend d'un ou plusieurs enregistrements requis mais introuvables.",
      };
    default:
      return {
        status: 500,
        message: "Erreur serveur : une erreur Prisma inconnue s'est produite.",
      };
  }
};

/**
 * Formats validation errors into a consistent structure.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const formatValidationErrors = (
  error: any
): { status: number; error: { field: string; message: string }[] } => {
  // Détection robuste des objets de type APIError (avec .body.error) ou objets simples (avec .error)
  if (error && error.body && Array.isArray(error.body.error)) {
    return { status: error.status || 500, error: error.body.error };
  }

  if (error && Array.isArray(error.error)) {
    return { status: error.status || 400, error: error.error };
  }

  return { status: error.status || 500, error: [] };
};

/**
 * Sends an error response to the client.
 */
const sendErrorResponse = (
  res: Response,
  status: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: any
): void => {
  // Toujours renvoyer un tableau pour la propriété error
  const errorArray = Array.isArray(error) ? error : [{ field: 'server', message: String(error) }];
  res.status(status).json({ status, error: errorArray });
};

/**
 * Handles an error by logging it and sending an appropriate error response.
 */
export const handleError = (error: unknown, req: Request, res: Response): void => {
  let status = 500;
  let errors: { field: string; message: string }[] = [];

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const errorPrisma = getPrismaErrorMessage(error);
    status = errorPrisma.status;
    errors = [{ field: 'database', message: errorPrisma.message }];
    logger.error(`${formatDate(new Date())} - [ERROR] - Erreur Prisma: ${errorPrisma.message}`);
  } else if (
    error &&
    typeof error === 'object' &&
    ('status' in error || (error as { name?: string }).name === 'APIError')
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errObj = error as any;
    status = errObj.status || 400;

    // Détection du format de l'erreur (APIError vs objet de validation simple)
    if (errObj.body && Array.isArray(errObj.body.error)) {
      errors = errObj.body.error;
    } else if (Array.isArray(errObj.error)) {
      errors = errObj.error;
    } else if (errObj.message) {
      errors = [{ field: 'api', message: errObj.message }];
    } else {
      errors = [{ field: 'api', message: 'Erreur inconnue' }];
    }
    logger.error(`${formatDate(new Date())} - [ERROR] - Erreur API: ${JSON.stringify(errors)}`);
  } else if (error instanceof Error) {
    status = 500;
    errors = [{ field: 'server', message: error.message }];
    logger.error(
      `${formatDate(new Date())} - [ERROR] - Erreur serveur: ${error.message} ${error.stack}`
    );
  } else {
    status = 500;
    errors = [{ field: 'server', message: 'Erreur serveur inconnue' }];
    logger.error(`${formatDate(new Date())} - [ERROR] - Erreur inconnue`);
  }

  res.status(status).json({ status, error: errors });
};

// Suppression du unused APIError car utilisé dynamiquement via (error as any).name === 'APIError'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _dontRemove = { formatValidationErrors, sendErrorResponse };

import { NextFunction } from 'express';
export const globalErrorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void => {
  handleError(err, req, res);
};
