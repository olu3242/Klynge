/** Research report presentation contract, shared by BYoT and BYoC.
 * No invented facts, provider calls, order routing or trade permission.
 */
import type { ResearchReport, ResearchSection } from "./research-framework.ts";
export interface ResearchViewSection {
  heading: string;
  status: "AVAILABLE" | "MISSING" | "CONFLICTED";
  direction: string;
  detail: string;
}
const headings:Record<ResearchSection,string>={
  MARKET:"1. Market Analysis",DIVERSIFICATION:"2. Portfolio Diversification",
  RISK:"3. Risk Management",TECHNICAL:"4. Technical Analysis",
  MACRO:"5. Economic Indicators",VALUATION:"6. Value Investing",
  SENTIMENT:"7. Market Sentiment",EARNINGS:"8. Earnings / Results",
  GROWTH_DIVIDENDS:"9. Growth vs Dividend",WORLD_EVENTS:"10. World Events"
};
export function presentResearchReport(report:ResearchReport):readonly ResearchViewSection[] {
 return report.sections.map(section=>({
   heading:headings[section.section],
   status:section.state,
   direction:section.stance,
   detail:section.state==="MISSING"?"Evidence unavailable; do not infer or fabricate":
     section.state==="CONFLICTED"?"Conflicting evidence; analyst review required":
     `${section.evidenceCount} eligible evidence item(s); research only, not an entry signal`
 }));
}
