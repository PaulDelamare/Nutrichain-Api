import { Schema, model } from 'mongoose';

export interface ITelemetry {
  metadata: {
    sensor_id: string; // Identifier for the Materiel
  };
  timestamp: Date;
  temperature: number;
  humidity: number;
  battery_level: number;
}

const telemetrySchema = new Schema<ITelemetry>(
  {
    metadata: {
      sensor_id: { type: String, required: true },
    },
    timestamp: { type: Date, required: true },
    temperature: { type: Number, required: true },
    humidity: { type: Number, required: true },
    battery_level: { type: Number, required: true },
  },
  {
    timeseries: {
      timeField: 'timestamp',
      metaField: 'metadata',
      granularity: 'seconds',
    },
    expireAfterSeconds: 31536000, // Retention policy: 1 year (365 days max for logs) - Optional optimization
  }
);

// Indexing explicitly for fast querying by sensor and time
telemetrySchema.index({ 'metadata.sensor_id': 1, timestamp: -1 });

export const TelemetryModel = model<ITelemetry>('IoT_Telemetry', telemetrySchema);
