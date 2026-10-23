import {v2MaximumSize,type V2Bracket} from './binance-v2-sizing';
import {Candle,indicators,signal} from './engine';
import {v2NormalChoices,v2NormalGate} from './binance-v2-normal';
import {crossLossStop} from './real-stop-plan';
import {scalpNet} from './real-scalp-sizing';
import {supportedTargetZone} from './real-target-zone';
export type V2Arm='normal'|'inverse';
export type V2Config={capital:number;fee:number;slip:number;baseMargin:number;boost:0|20|50;leverage:number;maxPositions:number;rr:number};
export const V2_DEFAULT:V2Config={capital:10,fee:.0005,slip:.0002,baseMargin:.2,boost:0,leverage:0,maxPositions:15,rr:1.5};
export const V2_VERSION='binance-v2-paired-normal-3';
export type V2Market={frames?:Record<string,Candle[]>;marketSource?:string;brackets:V2Bracket[];leverageSource?:string;symbol:string;observedAt:number;primary:Candle[];context:Candle[];minutes:Candle[];step:number;minimum:number;minNotional:number;tick:number;mark:number;spread:number;funding:{time:number;rate:number;mark:number}[]};
export type V2Evidence={normalConfluence?:number;normalFrames?:{tf:string;direction:number;signal:number;rsi3:number;adx5:number;confidence:number}[];marketSource?:string;signalClose?:number;strategy:string;signalSide:1|-1;signalTime:number;rsi:number;adx:number;atr:number;ema50:number;ema99:number;ema200:number;contextSide:number;contextAdx:number;spread:number;observedAt:number;legacyStopDistance:number;legacyTargetDistance:number};
export type V2Trade={pairId?:string;id:string;arm:V2Arm;symbol:string;strategy:string;side:1|-1;signalTime:number;scheduledAt:number;status:'pending'|'open'|'closed'|'skipped';createdAt:number;plannedStopDistance:number;plannedTargetDistance:number;openedAt?:number;closedAt?:number;entry?:number;rawEntry?:number;exit?:number;rawExit?:number;qty?:number;stop?:number;target?:number;margin?:number;risk?:number;leverage?:number;minimumAdjusted?:boolean;maintenanceRate?:number;maintenanceOffset?:number;leverageSource?:string;lastBar?:number;lastMark?:number;funding:number;fundingThrough:number;filters?:{step:number;minimum:number;minNotional:number;tick:number};exitCandle?:Candle;gross?:number;fees?:number;net?:number;ambiguous?:boolean;reason:string;evidence:V2Evidence};
export type V2Scan={arm:V2Arm;symbol:string;strategy:string;time:number;candleTime:number;status:'no-signal'|'filtered'|'accepted';reason:string};
export type V2Round={historyRefs?:{key:string;kind:'trades'|'decisions';count:number}[];scanner?:Record<string,V2Scan>;schema:1;version:string;id:string;createdAt:number;startedAt:number;running:boolean;config:V2Config;cursor:number;trades:V2Trade[];decisions:{id:string;time:number;arm:V2Arm;symbol:string;strategy:string;accepted:boolean;reason:string;evidence:V2Evidence}[];seen:Record<string,number>;lastTick?:number;lastMarketSource?:string;lastMarketAt?:number;lastError?:string};
const round=(v:number,step:number,up=false)=>Number(((up?Math.ceil(v/step-1e-8):Math.floor(v/step+1e-8))*step).toPrecision(12));

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
 return {closed:closed.length,valid:resolved.length,ambiguous:closed.length-resolved.length,open:open.length,pending:pending.length,pnl,validNet,floating,equity:r.config.capital+pnl+floating,winRate:resolved.length?wins.length/resolved.length*100:null,profitFactor:loss?profit/loss:null,expectancy:resolved.length?validNet/resolved.length:null,fees:closed.reduce((s,t)=>s+(t.fees||0),0),funding:all.reduce((s,t)=>s+t.funding,0),maxDrawdown,margin:open.reduce((s,t)=>s+t.margin!,0),risk:open.reduce((s,t)=>s+t.risk!,0)};
}
export function v2Candidate(m:V2Market,arm:V2Arm,strategy:string,config:V2Config):{side:1|-1;stopDistance:number;targetDistance:number;evidence:V2Evidence;reason?:string}|null{
 const bars=m.primary,context=m.context;if(bars.length<210||context.length<210)return null;
 const sig=signal(bars,strategy).side;if(!sig)return null;const a=indicators(bars),b=indicators(context),last=bars.at(-1)!,side=arm==='inverse'?-sig:sig,atr=a.atr.at(-1)!,rsi=a.rsi3.at(-1)!,adx=a.adx5.at(-1)!;
 const contextSide=b.e50.at(-1)!>b.e99.at(-1)!?1:-1,contextAdx=b.adx5.at(-1)!,legacyQty=.2*(1+config.boost/100)*Math.max(...m.brackets.map(b=>b.leverage))/last.c,legacyStopDistance=(config.boost===50?1:config.boost===20?.65:.5)/Math.max(round(legacyQty,m.step),round(Math.max(m.minimum,m.minNotional/last.c),m.step,true));
 const recent=bars.slice(-6,-1),structuralDistance=Math.max(atr*.8,last.c*.001,sig===1?last.c-Math.min(...recent.map(x=>x.l))+atr*.15:Math.max(...recent.map(x=>x.h))-last.c+atr*.15),legacyTargetDistance=sig*(supportedTargetZone(bars,last.c,sig,atr,m.tick,context).target-last.c);
 const evidence:V2Evidence={marketSource:m.marketSource||'binance-server',signalClose:last.c,strategy,signalSide:sig,signalTime:last.t,rsi,adx,atr,ema50:a.e50.at(-1)!,ema99:a.e99.at(-1)!,ema200:a.e200.at(-1)!,contextSide,contextAdx,spread:m.spread,observedAt:m.observedAt,legacyStopDistance,legacyTargetDistance};
 const gate=v2NormalGate(bars,context,m.frames,strategy,sig as 1|-1);
 evidence.normalConfluence=gate.confluence;evidence.normalFrames=gate.frames;
 const reason=!gate.accepted?gate.reason:legacyTargetDistance<=0?'Sin recorrido estructural':m.spread>.001?'Spread superior a 0,10%':undefined;
 return {side:sig as 1|-1,stopDistance:legacyStopDistance,targetDistance:legacyTargetDistance,evidence,reason};
}
export function v2Fund(t:V2Trade,m:V2Market,through:number){for(const f of m.funding.filter(f=>f.time>t.fundingThrough&&f.time>=t.openedAt!&&f.time<=through)){t.funding+=-t.side*t.qty!*f.mark*f.rate;t.fundingThrough=f.time}}
export function v2Close(r:V2Round,t:V2Trade,m:V2Market,bar:Candle,sl:boolean,tp:boolean){
 const c=r.config,slip=c.slip+t.evidence.spread/2;const raw=sl?(t.side===1?Math.min(bar.o,t.stop!):Math.max(bar.o,t.stop!)):(t.side===1?Math.max(bar.o,t.target!):Math.min(bar.o,t.target!));
 t.exitCandle=bar;t.status='closed';t.closedAt=bar.t+60000;t.rawExit=raw;t.exit=raw*(1-t.side*slip);t.gross=t.side*(t.exit-t.entry!)*t.qty!;t.fees=(t.entry!+t.exit)*t.qty!*c.fee;t.net=t.gross-t.fees+t.funding;t.ambiguous=sl&&tp;t.reason=sl&&tp?'SL y TP en la misma vela: SL conservador; excluida de la comparación válida':sl?'Stop simulado':'Objetivo simulado';

}
export function processV2Market(r:V2Round,m:V2Market,now=Date.now(),discover=true){
 const c=r.config,minutes=m.minutes.filter(b=>b.t+60000<=now).sort((a,b)=>a.t-b.t);
 // A single normal decision opens both legs atomically, with identical quantity and barriers.
 for(const normal of r.trades.filter(t=>t.symbol===m.symbol&&t.arm==='normal'&&t.status==='pending')){
  const inverse=r.trades.find(t=>t.pairId===normal.pairId&&t.arm==='inverse');if(!inverse||inverse.status!=='pending')throw Error('Pareja incompleta; no se abrió ningún lado');
  const bar=minutes.find(b=>b.t===normal.scheduledAt);if(!bar)continue;
  try{
   const slip=c.slip+normal.evidence.spread/2,entry=bar.o*(1+normal.side*slip),oppositeEntry=bar.o*(1-normal.side*slip),a=v2Metrics(r,'normal'),b=v2Metrics(r,'inverse');
   if(Math.max(a.open,b.open)>=c.maxPositions)throw Error('Cupo completo en la pareja');
   const sizing=v2MaximumSize({price:entry,available:a.equity-a.margin,baseMargin:c.baseMargin,boost:c.boost,step:m.step,minimum:m.minimum,minNotional:m.minNotional,fee:c.fee,slip,brackets:m.brackets}),qty=sizing.quantity,budget=c.boost===50?1:c.boost===20?.65:.5;
   const stop=crossLossStop(entry,qty,normal.side,m.tick,budget),target=round(normal.evidence.signalSide*(normal.evidence.legacyTargetDistance)+normal.evidence.signalClose!,m.tick,normal.side===-1);
   // Target is fixed at the signal; the next-minute fill must still leave the same edge as V1.
   if(normal.side*(target-entry)<=0||Math.abs((entry-(normal.evidence.signalClose||entry))/normal.evidence.atr)>1.25)throw Error('La entrada se alejó de la señal normal');
   if(scalpNet(qty,entry,target,c.fee,slip)<.005)throw Error('Objetivo normal inferior a US$0,005 netos tras costes');
   if(qty*oppositeEntry+1e-9<m.minNotional)throw Error('El lote de la normal no cumple el mínimo en el lado inverso; pareja omitida');
   const inverseCost=qty*oppositeEntry*(1/sizing.leverage+2*c.fee+slip);if(inverseCost>b.equity-b.margin+1e-9)throw Error('Saldo de la inversa insuficiente para copiar el tamaño normal; pareja omitida');
   for(const t of [normal,inverse]){const ownEntry=t.arm==='normal'?entry:oppositeEntry,ownStop=t.arm==='normal'?stop:target,ownTarget=t.arm==='normal'?target:stop;if(t.side*(ownEntry-ownStop)<=0||t.side*(ownTarget-ownEntry)<=0)throw Error('El spread no permite invertir los mismos niveles');}
   for(const t of [normal,inverse]){const ownEntry=t.arm==='normal'?entry:oppositeEntry,ownStop=t.arm==='normal'?stop:target,ownTarget=t.arm==='normal'?target:stop;Object.assign(t,{status:'open',openedAt:bar.t,entry:ownEntry,rawEntry:bar.o,qty,stop:ownStop,target:ownTarget,margin:qty*ownEntry/sizing.leverage,risk:qty*(Math.abs(ownEntry-ownStop)+(ownEntry+ownStop)*c.fee+ownEntry*slip),leverage:sizing.leverage,minimumAdjusted:sizing.minimumAdjusted,leverageSource:m.leverageSource,lastBar:bar.t-60000,lastMark:bar.o,filters:{step:m.step,minimum:m.minimum,minNotional:m.minNotional,tick:m.tick},reason:'Pareja simulada: decisión de la normal'})}
  }catch(error){for(const t of [normal,inverse]){t.status='skipped';t.reason=error instanceof Error?error.message:'No se pudo abrir la pareja'}}
 }
 for(const t of r.trades.filter(t=>t.symbol===m.symbol&&t.status==='open')){
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
 if(r.trades.some(t=>t.symbol===m.symbol&&['pending','open'].includes(t.status)))return;
 r.scanner??={};
 const options=v2NormalChoices(m.primary);
 for(const option of options){const key=`normal:${m.symbol}:${option.strategy}`,candidate=option.signal.side?v2Candidate(m,'normal',option.strategy,c):null;
  const reason=candidate?.reason||(!candidate?option.signal.checks.filter(x=>!x.ok).map(x=>x.label).join(' · ')||'Sin señal normal confirmada':'');
  r.scanner[key]={arm:'normal',symbol:m.symbol,strategy:option.strategy,time:now,candleTime:last.t,status:!candidate?'no-signal':reason?'filtered':'accepted',reason:reason||'Candidata normal; la inversa solo la copia'};
 }
 const picked=options[0];if(!picked?.signal.side)return;
 const key=`normal:${m.symbol}:${picked.strategy}`;if(r.seen[key]===last.t)return;r.seen[key]=last.t;
 const candidate=v2Candidate(m,'normal',picked.strategy,c);if(!candidate)return;
 const normal=v2Metrics(r,'normal'),inverse=v2Metrics(r,'inverse'),unresolved=r.trades.some(t=>t.status==='open'&&(t.lastBar??0)<Math.floor(now/60000)*60000-60000),reason=candidate.reason||(unresolved?'Valoración pendiente en una posición de la pareja':undefined)||(Math.max(normal.open+normal.pending,inverse.open+inverse.pending)>=c.maxPositions?'Cupo reservado de parejas completo':undefined);
 const pairId=`${r.id}:${m.symbol}:${picked.strategy}:${last.t}`,evidence=candidate.evidence;
 r.scanner[key]={...r.scanner[key],status:reason?'filtered':'accepted',reason:reason||'Pareja aceptada; apertura común del siguiente minuto'};
 r.decisions.push({id:pairId+':evaluation:'+now,time:now,arm:'normal',symbol:m.symbol,strategy:picked.strategy,accepted:!reason,reason:reason||'Normal decide; inversa replica con dirección contraria',evidence});
 if(reason){if(unresolved||reason==='Cupo reservado de parejas completo')delete r.seen[key];return;}
 for(const arm of ['normal','inverse'] as const)r.trades.push({pairId,id:`${pairId}:${arm}`,arm,symbol:m.symbol,strategy:picked.strategy,side:arm==='normal'?candidate.side:-candidate.side as 1|-1,signalTime:last.t,scheduledAt:(Math.floor(now/60000)+1)*60000,status:'pending',createdAt:now,plannedStopDistance:candidate.stopDistance,plannedTargetDistance:candidate.targetDistance,funding:0,fundingThrough:0,reason:'Esperando apertura común de la pareja',evidence});
}
