import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger';

// Chemins des fichiers de logs
const LOGS_DIR = path.join(process.cwd(), 'logs');

describe('Logger', () => {
  it('should log error messages to the error log file', async () => {
    logger.error('Test error message');

    const files = (await fs.readdir(LOGS_DIR)).filter(
      (file) => file.startsWith('error-') && file.endsWith('.log')
    );
    expect(files.length).toBeGreaterThan(0);

    const filesWithStats = await Promise.all(
      files.map(async (f) => {
        const s = await fs.stat(path.join(LOGS_DIR, f));
        return { file: f, mtime: s.mtimeMs, size: s.size };
      })
    );
    const sorted = filesWithStats.sort((a, b) => b.mtime - a.mtime);
    const errorLogFile = sorted[0].file;

    const logPath = path.join(LOGS_DIR, errorLogFile!);

    const waitForLog = async (file: string, timeout = 1000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const content = await fs.readFile(file, 'utf-8').catch(() => '');
        if (content.includes('Test error message')) return content;
        await new Promise((res) => setTimeout(res, 20));
      }
      return await fs.readFile(file, 'utf-8').catch(() => '');
    };

    const logContent = await waitForLog(logPath);
    expect(logContent).toContain('Test error message');
  });
});
