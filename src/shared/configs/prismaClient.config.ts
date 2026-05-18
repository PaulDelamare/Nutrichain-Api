// ! IMPORTS
import { PrismaClient } from '@prisma/client';

// ! EXPORT
// Export du client Prisma
export const bdd = new PrismaClient();
// Compatibilité : certains modules importent `prisma`.
export const prisma = bdd;
