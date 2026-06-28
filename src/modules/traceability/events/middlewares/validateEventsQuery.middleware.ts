import { Response, NextFunction } from 'express';
import { validateData } from '../../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';
import { eventsQuerySchema, EventsQuery } from './eventsQuery.schema';

export const validateEventsQuery = catchAsync(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const validated = await validateData(eventsQuerySchema, req.query as unknown as EventsQuery);
    req.validatedEventsQuery = validated;
    next();
  }
);

export default validateEventsQuery;
