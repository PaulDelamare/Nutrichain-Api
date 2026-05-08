/**
 * Formatte une date en une chaîne de caractères.
 *
 * Prend une date en paramètre (peut être un objet Date, un timestamp, ou un string
 * représentant une date) et renvoie une chaîne de caractères formatée comme suit :
 * "jj/mm/aaaa - hhmm".
 *
 * @param date - La date à formater.
 * @return La date formatée.
 */
export const formatDate = (date: string | Date) => {
  date = new Date(date);

  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const day = get('day');
  const month = get('month');
  const year = get('year');
  const hours = get('hour');
  const minutes = get('minute');

  return `${day}/${month}/${year} - ${hours}h${minutes}`;
};
