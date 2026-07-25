import { APIError } from '../errorHandler/APIError';

/**
 * Une DLC est un JOUR, et « à consommer jusqu'au 20/07 » veut dire le 20/07 INCLUS. Les gardes
 * « lot périmé » (expédition, transformation) comparent `date_peremption < new Date()` : ancrée à
 * minuit, une DLC au 20/07 rendrait le lot inexpédiable dès 00h01 ce jour-là — un jour de vie perdu
 * sur CHAQUE lot, et un lot reçu avec une DLC du jour serait mort-né. On ancre donc à la fin de la
 * journée. (Ce n'est pas une question de fuseau : `new Date('2026-07-20')` est déjà parsé en UTC.)
 */
function toEndOfUtcDay(isoDay: string): Date {
  return new Date(`${isoDay}T23:59:59.999Z`);
}

/**
 * `YYYY-MM-DD` bien formé ne veut pas dire jour existant : `2026-02-30` est accepté par le regex,
 * puis Date le REPORTE au 2 mars — une DLC allongée de deux jours, en silence, sur une donnée
 * sanitaire. On exige donc que la date relise à l'identique, et qu'elle ne soit pas déjà passée.
 */
export function parseExpiryDay(isoDay: string): Date {
  const expiry = toEndOfUtcDay(isoDay);

  if (Number.isNaN(expiry.getTime()) || expiry.toISOString().slice(0, 10) !== isoDay) {
    throw new APIError(400, {
      error: [{ field: 'date_peremption', message: `Date de péremption inexistante : ${isoDay}.` }],
    });
  }

  if (expiry.getTime() < Date.now()) {
    throw new APIError(400, {
      error: [{ field: 'date_peremption', message: `Ce lot est déjà périmé (DLC au ${isoDay}).` }],
    });
  }

  return expiry;
}
