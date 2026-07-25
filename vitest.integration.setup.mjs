// `vitest` ne charge pas `.env` (contrairement aux scripts e2e, lancés via `tsx --env-file=.env`) :
// sans ça, DATABASE_URL/MONGO_URI restent vides et Prisma échoue au premier appel.
import 'dotenv/config'
