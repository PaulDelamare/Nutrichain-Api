import { RequestHandler } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { sendSuccess } from '../Utils/returnSuccess/returnSuccess';
import { bdd } from '../Configs/prismaClient.config';

type HealthCheckResult = {
    name: string;
    ok: boolean;
    durationMs: number;
    optional?: boolean;
    error?: string;
    details?: Record<string, unknown>;
};

const toMessage = (err: unknown) => err instanceof Error ? err.message : String(err);

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
            error: toMessage(err),
        };
    }
};

const checkMigrations = async (): Promise<HealthCheckResult> => {
    const started = Date.now();
    const tableName = '_prisma_migrations';

    try {
        const existsRows = await withTimeout(
            bdd.$queryRawUnsafe<any[]>(`SELECT table_name FROM information_schema.tables WHERE table_name = '${tableName}' LIMIT 1;`),
            DB_TIMEOUT_MS,
            'Migrations table existence check'
        );

        if (!Array.isArray(existsRows) || existsRows.length === 0) {
            return {
                name: 'migrations',
                ok: false,
                optional: true,
                durationMs: Date.now() - started,
                details: { message: 'No migrations table present' },
            };
        }

        const cols = await withTimeout(
            bdd.$queryRawUnsafe<any[]>(`SELECT column_name FROM information_schema.columns WHERE table_name = '${tableName}';`),
            DB_TIMEOUT_MS,
            'Migrations columns discovery'
        );

        const columnNames = Array.isArray(cols) ? cols.map((c) => String(c.column_name || c.COLUMN_NAME || c.name)).filter(Boolean) : [];

        const preferred = columnNames.find((c: string) => /finished_at|finishedat/i.test(c)) || columnNames[0] || null;

        const orderClause = preferred ? `ORDER BY "${preferred}" DESC` : '';

        const rows = await withTimeout(
            bdd.$queryRawUnsafe<any[]>(`SELECT * FROM "${tableName}" ${orderClause} LIMIT 1;`),
            DB_TIMEOUT_MS,
            'Migrations latest row'
        );

        const latest = Array.isArray(rows) && rows[0] ? rows[0] : undefined;

        return {
            name: 'migrations',
            ok: Boolean(latest),
            optional: true,
            durationMs: Date.now() - started,
            details: latest ? latest : { message: 'No migration rows' },
        };
    } catch (err) {
        return {
            name: 'migrations',
            ok: false,
            optional: true,
            durationMs: Date.now() - started,
            error: toMessage(err).replace(/\n/g, ' '),
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
            details: { path: logsDir },
        };
    } catch (err) {
        return {
            name: 'logs',
            ok: false,
            durationMs: Date.now() - started,
            error: toMessage(err),
            details: { path: logsDir },
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
        uptime,
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
 * Readiness check: concurrently probes DB, migrations metadata and log dir writability.
 */
const readiness: RequestHandler = async (_req, res) => {
    const started = Date.now();

    const checks = await Promise.all([
        checkDatabase(),
        checkLogs(),
        checkMigrations(),
    ]);

    const hasBlockingFailure = checks.some((check) => !check.ok && !check.optional);

    sendSuccess(res, hasBlockingFailure ? 503 : 200, hasBlockingFailure ? 'not ready' : 'ready', {
        summary: {
            ready: !hasBlockingFailure,
            timestamp: new Date().toISOString(),
            uptimeSeconds: process.uptime(),
            totalDurationMs: Date.now() - started,
        },
        checks,
    });
};

export const HealthController = {
    health,
    readiness,
};
