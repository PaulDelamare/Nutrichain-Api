import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const incoming = req.header('x-request-id');
  req.requestId = incoming ?? crypto.randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
};
