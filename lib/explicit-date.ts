import { isIsoDate } from './integrity.ts';

const months = new Map([
  ['jan', 1], ['january', 1], ['feb', 2], ['february', 2], ['mar', 3], ['march', 3],
  ['apr', 4], ['april', 4], ['may', 5], ['jun', 6], ['june', 6], ['jul', 7], ['july', 7],
  ['aug', 8], ['august', 8], ['sep', 9], ['sept', 9], ['september', 9], ['oct', 10], ['october', 10],
  ['nov', 11], ['november', 11], ['dec', 12], ['december', 12],
]);

/** Convert only a complete, already-read calendar date. Locale and century are never guessed. */
export function explicitIsoDate(value: string): string | undefined {
  const text = value.trim().replace(/\s+/g, ' ');
  const iso = /^(\d{4})([./-])(\d{1,2})\2(\d{1,2})$/.exec(text);
  const numeric = /^(\d{1,2})([./-])(\d{1,2})\2(\d{4})$/.exec(text);
  const dayFirst = /^(\d{1,2})[. /-]*([a-z]+)\.?[, ./-]*(\d{4})$/i.exec(text);
  const monthFirst = /^([a-z]+)\.?[. /-]+(\d{1,2})[, ./-]+(\d{4})$/i.exec(text);
  let year: string | undefined;
  let month: number | undefined;
  let day: number | undefined;
  if (iso) {
    year = iso[1]; month = Number(iso[3]); day = Number(iso[4]);
  } else if (dayFirst && months.has(dayFirst[2].toLowerCase())) {
    year = dayFirst[3]; month = months.get(dayFirst[2].toLowerCase()); day = Number(dayFirst[1]);
  } else if (monthFirst && months.has(monthFirst[1].toLowerCase())) {
    year = monthFirst[3]; month = months.get(monthFirst[1].toLowerCase()); day = Number(monthFirst[2]);
  } else if (numeric) {
    const first = Number(numeric[1]), second = Number(numeric[3]);
    year = numeric[4];
    if (first > 12 && second <= 12) { day = first; month = second; }
    else if (second > 12 && first <= 12) { day = second; month = first; }
  }
  if (!year || !month || !day) return undefined;
  const result = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isIsoDate(result) ? result : undefined;
}
