// ! IMPORTS
import { Request, Response } from 'express';
import { validateData } from '../../shared/utils/validateData/validateData';
import vine from '@vinejs/vine';
import { sendSuccess } from '../../shared/utils/returnSuccess/returnSuccess';
import { helloService } from './hello.services';
import { catchAsync } from '../../shared/utils/errorHandler/catchAsync';

// ! METHODS

/**
 * Responds with a JSON object containing a 'Hello World!' message.
 *
 * @param req - The Express request object.
 * @param res - The Express response object.
 */
const helloWorld = catchAsync(async (_req: Request, res: Response) => {
  sendSuccess(res, 200, 'Hello World!');
});

/**
 * Handles a request to validate and process data.
 *
 * This function validates incoming request data against a predefined schema and sends a success response if validation succeeds.
 * In case of validation errors or other exceptions, it handles the error using the error handling utility.
 *
 * @param req - The Express request object containing the request data.
 * @param res - The Express response object used to send the response.
 */

const errorRequest = catchAsync(async (req: Request, res: Response) => {
  const schemaData = vine.object({
    name: vine.string(),
  });

  await validateData(schemaData, req.body);
  sendSuccess(res, 200, 'Hello', req.body.name);
});

/**
 * Handles a request to the service example endpoint.
 *
 * Calls the example service with a predefined object and sends a success response
 * with the service's response data. In case of an error, it handles the error
 * using the error handling middleware.
 *
 * @param req - The Express request object.
 * @param res - The Express response object.
 */

const serviceExemple = catchAsync(async (_req: Request, res: Response) => {
  const serviceResponse = await helloService.exempleService({ name: 'exemple' });
  sendSuccess(res, 200, 'Hello', serviceResponse);
});

export const HelloController = {
  helloWorld,
  errorRequest,
  serviceExemple,
};
