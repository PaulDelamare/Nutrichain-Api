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
          bearerFormat: 'JWT',
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
  apis: [
    './src/modules/**/*.routes.ts', // Va lire les annotations Swagger dans ces fichiers
    './src/app.ts',
  ],
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
