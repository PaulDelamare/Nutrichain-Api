import vine from "@vinejs/vine";
import { Request, Response, NextFunction } from "express";
import { formatVineErrors } from "../../../shared/utils/validateData/validateData";
import { USER_ROLES } from "../constants/roles.constants";

/**
 * Schéma de validation pour la création d'une invitation.
 */
const invitationSchema = vine.object({
    email: vine.string().email(),
    role: vine.enum(USER_ROLES),
    organizationId: vine.string().uuid()
});

/**
 * Middleware Express pour valider les paramètres d'invitation avec VineJS
 */
export const validateInvitationParams = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const data = await vine.validate({ schema: invitationSchema, data: req.body });
        req.body = data; // Remplace avec les données assainies par Vine
        next();
    } catch (error: any) {
        if (error.messages) {
            res.status(400).json({
                status: 400,
                error: formatVineErrors(error.messages)
            });
            return;
        }
        next(error);
    }
};
