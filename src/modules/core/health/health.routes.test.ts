import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const tmpDirBase = path.join(os.tmpdir(), 'nutrichain-health-tests');

afterEach(async () => {
  // cleanup any tmp dirs
  await fs.rm(tmpDirBase, { recursive: true, force: true }).catch(() => {});
  vi.resetModules();
  vi.restoreAllMocks();
  delete process.env.LOG_DIR;
});

describe('Health route', () => {
  /**
   * `hello.routes` et `health.routes` ont longtemps importé le MÊME `Router()` singleton
   * (`shared/configs/router.config`) : chacun y ajoutait ses routes, et `app.ts` montait deux fois
   * le même objet. Inerte tant que personne n'ajoutait de `router.use(...)` — mais le jour où l'un
   * des deux aurait posé un middleware, il se serait appliqué aux routes de l'autre sans que rien
   * ne le signale. Ce test échoue si le partage revient.
   */
  it("n'expose que ses propres routes : health et hello sont deux routeurs distincts", async () => {
    const { default: healthRoutes } = await import('./health.routes');
    const { default: helloRoutes } = await import('../hello.routes');

    const appHealth = express().use(healthRoutes);
    const appHello = express().use(helloRoutes);

    expect((await request(appHealth).get('/health')).status).toBe(200);
    expect((await request(appHealth).get('/hello')).status).toBe(404);
    expect((await request(appHello).get('/hello')).status).toBe(200);
    expect((await request(appHello).get('/health')).status).toBe(404);
  });

  it('should return ok status with uptime and timestamp', async () => {
    // import fresh module
    const { default: healthRoutes } = await import('./health.routes');

    const app = express();
    app.use(healthRoutes);

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 200);
    expect(res.body).toHaveProperty('message', 'ok');
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('uptimeSeconds');
    expect(res.body.data).toHaveProperty('timestamp');

    // #258 — `pid`, `nodeVersion` et `memory` ont été retirés : cette route est publique, et
    // `process.version` livre la version exacte du runtime, donc la liste de ses vulnérabilités
    // connues à qui sait lire. Un test de vivacité n'en a aucun besoin. Le jeu de clés est exact
    // pour qu'aucune bannière ne revienne s'y glisser.
    expect(Object.keys(res.body.data).sort()).toEqual(['timestamp', 'uptimeSeconds']);
  });

  /**
   * ⚠️ CONTRAT AVEC LE MOBILE — ne pas retirer, ne pas renommer, ne pas changer de format.
   *
   * `data.timestamp` est la SEULE horloge serveur que l'application web peut lire. L'en-tête HTTP
   * `Date` n'est pas dans la liste blanche CORS : dans un navigateur, JavaScript ne voit que
   * `content-type` et `content-length`. Le mobile apprend donc l'heure ici, et il en a besoin pour
   * une garde SANITAIRE : sans elle, la péremption d'un lot serait tranchée sur l'horloge du
   * téléphone — réglable à la main, et qui, reculée de deux mois, fait accepter un lot périmé en
   * transformation et en expédition (cf. Nutrichain-Mobile#44).
   *
   * Si ce champ disparaît, le mobile cesse de pouvoir juger une péremption. Rien d'autre ne le
   * signalerait : ce test est le seul garde-fou.
   */
  it('expose une horloge serveur lisible : `timestamp` est une date ISO réelle', async () => {
    const { default: healthRoutes } = await import('./health.routes');

    const app = express();
    app.use(healthRoutes);

    const res = await request(app).get('/health');

    const timestamp: unknown = res.body.data?.timestamp;
    expect(typeof timestamp).toBe('string');

    const parsed = Date.parse(timestamp as string);
    expect(Number.isFinite(parsed)).toBe(true);

    // C'est bien l'heure COURANTE du serveur, pas une constante ni une date de build : une valeur
    // figée passerait le test « c'est une date » tout en rendant la garde de péremption fausse.
    expect(Math.abs(Date.now() - parsed)).toBeLessThan(10_000);
  });

  const mockMongoConnected = () => {
    vi.doMock('mongoose', () => ({
      default: {
        connection: {
          db: { admin: () => ({ ping: vi.fn().mockResolvedValue({ ok: 1 }) }) },
        },
      },
    }));
  };

  it('readiness returns ready when DB, Mongo and logs are OK', async () => {
    const tmpDir = path.join(tmpDirBase, `ok-${Date.now()}`);
    process.env.LOG_DIR = tmpDir;

    // reset modules and mock the prisma client module used by the health controller
    vi.resetModules();
    vi.doMock('../../../shared/configs/prismaClient.config', () => ({
      bdd: {
        $queryRaw: vi.fn().mockResolvedValue(1),
        $queryRawUnsafe: vi.fn().mockResolvedValue([
          { migration_name: '20260731220000_confirmer_la_livraison', finished_at: new Date().toISOString() },
        ]),
      },
    }));
    mockMongoConnected();

    const { default: healthRoutes } = await import('./health.routes');
    const app = express();
    app.use(healthRoutes);

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 200);
    expect(res.body).toHaveProperty('message', 'ready');
    expect(res.body.data.summary.ready).toBe(true);

    type HealthCheck = { name: string; ok: boolean; optional?: boolean; diagnostic?: unknown };
    const checks: HealthCheck[] = res.body.data.checks;
    const dbCheck = checks.find((check) => check.name === 'database')!;
    const mongoCheck = checks.find((check) => check.name === 'mongodb')!;
    const logsCheck = checks.find((check) => check.name === 'logs')!;
    const migrationsCheck = checks.find((check) => check.name === 'migrations')!;

    expect(dbCheck.ok).toBe(true);
    expect(mongoCheck.ok).toBe(true);
    expect(logsCheck.ok).toBe(true);
    expect(migrationsCheck.optional).toBe(true);

    // #258 — La fuite n'attendait même pas une panne : en fonctionnement NOMINAL, la réponse
    // publiait le chemin absolu du répertoire de logs — donc la disposition du déploiement et
    // jusqu'au compte système — ainsi que le nom de la dernière migration. Sur la seule route qui
    // ne demande ni compte, ni clé, ni session.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(tmpDir);
    expect(body).not.toContain('20260731220000_confirmer_la_livraison');
    expect(body).not.toContain('details');

    // Jeu de clés EXACT : c'est la seule assertion qui garde la projection. Sans elle, revenir à
    // `checks: checks` republierait tout champ interne sans qu'un test ne bronche.
    expect(Object.keys(dbCheck).sort()).toEqual(['durationMs', 'name', 'ok']);
    expect(Object.keys(logsCheck).sort()).toEqual(['durationMs', 'name', 'ok']);
    expect(Object.keys(migrationsCheck).sort()).toEqual(['durationMs', 'name', 'ok', 'optional']);
  });

  /**
   * La télémétrie IoT (chaîne du froid) vit exclusivement dans Mongo : sans ce check, la sonde
   * répondait "prête" alors que POST /api/telemetry/ping échouerait — la vitrine IoT pouvait
   * tomber sans qu'aucun indicateur ne l'annonce (#158).
   */
  it('readiness returns not ready when Mongo is unreachable', async () => {
    const tmpDir = path.join(tmpDirBase, `mongo-nok-${Date.now()}`);
    process.env.LOG_DIR = tmpDir;

    vi.resetModules();
    vi.doMock('../../../shared/configs/prismaClient.config', () => ({
      bdd: {
        $queryRaw: vi.fn().mockResolvedValue(1),
        $queryRawUnsafe: vi.fn().mockResolvedValue([
          { migration_name: '20260731220000_confirmer_la_livraison', finished_at: new Date().toISOString() },
        ]),
      },
    }));
    vi.doMock('mongoose', () => ({
      default: {
        connection: {
          db: { admin: () => ({ ping: vi.fn().mockRejectedValue(new Error('Mongo down')) }) },
        },
      },
    }));

    const { default: healthRoutes } = await import('./health.routes');
    const app = express();
    app.use(healthRoutes);

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.data.summary.ready).toBe(false);

    type HealthCheck = { name: string; ok: boolean; optional?: boolean; diagnostic?: unknown };
    const checks: HealthCheck[] = res.body.data.checks;
    const mongoCheck = checks.find((check) => check.name === 'mongodb')!;
    expect(mongoCheck.ok).toBe(false);
    expect(mongoCheck.optional).toBeUndefined();
    // #258 — le message d exception ne sort PAS : cette route est le seul chemin sans
    // authentification, et il y publiait l URI Mongo.
    expect(mongoCheck.diagnostic).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("Mongo down");
  });

  it('readiness returns not ready when DB check fails', async () => {
    const tmpDir = path.join(tmpDirBase, `nok-${Date.now()}`);
    process.env.LOG_DIR = tmpDir;

    // reset modules and mock prisma to simulate DB down
    vi.resetModules();
    vi.doMock('../../../shared/configs/prismaClient.config', () => ({
      bdd: {
        $queryRaw: vi.fn().mockRejectedValue(new Error('DB down')),
        $queryRawUnsafe: vi.fn().mockRejectedValue(new Error('DB down')),
      },
    }));
    mockMongoConnected();

    const { default: healthRoutes } = await import('./health.routes');
    const app = express();
    app.use(healthRoutes);

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty('status', 503);
    expect(res.body).toHaveProperty('message', 'not ready');
    expect(res.body.data.summary.ready).toBe(false);

    type HealthCheck = { name: string; ok: boolean; optional?: boolean; diagnostic?: unknown };
    const checks: HealthCheck[] = res.body.data.checks;
    const dbCheck = checks.find((check) => check.name === 'database')!;
    expect(dbCheck.ok).toBe(false);
    // #258 — « Can t reach database server at <hote>:<port> » ne doit jamais atteindre un
    // appelant anonyme. Le superviseur apprend QU UNE dependance est tombee, pas son adresse.
    expect(dbCheck.diagnostic).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("DB down");
  });

  it('readiness stays ready when migrations probe fails with column missing', async () => {
    const tmpDir = path.join(tmpDirBase, `migr-${Date.now()}`);
    process.env.LOG_DIR = tmpDir;

    vi.resetModules();
    const migrationError = new Error('migrations column missing') as Error & { code?: string };
    migrationError.code = '42703';

    vi.doMock('../../../shared/configs/prismaClient.config', () => ({
      bdd: {
        $queryRaw: vi.fn().mockResolvedValue(1),
        $queryRawUnsafe: vi.fn().mockImplementation(() => Promise.reject(migrationError)),
      },
    }));
    mockMongoConnected();

    const { default: healthRoutes } = await import('./health.routes');
    const app = express();
    app.use(healthRoutes);

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 200);
    expect(res.body).toHaveProperty('message', 'ready');
    expect(res.body.data.summary.ready).toBe(true);

    type HealthCheck = { name: string; ok: boolean; optional?: boolean; diagnostic?: unknown };
    const checks: HealthCheck[] = res.body.data.checks;
    const migrationsCheck = checks.find((check) => check.name === 'migrations')!;
    expect(migrationsCheck.ok).toBe(false);
    expect(migrationsCheck.optional).toBe(true);
    expect(migrationsCheck.diagnostic).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("migrations column missing");
  });

  /**
   * #258, seconde moitié : retirer le message du corps ne suffit pas. Un exploitant doit toujours
   * pouvoir diagnostiquer une panne — sinon on a échangé une fuite contre un aveuglement. Le
   * message technique doit donc atterrir dans le JOURNAL, le seul endroit qui exige déjà un accès
   * à la machine.
   */
  it('le diagnostic atterrit dans le JOURNAL, pas dans la réponse', async () => {
    const tmpDir = path.join(tmpDirBase, `log-${Date.now()}`);
    process.env.LOG_DIR = tmpDir;

    vi.resetModules();
    const loggedErrors: string[] = [];
    vi.doMock('../../../shared/utils/logger/logger', () => ({
      logger: {
        error: (message: string) => loggedErrors.push(message),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      },
    }));
    vi.doMock('../../../shared/configs/prismaClient.config', () => ({
      bdd: {
        $queryRaw: vi.fn().mockRejectedValue(new Error("Can't reach database server at db-prod:5432")),
        $queryRawUnsafe: vi.fn().mockRejectedValue(new Error('boom')),
      },
    }));
    mockMongoConnected();

    const { default: healthRoutes } = await import('./health.routes');
    const app = express();
    app.use(healthRoutes);

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(503);
    // L'hôte et le port internes ne sortent pas...
    expect(JSON.stringify(res.body)).not.toContain('db-prod:5432');
    // ...mais ils sont bien quelque part, sinon la panne serait indiagnosticable.
    expect(loggedErrors.some((line) => line.includes('db-prod:5432'))).toBe(true);
    expect(loggedErrors.some((line) => line.includes('database'))).toBe(true);
  });

  /**
   * #258 — Le correctif a failli echanger une fuite en lecture contre une ecriture non
   * authentifiee dans le journal de securite.
   *
   * Cette route est anonyme ET exemptee du limiteur de debit. Journaliser a CHAQUE appel en faisait
   * un robinet : pendant une panne — le scenario meme du correctif — n importe qui la boucle et
   * remplit `error-*.log`, qui n est elague que par age. Le disque se remplit, et l API cesse
   * d ecrire sans que rien ne le signale.
   */
  it('ne journalise QU AU CHANGEMENT d etat, pas a chaque appel', async () => {
    const tmpDir = path.join(tmpDirBase, `flood-${Date.now()}`);
    process.env.LOG_DIR = tmpDir;

    vi.resetModules();
    const loggedErrors: string[] = [];
    vi.doMock('../../../shared/utils/logger/logger', () => ({
      logger: {
        error: (message: string) => loggedErrors.push(message),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      },
    }));
    vi.doMock('../../../shared/configs/prismaClient.config', () => ({
      bdd: {
        $queryRaw: vi.fn().mockRejectedValue(new Error('DB down')),
        $queryRawUnsafe: vi.fn().mockRejectedValue(new Error('DB down')),
      },
    }));
    mockMongoConnected();

    const { default: healthRoutes } = await import('./health.routes');
    const app = express();
    app.use(healthRoutes);

    await request(app).get('/health/ready');
    const apresPremierAppel = loggedErrors.length;

    for (let i = 0; i < 20; i++) {
      await request(app).get('/health/ready');
    }

    expect(apresPremierAppel).toBeGreaterThan(0);
    // 20 appels de plus, zero ligne de plus : l etat n a pas change.
    expect(loggedErrors.length).toBe(apresPremierAppel);
  }, 20_000);
});
