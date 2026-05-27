import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const MAX_REQUEST_ID_LENGTH = 128;

const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

const isAcceptable = (value: string): boolean =>
  value.length > 0 && value.length <= MAX_REQUEST_ID_LENGTH && !CONTROL_CHARS.test(value);

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && isAcceptable(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
};
