// ! IMPORTS
import { NextFunction, Request, Response } from 'express';
import { handleError } from '../errorHandler/errorHandler';

/**
 * Générateur de middleware pour vérifier une clé API spécifique
 *
 * @param expectedApiKey - La clé API attendue (par exemple, provenant de process.env)
 * @return - Un middleware Express qui valide la clé API
 */
export const checkApiKey = (expectedApiKey?: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const targetKey = expectedApiKey ?? process.env.API_KEY;
    const api_key_header = req.header('x-api-key');

    if (targetKey && api_key_header === targetKey) {
      next();
    } else {
      console.error('Non authentifié. Vous devez utiliser votre clef API.');
      handleError(
        { status: 401, error: 'Non authentifié. Vous devez utiliser votre clef API.' },
        req,
        res
      );
    }
  };
};
