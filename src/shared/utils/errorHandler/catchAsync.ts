import { Request, Response, NextFunction } from 'express';

/**
 * Wrapper asynchrone pour les contrôleurs afin de transférer automatiquement 
 * les erreurs vers le ErrorHandler global d'Express sans avoir à écrire de try/catch.
 */
export const catchAsync = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
};
