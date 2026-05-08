import { logger } from '../logger/logger';
import fs from 'fs/promises';
import path from 'path';
import { createFileIfDoesNotExist } from '../createFile/createFile';
import { Request, Response } from 'express';

const getLogDir = () => process.env.LOG_DIR || 'logs';
const MAX_LOG_SIZE = 5 * 1024 * 1024;

/**
 * Writes a log message to a file.
 * @param file - The log file.
 * @param message - The message to write.
 */
export const writeLog = async (file: string, message: string): Promise<void> => {
  try {
    await createFileIfDoesNotExist(file);
    const logMessage = `${new Date().toISOString()} - ${message}\n`;
    await fs.appendFile(file, logMessage, 'utf-8');
  } catch (err) {
    console.error(`Error writing to ${file}:`, err);
  }
};

/**
 * Logs request information (method and path).
 * @param req - The Express request object.
 * @param res - The Express response object.
 * @param next - The Express next function.
 */
export const requestLog = async (req: Request, res: Response, next: () => void): Promise<void> => {
  const method = req.method;
  const url = req.originalUrl;
  const requestFile = path.join(getLogDir(), 'request.log');
  await writeLog(requestFile, `Method: ${method}, Path: ${url}`);
  next();
};

/**
 * Rotate the request log if it exceeds the maximum size.
 * If the log exceeds the maximum size, it is renamed with a unique name and a new file is created.
 * @returns - A promise that resolves when the log rotation is complete.
 */
export const rotateLog = async (): Promise<void> => {
  try {
    const requestFile = path.join(getLogDir(), 'request.log');
    await createFileIfDoesNotExist(requestFile);
    const stats = await fs.stat(requestFile);

    if (stats.size > MAX_LOG_SIZE) {
      const uniqueFileName = `request_${Date.now()}.log`;
      const rotatedFilePath = path.join(getLogDir(), uniqueFileName);

      await fs.rename(requestFile, rotatedFilePath);
      await fs.writeFile(requestFile, '', 'utf-8');
      logger.info(`Log rotated: ${rotatedFilePath}`);
    }
  } catch (err) {
    console.error('Error rotating log file:', err);
  }
};

/**
 * Initializes the log directory by creating it if it does not exist.
 * @returns - A promise that resolves when the log directory is initialized.
 */
export const initLogDir = async (): Promise<void> => {
  try {
    await fs.mkdir(getLogDir(), { recursive: true });
  } catch (err) {
    console.error('Error creating log directory:', err);
  }
};
