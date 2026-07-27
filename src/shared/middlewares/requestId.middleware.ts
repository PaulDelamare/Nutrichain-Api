import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Jeu de caracteres volontairement etroit : cette valeur vient de l'appelant et repart desormais
 * dans le CORPS d'une reponse d'erreur (« Référence : … », cf. #252), plus seulement dans un
 * en-tete ou l'absence de CR/LF suffisait. Refuser tout ce qui n'est pas un identifiant de
 * correlation evite d'avoir a faire confiance a l'echappement de chaque consommateur.
 */
const ACCEPTABLE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

const isAcceptable = (value: string): boolean => ACCEPTABLE_REQUEST_ID.test(value);

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && isAcceptable(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
};
