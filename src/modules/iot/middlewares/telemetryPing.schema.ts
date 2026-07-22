import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';

/**
 * Contrat d'une trame de télémétrie. Il est volontairement STRICT — `vine.number({ strict: true })`
 * refuse toute valeur qui n'est pas déjà un nombre JSON.
 *
 * Sans ce mode, `true` est coercé en `1` par VineJS comme par Mongoose : la trame ressemble alors à
 * une mesure de 1 °C, elle est enregistrée, la surveillance tourne — et aucune excursion n'est
 * jamais détectée. Un capteur qu'on croit surveillé est pire qu'un capteur absent, donc on rejette
 * bruyamment (400) plutôt que d'accepter une valeur devinée.
 *
 * Les bornes ne sont pas cosmétiques : `Infinity` était accepté par Mongoose, enregistré en `null`,
 * et transmis tel quel à la détection — la trace et la décision divergeaient.
 */
export const telemetryPingSchema = vine.object({
  // Aligné sur `equipment.schema.ts` : un capteur enregistrable doit rester émetteur. Une borne
  // plus stricte ici ferait rejeter 100 % des trames d'un matériel pourtant accepté à la création,
  // et le frigo se croirait surveillé en silence.
  sensor_id: vine.string().trim().minLength(1).maxLength(100),
  /**
   * On ne rejette que l'IMPOSSIBLE, pas l'anormal. Une sonde 1-Wire déconnectée renvoie -127 °C,
   * et +85 °C après un reset d'alimentation : ces valeurs doivent être ENREGISTRÉES et déclencher
   * l'alerte de seuil, pas disparaître en 400. Une mesure aberrante est une information sanitaire ;
   * seule une valeur physiquement absurde est une trame corrompue.
   */
  temperature: vine.number({ strict: true }).min(-273.15).max(200),
  humidity: vine.number({ strict: true }).min(0).max(100),
  battery_level: vine.number({ strict: true }).min(0).max(100),
});

export type TelemetryPingPayload = Infer<typeof telemetryPingSchema>;
