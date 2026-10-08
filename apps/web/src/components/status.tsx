import type { ProvenanceView } from "@/lib/view-model";
import { Badge } from "@/components/ui/badge";

/** Provenance is always glyph + text — never color alone. */
export const PROVENANCE: Record<ProvenanceView, { glyph: string; text: string; tone: "success" | "warning" | "danger" | "neutral" | "lime" }> = {
  DATA_VERIFIED: { glyph: "◆", text: "Data verified", tone: "lime" },
  USER_CONFIRMED: { glyph: "✓✓", text: "Confirmed", tone: "success" },
  OBSERVED: { glyph: "✓", text: "Observed", tone: "success" },
  NOT_VERIFIED: { glyph: "⚠", text: "Not verified", tone: "warning" },
  NOT_VISIBLE: { glyph: "—", text: "Not visible", tone: "neutral" },
  NOT_PROVIDED: { glyph: "○", text: "Not provided", tone: "neutral" },
};

export function ProvenanceBadge({ status }: { status: ProvenanceView }) {
  const p = PROVENANCE[status];
  return (
    <Badge tone={p.tone} data-status={status}>
      <span aria-hidden="true">{p.glyph}</span> {p.text}
    </Badge>
  );
}
