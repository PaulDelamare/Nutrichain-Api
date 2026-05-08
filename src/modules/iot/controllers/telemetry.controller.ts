import { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { TelemetryModel } from '../models/telemetry.model';

/**
 * Ingest new telemetry ping from an IoT device.
 */
export const ingestTelemetry = async (req: Request, res: Response) => {
  try {
    const { sensor_id, temperature, humidity, battery_level } = req.body;

    // Ensure payload is complete.
    if (
      !sensor_id ||
      temperature === undefined ||
      humidity === undefined ||
      battery_level === undefined
    ) {
      res.status(400).json({ status: 400, message: 'Missing parameters payload' });
      return;
    }

    // Insert in MongoDB Time-Series Collection
    await TelemetryModel.create({
      metadata: { sensor_id },
      timestamp: new Date(), // Always real-time ingestion, OR take timestamp from ping if provided
      temperature,
      humidity,
      battery_level,
    });

    // Fast ingestion (HTTP 202 Accepted) since it's a massive ingestion flow
    sendSuccess(res, 202, 'Telemetry ingested successfully.', {
      sensor_id,
      ingested: true,
    });
  } catch (error) {
    console.error('[IoT Ingestion Error]', error);
    res.status(500).json({ status: 500, message: 'Internal server error' });
  }
};

/**
 * Get recent historical data for a specific sensor.
 */
export const getSensorHistory = async (req: Request, res: Response) => {
  try {
    const { sensor_id } = req.params;
    const limitStr = (req.query.limit as string) || '100';
    const limit = parseInt(limitStr, 10);

    // Querying MongoDB TS efficiently by time index and metaField
    const history = await TelemetryModel.find({ 'metadata.sensor_id': sensor_id })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    sendSuccess(res, 200, 'Historical data retrieved.', {
      sensor_id,
      points: history.length,
      data: history,
    });
  } catch (error) {
    console.error('[IoT History Error]', error);
    res.status(500).json({ status: 500, message: 'Internal server error' });
  }
};
