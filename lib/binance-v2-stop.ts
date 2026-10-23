import {createV2Round as createBase,v2Candidate,v2Metrics,v2Fund,v2Close,type V2Round as BaseRound,type V2Trade as BaseTrade,type V2Config,type V2Market,type V2Arm} from './binance-v3';
import {v2NormalChoices} from './binance-v2-normal';
import {v2MaximumSize} from './binance-v2-sizing';
import {crossLossStop} from './real-stop-plan';
import {netAt} from './paper-bracket-math';
export type {V2Config,V2Market,V2Arm};
export type V2Trade=BaseTrade&{pairId?:string;stopBudget?:number};
export type V2Round=Omit<BaseRound,'trades'>&{trades:V2Trade[]};
export {v2Metrics};
export const V2_VERSION='binance-v4-paired-stops-1';
export function stopBudget(arm:V2Arm,boost:0|20|50){return arm==='normal'?(boost===50?1:boost===20?.65:.5):.2*(1+boost/100)}
export function createV2Round(config:Partial<V2Config>,now=Date.now()):V2Round{return {...createBase(config,now),version:V2_VERSION}}
export function processV2Market(r:V2Round,m:V2Market,now=Date.now(),discover=true){
 const c=r.config,minutes=m.minutes.filter(b=>b.t+60000<=now).sort((a,b)=>a.t-b.t);
 for(const normal of r.trades.filter(t=>t.symbol===m.symbol&&t.arm==='normal'&&t.status==='pending')){
  const tight=r.trades.find(t=>t.pairId===normal.pairId&&t.arm==='inverse');if(!tight||tight.status!=='pending')throw Error('Pareja de stops incompleta');
  const bar=minutes.find(b=>b.t===normal.scheduledAt);if(!bar)continue;
  try{
   const a=v2Metrics(r,'normal'),b=v2Metrics(r,'inverse'),slip=c.slip+normal.evidence.spread/2,entry=bar.o*(1+normal.side*slip);
   if(Math.max(a.open,b.open)>=c.maxPositions)throw Error('Cupo completo de parejas');
   const size=v2MaximumSize({price:entry,available:Math.min(a.equity-a.margin,b.equity-b.margin),baseMargin:c.baseMargin,boost:c.boost,step:m.step,minimum:m.minimum,minNotional:m.minNotional,fee:c.fee,slip,brackets:m.brackets});
   const target=Number(((normal.side===-1?Math.ceil(normal.evidence.plannedTarget!/m.tick-1e-8):Math.floor(normal.evidence.plannedTarget!/m.tick+1e-8))*m.tick).toPrecision(12));
   if(!Number.isFinite(target)||normal.side*(target-entry)<=0||Math.abs(entry-normal.evidence.signalClose!)/normal.evidence.atr>1.25)throw Error('La apertura ya no respeta la señal y el TP originales');
   if(netAt(entry,target,normal.side,c.fee,slip)*size.quantity<.005)throw Error('El TP no deja US$0,005 netos');
   // Validate both brackets before mutating either leg: paired admissions are atomic.
   const stops=[normal,tight].map(t=>crossLossStop(entry,size.quantity,t.side,m.tick,stopBudget(t.arm,c.boost)));
   for(const [index,t] of [normal,tight].entries())Object.assign(t,{status:'open',openedAt:bar.t,entry,rawEntry:bar.o,qty:size.quantity,leverage:size.leverage,margin:size.margin,minimumAdjusted:size.minimumAdjusted,maintenanceRate:size.maintenanceRate,maintenanceOffset:size.maintenanceOffset,leverageSource:m.leverageSource,stop:stops[index],stopBudget:stopBudget(t.arm,c.boost),target,risk:-size.quantity*netAt(entry,stops[index],t.side,c.fee,slip),lastBar:bar.t-60000,lastMark:entry,filters:{step:m.step,minimum:m.minimum,minNotional:m.minNotional,tick:m.tick},evidence:{...t.evidence,profile:t.arm==='normal'?'SL original':'SL corto',executionRevision:V2_VERSION,plannedStop:stops[index],plannedTarget:target},reason:'Misma entrada y TP; solo cambia el SL'});
  }catch(error){const reason=error instanceof Error?error.message:'No se pudo ejecutar la pareja';for(const t of [normal,tight]){t.status='skipped';t.reason=reason}r.decisions.push({id:normal.id+':execution',time:now,arm:'normal',symbol:m.symbol,strategy:normal.strategy,accepted:false,reason,evidence:normal.evidence})}
 }
 for(const t of r.trades.filter(t=>t.symbol===m.symbol&&t.status==='open')){
  for(const bar of minutes.filter(b=>b.t>(t.lastBar??0))){
   if(bar.t!==(t.lastBar??0)+60000){t.reason='Faltan velas consecutivas; pendiente de recuperar';break}
   const sl=t.side===1?bar.l<=t.stop!:bar.h>=t.stop!,tp=t.side===1?bar.h>=t.target!:bar.l<=t.target!;
   v2Fund(t,m,bar.t);t.lastBar=bar.t;t.lastMark=bar.c;
   const observed=netAt(t.entry!,bar.c,t.side,c.fee,c.slip+t.evidence.spread/2)*t.qty!+t.funding;t.peakNet=Math.max(t.peakNet??observed,observed);t.worstNet=Math.min(t.worstNet??observed,observed);
   if(sl||tp){v2Close(r,t,m,bar,sl,tp);break}
  }
  if(t.status==='open'&&(t.lastBar??0)>=Math.floor(now/60000)*60000-60000)t.lastMark=m.mark;
 }
 if(!r.running||!discover)return;
 const last=m.primary.at(-1);if(!last||now-(last.t+180000)>180000||r.trades.some(t=>t.symbol===m.symbol&&['pending','open'].includes(t.status)))return;
 r.scanner??={};
 for(const option of v2NormalChoices(m.primary).filter(x=>['adx','rsi'].includes(x.strategy))){
  const key=`normal:${m.symbol}:${option.strategy}`;if(r.seen[key]===last.t)continue;
  const candidate=option.signal.side?v2Candidate(m,'normal',option.strategy,c):null;
  const a=v2Metrics(r,'normal'),b=v2Metrics(r,'inverse'),unresolved=r.trades.some(t=>t.status==='open'&&(t.lastBar??0)<Math.floor(now/60000)*60000-60000);
  const reason=candidate?.reason||(!candidate?'Sin señal de impulso o RSI':unresolved?'Valoración pendiente':Math.max(a.open+a.pending,b.open+b.pending)>=c.maxPositions?'Cupo de parejas completo':'');
  r.scanner[key]={arm:'normal',symbol:m.symbol,strategy:option.strategy,time:now,candleTime:last.t,status:!candidate?'no-signal':reason?'filtered':'accepted',reason:reason||'Entrada común aceptada'};
  if(!candidate)continue;
  if(r.seen[key+':evaluated']!==last.t){r.decisions.push({id:`${r.id}:${key}:${last.t}`,time:now,arm:'normal',symbol:m.symbol,strategy:option.strategy,accepted:!reason,reason:reason||'SL original frente a SL corto; entrada idéntica',evidence:candidate.evidence});r.seen[key+':evaluated']=last.t}
  if(reason)continue;r.seen[key]=last.t;
  const pairId=`${r.id}:${m.symbol}:${option.strategy}:${last.t}`;
  for(const arm of ['normal','inverse'] as const)r.trades.push({pairId,id:pairId+':'+arm,arm,symbol:m.symbol,strategy:option.strategy,side:candidate.side,signalTime:last.t,scheduledAt:(Math.floor(now/60000)+1)*60000,status:'pending',createdAt:now,plannedStopDistance:candidate.stopDistance,plannedTargetDistance:candidate.targetDistance,funding:0,fundingThrough:0,reason:'Entrada común del siguiente minuto',evidence:{...candidate.evidence,logicRevision:V2_VERSION}});
  break;
 }
}
export function stopPairs(r:V2Round){const pairs=r.trades.filter(t=>t.arm==='normal').map(a=>({a,b:r.trades.find(b=>b.pairId===a.pairId&&b.arm==='inverse')})),closed=pairs.filter(p=>p.a.status==='closed'&&p.b?.status==='closed'),valid=closed.filter(p=>!p.a.ambiguous&&!p.b!.ambiguous);return {total:pairs.length,complete:closed.length,valid:valid.length,delta:valid.reduce((sum,p)=>sum+p.b!.net!-p.a.net!,0),tightWins:valid.filter(p=>p.b!.net!>p.a.net!+1e-9).length,originalWins:valid.filter(p=>p.a.net!>p.b!.net!+1e-9).length,ties:valid.filter(p=>Math.abs(p.a.net!-p.b!.net!)<=1e-9).length}}
