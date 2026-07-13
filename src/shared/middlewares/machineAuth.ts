import { Request, Response, NextFunction } from 'express';
import { checkApiKey } from '../utils/checkApiKey/checkApiKey';
import { ensureActiveOrg } from './authGuards';

/**
 * Authentifie un **capteur** — une machine, qui ne peut pas ouvrir de session humaine.
 *
 * Elle utilise `IOT_API_KEY`, **distincte de `API_KEY`**, et c'est le point essentiel : `API_KEY`
 * est compilée dans le bundle de l'application mobile (`EXPO_PUBLIC_API_KEY`), donc extractible par
 * quiconque l'installe. `IOT_API_KEY`, elle, ne quitte jamais le serveur et la passerelle IoT.
 *
 * Pourquoi cette séparation n'est pas de la cérémonie : une trame de télémétrie ne fait PAS
 * qu'écrire une mesure. Elle déclenche `checkAndAlert`, qui met en quarantaine TOUS les lots du
 * matériel visé, lève une alerte PANIC et scelle un maillon d'audit WORM. Avec une clé publique,
 * un inconnu pouvait donc **arrêter la production** en postant une fausse température — un déni de
 * service sanitaire, irréversible depuis l'extérieur.
 *
 * ⚠️ Ce qui reste ouvert, et qu'il faut savoir : la clé IoT est partagée par TOUS les capteurs, et
 * le `sensor_id` est déclaré dans le corps de la requête sans être rattaché à un appareil
 * authentifié. Qui la détient (une passerelle compromise) peut donc encore agir au nom de
 * n'importe quel capteur de l'organisation. Le fermer demande un secret par appareil, ou une
 * signature des trames — hors périmètre ici, et documenté comme limitation.
 */
export const machineAuth = () => {
  return (req: Request, res: Response, next: NextFunction) => {
    return checkApiKey(process.env.IOT_API_KEY)(req, res, ensureActiveOrg(req, next));
  };
};
