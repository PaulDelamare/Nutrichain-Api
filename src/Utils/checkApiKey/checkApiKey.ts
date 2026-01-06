// ! IMPORTS
import { NextFunction, Request, Response } from "express";
import { handleError } from "../errorHandler/errorHandler";

/**
 * Générateur de middleware pour vérifier une clé API spécifique
 *
 * @param expectedApiKey - La clé API attendue (par exemple, provenant de process.env)
 * @return - Un middleware Express qui valide la clé API
 */
export const checkApiKey = (expectedApiKey: string = process.env.API_KEY!) => {
    return async (req: Request, res: Response, next: NextFunction) => {

        const api_key_header = req.header("x-api-key");

        if (api_key_header === expectedApiKey) {

            next();
        } else {

            console.error("Non authentifié. Vous devez utiliser votre clef API.");
            handleError({ status: 401, error: "Non authentifié. Vous devez utiliser votre clef API." }, req, res);
        }
    };
};
