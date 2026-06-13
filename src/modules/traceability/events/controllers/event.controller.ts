import { Response } from 'express';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { sendSuccess } from '../../../../shared/utils/returnSuccess/returnSuccess';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';
import { eventService } from '../services/event.service';

/**
 * Liste paginée des événements EPCIS de l'organisation active.
 */
export const listEventsController = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const activeOrgId = req.activeOrgId as string;
  const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
  const eventType = req.query.event_type as string | undefined;
  const relatedEntity = req.query.related_entity as string | undefined;

  const result = await eventService.listEvents(activeOrgId, page, limit, {
    eventType,
    relatedEntity,
  });

  sendSuccess(res, 200, 'Événements EPCIS récupérés', result);
});
