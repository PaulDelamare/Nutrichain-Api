import vine, { errors } from "@vinejs/vine";
import { Infer, SchemaTypes } from "@vinejs/vine/build/src/types";
import { frenchErrorMessages } from "./frenchError";
import { ValidationMessage } from "./validateData.model";

/**
 * Convertit les erreurs de validation de `vine` en utilisant les messages personnalisés.
 * @param error - L'erreur générée par `vine`.
 * @returns L'erreur avec les messages traduits.
 */
const localizeErrorMessages = (error: unknown): { status: number, error: { field: string, message: string, rule: string }[] } => {
    if (error instanceof errors.E_VALIDATION_ERROR) {
        const translatedMessages = error.messages.map((msg: ValidationMessage) => {
            const { field, rule, meta, message } = msg;

            const customMessage = frenchErrorMessages[rule as keyof typeof frenchErrorMessages];

            let translatedMessage: string;

            if (typeof customMessage === 'function') {

                const metaValue = meta ? Object.values(meta)[0] as never : undefined;

                translatedMessage = metaValue !== undefined
                    ? customMessage({ data: metaValue })
                    : message;

            } else {
                translatedMessage = customMessage || message;
            }

            return { field, message: translatedMessage, rule };
        });

        throw { status: 400, error: translatedMessages };
    }

    throw error;
};



/**
 * Valide les données en fonction d'un schéma et retourne les données validées.
 * @param schema - Le schéma Vine à utiliser pour la validation.
 * @param data - Les données à valider, typées automatiquement selon le schéma.
 * @returns Les données validées du type inféré.
 */
export const validateData = async <T extends SchemaTypes>(schema: T, data: Infer<T>): Promise<Infer<T>> => {
    try {
        return await vine.validate({
            schema,
            data,
        });
    } catch (error) {
        localizeErrorMessages(error);
    }
};
