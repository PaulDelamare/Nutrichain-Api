import { createLogger, format, transports } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';

const loglevel = {
  level: {
    info: 0,
    warn: 1,
    error: 2,
    crit: 3,
  },
};

const logFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.printf(({ level, message, timestamp, requestId }) => {
    const reqIdSegment = requestId ? ` [req:${requestId}]` : '';
    return `${timestamp} [${level.toUpperCase()}]${reqIdSegment}: ${message}`;
  })
);

/**
 * Rétention des journaux — durée pendant laquelle une trace reste analysable après un incident.
 *
 * Sans borne, la rotation empile indéfiniment : le disque finit plein, et l'API cesse d'écrire sans
 * que rien ne le signale. Trop courte, une intrusion découverte trois semaines après ne laisse plus
 * rien à examiner. Les erreurs sont gardées plus longtemps : c'est sur elles que porte l'analyse.
 */
const APP_LOG_RETENTION = process.env.LOG_RETENTION_DAYS || '14d';
const ERROR_LOG_RETENTION = process.env.ERROR_LOG_RETENTION_DAYS || '90d';

/**
 * Une date lexicographiquement triable, sur les DEUX transports. `MM-DD-YYYY` ne se trie pas
 * chronologiquement : un collecteur qui parcourt le répertoire dans l'ordre alphabétique
 * reconstitue une chronologie fausse — et les deux transports divergeaient.
 */
const LOG_DATE_PATTERN = 'YYYY-MM-DD';

// Crée un logger
export const logger = createLogger({
  levels: loglevel.level,
  format: logFormat,
  transports: [
    new transports.Console(),
    new DailyRotateFile({
      filename: path.join(process.cwd(), 'logs', 'app-%DATE%.log'),
      datePattern: LOG_DATE_PATTERN,
      maxSize: '5m',
      maxFiles: APP_LOG_RETENTION,
    }),
    new DailyRotateFile({
      filename: path.join(process.cwd(), 'logs', 'error-%DATE%.log'),
      datePattern: LOG_DATE_PATTERN,
      maxSize: '5m',
      maxFiles: ERROR_LOG_RETENTION,
      level: 'error',
      format: format.combine(
        format((info) => (info.level === 'error' || info.level === 'crit' ? info : false))(),
        logFormat
      ),
    }),
  ],
});
