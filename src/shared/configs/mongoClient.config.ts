import { logger } from '../utils/logger/logger';
import mongoose from 'mongoose';

// Ensure MONGO_URI is set, e.g. "mongodb://localhost:27017/nutrichain-iot"
const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/nutrichain-iot';

export const connectMongoDB = async () => {
  try {
    await mongoose.connect(mongoUri);
    logger.info(`Connected to MongoDB Time-Series Lake: ${mongoUri}`);
  } catch (error) {
    console.error('Failed to connect to MongoDB', error);
    process.exit(1);
  }
};

export const disconnectMongoDB = async () => {
  await mongoose.disconnect();
  logger.info('MongoDB disconnected.');
};
