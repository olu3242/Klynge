/**
 * US Eastern time without host timezone data: explicit US DST rule (Energy Policy Act 2005, in force since 2007):
 * DST starts the 2nd Sunday of March at 02:00 local and ends the 1st Sunday of November at 02:00 local.
 * EST = UTC−5, EDT = UTC−4. Deterministic for any year ≥ 2007.
 */
const DAY = 86_400_000;

export interface LocalDate {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
}

/** Day of month of the n-th `weekday` (0 = Sunday) of `month` (1–12). */
export function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

/** UTC instants at which DST starts and ends in `year`. */
export function dstBoundsUtc(year: number): { start: number; end: number } {
  if (year < 2007) throw new RangeError("eastern-time: DST rule implemented for 2007+");
  const startDay = nthWeekday(year, 3, 0, 2);
  const endDay = nthWeekday(year, 11, 0, 1);
  return { start: Date.UTC(year, 2, startDay, 7), end: Date.UTC(year, 10, endDay, 6) };
}

export function easternOffsetMs(utc: number): number {
  const year = new Date(utc).getUTCFullYear();
  const { start, end } = dstBoundsUtc(year);
  return utc >= start && utc < end ? -4 * 3_600_000 : -5 * 3_600_000;
}

/** UTC instant of an Eastern wall-clock time (exchange session times never fall in the DST gap/overlap). */
export function easternToUtc(d: LocalDate, hour: number, minute = 0): number {
  const naive = Date.UTC(d.year, d.month - 1, d.day, hour, minute);
  const guess = naive + 5 * 3_600_000;
  const offset = easternOffsetMs(guess);
  return naive - offset;
}

/** Eastern calendar date of a UTC instant. */
export function easternDateOf(utc: number): LocalDate & { weekday: number; minutes: number } {
  const local = new Date(utc + easternOffsetMs(utc));
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate(), weekday: local.getUTCDay(), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

export const ymd = (d: LocalDate) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

export function addDays(d: LocalDate, n: number): LocalDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day) + n * DAY);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

export const weekdayOf = (d: LocalDate) => new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
