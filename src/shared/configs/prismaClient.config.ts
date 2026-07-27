// ! IMPORTS
import { PrismaClient } from '@prisma/client';

// ! EXPORT
// Export du client Prisma
// `errorFormat` explicite, sinon Prisma le déduit de NODE_ENV : hors production il joint au message
// d'erreur les arguments de la requête et des extraits du fichier appelant. Or une erreur Prisma non
// mappée ressort en 500 avec `error.message` tel quel (errorHandler.ts), donc ces valeurs — métier ou
// personnelles — partiraient au client dès qu'une pile ne tourne pas en production.
export const bdd = new PrismaClient({ errorFormat: 'minimal' });
// Compatibilité : certains modules importent `prisma`.
export const prisma = bdd;
