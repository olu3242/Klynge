import { chartFor } from "./session.ts";
import type { ChartSession } from "./session.ts";
import { isUsable, REQUIRED_FIELDS, REQUIRED_ROLES } from "./types.ts";
import type { ChartRole, ObservationField, Provenance } from "./types.ts";

export interface MissingContextReport {
  charts: { role: ChartRole; present: boolean; symbol: string | null }[];
  fields: { role: ChartRole; field: ObservationField; status: Provenance }[];
  complete: boolean;
  nextSteps: string[];
}

const ROLE_LABEL: Record<ChartRole, string> = { TARGET: "target", SPX: "SPX", MNQ: "MNQ", VOLUME_PROXY: "volume proxy" };

/** Which required charts and fields are still missing or unverified, with concrete next steps. */
export function missingContext(session: ChartSession): MissingContextReport {
  const charts = REQUIRED_ROLES.map((role) => {
    const c = chartFor(session, role);
    return { role, present: c !== undefined, symbol: c && isUsable(c.observation.symbol.status) ? c.observation.symbol.value : null };
  });
  const fields: MissingContextReport["fields"] = [];
  for (const role of REQUIRED_ROLES) {
    const c = chartFor(session, role);
    if (!c) continue;
    for (const field of REQUIRED_FIELDS[role]) {
      const status = c.observation[field].status;
      if (!isUsable(status)) fields.push({ role, field, status });
    }
  }
  const nextSteps = [
    ...charts.filter((c) => !c.present).map((c) => `+ Add ${ROLE_LABEL[c.role]} chart`),
    ...fields.map((f) => `Confirm or correct ${f.field} on the ${ROLE_LABEL[f.role]} chart`),
  ];
  return { charts, fields, complete: charts.every((c) => c.present) && fields.length === 0, nextSteps };
}
