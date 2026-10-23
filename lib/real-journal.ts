// Entry evidence is immutable. Never infer a past strategy from today's chart.
export type RealEntryEvidence = {
  sourceSimulationId?:string;id:string; orderId:number|string; outcome?:import('./real-learning').RealOutcome; openedAt:number; engineVersion:string;
  symbol:string; side:'LONG'|'SHORT'; mode:string; timeframe:string; triggerTimeframe?:string; strategy:string;
  reason:string;entryMotor?:'legacy'|'impulso-rsi'|'swing-inverse';scheduledAt?:number;entryDelayMs?:number;boostPercent?:number;crossLossBudget?:number; plannedNetGoal?:number; sizingMultiplier?:number; quantity:number; entry:number; entryPriceConfirmed:boolean; plannedStop:number; plannedTarget:number;
  leverage:number; marginType:string; takerRate:number;
  confluence:number; signalConfirmed:boolean; pulseSide:number; fomo:number;
  frameAgreement:number; higherAgreement:number; historicalAgreement:number;
  signalTime:number; candleCount:number; signalClose:number; entryDriftATR:number;
  indicators:{ema50:number;ema99:number;ema200:number;rsi3:number;adx5:number;atr:number};
  frames:Array<{tf:string;direction:number;signal:number;rsi3:number;adx5:number;close:number;confidence:number}>;
};

export function appendRealEvidence(rows:RealEntryEvidence[], entry:RealEntryEvidence):RealEntryEvidence[]{
  if(rows.some(row=>row.id===entry.id))return rows;
  return [...rows,entry];
}

export function entryEconomics(entry:Pick<RealEntryEvidence,'entry'|'plannedStop'|'plannedTarget'|'quantity'|'takerRate'>){
  const riskDistance=Math.abs(entry.entry-entry.plannedStop);
  const rewardDistance=Math.abs(entry.plannedTarget-entry.entry);
  const targetFees=entry.quantity*(entry.entry+entry.plannedTarget)*entry.takerRate;
  const stopFees=entry.quantity*(entry.entry+entry.plannedStop)*entry.takerRate;
  const netTarget=rewardDistance*entry.quantity-targetFees;
  const netRisk=riskDistance*entry.quantity+stopFees;
  return {stopPct:riskDistance/entry.entry*100,targetPct:rewardDistance/entry.entry*100,
    netTarget,netRisk,breakEvenWinRate:netTarget>0?netRisk/(netRisk+netTarget)*100:null};
}

export function summarizeRealizedRows(rows:Array<{id:string;realizedPnl:number}>){
  const unique=[...new Map(rows.filter(row=>Number.isFinite(row.realizedPnl)).map(row=>[row.id,row])).values()];
  return {count:unique.length,positive:unique.filter(row=>row.realizedPnl>0).length,
    negative:unique.filter(row=>row.realizedPnl<0).length,zero:unique.filter(row=>row.realizedPnl===0).length,
    gross:unique.reduce((sum,row)=>sum+row.realizedPnl,0)};
}
