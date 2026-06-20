import { Response } from 'express';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { sendSuccess } from '../../../../shared/utils/returnSuccess/returnSuccess';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';
import { eventService } from '../services/event.service';

/**
 * Liste paginée des événements EPCIS de l'organisation active.
 */
export const listEventsController = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, event_type, related_entity } = req.validatedEventsQuery ?? {};

  const result = await eventService.listEvents(req.activeOrgId, page, limit, {
    eventType: event_type,
    relatedEntity: related_entity,
  });

  sendSuccess(res, 200, 'Événements EPCIS récupérés', result);
});
