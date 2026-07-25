import { Request, Response, NextFunction } from 'express';
import { validateData } from '../../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { publicScanDigitalLinkSchema } from './publicScanDigitalLink.schema';

/**
 * Canal public non authentifié : le GTIN et le lot viennent d'un QR code scanné par un inconnu,
 * on les borne avant qu'ils n'atteignent la requête Prisma. Ne stocke rien sur `req` (pas de
 * session ici) — la validation suffit, le contrôleur relit `req.params` normalement.
 */
export const validatePublicScanDigitalLink = catchAsync(
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    await validateData(publicScanDigitalLinkSchema, req.params);
    next();
  }
);
