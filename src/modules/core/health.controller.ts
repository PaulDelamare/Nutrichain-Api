import { RequestHandler } from 'express';
import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import { sendSuccess } from '../../shared/utils/returnSuccess/returnSuccess';
import { bdd } from '../../shared/configs/prismaClient.config';
import { logger } from '../../shared/utils/logger/logger';

type HealthCheckResult = {
  name: string;
  ok: boolean;
  durationMs: number;
  optional?: boolean;
  /**
   * Ce que la sonde a appris — et qui ne SORT JAMAIS dans la réponse.
   *
   * Cette route est le seul chemin du serveur qui ne demande ni compte, ni clé, ni session. Un
   * message d'exception y publiait l'hôte et le port de la base, l'URI Mongo ou le chemin absolu du
   * répertoire de logs : donc la disposition du déploiement, et jusqu'au compte système (#258).
   * Un superviseur a besoin de savoir qu'une dépendance est tombée, pas de son adresse.
   */
  diagnostic?: string;
};

const toMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string) => {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const resolveLogDir = () => process.env.LOG_DIR || path.join(process.cwd(), 'logs');
const DB_TIMEOUT_MS = Number(process.env.DB_HEALTH_TIMEOUT_MS || 1500);
const LOG_TIMEOUT_MS = Number(process.env.LOG_HEALTH_TIMEOUT_MS || 1500);

const checkDatabase = async (): Promise<HealthCheckResult> => {
  const started = Date.now();

  try {
    await withTimeout(bdd.$queryRaw`SELECT 1`, DB_TIMEOUT_MS, 'DB connectivity');

    return {
      name: 'database',
      ok: true,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return {
      name: 'database',
      ok: false,
      durationMs: Date.now() - started,
      diagnostic: toMessage(err),
    };
  }
};

const checkMigrations = async (): Promise<HealthCheckResult> => {
  const started = Date.now();

  try {
    // `_prisma_migrations` a un schéma fixe géré par Prisma : on lit directement la dernière
    // migration via ses colonnes connues. Requête constante = aucune surface d'injection (plus
    // besoin de découverte de colonnes ni de garde d'identifiant). Si la table/colonne est
    // absente, le catch renvoie ok:false — la probe est optionnelle, la readiness reste verte.
    const rows = await withTimeout(
      bdd.$queryRawUnsafe<{ migration_name?: string; finished_at?: Date | string | null }[]>(
        `SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY finished_at DESC NULLS LAST LIMIT 1;`
      ),
      DB_TIMEOUT_MS,
      'Migrations latest row'
    );

    const latest = Array.isArray(rows) && rows[0] ? rows[0] : undefined;

    return {
      name: 'migrations',
      ok: Boolean(latest),
      optional: true,
      durationMs: Date.now() - started,
      diagnostic: latest
        ? `dernière migration : ${latest.migration_name}`
        : 'aucune ligne de migration',
    };
  } catch (err) {
    return {
      name: 'migrations',
      ok: false,
      optional: true,
      durationMs: Date.now() - started,
      diagnostic: toMessage(err).replace(/\n/g, ' '),
    };
  }
};

const checkMongo = async (): Promise<HealthCheckResult> => {
  const started = Date.now();

  try {
    // La télémétrie IoT (chaîne du froid) vit exclusivement dans Mongo : sans ce check, la
    // sonde répondait "prête" alors que POST /api/telemetry/ping échouerait — la vitrine IoT
    // pouvait tomber sans qu'aucun indicateur ne l'annonce (#158).
    if (!mongoose.connection.db) {
      throw new Error('MongoDB connection not established');
    }
    await withTimeout(mongoose.connection.db.admin().ping(), DB_TIMEOUT_MS, 'MongoDB connectivity');

    return {
      name: 'mongodb',
      ok: true,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return {
      name: 'mongodb',
      ok: false,
      durationMs: Date.now() - started,
      diagnostic: toMessage(err),
    };
  }
};

const checkLogs = async (): Promise<HealthCheckResult> => {
  const started = Date.now();
  const logsDir = resolveLogDir();

  try {
    await withTimeout(
      (async () => {
        await fs.mkdir(logsDir, { recursive: true });
        const testFile = path.join(logsDir, `.healthcheck_${Date.now()}.tmp`);
        await fs.writeFile(testFile, 'ok', 'utf-8');
        await fs.unlink(testFile);
      })(),
      LOG_TIMEOUT_MS,
      'Logs directory check'
    );

    return {
      name: 'logs',
      ok: true,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return {
      name: 'logs',
      ok: false,
      durationMs: Date.now() - started,
      diagnostic: `${toMessage(err)} (répertoire : ${logsDir})`,
    };
  }
};

/**
 * Basic liveness check with process metadata.
 */
const health: RequestHandler = async (_req, res) => {
  const mem = process.memoryUsage();
  const uptime = process.uptime();

  sendSuccess(res, 200, 'ok', {
    uptimeSeconds: uptime,
    timestamp: new Date().toISOString(),
    pid: process.pid,
    nodeVersion: process.version,
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
    },
  });
};

/**
 * Readiness check: concurrently probes DB, MongoDB, migrations metadata and log dir writability.
 */
const readiness: RequestHandler = async (_req, res) => {
  const started = Date.now();

  const checks = await Promise.all([checkDatabase(), checkMongo(), checkLogs(), checkMigrations()]);

  const hasBlockingFailure = checks.some((check) => !check.ok && !check.optional);

  // Le diagnostic part dans le JOURNAL, jamais dans la réponse. C'est là qu'un exploitant regarde,
  // et c'est le seul endroit qui exige déjà un accès à la machine (#258).
  for (const check of checks) {
    if (!check.ok && check.diagnostic) {
      logger.error(`[Health] sonde « ${check.name} » en échec : ${check.diagnostic}`);
    }
  }

  // Projection EXPLICITE : renvoyer `checks` tel quel republierait tout champ ajouté un jour à
  // `HealthCheckResult`, sur la seule route sans authentification. C'est ainsi que la fuite est née.
  const publicChecks = checks.map(({ name, ok, durationMs, optional }) => ({
    name,
    ok,
    durationMs,
    ...(optional ? { optional } : {}),
  }));

  sendSuccess(res, hasBlockingFailure ? 503 : 200, hasBlockingFailure ? 'not ready' : 'ready', {
    summary: {
      ready: !hasBlockingFailure,
      timestamp: new Date().toISOString(),
      uptimeSeconds: process.uptime(),
      totalDurationMs: Date.now() - started,
    },
    checks: publicChecks,
  });
};

export const HealthController = {
  health,
  readiness,
};
