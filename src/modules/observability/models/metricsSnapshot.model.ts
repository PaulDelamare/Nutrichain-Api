import { Schema, model } from 'mongoose';

/**
 * Instantané périodique des compteurs de requêtes par organisation. Seul ce qui n'est PAS déjà
 * durable ailleurs est snapshotté ici : le journal d'audit et les alertes vivent dans Postgres et
 * survivent déjà à un redémarrage — seul le ring buffer en mémoire de `metricsStore` en a besoin.
 */
export interface IMetricsSnapshot {
  metadata: {
    organization_id: string;
  };
  timestamp: Date;
  request_count: number;
  error_count: number;
}

const metricsSnapshotSchema = new Schema<IMetricsSnapshot>(
  {
    metadata: {
      organization_id: { type: String, required: true, index: true },
    },
    timestamp: { type: Date, required: true },
    request_count: { type: Number, required: true },
    error_count: { type: Number, required: true },
  },
  {
    timeseries: {
      timeField: 'timestamp',
      metaField: 'metadata',
      granularity: 'minutes',
    },
    // 30 jours : assez pour une tendance utile, borné pour ne pas grossir indéfiniment.
    expireAfterSeconds: 2_592_000,
  }
);

export const MetricsSnapshotModel = model<IMetricsSnapshot>(
  'Observability_MetricsSnapshot',
  metricsSnapshotSchema
);
