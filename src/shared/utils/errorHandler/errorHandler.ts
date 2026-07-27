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

const GENERIC_SERVER_ERROR = 'Une erreur interne est survenue.';

/**
 * Le `status` porté par une erreur n'est pas toujours un nombre : la `APIError` de Better-Auth
 * expose un libellé (« FORBIDDEN »), qui ferait lever `res.status()`. Elle porte alors le code
 * numérique dans `statusCode`, qu'il faut préférer : sans lui, une session expirée ou un accès
 * révoqué deviendrait un 500 « erreur interne », et le client réessaierait indéfiniment une
 * opération qu'il fallait au contraire cesser de tenter.
 *
 * Ce qui reste inexploitable devient 500 : c'est le cas où l'on sait le moins ce que l'on
 * s'apprête à divulguer.
 */
const toHttpStatus = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : 500;

/**
 * Le gestionnaire d'erreurs est terminal : s'il lève, Express rend la main à `finalhandler`, qui
 * publie la pile hors production — la fuite même que ce fichier ferme. Ni la sérialisation d'un
 * objet arbitraire passé à `next()` (référence circulaire, getter qui lève) ni `String()` sur un
 * objet à prototype nul ne doivent pouvoir en arriver là.
 */
const safeText = (value: unknown): string => {
  try {
    if (value instanceof Error) return `${value.message} ${value.stack ?? ''}`;
    return typeof value === 'string' ? value : JSON.stringify(value) || String(value);
  } catch {
    return '[valeur non representable]';
  }
};

/**
 * Handles an error by logging it and sending an appropriate error response.
 */
export const handleError = (error: unknown, req: Request, res: Response): void => {
  let status = 500;
  let errors: { field: string; message: string }[] = [];
  const requestId = req.requestId;

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const errorPrisma = getPrismaErrorMessage(error);
    status = errorPrisma.status;
    errors = [{ field: 'database', message: errorPrisma.message }];
    logger.error(
      `${formatDate(new Date())} - [ERROR] - Erreur Prisma: ${errorPrisma.message} ${safeText(error)}`,
      { requestId }
    );
  } else if (
    error &&
    typeof error === 'object' &&
    ('status' in error || (error as { name?: string }).name === 'APIError')
  ) {
    const errObj = error as {
      status?: number | string;
      statusCode?: number;
      body?: { error?: { field: string; message: string }[] };
      error?: { field: string; message: string }[];
      message?: string;
    };
    // `statusCode` d'abord : c'est le seul champ numérique quand l'erreur vient de Better-Auth.
    status = toHttpStatus(errObj.statusCode ?? errObj.status ?? 400);

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
    // La cause brute est journalisee en plus du corps : sans elle, une erreur de bibliotheque
    // masquee au client ne laisserait aucune trace exploitable.
    logger.error(
      `${formatDate(new Date())} - [ERROR] - Erreur API: ${safeText(errors)} ${safeText(error)}`,
      { requestId }
    );
  } else if (error instanceof Error) {
    // `errors` n'est volontairement pas renseigné ici : la garde terminale le fait pour toute 5xx.
    // L'y écrire aussi laisserait croire que ce message peut atteindre le client.
    status = 500;
    logger.error(`${formatDate(new Date())} - [ERROR] - Erreur serveur: ${safeText(error)}`, {
      requestId,
    });
  } else {
    status = 500;
    logger.error(`${formatDate(new Date())} - [ERROR] - Erreur inconnue: ${safeText(error)}`, {
      requestId,
    });
  }

  // Better-Auth ecrit lui-meme dans le flux de reponse : si la reponse est deja partie, insister
  // leverait ERR_HTTP_HEADERS_SENT depuis le gestionnaire terminal, donc sans filet.
  if (res.headersSent) return;

  const httpStatus = toHttpStatus(status);

  // Garde terminale plutot qu'une correction branche par branche : toute 5xx, y compris celles
  // qu'ajouteront les prochains contributeurs, sort avec le meme texte. Le detail reste au journal,
  // et la reference permet de l'y retrouver (#252).
  if (httpStatus >= 500) {
    errors = [
      {
        field: 'server',
        message: `${GENERIC_SERVER_ERROR} Référence : ${requestId ?? 'non disponible'}`,
      },
    ];
  }

  res.status(httpStatus).json({ status: httpStatus, error: errors });
};

export const globalErrorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  handleError(err, req, res);
};
