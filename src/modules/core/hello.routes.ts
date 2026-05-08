// ! IMPORTS
import { router } from '../../shared/configs/router.config';
import { HelloController } from './hello.controller';
import { checkApiKey } from '../../shared/utils/checkApiKey/checkApiKey';
import { requireAuth } from '../identity/middlewares/requireAuth.middleware';
import { Request, Response } from 'express';

// ! RequÃªtes
router.get('/hello', HelloController.helloWorld);

// Route de test protégée par Better-Auth !
router.get('/me', requireAuth, (req: Request, res: Response) => {
  res.json({
    message: 'Authentification réussie !',
    user: (req as unknown).user,
    session: (req as unknown).session,
  });
});

router.post('/error', HelloController.errorRequest);

router.post('/service', checkApiKey(), HelloController.serviceExemple);

// ! EXPORT
export default router;
