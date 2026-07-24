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

/**
 * Les journaux sont la seule source exploitable par une détection : s'ils disparaissent ou ne se
 * lisent pas dans l'ordre, aucune règle ne peut être écrite au-dessus.
 */
describe('Rétention et collecte des journaux', () => {
  const fileTransportOptions = (): Record<string, unknown>[] =>
    logger.transports
      .filter((transport) => (transport as unknown as { filename?: string }).filename)
      .map((transport) => (transport as unknown as { options: Record<string, unknown> }).options);

  it('borne la rétention de chaque fichier de journal', () => {
    // Sans `maxFiles`, la rotation empile indéfiniment. Le disque finit plein, et l'API cesse
    // d'écrire — la source de détection meurt sans que rien ne le signale.
    const options = fileTransportOptions();
    expect(options.length).toBeGreaterThan(0);

    for (const option of options) {
      expect(option.maxFiles).toBeDefined();
    }
  });

  it('date les fichiers dans un format triable', () => {
    // `MM-DD-YYYY` ne se trie pas chronologiquement : un collecteur qui parcourt le répertoire
    // dans l'ordre lexicographique reconstitue une chronologie fausse. Les deux transports
    // divergeaient, ce qui rendait le répertoire illisible d'un seul balayage.
    for (const option of fileTransportOptions()) {
      expect(option.datePattern).toBe('YYYY-MM-DD');
    }
  });
});
