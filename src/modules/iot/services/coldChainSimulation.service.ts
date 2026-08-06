import mongoose from 'mongoose';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { TelemetryModel } from '../models/telemetry.model';
import { iotAlertService } from './iotAlert.service';
import { COLD_QUARANTINABLE_STATUSES } from '../../logistics/constants/logistics.constants';

/**
 * Simulation d'un incident chaîne du froid, pour DÉMONTRER le mécanisme depuis l'interface.
 *
 * Elle ne « fait pas semblant » : elle injecte une vraie fenêtre de mesures au-dessus du seuil puis
 * REJOUE le pipeline de détection réel (`iotAlertService.checkAndAlert`). L'alerte PANIC, la mise en
 * quarantaine des lots et l'écriture d'audit sont donc identiques à celles d'un incident capteur —
 * seule l'origine des mesures change. La clé de passerelle IoT reste hors de portée du navigateur :
 * ce chemin est appelé par un humain authentifié, pas par une machine.
 */

// La détection exige ≥ 5 points dont ≥ 80 % au-dessus du seuil : on en pose 6, tous au-dessus,
// étalés dans la fenêtre glissante de 15 min pour reproduire une vraie excursion.
const SIMULATED_POINTS = 6;
const POINT_SPACING_MS = 2 * 60_000;
const PEAK_OFFSET_C = 4;

export interface SimulateIncidentParams {
  organizationId: string;
  /** Matériel ciblé ; à défaut, un frigo apte de l'organisation est choisi automatiquement. */
  equipmentId?: string;
}

export interface SimulateIncidentResult {
  equipmentId: string;
  sensorId: string;
  threshold: number;
  peakTemp: number;
  alertCreated: boolean;
  quarantinedCount: number;
}

interface SimulableEquipment {
  id: string;
  sensor_id: string;
  temp_seuil_max: Prisma.Decimal;
}

export const coldChainSimulationService = {
  async simulateIncident(params: SimulateIncidentParams): Promise<SimulateIncidentResult> {
    const { organizationId, equipmentId } = params;

    const equipment = await resolveTarget(organizationId, equipmentId);
    const threshold = Number(equipment.temp_seuil_max);
    const peakTemp = threshold + PEAK_OFFSET_C;
    const sensorId = equipment.sensor_id;

    // Écriture des points puis relecture (dans checkAndAlert) partagent la même session à cohérence
    // causale : sans elle, les points tout juste insérés peuvent ne pas être visibles à la détection
    // immédiate (cf. #226 dans l'ingestion réelle).
    const now = Date.now();
    const session = await mongoose.startSession();
    try {
      await TelemetryModel.insertMany(
        Array.from({ length: SIMULATED_POINTS }, (_, idx) => ({
          metadata: { sensor_id: sensorId, organization_id: organizationId },
          timestamp: new Date(now - (SIMULATED_POINTS - 1 - idx) * POINT_SPACING_MS),
          temperature: peakTemp,
          humidity: 55,
          battery_level: 80,
        })),
        { session }
      );

      await iotAlertService.checkAndAlert({
        sensorId,
        organizationId,
        currentTemp: peakTemp,
        timestamp: new Date(now),
        mongoSession: session,
      });
    } finally {
      await session.endSession();
    }

    // On renvoie l'effet CONCRET (alerte ouverte, lots bloqués) plutôt qu'un vague succès : le bouton
    // peut annoncer « 1 alerte, N lots en quarantaine » au lieu de laisser deviner.
    const [alert, quarantinedCount] = await Promise.all([
      prisma.alert.findFirst({
        where: {
          organization_id: organizationId,
          id_materiel: equipment.id,
          type: 'TEMP_EXCURSION',
          statut: 'ACTIVE',
        },
        select: { id: true },
      }),
      prisma.batch.count({
        where: {
          organization_id: organizationId,
          id_materiel_actuel: equipment.id,
          statut: 'BLOQUE',
        },
      }),
    ]);

    return {
      equipmentId: equipment.id,
      sensorId,
      threshold,
      peakTemp,
      alertCreated: alert !== null,
      quarantinedCount,
    };
  },
};

const SELECT_SIMULABLE = { id: true, sensor_id: true, temp_seuil_max: true } as const;

async function resolveTarget(
  organizationId: string,
  equipmentId?: string
): Promise<SimulableEquipment> {
  if (equipmentId) {
    const eq = await prisma.equipment.findFirst({
      where: { id: equipmentId, organization_id: organizationId },
      select: SELECT_SIMULABLE,
    });
    if (!eq) {
      throw new APIError(404, {
        error: [
          { field: 'equipmentId', message: "Le matériel demandé n'existe pas dans cette organisation." },
        ],
      });
    }
    return assertSimulable(eq);
  }

  // Sélection automatique (bouton one-click) : un frigo apte, de préférence contenant des lots
  // quarantinables pour que la démonstration montre aussi la mise en quarantaine. Ordre déterministe
  // par nom — jamais un matériel au hasard qui changerait d'un run à l'autre.
  const base: Prisma.EquipmentWhereInput = {
    organization_id: organizationId,
    sensor_id: { not: null },
    temp_seuil_max: { not: null },
  };
  const withLots = await prisma.equipment.findFirst({
    where: { ...base, lots: { some: { statut: { in: COLD_QUARANTINABLE_STATUSES as string[] } } } },
    select: SELECT_SIMULABLE,
    orderBy: { nom: 'asc' },
  });
  const eq =
    withLots ??
    (await prisma.equipment.findFirst({
      where: base,
      select: SELECT_SIMULABLE,
      orderBy: { nom: 'asc' },
    }));
  if (!eq) {
    throw new APIError(409, {
      error: [
        {
          field: 'equipmentId',
          message:
            'Aucun matériel avec capteur et seuil configuré : impossible de simuler un incident.',
        },
      ],
    });
  }
  return assertSimulable(eq);
}

function assertSimulable(eq: {
  id: string;
  sensor_id: string | null;
  temp_seuil_max: Prisma.Decimal | null;
}): SimulableEquipment {
  if (!eq.sensor_id || eq.temp_seuil_max === null) {
    throw new APIError(409, {
      error: [
        { field: 'equipmentId', message: "Ce matériel n'a pas de capteur ou de seuil configuré." },
      ],
    });
  }
  return { id: eq.id, sensor_id: eq.sensor_id, temp_seuil_max: eq.temp_seuil_max };
}
