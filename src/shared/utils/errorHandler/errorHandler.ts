import { Prisma } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';
import { formatDate } from '../formatDateError/formatDateError';
import { logger } from '../logger/logger';

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
    const errObj = error as {
      status?: number;
      body?: { error?: { field: string; message: string }[] };
      error?: { field: string; message: string }[];
      message?: string;
    };
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

export const globalErrorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  handleError(err, req, res);
};
