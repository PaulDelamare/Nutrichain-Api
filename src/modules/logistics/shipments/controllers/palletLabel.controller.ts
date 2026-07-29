import { Response } from 'express';
import { palletLabelService } from '../services/palletLabel.service';
import { sendSuccess } from '../../../../shared/utils/returnSuccess/returnSuccess';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';

/**
 * Étiquette scannable d'une palette (réponse binaire, hors enveloppe JSON).
 */
export const getPalletLabelController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const { png, code } = await palletLabelService.generateLabel(
      req.params.id as string,
      req.activeOrgId as string
    );

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="palette-${code}.png"`);
    // `private` et non `public` : l'étiquette d'une palette n'a rien à faire dans un cache
    // partagé, elle est servie sous session et cloisonnée par organisation.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(png);
  }
);

/**
 * Contenu d'une palette à partir du SSCC lu par la caméra.
 */
export const resolvePalletController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const palette = await palletLabelService.resolveBySscc(
      req.params.sscc as string,
      req.activeOrgId as string
    );

    sendSuccess(res, 200, 'Contenu de la palette récupéré', palette);
  }
);
