import { Request, Response, NextFunction } from 'express';
import { APIError } from '../utils/errorHandler/APIError';
import { resolveGatewayOrg } from '../utils/iotGateway/iotGateway';
import { AuthenticatedRequest } from '../../modules/identity/types/auth.types';

const cleRefusee = () =>
  new APIError(401, {
    error: [{ field: 'api_key', message: 'Passerelle IoT inconnue ou révoquée.' }],
  });

/**
 * Authentifie une **passerelle capteur** — une machine, qui ne peut pas ouvrir de session humaine.
 *
 * La clé présentée est résolue en base (`IotGateway`), et c'est là tout le point : elle porte SON
 * organisation. Avant, elle retombait sur `API_KEY_ORG_ID`, une variable d'environnement unique —
 * toute trame était donc estampillée de l'organisation du `.env`. Conséquences (issue #93) : une
 * organisation créée après coup n'avait aucune chaîne du froid (ingest 202, jamais d'alerte), et un
 * `sensor_id` homonyme déclenché depuis une autre organisation mettait en quarantaine des lots qui
 * ne lui appartenaient pas.
 *
 * Une trame de télémétrie ne fait pas qu'écrire une mesure : elle déclenche `checkAndAlert`, qui met
 * en quarantaine TOUS les lots du matériel visé, lève une alerte PANIC et scelle un maillon d'audit
 * WORM. D'où la clé dédiée, distincte de l'`API_KEY` compilée dans le bundle mobile.
 *
 * ⚠️ Ce qui reste ouvert : une passerelle couvre tous les capteurs de son organisation, et le
 * `sensor_id` est déclaré dans le corps de la requête. Une passerelle compromise peut donc encore
 * agir au nom de n'importe quel capteur **de son organisation** — plus d'aucune autre. Le fermer
 * demande un secret par appareil ou une signature des trames : hors périmètre, documenté comme
 * limitation.
 */
export const machineAuth = () => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const presentedKey = req.header('x-api-key');

    if (!presentedKey) {
      return next(cleRefusee());
    }

    try {
      const organizationId = await resolveGatewayOrg(presentedKey);

      if (!organizationId) {
        return next(cleRefusee());
      }

      // Seul `activeOrgId` est posé : une machine n'a ni utilisateur ni session. Fabriquer un
      // `req.auth` partiel ferait mentir `AuthContext` (dont `user` et `session` sont obligatoires)
      // et n'importe quel code partagé lisant `req.auth.user.id` casserait à l'exécution.
      (req as AuthenticatedRequest).activeOrgId = organizationId;

      next();
    } catch (erreur) {
      next(erreur);
    }
  };
};
