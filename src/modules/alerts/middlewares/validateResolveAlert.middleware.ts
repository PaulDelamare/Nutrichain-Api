import vine from '@vinejs/vine';
import { Response, NextFunction } from 'express';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../identity/types/auth.types';

/**
 * Schéma de validation du body de PATCH /api/alerts/:id/resolve.
 *
 * - `note` optionnelle, max 500 chars (anti-bloat WORM, suffisant pour décrire la résolution).
 * - Pas de validation de contenu (charset libre — emoji/RTL OK).
 *
 * Note importante : empty string `""` est normalisée en `undefined` AVANT validation,
 * pour éviter la 4e branche "valeur fournie mais vide". Le service voit alors `note=undefined`
 * (puis `note: null` en audit). Décision documentée plan §TDD-5.
 */
const resolveAlertSchema = vine.object({
  note: vine.string().maxLength(500).optional(),
});

export const validateResolveAlert = catchAsync(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const body = (req.body ?? {}) as { note?: unknown };

    // Empty string traité comme absent — pas de validation sur une string vide
    // (qui sinon ferait échouer .string() même avec .optional()).
    const sanitized = {
      ...body,
      note: typeof body.note === 'string' && body.note.length === 0 ? undefined : body.note,
    };

    const validated = await validateData(resolveAlertSchema, sanitized as { note?: string });
    req.validatedResolveAlert = { note: validated?.note };
    next();
  }
);

export default validateResolveAlert;
