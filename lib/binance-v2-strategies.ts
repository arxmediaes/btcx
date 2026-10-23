import {v2MaximumSize,type V2Bracket} from './binance-v2-sizing';
import {Candle,indicators,signal} from './engine';
import {minimumNetTarget} from './binance-v2-capacity';
import {supportedTargetZone} from './real-target-zone';
export type V2Arm='normal'|'inverse';
export type V2Config={capital:number;fee:number;slip:number;baseMargin:number;boost:0|20|50;leverage:number;maxPositions:number;rr:number};
export const V2_DEFAULT:V2Config={capital:10,fee:.0005,slip:.0002,baseMargin:.2,boost:0,leverage:0,maxPositions:15,rr:1.5};
export const V2_VERSION='binance-v2-strategy-forward-2';
export type V2Market={marketSource?:string;brackets:V2Bracket[];leverageSource?:string;symbol:string;observedAt:number;primary:Candle[];context:Candle[];minutes:Candle[];step:number;minimum:number;minNotional:number;tick:number;mark:number;spread:number;funding:{time:number;rate:number;mark:number}[]};
export type V2Evidence={logicRevision?:string;executionRevision?:string;marketSource?:string;signalClose?:number;strategy:string;signalSide:1|-1;signalTime:number;rsi:number;adx:number;atr:number;ema50:number;ema99:number;ema200:number;contextSide:number;contextAdx:number;spread:number;observedAt:number;legacyStopDistance:number;legacyTargetDistance:number};
export type V2Trade={id:string;arm:V2Arm;symbol:string;strategy:string;side:1|-1;signalTime:number;scheduledAt:number;status:'pending'|'open'|'closed'|'skipped';createdAt:number;plannedStopDistance:number;plannedTargetDistance:number;openedAt?:number;closedAt?:number;entry?:number;rawEntry?:number;exit?:number;rawExit?:number;qty?:number;stop?:number;target?:number;margin?:number;risk?:number;leverage?:number;minimumAdjusted?:boolean;maintenanceRate?:number;maintenanceOffset?:number;leverageSource?:string;lastBar?:number;lastMark?:number;funding:number;fundingThrough:number;filters?:{step:number;minimum:number;minNotional:number;tick:number};exitCandle?:Candle;gross?:number;fees?:number;net?:number;mirrorNet?:number;ambiguous?:boolean;reason:string;evidence:V2Evidence};
export type V2Scan={arm:V2Arm;symbol:string;strategy:string;time:number;candleTime:number;status:'no-signal'|'filtered'|'accepted';reason:string};
export type V2Round={historyRefs?:{key:string;kind:'trades'|'decisions';count:number}[];scanner?:Record<string,V2Scan>;schema:1;version:string;id:string;createdAt:number;startedAt:number;running:boolean;config:V2Config;cursor:number;trades:V2Trade[];decisions:{id:string;time:number;arm:V2Arm;symbol:string;strategy:string;accepted:boolean;reason:string;evidence:V2Evidence}[];seen:Record<string,number>;lastTick?:number;lastMarketSource?:string;lastMarketAt?:number;lastError?:string};
const round=(v:number,step:number,up=false)=>Number(((up?Math.ceil(v/step-1e-8):Math.floor(v/step+1e-8))*step).toPrecision(12));
const strategyIds={normal:['rsi','sweep'],inverse:['ema','breakout']};
export function v2Config(raw:Partial<V2Config>):V2Config{
 const c={...V2_DEFAULT,...raw};
 for(const k of Object.keys(V2_DEFAULT) as (keyof V2Config)[])if(!Number.isFinite(c[k]))throw Error('Configuración incompleta.');
 if(c.capital!==10||c.fee<0||c.fee>.005||c.slip<0||c.slip>.01||c.baseMargin!==.2||![0,20,50].includes(c.boost)||c.leverage!==0||!Number.isInteger(c.maxPositions)||c.maxPositions<1||c.maxPositions>15||c.rr<1||c.rr>4)throw Error('V2 usa US$10 por perfil y el máximo confirmado por contrato.');
 return c;
}
export function createV2Round(config:Partial<V2Config>,now=Date.now()):V2Round{return {schema:1,version:V2_VERSION,id:crypto.randomUUID(),createdAt:now,startedAt:now,running:false,config:v2Config(config),cursor:0,trades:[],decisions:[],seen:{}}}
export function v2Metrics(r:V2Round,arm:V2Arm){
 const all=r.trades.filter(t=>t.arm===arm),closed=all.filter(t=>t.status==='closed'),resolved=closed.filter(t=>!t.ambiguous),open=all.filter(t=>t.status==='open'),pending=all.filter(t=>t.status==='pending');
 const pnl=closed.reduce((s,t)=>s+(t.net||0),0),validNet=resolved.reduce((s,t)=>s+(t.net||0),0),floating=open.reduce((s,t)=>s+t.side*((t.lastMark??t.entry!)-t.entry!)*t.qty!-(t.entry!+(t.lastMark??t.entry!))*t.qty!*r.config.fee+t.funding,0);
 let equity=r.config.capital,peak=equity,maxDrawdown=0;for(const t of [...closed].sort((a,b)=>a.closedAt!-b.closedAt!)){equity+=t.net!;peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,peak-equity)}
 const wins=resolved.filter(t=>t.net!>0),losses=resolved.filter(t=>t.net!<0),profit=wins.reduce((s,t)=>s+t.net!,0),loss=-losses.reduce((s,t)=>s+t.net!,0);
 return {closed:closed.length,valid:resolved.length,ambiguous:closed.length-resolved.length,open:open.length,pending:pending.length,pnl,validNet,floating,equity:r.config.capital+pnl+floating,winRate:resolved.length?wins.length/resolved.length*100:null,profitFactor:loss?profit/loss:null,expectancy:resolved.length?validNet/resolved.length:null,fees:closed.reduce((s,t)=>s+(t.fees||0),0),funding:all.reduce((s,t)=>s+t.funding,0),maxDrawdown,margin:open.reduce((s,t)=>s+t.margin!,0),risk:open.reduce((s,t)=>s+t.risk!,0),mirrorNet:resolved.filter(t=>t.arm==='inverse').reduce((s,t)=>s+(t.mirrorNet||0),0)};
}
export function strategySignal(bars:Candle[],strategy:string,arm:V2Arm){
 if(arm!=='normal')return signal(bars,strategy);
 if(bars.length<60)return {side:0 as 1|-1|0,checks:[{label:'60 velas cerradas disponibles',ok:false}]};
 const x=bars.at(-1)!,a=indicators(bars);let long=false,short=false;
 if(strategy==='rsi'){const prev=a.rsi3.at(-2)!,current=a.rsi3.at(-1)!;long=prev<20&&current>=20&&x.c>x.o;short=prev>80&&current<=80&&x.c<x.o}
 else if(strategy==='sweep'){const ten=bars.slice(-11,-1),lo=Math.min(...ten.map(b=>b.l)),hi=Math.max(...ten.map(b=>b.h));long=x.l<lo&&x.c>lo&&x.c>x.o;short=x.h>hi&&x.c<hi&&x.c<x.o}
 return {side:(long?1:short?-1:0) as 1|-1|0,checks:[{label:strategy==='rsi'?'RSI(3) sale de 20/80 y vela confirma recuperación':'Barrido con cierre de recuperación',ok:long||short}]};
}
export function v2Candidate(m:V2Market,arm:V2Arm,strategy:string,config:V2Config):{side:1|-1;stopDistance:number;targetDistance:number;evidence:V2Evidence;reason?:string}|null{
 const bars=m.primary,context=m.context;if(bars.length<210||context.length<210)return null;
 const sig=strategySignal(bars,strategy,arm).side;if(!sig)return null;const a=indicators(bars),b=indicators(context),last=bars.at(-1)!,side=sig,atr=a.atr.at(-1)!,rsi=a.rsi3.at(-1)!,adx=a.adx5.at(-1)!;
 const contextSide=b.e50.at(-1)!>b.e99.at(-1)!?1:-1,contextAdx=b.adx5.at(-1)!,legacyQty=.2*(1+config.boost/100)*Math.max(...m.brackets.map(b=>b.leverage))/last.c,legacyStopDistance=(config.boost===50?1:config.boost===20?.65:.5)/Math.max(round(legacyQty,m.step),round(Math.max(m.minimum,m.minNotional/last.c),m.step,true));
 const structuralDistance=Math.max(atr*.8,last.c*.001,sig===1?last.c-last.l+atr*.15:last.h-last.c+atr*.15),legacyTargetDistance=sig*(supportedTargetZone(bars,last.c,sig,atr,m.tick,context).target-last.c);
 const evidence:V2Evidence={logicRevision:arm==='inverse'?'ema-breakout-forward-v2':'reversal-candle-stop-20261015',marketSource:m.marketSource||'binance-server',signalClose:last.c,strategy,signalSide:sig,signalTime:last.t,rsi,adx,atr,ema50:a.e50.at(-1)!,ema99:a.e99.at(-1)!,ema200:a.e200.at(-1)!,contextSide,contextAdx,spread:m.spread,observedAt:m.observedAt,legacyStopDistance,legacyTargetDistance};
 const normalTargetDistance=Math.max(structuralDistance*config.rr,minimumNetTarget(last.c,last.c-sig*structuralDistance,sig as 1|-1,config.fee,config.slip+m.spread/2,m.tick));
 let reason:string|undefined;if(legacyTargetDistance<=0)reason='Sin recorrido estructural';else if(arm==='normal'&&legacyTargetDistance<normalTargetDistance)reason='El recorrido no cubre riesgo, comisiones y deslizamiento';else if(adx<20)reason='Fuerza insuficiente';else if(m.spread>.001)reason='Spread superior a 0,10%';else if(arm==='normal'&&contextAdx>=25&&contextSide!==sig)reason='Contexto de 15m contrario';else if(arm==='normal'&&(sig===1?rsi>80:rsi<20))reason='Entrada extendida';
 return {side:side as 1|-1,stopDistance:arm==='inverse'?legacyStopDistance:structuralDistance,targetDistance:arm==='inverse'?legacyTargetDistance:normalTargetDistance,evidence,reason};
}
export function v2Fund(t:V2Trade,m:V2Market,through:number){for(const f of m.funding.filter(f=>f.time>t.fundingThrough&&f.time>=t.openedAt!&&f.time<=through)){t.funding+=-t.side*t.qty!*f.mark*f.rate;t.fundingThrough=f.time}}
export function v2Close(r:V2Round,t:V2Trade,m:V2Market,bar:Candle,sl:boolean,tp:boolean){
 const c=r.config,slip=c.slip+t.evidence.spread/2;const raw=sl?(t.side===1?Math.min(bar.o,t.stop!):Math.max(bar.o,t.stop!)):t.target!;
 t.exitCandle=bar;t.status='closed';t.closedAt=bar.t+60000;t.rawExit=raw;t.exit=raw*(1-t.side*slip);t.gross=t.side*(t.exit-t.entry!)*t.qty!;t.fees=(t.entry!+t.exit)*t.qty!*c.fee;t.net=t.gross-t.fees+t.funding;t.ambiguous=sl&&tp;t.reason=sl&&tp?'SL y TP en la misma vela: SL conservador; excluida de la comparación válida':sl?'Stop simulado':'Objetivo simulado';

}
export function processV2Market(r:V2Round,m:V2Market,now=Date.now(),discover=true){
 const c=r.config,minutes=m.minutes.filter(b=>b.t+60000<=now).sort((a,b)=>a.t-b.t);
 // Replay only candles after the scheduled next-minute entry. The signal was already fixed.
 for(const t of r.trades.filter(t=>t.symbol===m.symbol&&['pending','open'].includes(t.status))){
  if(t.status==='pending'){
   const bar=minutes.find(b=>b.t===t.scheduledAt);if(!bar)continue;
   const metrics=v2Metrics(r,t.arm),fillSlip=c.slip+t.evidence.spread/2,entry=bar.o*(1+t.side*fillSlip),candidateStop=t.evidence.legacyTargetDistance,candidateTarget=t.evidence.legacyStopDistance;
   const stopDistance=t.arm==='inverse'?candidateTarget:t.plannedStopDistance,targetDistance=t.arm==='inverse'?candidateStop:t.plannedTargetDistance;
   const stop=round(entry-t.side*stopDistance,m.tick,t.side===-1),netDistance=t.arm==='normal'?Math.max(targetDistance,minimumNetTarget(entry,stop,t.side,c.fee,fillSlip,m.tick)):targetDistance,target=round(entry+t.side*netDistance,m.tick,t.side===-1);
   const available=Math.max(0,metrics.equity-metrics.margin);
   let sizing:ReturnType<typeof v2MaximumSize>;
   try{sizing=v2MaximumSize({price:entry,available,baseMargin:c.baseMargin,boost:c.boost,step:m.step,minimum:m.minimum,minNotional:m.minNotional,fee:c.fee,slip:fillSlip,brackets:m.brackets})}catch(e){t.status='skipped';t.reason=e instanceof Error?e.message:'Saldo insuficiente';r.scanner??={};r.scanner[`${t.arm}:${m.symbol}:${t.strategy}`]={arm:t.arm,symbol:m.symbol,strategy:t.strategy,time:now,candleTime:t.signalTime,status:'filtered',reason:t.reason};continue}
   const quantity=sizing.quantity,margin=sizing.margin,risk=quantity*(Math.abs(entry-stop)+(entry+stop)*c.fee+entry*fillSlip),reward=quantity*(Math.abs(target-entry)-(entry+target)*c.fee-entry*fillSlip);
   let failure='';if(t.side*(entry-stop)<=0||t.side*(target-entry)<=0||stop<=0||target<=0)failure='Niveles inválidos';else if(t.arm==='normal'&&t.side*(target-((t.evidence.signalClose??entry)+t.evidence.signalSide*t.evidence.legacyTargetDistance))>m.tick*.1)failure='El objetivo neto supera el soporte o resistencia disponible';else if(t.arm==='normal'&&reward/risk<1)failure='Beneficio/riesgo neto inferior a 1 tras costes';else if(t.arm==='inverse'&&reward<.005)failure='Objetivo EMA/rupturas inferior a US$0,005 netos tras costes';else if(metrics.open>=c.maxPositions)failure='Cupo completo';

   if(failure){t.status='skipped';t.reason=failure;r.scanner??={};r.scanner[`${t.arm}:${m.symbol}:${t.strategy}`]={arm:t.arm,symbol:m.symbol,strategy:t.strategy,time:now,candleTime:t.signalTime,status:'filtered',reason:failure};r.decisions.push({id:t.id+':execution',time:now,arm:t.arm,symbol:m.symbol,strategy:t.strategy,accepted:false,reason:failure,evidence:t.evidence});continue}
   t.evidence.executionRevision=t.arm==='inverse'?'forward-levels-v2':'net-target-20261015';
   t.filters={step:m.step,minimum:m.minimum,minNotional:m.minNotional,tick:m.tick};
   Object.assign(t,{leverage:sizing.leverage,minimumAdjusted:sizing.minimumAdjusted,maintenanceRate:sizing.maintenanceRate,maintenanceOffset:sizing.maintenanceOffset,leverageSource:m.leverageSource||'account-server',status:'open',openedAt:bar.t,entry,rawEntry:bar.o,qty:quantity,stop,target,margin,risk,lastBar:bar.t-60000,lastMark:entry,reason:'Simulación activa'});
  }
  for(const bar of minutes.filter(b=>b.t>(t.lastBar??0))){
   if(bar.t!==(t.lastBar??0)+60000){t.reason='Faltan velas consecutivas; pendiente de recuperar';break}
   const sl=t.side===1?bar.l<=t.stop!:bar.h>=t.stop!,tp=t.side===1?bar.h>=t.target!:bar.l<=t.target!;
   // Funding inside an exit candle has unknown event ordering: retain the conservative cost.
   v2Fund(t,m,bar.t);t.lastBar=bar.t;t.lastMark=bar.c;
   if(sl||tp){v2Close(r,t,m,bar,sl,tp);break}
  }
  if(t.status==='open'&&(t.lastBar??0)>=Math.floor(now/60000)*60000-60000)t.lastMark=m.mark;
 }
 if(!r.running||!discover)return;
 const last=m.primary.at(-1);if(!last||now-(last.t+180000)>180000)return;
 for(const arm of ['normal','inverse'] as const){
  if(r.trades.some(t=>t.arm===arm&&t.symbol===m.symbol&&['pending','open'].includes(t.status)))continue;

  for(const strategy of strategyIds[arm]){
   const key=`${arm}:${m.symbol}:${strategy}`;if(r.seen[key]===last.t){r.scanner??={};if(!r.scanner[key]){const checks=strategySignal(m.primary,strategy,arm);r.scanner[key]={arm,symbol:m.symbol,strategy,time:now,candleTime:last.t,status:checks.side?'filtered':'no-signal',reason:checks.side?'Vela ya evaluada; esperando un nuevo cierre':checks.checks.filter(check=>!check.ok).map(check=>check.label).join(' · ')||'Sin señal al cierre de esta vela'}}continue;}r.seen[key]=last.t;
   let candidate:ReturnType<typeof v2Candidate>;r.scanner??={};
   try{candidate=v2Candidate(m,arm,strategy,c)}catch(e){r.scanner[key]={arm,symbol:m.symbol,strategy,time:now,candleTime:last.t,status:'filtered',reason:e instanceof Error?e.message:'Estructura pendiente'};continue;}if(!candidate){const checks=strategySignal(m.primary,strategy,arm).checks;r.scanner[key]={arm,symbol:m.symbol,strategy,time:now,candleTime:last.t,status:'no-signal',reason:checks.filter(check=>!check.ok).map(check=>check.label).join(' · ')||'Sin señal al cierre de esta vela'};continue;}
   const unresolved=r.trades.some(t=>t.arm===arm&&t.status==='open'&&(t.lastBar??0)<Math.floor(now/60000)*60000-60000);
   const metrics=v2Metrics(r,arm),reason=candidate.reason||(unresolved?'Valoración o velas pendientes en el perfil':undefined)||(metrics.open+metrics.pending>=c.maxPositions?'Cupo reservado completo':undefined);
   r.scanner[key]={arm,symbol:m.symbol,strategy,time:now,candleTime:last.t,status:reason?'filtered':'accepted',reason:reason||'Señal aceptada; pendiente del siguiente minuto'};
   const id=`${r.id}:${key}:${last.t}`,evidence=candidate.evidence;
   r.decisions.push({id:id+':evaluation:'+now,time:now,arm,symbol:m.symbol,strategy,accepted:!reason,reason:reason||'Señal aceptada; entrada al abrir el siguiente minuto',evidence});
   if(reason){if(unresolved||metrics.open+metrics.pending>=c.maxPositions)delete r.seen[key];continue;}
   r.trades.push({id,arm,symbol:m.symbol,strategy,side:candidate.side,signalTime:last.t,scheduledAt:(Math.floor(now/60000)+1)*60000,status:'pending',createdAt:now,plannedStopDistance:candidate.stopDistance,plannedTargetDistance:candidate.targetDistance,funding:0,fundingThrough:0,reason:'Esperando apertura del siguiente minuto',evidence});break;
  }
 }
}
