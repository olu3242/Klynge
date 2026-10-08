import type { SessionCalendar, SessionWindow } from "../providers/calendar.ts";
import { addDays, easternDateOf, easternToUtc, weekdayOf, ymd } from "./eastern-time.ts";
import type { LocalDate } from "./eastern-time.ts";
import { NYSE_COVERAGE, NYSE_EARLY_CLOSES, NYSE_HOLIDAYS } from "./holidays.ts";

export type MarketStatus = "OPEN" | "CLOSED" | "EXCLUDED" | "OUTSIDE_COVERAGE";

/** Exchange-aware calendar. `excluded` explains windows the calendar refuses to model (fail closed, never fabricated). */
export interface ExchangeCalendar extends SessionCalendar {
  readonly id: "XNYS" | "CME_EQUITY_INDEX";
  covers(ts: number): boolean;
  status(ts: number): MarketStatus;
  excluded(ts: number): string | null;
}

const inCoverage = (year: number) => year >= NYSE_COVERAGE.fromYear && year <= NYSE_COVERAGE.toYear;

function buildCalendar(id: ExchangeCalendar["id"], sessionForDay: (d: LocalDate) => SessionWindow | null, excludedForDay: (d: LocalDate) => string | null, lookbackDays: number): ExchangeCalendar {
  const dayOf = (ts: number): LocalDate => easternDateOf(ts);
  /** Candidate trading days whose session could contain `ts` (today and, for overnight sessions, tomorrow). */
  const candidates = (ts: number) => [dayOf(ts), addDays(dayOf(ts), 1)];
  const cal: ExchangeCalendar = {
    id,
    covers: (ts) => inCoverage(dayOf(ts).year) && inCoverage(addDays(dayOf(ts), 1).year),
    sessionAt(ts) {
      for (const d of candidates(ts)) {
        if (!inCoverage(d.year)) continue;
        const w = sessionForDay(d);
        if (w && ts >= w.openTimestamp && ts < w.closeTimestamp) return w;
      }
      return null;
    },
    excluded(ts) {
      for (const d of candidates(ts)) {
        if (!inCoverage(d.year)) return "outside calendar coverage";
        const reason = excludedForDay(d);
        if (!reason) continue;
        // Excluded days cover the window the regular session would have occupied.
        const regular = id === "XNYS" ? { openTimestamp: easternToUtc(d, 9, 30), closeTimestamp: easternToUtc(d, 16) } : { openTimestamp: easternToUtc(addDays(d, -1), 18), closeTimestamp: easternToUtc(d, 17) };
        if (ts >= regular.openTimestamp && ts < regular.closeTimestamp) return reason;
      }
      return null;
    },
    status(ts) {
      if (!cal.covers(ts)) return "OUTSIDE_COVERAGE";
      if (cal.sessionAt(ts)) return "OPEN";
      return cal.excluded(ts) ? "EXCLUDED" : "CLOSED";
    },
    sessionsBetween(from, to) {
      const out: SessionWindow[] = [];
      for (let d = addDays(dayOf(from), -1); ; d = addDays(d, 1)) {
        if (inCoverage(d.year)) {
          const w = sessionForDay(d);
          if (w && w.closeTimestamp > from && w.openTimestamp < to) out.push(w);
          if (w && w.openTimestamp >= to) break;
        }
        if (easternToUtc(d, 0) > to + 2 * 86_400_000) break;
      }
      return out;
    },
    recentSessions(now, count) {
      const out: SessionWindow[] = [];
      for (let i = 0, d = addDays(dayOf(now), 1); out.length < count && i < lookbackDays; i++, d = addDays(d, -1)) {
        if (!inCoverage(d.year)) break;
        const w = sessionForDay(d);
        if (w && w.openTimestamp <= now) out.unshift(w);
      }
      return out;
    },
  };
  return cal;
}

/** NYSE regular trading hours: 09:30–16:00 ET (13:00 on early-close days); closed weekends + holidays. */
export function nyseCalendar(): ExchangeCalendar {
  return buildCalendar(
    "XNYS",
    (d) => {
      const wd = weekdayOf(d);
      if (wd === 0 || wd === 6 || NYSE_HOLIDAYS.has(ymd(d))) return null;
      return { openTimestamp: easternToUtc(d, 9, 30), closeTimestamp: easternToUtc(d, NYSE_EARLY_CLOSES.has(ymd(d)) ? 13 : 16) };
    },
    (d) => (NYSE_HOLIDAYS.has(ymd(d)) ? "exchange holiday" : null),
    400,
  );
}

/**
 * CME Globex equity-index futures (e.g. MNQ): trading day D runs 18:00 ET on D−1 to 17:00 ET on D (Mon–Fri), so
 * Monday's session opens Sunday evening and the 17:00–18:00 maintenance halt separates sessions.
 * Holiday trading days (US exchange holidays and early-close days, plus the day after) follow special CME schedules
 * that are NOT encoded here: those sessions are EXCLUDED (bars inside them are dropped with a warning and any
 * evaluation inside them is refused) instead of being modelled with guessed hours.
 */
export function cmeEquityIndexCalendar(): ExchangeCalendar {
  const special = (d: LocalDate) => NYSE_HOLIDAYS.has(ymd(d)) || NYSE_EARLY_CLOSES.has(ymd(d)) || NYSE_HOLIDAYS.has(ymd(addDays(d, -1)));
  return buildCalendar(
    "CME_EQUITY_INDEX",
    (d) => {
      const wd = weekdayOf(d);
      if (wd === 0 || wd === 6 || special(d)) return null;
      return { openTimestamp: easternToUtc(addDays(d, -1), 18), closeTimestamp: easternToUtc(d, 17) };
    },
    (d) => {
      const wd = weekdayOf(d);
      return wd !== 0 && wd !== 6 && special(d) ? "CME holiday schedule not modelled" : null;
    },
    400,
  );
}
