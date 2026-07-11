import { Response, NextFunction } from 'express';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { organizationQuerySchema, OrganizationQuery } from './organizationQuery.schema';

export const validateOrganizationQuery = catchAsync(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const validated = await validateData(
      organizationQuerySchema,
      req.query as unknown as OrganizationQuery
    );
    req.validatedOrganizationQuery = validated;
    next();
  }
);

export default validateOrganizationQuery;
