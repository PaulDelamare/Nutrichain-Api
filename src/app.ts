// ! IMPORTS
import express from 'express';

// ! Routes Imports
import helloRoutes from './modules/core/hello.routes';
import healthRoutes from './modules/core/health/health.routes';
import telemetryRoutes from './modules/iot/routes/telemetry.routes';
import authRoutes from './modules/identity/routes/auth.routes';
import configureMiddleware from './shared/configs/apiConfigMiddleware.config';  


// ! Imports Swagger
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './shared/configs/swagger.config';

// ! Middleware
const app = express();

configureMiddleware(app);

// ! Swagger Route (Accessible par les front-ends, exp: http://localhost:3000/api-docs)
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));


// ! Routes
app.use('/api', authRoutes);
app.use('/api', helloRoutes);
app.use('/api', healthRoutes);
app.use('/api', telemetryRoutes);
export { app };