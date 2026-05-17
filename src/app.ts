// ! IMPORTS
import express from 'express';

// ! Routes Imports
import helloRoutes from './modules/core/hello.routes';
import healthRoutes from './modules/core/health/health.routes';
import telemetryRoutes from './modules/iot/routes/telemetry.routes';
import authRoutes from './modules/identity/routes/auth.routes';
import catalogRoutes from './modules/traceability/catalog/routes/catalog.routes';
import configureMiddleware from './shared/configs/apiConfigMiddleware.config';
import { globalErrorHandler } from './shared/utils/errorHandler/errorHandler';

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
app.use('/api', catalogRoutes);
app.use('/api', helloRoutes);
app.use('/api', healthRoutes);
app.use('/api', telemetryRoutes);

// ! Global Error Handler (Doit être le dernier middleware)
app.use(globalErrorHandler);

export { app };
