import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import fs from 'fs/promises';
import { writeLog, requestLog, rotateLog, initLogDir } from './logFunction';
import path from 'path';
import os from 'os';

describe('Logger', () => {
  const TEST_LOG_DIR = path.join(os.tmpdir(), `nutrichain-logs-${Date.now()}`);

  beforeEach(async () => {
    process.env.LOG_DIR = TEST_LOG_DIR;
    await fs.rm(TEST_LOG_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_LOG_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_LOG_DIR, { recursive: true, force: true });
  });

  const getLogDir = () => process.env.LOG_DIR || 'logs';
  const getRequestFile = () => path.join(getLogDir(), 'request.log');

  describe('writeLog', () => {
    it('should create a log file and write a message to it', async () => {
      const testMessage = 'Test log message';
      await writeLog(getRequestFile(), testMessage);

      const fileExists = await fs
        .access(getRequestFile())
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

      const content = await fs.readFile(getRequestFile(), 'utf-8');
      expect(content).toContain(testMessage);
    });

    it('should append messages to the log file', async () => {
      const message1 = 'First log message';
      const message2 = 'Second log message';

      await writeLog(getRequestFile(), message1);
      await writeLog(getRequestFile(), message2);

      const content = await fs.readFile(getRequestFile(), 'utf-8');
      expect(content).toContain(message1);
      expect(content).toContain(message2);
    });
  });

  describe('requestLog', () => {
    it('should log request method and path', async () => {
      const mockReq = {
        method: 'GET',
        originalUrl: '/test',
      };
      const mockRes = {};
      const mockNext = vi.fn();

      await requestLog(mockReq as unknown, mockRes as unknown, mockNext);

      const content = await fs.readFile(getRequestFile(), 'utf-8');
      expect(content).toContain('Method: GET, Path: /test');
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('rotateLog', () => {
    it('should rotate log file if it exceeds max size', async () => {
      const largeContent = 'a'.repeat(6 * 1024 * 1024);
      await fs.writeFile(getRequestFile(), largeContent, 'utf-8');

      await rotateLog();

      const stats = await fs.stat(getRequestFile());
      expect(stats.size).toBe(0);

      const files = await fs.readdir(getLogDir());
      const archivedFile = files.find(
        (file) => file.startsWith('request_') && file.endsWith('.log')
      );
      expect(archivedFile).toBeDefined();
    });
  });

  describe('initLogDir', () => {
    it('should create log directory if it does not exist', async () => {
      await initLogDir();

      const dirStats = await fs.stat(getLogDir());
      expect(dirStats.isDirectory()).toBe(true);
    });

    it('should not throw an error if log directory already exists', async () => {
      await fs.mkdir(getLogDir(), { recursive: true });

      await initLogDir();

      const dirStats = await fs.stat(getLogDir());
      expect(dirStats.isDirectory()).toBe(true);
    });
  });
});
