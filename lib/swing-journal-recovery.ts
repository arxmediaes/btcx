import type {RealEntryEvidence} from './real-journal';
import type {SwingSourceRound} from './swing-normal-source';
import {normalizeRealFills} from './real-learning';
export function missingSwingCopy(round:SwingSourceRound|undefined,entries:RealEntryEvidence[],attempts:Record<string,number>={},now=Date.now()){
 if(!round)return;
 for(const event of Object.values(round.copies||{})){
  if(now-(attempts['copy:'+event.sourceId]||0)<60000)continue;
  if(event.status!=='opened'||event.orderId===undefined)continue;
  if(entries.some(e=>e.sourceSimulationId===event.sourceId||e.symbol===event.symbol&&String(e.orderId)===String(event.orderId)))continue;
  const normal=round.trades.find(t=>t.id===event.sourceId&&t.arm==='normal');
  if(normal&&normal.stop&&normal.target&&normal.leverage)return {event,normal};
 }
}
/** Recover only from a stored real-copy order ID and that order's real entry fills. Never infer from account income. */
export function recoverSwingEntry(copy:NonNullable<ReturnType<typeof missingSwingCopy>>,raw:unknown):RealEntryEvidence{
 const {event,normal}=copy,e=normal.evidence,id=String(event.orderId),side=normal.side===1?'SHORT':'LONG';
 if(typeof event.orderId==='number'&&!Number.isSafeInteger(event.orderId))throw Error('ID real guardado sin precisión; requiere revisión.');
 const fills=normalizeRealFills(raw).filter(f=>f.symbol===event.symbol&&f.orderId===id);
 if(!fills.length||fills.some(f=>f.side!==(side==='LONG'?'BUY':'SELL')||Number(f.realizedPnl)!==0))throw Error('La orden real no confirma una entrada inversa independiente.');
 if(fills.some(f=>f.commissionAsset!=='USDT'||!Number.isFinite(Number(f.commission))))throw Error('Comisión de entrada pendiente de verificar.');
 const quantity=fills.reduce((sum,f)=>sum+Number(f.qty),0),entry=fills.reduce((sum,f)=>sum+Number(f.qty)*Number(f.price),0)/quantity,openedAt=Math.min(...fills.map(f=>f.time));
 if(![quantity,entry,openedAt,normal.stop,normal.target,normal.leverage].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0))throw Error('Ejecuciones de origen incompletas.');
 return {id:`${event.symbol}:${id}`,orderId:id,sourceSimulationId:normal.id,openedAt,engineVersion:'real-swing-inverse-v1-recovered',entryMotor:'swing-inverse',symbol:event.symbol,side,mode:'swing',timeframe:'1h',strategy:normal.strategy,reason:'Entrada inversa recuperada de la copia real guardada '+normal.id,scheduledAt:normal.openedAt,quantity,entry,entryPriceConfirmed:true,plannedStop:normal.target!,plannedTarget:normal.stop!,leverage:normal.leverage!,marginType:'UNKNOWN',takerRate:fills.reduce((sum,f)=>sum+Number(f.commission),0)/(quantity*entry),confluence:0,signalConfirmed:true,pulseSide:e.signalSide,fomo:0,frameAgreement:0,higherAgreement:0,historicalAgreement:0,signalTime:normal.signalTime,candleCount:0,signalClose:e.signalClose??entry,entryDriftATR:(entry-(e.signalClose??entry))/e.atr,indicators:{ema50:e.ema50,ema99:e.ema99,ema200:e.ema200,rsi3:e.rsi,adx5:e.adx,atr:e.atr},frames:[]};
}
