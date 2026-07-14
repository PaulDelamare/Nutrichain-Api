import { toNodeHandler } from 'better-auth/node';
import { Router, Request, Response, NextFunction } from 'express';
import { auth } from '../auth.config';
import { checkApiKey } from '../../../shared/utils/checkApiKey/checkApiKey';
import { requireInvitationOrFirstUser } from '../middlewares/guardSignUp.middleware';
import { validateSignInParams, validateSignUpParams } from '../middlewares/validateAuth.middleware';
import { blockOrgPassthrough } from '../middlewares/blockOrgPassthrough.middleware';
import invitationRoutes from './invitation.routes';

const router = Router();

/**
 * @swagger
 * /api/auth/sign-up/email:
 *   post:
 *     summary: Inscription d'un nouvel utilisateur (fermé par défaut)
 *     description: |
 *       Inscription gérée par Better-Auth. Le middleware `requireInvitationOrFirstUser`
 *       valide en amont qu'une `Invitation` pending non-expirée existe pour `(email, token)`.
 *       Le tout premier utilisateur du système bypasse cette guard (création du First Admin).
 *
 *       Après création du `User`, le hook `databaseHooks.user.create.after` :
 *       - marque l'`Invitation` comme `accepted` (consommation atomique)
 *       - crée un `Member` dans l'org de l'invitation avec le rôle correspondant
 *       - (si first user) crée une org "Siège Central" + role 'owner'
 *
 *       Voir `docs/16_invitation_register_flow.md` pour l'intégration frontend.
 *     tags: [Identité]
 *     security:
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, name]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               name:
 *                 type: string
 *                 minLength: 2
 *               password:
 *                 type: string
 *                 description: Doit respecter passwordRule (longueur, complexité)
 *               token:
 *                 type: string
 *                 format: uuid
 *                 description: |
 *                   UUID de l'`Invitation` reçue par email. Optionnel pour le premier
 *                   utilisateur du système, OBLIGATOIRE pour tous les autres sign-ups.
 *     responses:
 *       200:
 *         description: Compte créé, session active (cookie pour web + header `set-auth-token` pour mobile/Bearer)
 *       400:
 *         description: Payload invalide (email, password trop faible, name trop court, token mal formé)
 *       403:
 *         description: Pas d'invitation valide ou token incorrect (message générique, anti-enumeration)
 *
 * /api/auth/sign-in/email:
 *   post:
 *     summary: Connexion d'un utilisateur existant
 *     tags: [Identité]
 *     security:
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Succès, retourne la session
 *       401:
 *         description: Identifiants incorrects
 *
 * /api/auth/sign-out:
 *   post:
 *     summary: Déconnexion de l'utilisateur actif
 *     tags: [Identité]
 *     security:
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Déconnexion réussie
 */

// ==========================================
// SÉCURITÉ MAXIMALE : EXIGENCE CLÉ API (B2B)
// ==========================================
// On applique "checkApiKey()" à toute méthode passant par /api/auth/*.
// Le front-end ou le robot industriel DEVRA fournir en Header : x-api-key : MON_SUPER_SECRET
router.use('/auth/*', checkApiKey());

// ==========================================
// VALIDATION & GUARD SIGNUP / SIGNIN
// ==========================================
// Validation des champs & règles strictes de MDP pour Inscription
// + Seules les adresses e-mails invitees ou le 1er de l'usine peuvent s'inscrire !
router.post('/auth/sign-up/email', validateSignUpParams, requireInvitationOrFirstUser);

// Validation des champs basique pour la Connexion
router.post('/auth/sign-in/email', validateSignInParams);

// ==========================================
// FERMETURE DU PASSTHROUGH SUR LES ORGANISATIONS
// ==========================================
// Doit rester AVANT le passthrough ci-dessous : sinon Better-Auth répond avant nous.
router.all('/auth/organization/*', blockOrgPassthrough);

// ==========================================
// FORMATTAGE DES ERREURS NATIVES BETTER-AUTH
// ==========================================
// NOTE CRITIQUE : Cette route intercepte toNodeHandler(auth) pour mapper
// les codes d'erreur bruts de Better-Auth vers notre format standard API.
// Indispensable car Better-Auth gère le stream de réponse de manière autonome.
router.all('/auth/*', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await toNodeHandler(auth)(req, res);
  } catch (error: unknown) {
    const err = error as { status?: number; body?: { code?: string; message?: string } };

    // Si l'erreur provient nativement de BetterAuth, on la formate pour le globalErrorHandler
    if (err && err.status && err.body) {
      const errCode = err.body.code;

      if (errCode === 'INVALID_EMAIL_OR_PASSWORD') {
        return next({
          status: 401,
          error: [
            {
              field: 'auth',
              message:
                "Impossible de se connecter : L'adresse e-mail ou le mot de passe est incorrect.",
            },
          ],
        });
      }

      if (errCode === 'USER_NOT_FOUND' || errCode === 'email_not_found') {
        return next({
          status: 404,
          error: [
            { field: 'auth', message: 'Aucun utilisateur trouvé avec cette adresse e-mail.' },
          ],
        });
      }

      return next({
        status: err.status,
        error: [{ field: 'auth', message: err.body?.message || "Erreur d'authentification." }],
      });
    }

    next(error);
  }
});

// Joindre les routes d'Identity Métier (Invitations)
router.use('/', invitationRoutes);

export default router;
