import { test } from "node:test";
import assert from "node:assert/strict";
import { buildResearchReport, RESEARCH_SECTIONS, type ResearchEvidence } from "./research-framework.ts";
const t=1000000;
const item=(section:ResearchEvidence["section"],stance:ResearchEvidence["stance"],origin:ResearchEvidence["origin"]="VERIFIED_DATA"):ResearchEvidence=>
  ({section,stance,origin,source:"verified-fixture",publishedAt:t-10,observedAt:t-5,summary:"Fixture evidence"});
test("ten sections exist and missing evidence is explicitly unknown",()=>{
  const r=buildResearchReport({symbol:"SNDK",entry:"BYOT",evaluatedAt:t,evidence:[]});
  assert.equal(r.sections.length,10); assert.equal(r.completeness,0);
  assert.equal(r.overall,"UNKNOWN"); assert.equal(r.tradePermission,"BLOCKED");
});
test("chart-only technical observation never becomes earnings evidence",()=>{
  const r=buildResearchReport({symbol:"NVDA",entry:"BYOC",evaluatedAt:t,evidence:[item("TECHNICAL","BEARISH","CHART_OBSERVATION")]});
  assert.equal(r.sections.find(s=>s.section==="TECHNICAL")?.stance,"BEARISH");
  assert.equal(r.sections.find(s=>s.section==="EARNINGS")?.state,"MISSING");
  assert.equal(r.overall,"UNKNOWN");
  assert.throws(()=>buildResearchReport({symbol:"NVDA",entry:"BYOC",evaluatedAt:t,evidence:[item("EARNINGS","BULLISH","CHART_OBSERVATION")]}));
});
test("conflicting research evidence remains unclassified",()=>{
  const r=buildResearchReport({symbol:"SNDK",entry:"BYOT",evaluatedAt:t,evidence:[item("MARKET","BULLISH"),item("MARKET","BEARISH")]});
  assert.equal(r.sections[0]?.state,"CONFLICTED");assert.equal(r.sections[0]?.stance,"UNKNOWN");
});
test("future evidence and invalid symbols fail closed",()=>{
  assert.throws(()=>buildResearchReport({symbol:"SNDK",entry:"BYOT",evaluatedAt:t,evidence:[{...item("EARNINGS","BULLISH"),publishedAt:t+1,observedAt:t+1}]}));
  assert.throws(()=>buildResearchReport({symbol:"",entry:"BYOT",evaluatedAt:t,evidence:[]}));
});
test("complete verified research gives outlook, not trade permission",()=>{
 const r=buildResearchReport({symbol:"SNDK",entry:"BYOT",evaluatedAt:t,evidence:RESEARCH_SECTIONS.map(s=>item(s,"BULLISH"))});
 assert.equal(r.completeness,1);assert.equal(r.overall,"BULLISH");assert.equal(r.tradePermission,"BLOCKED");
});
