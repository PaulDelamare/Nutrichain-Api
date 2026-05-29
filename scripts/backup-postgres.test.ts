import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPgDumpArgs, runBackupPostgres } from './backup-postgres';

describe('backup-postgres', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('1. buildPgDumpArgs : path horodaté + format custom + -d url', () => {
    const fakeNow = new Date('2026-05-29T10:30:45.000Z');
    const { outFile, args } = buildPgDumpArgs(
      'postgresql://u:p@localhost:5432/nutrichain',
      './backups',
      fakeNow
    );
    expect(outFile).toMatch(/postgres-20260529103045\.dump$/);
    expect(args).toEqual(['-Fc', '-f', outFile, '-d', 'postgresql://u:p@localhost:5432/nutrichain']);
  });

  it("2. runBackupPostgres : exec pg_dump avec les bons args + crée le dir", () => {
    const exec = vi.fn();
    const mkdir = vi.fn();
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/nutrichain';
    process.env.BACKUP_DIR = './backups-test';
    const out = runBackupPostgres({
      exec: exec as never,
      mkdir: mkdir as never,
      log: () => {},
      now: () => new Date('2026-05-29T10:30:45.000Z'),
    });
    expect(mkdir).toHaveBeenCalledWith('./backups-test', { recursive: true });
    expect(exec).toHaveBeenCalledWith(
      'pg_dump',
      ['-Fc', '-f', expect.stringContaining('postgres-20260529103045.dump'), '-d', 'postgresql://u:p@localhost:5432/nutrichain'],
      { stdio: 'inherit' }
    );
    expect(out).toMatch(/postgres-20260529103045\.dump$/);
  });

  it("3. runBackupPostgres : throw si DATABASE_URL manquant", () => {
    delete process.env.DATABASE_URL;
    expect(() =>
      runBackupPostgres({
        exec: vi.fn() as never,
        mkdir: vi.fn() as never,
        log: () => {},
      })
    ).toThrow(/DATABASE_URL/);
  });
});
