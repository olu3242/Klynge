/** Deterministic regular-session calendar (explicit epoch-ms windows; no wall clock, no host timezone). */
export interface SessionWindow {
  openTimestamp: number;
  /** Exclusive. */
  closeTimestamp: number;
}

export interface SessionCalendar {
  /** The regular session containing `timestamp`, or null (outside regular hours / closed day). */
  sessionAt(timestamp: number): SessionWindow | null;
  /** Sessions overlapping [from, to), ascending. */
  sessionsBetween(from: number, to: number): SessionWindow[];
  /** The last `count` sessions that have opened at or before `now`, ascending (current session last). */
  recentSessions(now: number, count: number): SessionWindow[];
  /** Exchange calendars: false outside the encoded holiday coverage (callers fail closed). */
  covers?(ts: number): boolean;
  /** Exchange calendars: reason when `ts` falls in a deliberately unmodelled window (e.g. CME holiday schedule). */
  excluded?(ts: number): string | null;
  /** Exchange calendars: market status at `ts`. */
  status?(ts: number): "OPEN" | "CLOSED" | "EXCLUDED" | "OUTSIDE_COVERAGE";
}

/**
 * Fixed-period calendar: sessions of `lengthMs` starting at `anchorOpen + k * periodMs`, optionally skipping
 * indices (closed days). Real venues (DST, holidays) plug in their own SessionCalendar.
 */
export function fixedSessionCalendar(opts: { anchorOpen: number; lengthMs: number; periodMs: number; closedIndices?: readonly number[] }): SessionCalendar {
  const { anchorOpen, lengthMs, periodMs } = opts;
  if (!(lengthMs > 0 && periodMs >= lengthMs)) throw new RangeError("calendar: need 0 < lengthMs <= periodMs");
  const closed = new Set(opts.closedIndices ?? []);
  const at = (k: number): SessionWindow | null => (closed.has(k) ? null : { openTimestamp: anchorOpen + k * periodMs, closeTimestamp: anchorOpen + k * periodMs + lengthMs });
  return {
    sessionAt(ts) {
      const k = Math.floor((ts - anchorOpen) / periodMs);
      const w = at(k);
      return w && ts >= w.openTimestamp && ts < w.closeTimestamp ? w : null;
    },
    sessionsBetween(from, to) {
      const out: SessionWindow[] = [];
      for (let k = Math.floor((from - anchorOpen) / periodMs); anchorOpen + k * periodMs < to; k++) {
        const w = at(k);
        if (w && w.closeTimestamp > from) out.push(w);
      }
      return out;
    },
    recentSessions(now, count) {
      const out: SessionWindow[] = [];
      for (let k = Math.floor((now - anchorOpen) / periodMs); out.length < count && k > -100_000; k--) {
        const w = at(k);
        if (w && w.openTimestamp <= now) out.unshift(w);
      }
      return out;
    },
  };
}
