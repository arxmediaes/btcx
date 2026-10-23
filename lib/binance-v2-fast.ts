import {indicators,type Candle} from './engine';
import {createV2Round as createBase,v2Candidate,v2Fund,v2Close,v2Metrics as baseMetrics,type V2Config,type V2Round as BaseRound,type V2Trade as BaseTrade,type V2Market} from './binance-v2';
import {v2NormalChoices} from './binance-v2-normal';
import {v2MaximumSize} from './binance-v2-sizing';
import {crossLossStop} from './real-stop-plan';
import {netTargetDistance,scalpNet} from './real-scalp-sizing';
export type {V2Market,V2Config};
export type V2Trade=BaseTrade&{fastRules?:string;baselineTarget?:number;baselineStop?:number;peakNet?:number;worstNet?:number;lastSpread?:number;exitWindow?:Candle[];fastExitAt?:number;fastExitReason?:string;exitKind?:string;exitRsi?:number;exitVolumeRatio?:number;heldMs?:number;peakCapturedPct?:number};
export type V2Round=Omit<BaseRound,'trades'>&{trades:V2Trade[]};
export const V2_VERSION='binance-v2-normal-fast-1';
export function createV2Round(c:Partial<V2Config>,now=Date.now()):V2Round{return {...createBase(c,now),version:V2_VERSION}}
export function v2Metrics(r:V2Round,arm:'normal'|'inverse'){const metrics=baseMetrics(r,arm),floating=r.trades.filter(t=>t.arm===arm&&t.status==='open').reduce((sum,t)=>sum+fastNet(r,t,t.lastMark??t.entry!),0);return {...metrics,floating,equity:metrics.equity+floating-metrics.floating}}
const round=(n:number,tick:number,up=false)=>Number(((up?Math.ceil(n/tick-1e-8):Math.floor(n/tick+1e-8))*tick).toPrecision(12));
export function fastNet(r:V2Round,t:V2Trade,raw:number,spread=t.lastSpread??t.evidence.spread){const exit=raw*(1-t.side*(r.config.slip+spread/2));return t.side*(exit-t.entry!)*t.qty!-(exit+t.entry!)*t.qty!*r.config.fee+t.funding}
export function fastThresholds(r:V2Round,t:V2Trade){const fees=t.entry!*t.qty!*r.config.fee*2;return {activation:Math.max(.01,fees),floor:Math.max(.003,fees*.2)}}
export function fastExitSignal(bars:Candle[],side:1|-1){
 if(bars.length<21)return null;const a=indicators(bars),last=bars.at(-1)!,previous=bars.at(-2)!,rsi=a.rsi3.at(-1)!,prior=a.rsi3.at(-2)!,mean=bars.slice(-21,-1).reduce((s,b)=>s+b.v,0)/20;
 const volumeRatio=mean>0?last.v/mean:0,opposite=side*(last.c-last.o)<0&&side*(last.c-previous.c)<0,weak=side===1?(prior>=50&&rsi<50)||(prior>=80&&rsi<80):(prior<=50&&rsi>50)||(prior<=20&&rsi>20);
 return {exit:volumeRatio>=1.3&&opposite&&weak,rsi,volumeRatio};
}
function closeFast(r:V2Round,t:V2Trade,raw:number,at:number,kind:string,reason:string,spread=t.evidence.spread){const exit=raw*(1-t.side*(r.config.slip+spread/2));Object.assign(t,{status:'closed',closedAt:at,rawExit:raw,exit,gross:t.side*(exit-t.entry!)*t.qty!,fees:(exit+t.entry!)*t.qty!*r.config.fee,ambiguous:false,exitKind:kind,reason,heldMs:at-t.openedAt!});t.net=t.gross!-t.fees!+t.funding;t.peakNet=Math.max(t.peakNet??t.net,t.net);t.worstNet=Math.min(t.worstNet??t.net,t.net);t.peakCapturedPct=(t.peakNet||0)>0?t.net/t.peakNet!*100:undefined;delete t.exitWindow;delete t.fastExitAt;delete t.fastExitReason}
function recordNet(r:V2Round,t:V2Trade,raw:number,spread=t.evidence.spread){const net=fastNet(r,t,raw,spread);t.peakNet=Math.max(t.peakNet??net,net);t.worstNet=Math.min(t.worstNet??net,net);return net}
export function processV2Market(r:V2Round,m:V2Market,now=Date.now(),discover=true){
 const c=r.config,minutes=m.minutes.filter(b=>b.t+60000<=now).sort((a,b)=>a.t-b.t);
 for(const t of r.trades.filter(t=>t.symbol===m.symbol&&t.status==='pending')){
  const bar=minutes.find(b=>b.t===t.scheduledAt);if(!bar)continue;
  try{const metrics=v2Metrics(r,'normal'),slip=c.slip+t.evidence.spread/2,entry=bar.o*(1+t.side*slip);
   if(metrics.open>=c.maxPositions)throw Error('Cupo completo');
   if(Math.abs((entry-(t.evidence.signalClose||entry))/t.evidence.atr)>1.25)throw Error('La entrada se alejó de la señal normal');
   const sizing=v2MaximumSize({price:entry,available:metrics.equity-metrics.margin,baseMargin:c.baseMargin,boost:c.boost,step:m.step,minimum:m.minimum,minNotional:m.minNotional,fee:c.fee,slip,brackets:m.brackets}),qty=sizing.quantity,stop=crossLossStop(entry,qty,t.side,m.tick,c.boost===50?1:c.boost===20?.65:.5),baselineTarget=round(t.evidence.signalClose!+t.side*t.evidence.legacyTargetDistance,m.tick,t.side===-1);
   if(t.side*(baselineTarget-entry)<=0||scalpNet(qty,entry,baselineTarget,c.fee,slip)<.005)throw Error('El objetivo normal ya no cubre los costes');
   const netGoal=Math.max(.01,sizing.margin*.1),distance=Math.min(Math.abs(baselineTarget-entry),netTargetDistance(qty,entry,t.side,c.fee,slip,netGoal)),target=round(entry+t.side*distance,m.tick,t.side===1);
   if(t.side*(target-baselineTarget)>m.tick*.1||scalpNet(qty,entry,target,c.fee,slip)<.005)throw Error('El tick no deja un TP rápido válido');
   Object.assign(t,{status:'open',openedAt:bar.t,entry,rawEntry:bar.o,qty,stop,target,baselineStop:stop,baselineTarget,margin:sizing.margin,risk:qty*(Math.abs(entry-stop)+(entry+stop)*c.fee+entry*slip),leverage:sizing.leverage,minimumAdjusted:sizing.minimumAdjusted,leverageSource:m.leverageSource,lastBar:bar.t-60000,lastMark:bar.o,filters:{step:m.step,minimum:m.minimum,minNotional:m.minNotional,tick:m.tick},fastRules:'net-profit-rsi-volume-trail-time-v1',reason:'Normal independiente con salida rápida'});
  }catch(e){t.status='skipped';t.reason=e instanceof Error?e.message:'Entrada pendiente de saldo'}
 }
 for(const t of r.trades.filter(t=>t.symbol===m.symbol&&t.status==='open')){
  for(const bar of minutes.filter(b=>b.t>(t.lastBar??0))){
   if(bar.t!==(t.lastBar??0)+60000){t.reason='Faltan velas consecutivas; pendiente de recuperar';break}
   v2Fund(t,m,bar.t);
   if(t.fastExitAt&&bar.t>=t.fastExitAt){closeFast(r,t,bar.o,bar.t,'signal',t.fastExitReason!);break}
   const sl=t.side===1?bar.l<=t.stop!:bar.h>=t.stop!,tp=t.side===1?bar.h>=t.target!:bar.l<=t.target!;t.lastBar=bar.t;t.lastMark=bar.c;
   if(sl||tp){v2Close(r,t,m,bar,sl,tp);t.exitKind=sl?'stop':'target';t.heldMs=t.closedAt!-t.openedAt!;t.peakNet=Math.max(t.peakNet??t.net!,t.net!);t.worstNet=Math.min(t.worstNet??t.net!,t.net!);t.peakCapturedPct=t.peakNet>0?t.net!/t.peakNet*100:undefined;delete t.exitWindow;break}
   const past=(m.frames?.['1m']||[]).filter(b=>b.t<bar.t).slice(-40),stored=(t.exitWindow||[]).filter(b=>b.t<bar.t),combined=[...past,...stored,bar],unique=[...new Map(combined.map(b=>[b.t,b])).values()].sort((a,b)=>a.t-b.t).slice(-41);
   t.exitWindow=unique;const contiguous=unique.length>=21&&unique.slice(1).every((b,i)=>b.t===unique[i].t+60000),indicator=contiguous?fastExitSignal(unique,t.side):null,net=recordNet(r,t,bar.c),limits=fastThresholds(r,t),held=bar.t+60000-t.openedAt!;
   let reason='';if(indicator?.exit&&net>=limits.floor){reason='RSI pierde impulso con volumen contrario, conservando ganancia neta';t.exitRsi=indicator.rsi;t.exitVolumeRatio=indicator.volumeRatio}
   else if(t.peakNet!>=limits.activation&&net<=Math.max(limits.floor,t.peakNet!*.6))reason='Protección: retroceso del 40% de la ganancia neta observada';
   else if(held>=20*60000)reason='Salida por duración máxima de 20 minutos';
   else if(held>=6*60000&&t.peakNet!<limits.activation&&net<=limits.floor)reason='Salida por estancamiento: 6 minutos sin avance neto suficiente';
   if(reason){t.fastExitAt=bar.t+60000;t.fastExitReason=reason}
  }
  // Fresh quotes may close now; they never rewrite earlier bars or backdate a fill.
  if(t.status==='open'&&(t.lastBar??0)>=Math.floor(now/60000)*60000-60000){
   v2Fund(t,m,now);t.lastMark=m.mark;t.lastSpread=m.spread;const net=recordNet(r,t,m.mark,m.spread),limits=fastThresholds(r,t),sl=t.side*(m.mark-t.stop!)<=0,tp=t.side*(m.mark-t.target!)>=0;
   if(sl||tp)closeFast(r,t,m.mark,now,sl?'stop-quote':'target-quote',sl?'Stop alcanzado en cotización observada':'TP rápido alcanzado en cotización observada',m.spread);
   else if(t.fastExitAt&&now>=t.fastExitAt)closeFast(r,t,m.mark,now,'signal-quote',t.fastExitReason!,m.spread);
   else if(t.peakNet!>=limits.activation&&net<=Math.max(limits.floor,t.peakNet!*.6))closeFast(r,t,m.mark,now,'protection-quote','Protección: retroceso del 40% de la ganancia neta observada',m.spread);
  }
 }
 if(!r.running||!discover)return;const last=m.primary.at(-1);if(!last||now-(last.t+180000)>180000)return;
 if(r.trades.some(t=>t.symbol===m.symbol&&['pending','open'].includes(t.status)))return;
 const options=v2NormalChoices(m.primary);r.scanner??={};
 for(const option of options){const key=`normal:${m.symbol}:${option.strategy}`;try{const candidate=option.signal.side?v2Candidate(m,'normal',option.strategy,c):null,reason=candidate?.reason||(!candidate?option.signal.checks.filter(x=>!x.ok).map(x=>x.label).join(' · '):'');r.scanner[key]={arm:'normal',symbol:m.symbol,strategy:option.strategy,time:now,candleTime:last.t,status:!candidate?'no-signal':reason?'filtered':'accepted',reason:reason||'Señal del motor normal'}}catch(e){r.scanner[key]={arm:'normal',symbol:m.symbol,strategy:option.strategy,time:now,candleTime:last.t,status:'filtered',reason:e instanceof Error?e.message:'Estructura pendiente'}}}
 const picked=options[0];if(!picked?.signal.side)return;const key=`normal:${m.symbol}:${picked.strategy}`;if(r.seen[key]===last.t)return;r.seen[key]=last.t;
 let candidate;try{candidate=v2Candidate(m,'normal',picked.strategy,c)}catch{return}if(!candidate)return;
 const metrics=v2Metrics(r,'normal'),unresolved=r.trades.some(t=>t.status==='open'&&(t.lastBar??0)<Math.floor(now/60000)*60000-60000),reason=candidate.reason||(unresolved?'Valoración pendiente':undefined)||(metrics.open+metrics.pending>=c.maxPositions?'Cupo completo':undefined),id=`${r.id}:${key}:${last.t}`;
 r.decisions.push({id:id+':'+now,time:now,arm:'normal',symbol:m.symbol,strategy:picked.strategy,accepted:!reason,reason:reason||'Entrada normal con salidas rápidas',evidence:candidate.evidence});
 if(reason){if(unresolved||reason==='Cupo completo')delete r.seen[key];return}
 r.trades.push({id,arm:'normal',symbol:m.symbol,strategy:picked.strategy,side:candidate.side,signalTime:last.t,scheduledAt:(Math.floor(now/60000)+1)*60000,status:'pending',createdAt:now,plannedStopDistance:candidate.stopDistance,plannedTargetDistance:candidate.targetDistance,funding:0,fundingThrough:0,reason:'Esperando apertura del próximo minuto',evidence:candidate.evidence});
}
