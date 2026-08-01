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
   * Cette route ne demande ni compte, ni clé, ni session. Un message d'exception y publiait l'hôte
   * et le port de la base, l'URI Mongo ou le chemin absolu du répertoire de logs : donc la
   * disposition du déploiement, et jusqu'au compte système (#258). Un superviseur a besoin de
   * savoir qu'une dépendance est tombée, pas de son adresse.
   *
   * Elle n'est pas la seule route publique — `/api/hello`, le scan public GS1 et `/api-docs` le
   * sont aussi. Elle est en revanche la seule à interroger les dépendances, donc la seule à avoir
   * des messages d'infrastructure à laisser fuir.
   */
  diagnostic?: string;
};

/**
 * Aplati sur une seule ligne : le journal est déclaré « texte ligne à ligne » par
 * `docs/22_JOURNALISATION_SIEM.md`, et une `PrismaClientInitializationError` est multi-ligne. Sans
 * ça, un collecteur découpe un échec de base en trois pseudo-événements, dont deux sans horodatage.
 */
const toMessage = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/\s*\n\s*/g, ' ').trim();

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
      diagnostic: toMessage(err),
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
  // `pid`, `nodeVersion` et `memory` ont été retirés (#258) : cette route est publique, et
  // `process.version` livre la version exacte du runtime — donc la liste de ses vulnérabilités
  // connues à qui sait lire. Une bannière de version est une divulgation plus actionnable que le
  // chemin d'un répertoire, et un test de vivacité n'en a aucun besoin.
  //
  // ⚠️ `timestamp` et `uptimeSeconds` RESTENT : `timestamp` est un contrat avec le mobile, qui n'a
  // aucun autre moyen de lire l'horloge serveur et en dépend pour juger une péremption.
  sendSuccess(res, 200, 'ok', {
    uptimeSeconds: process.uptime(),
    timestamp: new Date().toISOString(),
  });
};

/**
 * Readiness check: concurrently probes DB, MongoDB, migrations metadata and log dir writability.
 */
/**
 * Dernier état connu de chaque sonde, pour ne journaliser que les TRANSITIONS. Voir la boucle
 * ci-dessous : sans cette mémoire, la route devient un robinet d'écriture ouvert à tout venant.
 */
const failingSince = new Map<string, boolean>();

const readiness: RequestHandler = async (req, res) => {
  const started = Date.now();

  const checks = await Promise.all([checkDatabase(), checkMongo(), checkLogs(), checkMigrations()]);

  const hasBlockingFailure = checks.some((check) => !check.ok && !check.optional);

  // Le diagnostic part dans le JOURNAL, jamais dans la réponse : c'est là qu'un exploitant regarde,
  // et c'est le seul canal qui exige déjà un accès à la machine (#258).
  //
  // ⚠️ Journalisé au CHANGEMENT D'ÉTAT, pas à chaque appel. Cette route est anonyme ET exemptée du
  // limiteur de débit (`rateLimiter.middleware.ts`) : pendant une panne — le scénario même de ce
  // correctif — n'importe qui la boucle et écrit autant de lignes qu'il veut dans `error-*.log`.
  // Le fichier tourne à 5 Mo mais n'est élagué que par ÂGE : le disque se remplit, et l'API cesse
  // d'écrire sans que rien ne le signale. On aurait échangé une divulgation en lecture contre une
  // écriture non authentifiée dans le journal de sécurité.
  for (const check of checks) {
    const wasFailing = failingSince.get(check.name) === true;

    if (!check.ok && !wasFailing) {
      logger.error(
        `[Health] sonde « ${check.name} » en échec : ${check.diagnostic ?? 'sans diagnostic'}`,
        { requestId: req.requestId }
      );
    } else if (check.ok && wasFailing) {
      logger.info(`[Health] sonde « ${check.name} » rétablie`, {
        requestId: req.requestId,
      });
    }

    failingSince.set(check.name, !check.ok);
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
