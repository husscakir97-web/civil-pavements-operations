// Deterministic project financial arithmetic (never model output).
// One definition of every total so dashboards, reports and the project
// workspace can never disagree.
export type ForecastInput={
 originalContract:number;approvedVariations:number;pendingVariations:number;
 originalBudget:number;approvedVariationCost:number;
 actual:number;committed:number;accrued:number;
 claimed:number;certified:number;invoiced:number;paid:number;
};
const r=(n:number)=>Math.round((Number.isFinite(n)?n:0)*100)/100;
export function forecast(i:ForecastInput){
 const currentContract=r(i.originalContract+i.approvedVariations);
 const currentBudget=r(i.originalBudget+i.approvedVariationCost);
 const spent=r(i.actual+i.committed+i.accrued);
 // Cost to complete: the remaining current budget, never negative. When spend
 // already exceeds budget the forecast final cost equals the spend.
 const costToComplete=r(Math.max(0,currentBudget-spent));
 const forecastFinalCost=r(spent+costToComplete);
 const forecastRevenue=currentContract;
 const forecastProfit=r(forecastRevenue-forecastFinalCost);
 const forecastMarginPct=forecastRevenue>0?r(forecastProfit/forecastRevenue*100):null;
 // Earned revenue on a cost-to-date basis (percent complete = incurred / forecast final cost).
 const percentComplete=forecastFinalCost>0?Math.min(1,(i.actual+i.accrued)/forecastFinalCost):0;
 const earnedRevenue=r(currentContract*percentComplete);
 return {currentContract,approvedVariations:r(i.approvedVariations),pendingVariations:r(i.pendingVariations),originalContract:r(i.originalContract),originalBudget:r(i.originalBudget),currentBudget,actual:r(i.actual),committed:r(i.committed),accrued:r(i.accrued),costToComplete,forecastFinalCost,forecastRevenue,forecastProfit,forecastMarginPct,percentComplete:r(percentComplete*100),earnedRevenue,claimed:r(i.claimed),certified:r(i.certified),invoiced:r(i.invoiced),paid:r(i.paid),unbilled:r(Math.max(0,earnedRevenue-i.claimed)),outstanding:r(Math.max(0,i.invoiced-i.paid))};
}
export type Forecast=ReturnType<typeof forecast>;

/** Progress claim line arithmetic: prevents claiming beyond the line value. */
export function claimLine(contractValue:number,previousClaimed:number,thisClaim:number){
 const remaining=r(contractValue-previousClaimed);
 if(thisClaim<0&&-thisClaim>previousClaimed)throw new Error('A negative adjustment cannot exceed the amount previously claimed.');
 if(contractValue>=0&&thisClaim>remaining+0.005)throw new Error(`This claim exceeds the remaining value (${remaining.toFixed(2)}).`);
 return {contractValue:r(contractValue),previousClaimed:r(previousClaimed),thisClaim:r(thisClaim),claimedToDate:r(previousClaimed+thisClaim),remaining:r(remaining-thisClaim)};
}
/**
 * Retention on a progress claim (all amounts ex-GST).
 * withheld = gross × pct, limited so cumulative held retention never exceeds the cap;
 * a release returns previously held retention and can never exceed what is held.
 * net = gross − withheld + released. Negative adjustments withhold nothing.
 */
export type RetentionTerms={enabled:boolean;pct:number;cap:number|null};
export function retention(terms:RetentionTerms,gross:number,heldBefore:number,release=0){
 if(release<0)throw new Error('A retention release cannot be negative.');
 if(release>r(heldBefore)+0.005)throw new Error(`The release exceeds retention held (${r(heldBefore).toFixed(2)}).`);
 let withheld=0;
 if(terms.enabled&&terms.pct>0&&gross>0){
  withheld=r(gross*terms.pct/100);
  if(terms.cap!=null)withheld=r(Math.min(withheld,Math.max(0,terms.cap-heldBefore)));
 }
 const released=r(release);
 return {gross:r(gross),withheld,released,net:r(gross-withheld+released),heldAfter:r(heldBefore+withheld-released)};
}
/** Retention held on a set of claims: certified retention where certified, otherwise the claimed retention, less releases. */
export function retentionHeld(claims:Array<{retentionWithheld:number;certifiedRetention:number|null;retentionReleased:number}>){
 const withheld=r(claims.reduce((s,c)=>s+(c.certifiedRetention??c.retentionWithheld),0));
 const released=r(claims.reduce((s,c)=>s+c.retentionReleased,0));
 return {withheld,released,held:r(withheld-released)};
}
export const gst=(amountExGst:number,ratePct=10)=>{const g=r(amountExGst*ratePct/100);return {amountExGst:r(amountExGst),gst:g,total:r(amountExGst+g)};};

/** Deterministic readiness: percentage of mandatory requirements satisfied. */
export function readinessPercent(items:Array<{mandatory:boolean;ok:boolean}>){
 const mandatory=items.filter(i=>i.mandatory);
 if(!mandatory.length)return null;
 return Math.round(mandatory.filter(i=>i.ok).length/mandatory.length*100);
}
