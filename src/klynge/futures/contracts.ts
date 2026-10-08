import { easternToUtc, nthWeekday } from "../calendar/eastern-time.ts";

/**
 * CME quarterly equity-index futures contracts (MNQ: Micro E-mini Nasdaq-100). Contract months H/M/U/Z; last trading
 * day = 3rd Friday of the contract month (09:30 ET). The ROLL RULE is configuration (verify against CME's published
 * roll calendar): by default the front contract changes `rollDaysBeforeExpiry` calendar days before expiry.
 * Each evaluation uses ONE contract's own bars for its whole window — series are never stitched or back-adjusted,
 * and a different root (NQ) is never accepted for MNQ.
 */
export const QUARTERLY_CODES: Readonly<Record<number, string>> = Object.freeze({ 3: "H", 6: "M", 9: "U", 12: "Z" });

export interface RollRule {
  rollDaysBeforeExpiry: number;
}

export const DEFAULT_ROLL_RULE: Readonly<RollRule> = Object.freeze({ rollDaysBeforeExpiry: 8 });

export interface FuturesContract {
  root: string;
  /** Exchange symbol, e.g. MNQZ6. */
  symbol: string;
  year: number;
  month: number;
  /** Last trading instant (epoch ms). */
  expiry: number;
  /** Instant from which this contract is no longer the front contract. */
  rollAt: number;
}

const DAY = 86_400_000;
const ROOT = /^[A-Z]{2,4}$/;

export function contractFor(root: string, year: number, month: number, rule: RollRule = DEFAULT_ROLL_RULE): FuturesContract {
  if (!ROOT.test(root)) throw new RangeError(`futures: invalid root ${root}`);
  const code = QUARTERLY_CODES[month];
  if (!code) throw new RangeError("futures: equity-index contracts are quarterly (Mar/Jun/Sep/Dec)");
  if (!(rule.rollDaysBeforeExpiry >= 0 && rule.rollDaysBeforeExpiry <= 30)) throw new RangeError("futures: roll rule out of range");
  const expiry = easternToUtc({ year, month, day: nthWeekday(year, month, 5, 3) }, 9, 30);
  return { root, symbol: `${root}${code}${year % 10}`, year, month, expiry, rollAt: expiry - rule.rollDaysBeforeExpiry * DAY };
}

/** The front (active) contract at `ts` under the roll rule. */
export function activeContract(root: string, ts: number, rule: RollRule = DEFAULT_ROLL_RULE): FuturesContract {
  const d = new Date(ts);
  let year = d.getUTCFullYear();
  let month = Math.ceil((d.getUTCMonth() + 1) / 3) * 3;
  for (let i = 0; i < 6; i++) {
    const c = contractFor(root, year, month, rule);
    if (ts < c.rollAt) return c;
    month += 3;
    if (month > 12) {
      month = 3;
      year++;
    }
  }
  throw new RangeError("futures: no active contract found");
}

/** Parse an exchange symbol like MNQZ6 relative to a reference time (single-digit years resolve to the nearest decade). */
export function parseContractSymbol(symbol: string, referenceTs: number): { root: string; year: number; month: number } | null {
  const m = /^([A-Z]{2,4})([HMUZ])(\d)$/.exec(symbol);
  if (!m) return null;
  const month = Number(Object.entries(QUARTERLY_CODES).find(([, c]) => c === m[2])?.[0]);
  const refYear = new Date(referenceTs).getUTCFullYear();
  let year = refYear - (refYear % 10) + Number(m[3]);
  if (year < refYear - 1) year += 10;
  return { root: m[1] as string, year, month };
}
