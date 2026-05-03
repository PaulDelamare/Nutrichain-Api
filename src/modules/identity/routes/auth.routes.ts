import { toNodeHandler } from "better-auth/node";
import { Router, Request, Response, NextFunction } from "express";
import { auth } from "../auth.config";
import { checkApiKey } from "../../../shared/utils/checkApiKey/checkApiKey";
import { requireInvitationOrFirstUser } from "../middlewares/guardSignUp.middleware";
import { validateSignInParams, validateSignUpParams } from "../middlewares/validateAuth.middleware";
import invitationRoutes from "./invitation.routes";

const router = Router();

/**
 * @swagger
 * /api/auth/sign-up/email:
 *   post:
 *     summary: Inscription d'un nouvel utilisateur (fermé par défaut)
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
 *               name:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Succès
 *       403:
 *         description: Pas d'invitation
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
 router.use("/auth/*", checkApiKey());

// ==========================================
// VALIDATION & GUARD SIGNUP / SIGNIN
// ==========================================
// Validation des champs & rÃ¨gles strictes de MDP pour Inscription
// + Seules les adresses e-mails invitees ou le 1er de l'usine peuvent s'inscrire !
router.post("/auth/sign-up/email", validateSignUpParams, requireInvitationOrFirstUser);

// Validation des champs basique pour la Connexion
router.post("/auth/sign-in/email", validateSignInParams);

// ==========================================
// FORMATTAGE DES ERREURS BETTER-AUTH
// ==========================================
router.all("/auth/*", async (req: Request, res: Response, next: NextFunction) => {
    try {
        await toNodeHandler(auth)(req, res);
    } catch (error: any) {
        
        // 1) Si l'erreur provient de `onAPIError: { throw: true }` dans BetterAuth
        if (error && error.status && error.body) {
            
            const errCode = error.body.code;

            // Traduction personnalisée pour les mots de passe incorrects
            if (errCode === "INVALID_EMAIL_OR_PASSWORD") {
                return next({
                    status: 401,
                    error: [{ field: "auth", message: "Impossible de se connecter : L'adresse e-mail ou le mot de passe est incorrect." }]
                });
            }

            // Traduction personnalisée pour les e-mails inconnus
            if (errCode === "USER_NOT_FOUND" || errCode === "email_not_found") {
                return next({
                    status: 404,
                    error: [{ field: "auth", message: "Aucun utilisateur trouvé avec cette adresse e-mail." }]
                });
            }

            // Formulaire global BetterAuth pour les autres erreurs (ex: invalid_code)
            return next({
                status: error.status,
                error: [{ field: "auth", message: error.body?.message || "Erreur d'authentification." }]
            });
        }

// Format error complet catch
        next(error);
    }
});

// Joindre les routes d'Identity Métier (Invitations)
router.use("/", invitationRoutes);

export default router;
