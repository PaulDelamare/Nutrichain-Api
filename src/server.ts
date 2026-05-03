// ! IMPORTS
import { app } from './app';
import { bdd } from './shared/configs/prismaClient.config';
import { connectMongoDB, disconnectMongoDB } from './shared/configs/mongoClient.config';

// ! CONFIG
const PORT = process.env.PORT || 3000;
const API_URL = process.env.API_URL;

// ! INITIALISATION
connectMongoDB()
    .then(() => {
        const server = app.listen(PORT, () => {
            console.log(`Server running on ${API_URL}`);
        });

        // ! FERMETURE
        process.on('SIGINT', async () => {
            console.log("Server shutdown...");
            await bdd.$disconnect();
            await disconnectMongoDB();
            server.close(() => {
                console.log("Server stopped successfully.");
                process.exit(0);
            });
        });
    })
    .catch(console.error);
