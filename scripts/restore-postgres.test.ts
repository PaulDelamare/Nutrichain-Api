import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseDatabaseUrl,
  assertRestoreSafety,
  runRestorePostgres,
  RestoreSafetyError,
} from './restore-postgres';

describe('restore-postgres', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('1. parseDatabaseUrl : extrait host + dbname proprement', () => {
    const p = parseDatabaseUrl('postgresql://u:p@localhost:5432/nutrichain?sslmode=disable');
    expect(p.host).toBe('localhost');
    expect(p.dbname).toBe('nutrichain');
  });

  it("2. assertRestoreSafety : refuse si NODE_ENV=production sans RESTORE_ALLOW_PROD", () => {
    expect(() =>
      assertRestoreSafety(
        { NODE_ENV: 'production', RESTORE_CONFIRM_DB: 'nutrichain' },
        { host: 'prod-db', dbname: 'nutrichain' }
      )
    ).toThrow(RestoreSafetyError);
  });

  it("3. assertRestoreSafety : accepte si NODE_ENV=production + RESTORE_ALLOW_PROD=YES + DB match", () => {
    expect(() =>
      assertRestoreSafety(
        {
          NODE_ENV: 'production',
          RESTORE_ALLOW_PROD: 'YES',
          RESTORE_CONFIRM_DB: 'nutrichain',
        },
        { host: 'prod-db', dbname: 'nutrichain' }
      )
    ).not.toThrow();
  });

  it("4. assertRestoreSafety : refuse si RESTORE_CONFIRM_DB ne matche pas le dbname parsé", () => {
    expect(() =>
      assertRestoreSafety(
        { RESTORE_CONFIRM_DB: 'wrong-dbname' },
        { host: 'localhost', dbname: 'nutrichain' }
      )
    ).toThrow(/ne matche pas/);
  });

  it("5. assertRestoreSafety : refuse si RESTORE_CONFIRM_DB absent", () => {
    expect(() =>
      assertRestoreSafety(
        { /* no RESTORE_CONFIRM_DB */ },
        { host: 'localhost', dbname: 'nutrichain' }
      )
    ).toThrow(/RESTORE_CONFIRM_DB requis/);
  });

  it("6. runRestorePostgres : refuse + n'exécute PAS pg_restore si NODE_ENV=production sans flag", () => {
    const exec = vi.fn();
    expect(() =>
      runRestorePostgres('./dump.bin', {
        exec: exec as never,
        log: () => {},
        env: {
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://u:p@prod:5432/nutrichain',
          RESTORE_CONFIRM_DB: 'nutrichain',
        },
      })
    ).toThrow(RestoreSafetyError);
    expect(exec).not.toHaveBeenCalled();
  });

  it("7. runRestorePostgres : accepte si match + non-prod, appelle pg_restore avec les bons args", () => {
    const exec = vi.fn();
    runRestorePostgres('./dump.bin', {
      exec: exec as never,
      log: () => {},
      env: {
        DATABASE_URL: 'postgresql://u:p@localhost:5432/nutrichain',
        RESTORE_CONFIRM_DB: 'nutrichain',
      },
    });
    expect(exec).toHaveBeenCalledWith(
      'pg_restore',
      ['--clean', '--if-exists', '-d', 'postgresql://u:p@localhost:5432/nutrichain', './dump.bin'],
      { stdio: 'inherit' }
    );
  });
});
