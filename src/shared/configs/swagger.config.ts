import path from 'path';
import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'NutriChain API',
      version: '1.0.0',
      description: 'API Documentation for NutriChain (B2B & IoT)',
    },
    servers: [
      {
        url: process.env.API_URL || 'http://localhost:3000',
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          // Jeton de session OPAQUE (plugin `bearer` de Better-Auth), pas un JWT : inutile d'essayer
      // d'en décoder le contenu.
      bearerFormat: 'opaque',
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
        },
      },
    },
    // Défaut : une SESSION. La clé API n'autorise rien par elle-même — les rares routes qui
    // l'acceptent (l'ingestion des capteurs, l'authentification) la déclarent explicitement.
    // La déclarer globalement publiait un contrat faux : « toutes nos routes acceptent une clé ».
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  /**
   * Les annotations sont lues dans les FICHIERS, pas dans le code chargé.
   *
   * Le glob est ancré sur `__dirname`, donc sur l'arbre RÉELLEMENT exécuté : `src/` sous `tsx`,
   * `dist/` en conteneur. Deux défauts sont évités d'un coup.
   *
   * Il était auparavant relatif au répertoire courant (`./src/modules/**`) : l'image de production
   * ne contenant que `dist/`, `/api-docs` y servait un contrat VIDE — mesuré à zéro chemin — sans
   * que rien ne le signale.
   *
   * Et désigner les DEUX arbres ne serait pas une solution : en développement les deux existent, le
   * dernier lu l'emporte, et un `dist/` périmé (jamais nettoyé, hors Git) servirait silencieusement
   * une doc ancienne — voire une route supprimée depuis. Le même défaut, déplacé.
   */
  apis: [
    path.join(__dirname, '../../modules/**/*.routes.{ts,js}'),
    path.join(__dirname, '../../app.{ts,js}'),
  ],
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
