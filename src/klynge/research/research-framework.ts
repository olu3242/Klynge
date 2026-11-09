/** Ten-part Klynge research framework. Deterministic evidence synthesis, NOT trade authorization.
 * BYoC observations must never masquerade as independently verified financial/market data.
 */
export type ResearchSection =
  | "MARKET" | "DIVERSIFICATION" | "RISK" | "TECHNICAL" | "MACRO"
  | "VALUATION" | "SENTIMENT" | "EARNINGS" | "GROWTH_DIVIDENDS" | "WORLD_EVENTS";
export const RESEARCH_SECTIONS: readonly ResearchSection[] = [
  "MARKET","DIVERSIFICATION","RISK","TECHNICAL","MACRO",
  "VALUATION","SENTIMENT","EARNINGS","GROWTH_DIVIDENDS","WORLD_EVENTS"
];
export type ResearchEntry = "BYOT" | "BYOC";
export type EvidenceOrigin = "VERIFIED_DATA" | "CHART_OBSERVATION" | "USER_ASSERTION";
export type ResearchStance = "BULLISH" | "BEARISH" | "NEUTRAL" | "UNKNOWN";
export interface ResearchEvidence {
  section: ResearchSection;
  origin: EvidenceOrigin;
  source: string;
  /** When the information became available, in epoch milliseconds. */
  publishedAt: number;
  /** Source retrieval time; must not precede publication. */
  observedAt: number;
  stance: ResearchStance;
  summary: string;
}
export interface ResearchRequest {
  symbol: string;
  entry: ResearchEntry;
  evaluatedAt: number;
  evidence: readonly ResearchEvidence[];
}
export interface SectionResult {
  section: ResearchSection;
  stance: ResearchStance;
  state: "AVAILABLE" | "MISSING" | "CONFLICTED";
  evidenceCount: number;
  reasons: readonly string[];
}
export interface ResearchReport {
  symbol: string;
  entry: ResearchEntry;
  evaluatedAt: number;
  sections: readonly SectionResult[];
  overall: ResearchStance;
  completeness: number;
  tradePermission: "BLOCKED";
  reasons: readonly string[];
}
export function buildResearchReport(request: ResearchRequest): ResearchReport {
  const {symbol,entry,evaluatedAt,evidence}=request;
  if (!/^[A-Z][A-Z0-9.\-^]{0,19}$/.test(symbol) || !["BYOT","BYOC"].includes(entry) ||
      !Number.isFinite(evaluatedAt) || evaluatedAt<0)
    throw new RangeError("Invalid research identity or evaluation time");
  for (const item of evidence) {
    if (!RESEARCH_SECTIONS.includes(item.section) ||
        !["VERIFIED_DATA","CHART_OBSERVATION","USER_ASSERTION"].includes(item.origin) ||
        !["BULLISH","BEARISH","NEUTRAL","UNKNOWN"].includes(item.stance) ||
        !item.source.trim() || !item.summary.trim() ||
        !Number.isFinite(item.publishedAt) || !Number.isFinite(item.observedAt) ||
        item.publishedAt<0 || item.observedAt<item.publishedAt || item.observedAt>evaluatedAt ||
        item.publishedAt>evaluatedAt)
      throw new RangeError("Invalid, future-dated, or unsourced research evidence");
    if (item.origin==="CHART_OBSERVATION" &&
        !["TECHNICAL","MARKET","SENTIMENT"].includes(item.section))
      throw new RangeError("Chart observation cannot establish financial, macro or portfolio facts");
  }
  const sections:SectionResult[]=RESEARCH_SECTIONS.map(section=>{
    const observations=evidence.filter(x=>x.section===section);
    const verified=observations.filter(x=>x.origin==="VERIFIED_DATA");
    const usable=section==="TECHNICAL" || section==="MARKET" || section==="SENTIMENT" ? observations : verified;
    const stances=new Set(usable.map(x=>x.stance).filter(x=>x!=="UNKNOWN"));
    const state=usable.length===0?"MISSING":stances.size>1?"CONFLICTED":"AVAILABLE";
    const stance:ResearchStance=state!=="AVAILABLE"?"UNKNOWN":stances.size===1?[...stances][0] as ResearchStance:"UNKNOWN";
    return {section,stance,state,evidenceCount:usable.length,reasons:state==="MISSING"
      ?["No eligible evidence available"]:state==="CONFLICTED"?["Conflicting evidence requires analyst review"]:[]};
  });
  const known=sections.filter(x=>x.stance!=="UNKNOWN");
  const bulls=known.filter(x=>x.stance==="BULLISH").length;
  const bears=known.filter(x=>x.stance==="BEARISH").length;
  const overall:ResearchStance=known.length<5?"UNKNOWN":bulls>bears?"BULLISH":bears>bulls?"BEARISH":"NEUTRAL";
  return {symbol,entry,evaluatedAt,sections,overall,completeness:sections.filter(x=>x.state==="AVAILABLE").length/10,
    tradePermission:"BLOCKED",reasons:["Research does not certify an options entry; separate market, risk, execution and strategy gates required"]};
}
