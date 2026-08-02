// ! IMPORTS
import express from 'express';

// ! Routes Imports
import helloRoutes from './modules/core/hello.routes';
import healthRoutes from './modules/core/health/health.routes';
import telemetryRoutes from './modules/iot/routes/telemetry.routes';
import authRoutes from './modules/identity/routes/auth.routes';
import catalogRoutes from './modules/traceability/catalog/routes/catalog.routes';
import transformationRoutes from './modules/traceability/transformations/routes/transformation.routes';
import eventRoutes from './modules/traceability/events/routes/event.routes';
import receiptRoutes from './modules/logistics/receipts/routes/receipt.routes';
import shipmentRoutes from './modules/logistics/shipments/routes/shipment.routes';
import logisticUnitRoutes from './modules/logistics/logisticUnits/routes/logisticUnit.routes';
import withdrawalRoutes from './modules/logistics/withdrawals/routes/withdrawal.routes';
import syncRoutes from './modules/sync/routes/sync.routes';
import alertRoutes from './modules/alerts/routes/alert.routes';
import auditRoutes from './modules/auditIntegrity/routes/audit.routes';
import connectorRoutes from './modules/connectors/routes/connector.routes';
import organizationRoutes from './modules/organization/routes/organization.routes';
import platformRoutes from './modules/platform/routes/platform.routes';
import observabilityRoutes from './modules/observability/routes/observability.routes';
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
app.use('/api', transformationRoutes);
app.use('/api', eventRoutes);
app.use('/api', receiptRoutes);
app.use('/api', shipmentRoutes);
app.use('/api', logisticUnitRoutes);
app.use('/api', withdrawalRoutes);
app.use('/api', syncRoutes);
app.use('/api', helloRoutes);
app.use('/api', healthRoutes);
app.use('/api', telemetryRoutes);
app.use('/api', alertRoutes);
app.use('/api', auditRoutes);
app.use('/api', connectorRoutes);
app.use('/api', organizationRoutes);
app.use('/api', platformRoutes);
app.use('/api', observabilityRoutes);

// ! Global Error Handler (Doit être le dernier middleware)
app.use(globalErrorHandler);

export { app };
