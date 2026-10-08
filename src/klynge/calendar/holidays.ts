/**
 * Exchange holiday configuration. Encoded from the published NYSE holiday & early-close schedule; it is
 * CONFIGURATION, not engine logic, and must be re-verified against the official exchange calendar every year
 * before production use. Outside COVERAGE the calendars fail closed (no sessions are fabricated).
 */
export const NYSE_COVERAGE = Object.freeze({ fromYear: 2025, toYear: 2027 });

/** Full-day closures (YYYY-MM-DD, Eastern). */
export const NYSE_HOLIDAYS: ReadonlySet<string> = new Set([
  // 2025
  "2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

/** Early closes at 13:00 Eastern. */
export const NYSE_EARLY_CLOSES: ReadonlySet<string> = new Set(["2025-07-03", "2025-11-28", "2025-12-24", "2026-11-27", "2026-12-24", "2027-11-26"]);
