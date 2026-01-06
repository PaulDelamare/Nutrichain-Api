// ! IMPORTS
import express from 'express';

// ! Routes Imports
import helloRoutes from './Routes/hello.routes';
import configureMiddleware from './Configs/apiConfigMiddleware.config';


// ! Middleware
const app = express();

configureMiddleware(app);


// ! Routes
app.use('/api', helloRoutes);


// ! EXPORT
export { app };