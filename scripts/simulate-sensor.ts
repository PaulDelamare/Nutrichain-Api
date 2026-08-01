import mongoose from 'mongoose';
import { prisma } from '../src/shared/configs/prismaClient.config';
import { hashGatewayKey } from '../src/shared/utils/iotGateway/iotGateway';

/**
 * NUTRICHAIN — Émetteur de trames de télémétrie.
 *
 * À quoi ça sert : la surveillance de la chaîne du froid est réelle et testée côté serveur, mais
 * **rien n'émet de trames**. Sans capteur physique, la courbe reste vide et la seule alerte visible
 * est celle que le jeu de données pose à la main — personne ne l'a vue naître, et ses champs
 * `peak_temp` / `temp_seuil` sont vides parce qu'aucune détection ne les a calculés. Ce script joue
 * le thermomètre, rien d'autre : il envoie des mesures sur le vrai `POST /api/telemetry/ping` avec
 * la clé de la passerelle. Détection, alerte, quarantaine des lots et courriel restent le fait du
 * serveur.
 *
 * Il exerce au passage le seul chemin d'ingestion qu'aucun scénario ne couvrait de bout en bout :
 * `e2e-iot-alert.ts` appelle `iotAlertService.checkAndAlert` directement, sans passer par HTTP.
 *
 * ⚠️ Les effets de bord sont RÉELS et en partie irréversibles : lots mis en quarantaine (levables
 * seulement par un geste qualité), maillon scellé dans le journal WORM, **courriels envoyés aux
 * responsables**. D'où les gardes d'environnement ci-dessous.
 *
 * Usage :
 *   npm run simulate:sensor -- [--sensor SENSOR-FROID-A1] [--nominal 10] [--excursion N]
 *                              [--interval 2] [--cooldown] [--allow-remote]
 */

const MIN_POINTS = 5;
const MIN_OVER_THRESHOLD_RATIO = 0.8;
const WINDOW_MINUTES = 15;

/**
 * Au-delà de cette cadence, moins de 5 trames tiennent dans la fenêtre : la détection devient
 * structurellement impossible et le script tournerait des heures pour rien.
 */
const MAX_INTERVAL_SECONDS = Math.floor((WINDOW_MINUTES * 60) / (MIN_POINTS - 1));

/** Plafond de trames : sans lui, `--nominal 1e9` part pour toujours. */
const MAX_FRAMES = 500;

const argValue = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = process.argv[i + 1];
  // Un `--sensor` en dernière position retombait en silence sur le capteur par défaut.
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`--${name} attend une valeur.`);
  }
  return value;
};

const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const boundedInt = (name: string, fallback: number, max: number): number => {
  const raw = argValue(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    throw new Error(`--${name} attend un entier entre 0 et ${max}, reçu « ${raw} »`);
  }
  return parsed;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Trames chaudes nécessaires pour franchir le ratio, compte tenu des froides de la fenêtre.
 *
 * Calculé en itérant avec **exactement la comparaison du serveur** (`hot / total >= ratio`), et non
 * par la forme fermée `cold * ratio / (1 - ratio)` : en double, `0.8 / 0.2` vaut 4.000000000000001,
 * et le `ceil` ajoutait une trame de trop dès 2 froides. Le script annonçait alors « ça ne suffira
 * pas » sur un cas que le serveur accepte — le pire défaut pour un outil censé expliquer la règle.
 */
function requiredHotFrames(coldInWindow: number): number {
  let hot = MIN_POINTS;
  while (hot / (hot + coldInWindow) < MIN_OVER_THRESHOLD_RATIO) hot++;
  return hot;
}

/** Points déjà dans la fenêtre pour ce capteur, cloisonnés par organisation comme le fait le serveur. */
async function readDetectionWindow(sensorId: string, organizationId: string, threshold: number) {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI absente du .env : impossible de lire la fenêtre.');
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);
  const points = await mongoose.connection
    .db!.collection('iot_telemetries')
    .find({
      'metadata.sensor_id': sensorId,
      'metadata.organization_id': organizationId,
      timestamp: { $gte: since },
    })
    .project({ temperature: 1 })
    .toArray();
  // `>` strict, comme la détection : une mesure pile au seuil n'est PAS une excursion.
  const hot = points.filter((p) => Number(p.temperature) > threshold).length;
  return { hot, cold: points.length - hot };
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refus en production. Ce script crée de vraies alertes, met des lots en quarantaine et envoie des courriels.'
    );
  }

  const apiUrl = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const host = new URL(apiUrl).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host) && !hasFlag('allow-remote')) {
    throw new Error(
      `API_URL pointe sur « ${host} », pas sur cette machine. Relance avec --allow-remote si c'est voulu.`
    );
  }

  const gatewayKey = process.env.IOT_API_KEY;
  if (!gatewayKey) {
    throw new Error('IOT_API_KEY absente du .env : la passerelle ne peut pas s’authentifier.');
  }

  // Le tenant vient de la PASSERELLE, jamais d'un choix du script : c'est la règle du serveur, et
  // sans elle on pourrait désigner l'équipement d'une autre organisation et rapporter son état.
  const gateway = await prisma.iotGateway.findFirst({
    where: { key_hash: hashGatewayKey(gatewayKey), revoked_at: null },
  });
  if (!gateway) {
    throw new Error(
      "Aucune passerelle active pour cette IOT_API_KEY. Rejoue `npx prisma db seed`, ou `npm run iot:gateway -- --org <id>`."
    );
  }
  const organizationId = gateway.organization_id;

  const requestedSensor = argValue('sensor');
  const equipment = await prisma.equipment.findFirst({
    where: requestedSensor
      ? { sensor_id: requestedSensor, organization_id: organizationId }
      : {
          sensor_id: { not: null },
          temp_seuil_max: { not: null },
          organization_id: organizationId,
        },
    // `id` départage deux matériels homonymes : sans lui, le capteur choisi par défaut peut changer
    // d'une exécution à l'autre, et la démonstration ne joue pas deux fois la même chambre.
    orderBy: [{ nom: 'asc' }, { id: 'asc' }],
  });

  if (!equipment?.sensor_id || equipment.temp_seuil_max === null) {
    const known = await prisma.equipment.findMany({
      where: { sensor_id: { not: null }, organization_id: organizationId },
      select: { nom: true, sensor_id: true, temp_seuil_max: true },
    });
    throw new Error(
      'Aucun matériel surveillé pour ce capteur dans l’organisation de la passerelle. Capteurs connus :\n' +
        (known.map((e) => `  ${e.sensor_id} — ${e.nom} (seuil ${e.temp_seuil_max})`).join('\n') ||
          '  (aucun)')
    );
  }

  const sensorId = equipment.sensor_id;
  const threshold = Number(equipment.temp_seuil_max);
  const nominalCount = boundedInt('nominal', 10, MAX_FRAMES);
  const intervalSeconds = boundedInt('interval', 2, MAX_INTERVAL_SECONDS);
  const cooldownCount = hasFlag('cooldown') ? nominalCount : 0;

  const windowBefore = await readDetectionWindow(sensorId, organizationId, threshold);
  const coldAhead = windowBefore.cold + nominalCount;
  const required = requiredHotFrames(coldAhead);
  const hotCount =
    argValue('excursion') !== undefined ? boundedInt('excursion', required, MAX_FRAMES) : required;

  const alertBefore = await prisma.alert.findFirst({
    where: { id_materiel: equipment.id, statut: 'ACTIVE', organization_id: organizationId },
    orderBy: { created_at: 'desc' },
  });
  const atRisk = await prisma.batch.count({
    where: {
      id_materiel_actuel: equipment.id,
      organization_id: organizationId,
      statut: { in: ['EN_STOCK', 'EN_ATTENTE_QC'] },
    },
  });

  console.log(`Organisation : ${organizationId} (résolue depuis la passerelle « ${gateway.nom} »)`);
  console.log(`Capteur      : ${sensorId} — ${equipment.nom}`);
  console.log(`Seuil        : ${threshold} °C`);
  console.log(`Cadence      : une trame toutes les ${intervalSeconds} s`);
  console.log(
    `Fenêtre      : ${windowBefore.hot} chaude(s) / ${windowBefore.cold} froide(s) (${WINDOW_MINUTES} min)`
  );
  console.log(
    `Règle        : ≥ ${MIN_POINTS} points et ≥ ${MIN_OVER_THRESHOLD_RATIO * 100} % au-dessus du seuil`
  );
  console.log(
    `Programme    : ${nominalCount} nominales puis ${hotCount} en dérive` +
      (cooldownCount ? `, ${cooldownCount} de retour au nominal` : '')
  );

  // Annoncé AVANT, pas constaté après : ces lots deviennent non expédiables et non transformables,
  // et seule une décision qualité les libère.
  if (atRisk > 0) {
    console.log(
      `\n  ⚠️  ${atRisk} lot(s) sont rangés dans ce matériel : ils passeront en quarantaine et ne` +
        `\n      se débloqueront que par une levée depuis l'écran Non-conformités (rôle qualité).`
    );
  }
  if (alertBefore) {
    console.log(
      `\n  ⚠️  Une alerte est DÉJÀ active ici (${alertBefore.id}). Le dédoublonnage empêchera` +
        `\n      d'en créer une nouvelle : résous-la d'abord si tu veux voir la détection opérer.`
    );
  }
  if (hotCount < required) {
    console.log(
      `\n  ⚠️  ${hotCount} trames chaudes ne suffiront pas : il en faut ${required} pour compenser` +
        `\n      les ${coldAhead} froides de la fenêtre. Aucune alerte ne sera créée.`
    );
  }
  console.log('');

  const phases: { label: string; count: number; base: number }[] = [
    { label: 'nominal', count: nominalCount, base: threshold - 1 },
    { label: 'DÉRIVE ', count: hotCount, base: threshold + 3 },
    { label: 'retour ', count: cooldownCount, base: threshold - 1 },
  ];

  const totalFrames = phases.reduce((sum, phase) => sum + phase.count, 0);
  let sent = 0;
  let sentAbove = 0;
  let bornAlertId: string | null = null;

  for (const phase of phases) {
    for (let i = 0; i < phase.count; i++) {
      // Une mesure ne se répète jamais à l'identique : un plateau parfaitement plat se lit comme
      // une sonde bloquée, pas comme une chambre froide.
      const temperature = Number((phase.base + (Math.random() - 0.5) * 0.6).toFixed(2));
      const response = await fetch(`${apiUrl}/api/telemetry/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': gatewayKey },
        body: JSON.stringify({
          sensor_id: sensorId,
          temperature,
          humidity: Number((60 + Math.random() * 10).toFixed(1)),
          battery_level: 92,
        }),
      });

      const body = (await response.json().catch(() => null)) as {
        data?: { detection?: string };
        error?: unknown;
      } | null;

      if (!response.ok) {
        throw new Error(
          `Trame refusée (HTTP ${response.status}) : ${JSON.stringify(body?.error ?? body)}`
        );
      }

      sent++;
      if (temperature > threshold) sentAbove++;
      const detection = body?.data?.detection ?? '?';

      // Une trame acceptée mais non surveillée est le pire des cas : l'installation se croit
      // couverte. On s'arrête au lieu d'envoyer 50 trames dans le vide.
      if (detection !== 'MONITORED') {
        throw new Error(
          `Le serveur répond « ${detection} » : ce capteur n'est rattaché à aucun matériel doté d'un seuil dans l'organisation de la passerelle. Aucune alerte n'est possible.`
        );
      }

      console.log(
        `  [${phase.label}] ${temperature.toFixed(2)} °C  → ${detection}` +
          (temperature > threshold ? `  (au-dessus du seuil : ${sentAbove})` : '')
      );

      // On relit l'alerte en base plutôt que de croire un compteur local — et on ne l'annonce que
      // si son identifiant DIFFÈRE de celle qui existait déjà, sinon on s'attribue le résultat de
      // l'exécution précédente.
      if (!bornAlertId && temperature > threshold) {
        const current = await prisma.alert.findFirst({
          where: { id_materiel: equipment.id, statut: 'ACTIVE', organization_id: organizationId },
          orderBy: { created_at: 'desc' },
        });
        if (current && current.id !== alertBefore?.id) {
          bornAlertId = current.id;
          console.log(`\n  🔴 ALERTE CRÉÉE — ${current.message}\n`);
          // Le compte de trames n'était qu'une estimation : la fenêtre glisse pendant l'envoi, et
          // à cadence lente l'alerte tombe bien plus tôt. Continuer n'apprendrait rien.
          if (cooldownCount === 0) {
            console.log('  (dérive interrompue : le but était de la déclencher)\n');
            break;
          }
        }
      }

      if (sent < totalFrames) await wait(intervalSeconds * 1000);
    }
    if (bornAlertId && cooldownCount === 0) break;
  }

  const quarantined = await prisma.batch.count({
    where: { id_materiel_actuel: equipment.id, organization_id: organizationId, statut: 'BLOQUE' },
  });

  console.log('\n— Résultat côté serveur —');
  if (bornAlertId) {
    console.log(`  Alerte CRÉÉE pendant cette exécution : ${bornAlertId}`);
  } else if (alertBefore) {
    console.log(`  Alerte ${alertBefore.id} déjà ouverte avant : rien de neuf (dédoublonnage).`);
  } else {
    console.log("  Aucune alerte : la dérive n'a pas atteint le critère.");
  }
  console.log(`  Lots en quarantaine sur ce matériel : ${quarantined}`);
  if (quarantined > 0 || bornAlertId) {
    // `--cooldown` ne referme RIEN : redescendre en température ne résout pas l'alerte et ne
    // débloque aucun lot. Le dire, sinon on croit avoir remis l'état à zéro.
    console.log(
      "  Remise à zéro : lever la quarantaine (écran Non-conformités, rôle qualité) et résoudre\n" +
        "  l'alerte. Redescendre la température ne suffit pas — aucun chemin ne referme une alerte."
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error(`\n❌ ${(error as Error).message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Fermé sur TOUS les chemins, y compris l'erreur : sinon le script reste pendu et la
    // démonstration a l'air figée.
    await prisma.$disconnect();
    if (mongoose.connection.readyState !== 0) await mongoose.connection.close();
  });
