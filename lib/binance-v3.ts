import {v2MaximumSize,type V2Bracket} from './binance-v2-sizing';
import {Candle,indicators,signal,emaRegime} from './engine';
import {netAt,netBracketTarget} from './paper-bracket-math';
import {v2NormalChoices,v2NormalGate} from './binance-v2-normal';
import {crossLossStop} from './real-stop-plan';
import {supportedTargetZone} from './real-target-zone';
export type V2Arm='normal'|'inverse';
export type V2Config={capital:number;fee:number;slip:number;baseMargin:number;boost:0|20|50;leverage:number;maxPositions:number;rr:number};
export const V2_DEFAULT:V2Config={capital:10,fee:.0005,slip:.0002,baseMargin:.2,boost:0,leverage:0,maxPositions:15,rr:1.5};
export const V2_VERSION='binance-v3-ricardo-rsi-1';
export type V2Market={frames?:Record<string,Candle[]>;marketSource?:string;brackets:V2Bracket[];leverageSource?:string;symbol:string;observedAt:number;primary:Candle[];context:Candle[];minutes:Candle[];step:number;minimum:number;minNotional:number;tick:number;mark:number;spread:number;funding:{time:number;rate:number;mark:number}[]};
export type V2Evidence={setupTime?:number;setupExtreme?:number;recoveryBars?:number;contextStrong?:boolean;filterChecks?:{name:string;passed:boolean}[];normalConfluence?:number;normalFrames?:{tf:string;direction:number;signal:number;rsi3:number;adx5:number;confidence:number}[];plannedStop?:number;plannedTarget?:number;netRR?:number;profile?:string;logicRevision?:string;executionRevision?:string;marketSource?:string;signalClose?:number;strategy:string;signalSide:1|-1;signalTime:number;rsi:number;adx:number;atr:number;ema50:number;ema99:number;ema200:number;contextSide:number;contextAdx:number;spread:number;observedAt:number;legacyStopDistance:number;legacyTargetDistance:number};
export type V2Trade={id:string;arm:V2Arm;symbol:string;strategy:string;side:1|-1;signalTime:number;scheduledAt:number;status:'pending'|'open'|'closed'|'skipped';createdAt:number;plannedStopDistance:number;plannedTargetDistance:number;openedAt?:number;closedAt?:number;entry?:number;rawEntry?:number;exit?:number;rawExit?:number;qty?:number;stop?:number;target?:number;margin?:number;risk?:number;leverage?:number;minimumAdjusted?:boolean;maintenanceRate?:number;maintenanceOffset?:number;leverageSource?:string;lastBar?:number;lastMark?:number;funding:number;fundingThrough:number;filters?:{step:number;minimum:number;minNotional:number;tick:number};exitCandle?:Candle;gross?:number;fees?:number;net?:number;mirrorNet?:number;peakNet?:number;worstNet?:number;heldMs?:number;resultR?:number;ambiguous?:boolean;reason:string;evidence:V2Evidence};
export type V2Scan={arm:V2Arm;symbol:string;strategy:string;time:number;candleTime:number;status:'no-signal'|'filtered'|'accepted';reason:string};
export type V2Round={codexRevision?:string;policyChanges?:{time:number;arm:V2Arm;revision:string;previous?:string}[];historyRefs?:{key:string;kind:'trades'|'decisions';count:number}[];scanner?:Record<string,V2Scan>;schema:1;version:string;id:string;createdAt:number;startedAt:number;running:boolean;config:V2Config;cursor:number;trades:V2Trade[];decisions:{id:string;time:number;arm:V2Arm;symbol:string;strategy:string;accepted:boolean;reason:string;evidence:V2Evidence}[];seen:Record<string,number>;lastTick?:number;lastMarketSource?:string;lastMarketAt?:number;lastError?:string};
const round=(v:number,step:number,up=false)=>Number(((up?Math.ceil(v/step-1e-8):Math.floor(v/step+1e-8))*step).toPrecision(12));
export const CODEX_REVISION='codex-rsi-recovery-window-v2';
export const strategyIds={normal:['adx','rsi'],inverse:['rsi']};
export function v2Config(raw:Partial<V2Config>):V2Config{
 const c={...V2_DEFAULT,...raw};
 for(const k of Object.keys(V2_DEFAULT) as (keyof V2Config)[])if(!Number.isFinite(c[k]))throw Error('Configuración incompleta.');
 if(c.capital!==10||c.fee<0||c.fee>.005||c.slip<0||c.slip>.01||c.baseMargin!==.2||![0,20,50].includes(c.boost)||c.leverage!==0||!Number.isInteger(c.maxPositions)||c.maxPositions<1||c.maxPositions>15||c.rr<1||c.rr>4)throw Error('V2 usa US$10 por perfil y el máximo confirmado por contrato.');
 return c;
}
export function createV2Round(config:Partial<V2Config>,now=Date.now()):V2Round{return {schema:1,version:V2_VERSION,id:crypto.randomUUID(),createdAt:now,startedAt:now,running:false,config:v2Config(config),cursor:0,trades:[],decisions:[],seen:{}}}
export function v2Metrics(r:V2Round,arm:V2Arm){
 const all=r.trades.filter(t=>t.arm===arm),closed=all.filter(t=>t.status==='closed'),resolved=closed.filter(t=>!t.ambiguous),open=all.filter(t=>t.status==='open'),pending=all.filter(t=>t.status==='pending');
 const pnl=closed.reduce((s,t)=>s+(t.net||0),0),validNet=resolved.reduce((s,t)=>s+(t.net||0),0),floating=open.reduce((s,t)=>s+netAt(t.entry!,t.lastMark??t.entry!,t.side,r.config.fee,r.config.slip+t.evidence.spread/2)*t.qty!+t.funding,0);
 let equity=r.config.capital,peak=equity,maxDrawdown=0;for(const t of [...closed].sort((a,b)=>a.closedAt!-b.closedAt!)){equity+=t.net!;peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,peak-equity)}
 const wins=resolved.filter(t=>t.net!>0),losses=resolved.filter(t=>t.net!<0),profit=wins.reduce((s,t)=>s+t.net!,0),loss=-losses.reduce((s,t)=>s+t.net!,0);
 return {closed:closed.length,valid:resolved.length,ambiguous:closed.length-resolved.length,open:open.length,pending:pending.length,pnl,validNet,floating,equity:r.config.capital+pnl+floating,winRate:resolved.length?wins.length/resolved.length*100:null,profitFactor:loss?profit/loss:null,expectancy:resolved.length?validNet/resolved.length:null,fees:closed.reduce((s,t)=>s+(t.fees||0),0),funding:all.reduce((s,t)=>s+t.funding,0),maxDrawdown,margin:open.reduce((s,t)=>s+t.margin!,0),risk:open.reduce((s,t)=>s+t.risk!,0),mirrorNet:resolved.filter(t=>t.arm==='inverse').reduce((s,t)=>s+(t.mirrorNet||0),0)};
}
// A recovery can be confirmed on the cross candle or the following two closed candles.
// No new trade may reuse the same RSI cross, even when confirmation spans several bars.
export function rsiRecovery(bars:Candle[],values:number[]){
 const i=bars.length-1,x=bars[i];if(!x||i<3)return null;
 for(let k=i;k>=i-2;k--){const prev=values[k-1],current=values[k],tail=values.slice(k,i+1);
  const long=prev<20&&current>=20&&tail.every(v=>v>=20)&&values[i]<=65&&x.c>x.o&&x.c>=bars[k].c;
  const short=prev>80&&current<=80&&tail.every(v=>v<=80)&&values[i]>=35&&x.c<x.o&&x.c<=bars[k].c;
  if(long||short){const side=(long?1:-1) as 1|-1,recent=bars.slice(k,i+1);return {side,setupTime:bars[k].t,recoveryBars:i-k,extreme:side===1?Math.min(...recent.map(b=>b.l)):Math.max(...recent.map(b=>b.h))}}
 }
 return null;
}
export function strategySignal(bars:Candle[],strategy:string,arm:V2Arm):{side:1|-1|0;checks:{label:string;ok:boolean}[]}{
 if(arm==='normal')return signal(bars,strategy);
 if(bars.length<60)return {side:0 as 1|-1|0,checks:[{label:'60 velas cerradas disponibles',ok:false}]};
 const recovery=strategy==='rsi'?rsiRecovery(bars,indicators(bars).rsi3):null;
 return {side:recovery?.side??0,checks:[{label:'RSI cruza 20/80 y confirma con vela a favor en hasta 2 cierres posteriores, sin volver al extremo',ok:!!recovery}]};
}

export function v2Candidate(m:V2Market,arm:V2Arm,strategy:string,config:V2Config):{side:1|-1;stopDistance:number;targetDistance:number;evidence:V2Evidence;reason?:string}|null{
 const bars=m.primary,context=m.context;if(bars.length<210||context.length<210)return null;
 const sig=strategySignal(bars,strategy,arm).side;if(!sig)return null;const a=indicators(bars),b=indicators(context),last=bars.at(-1)!,side=sig,atr=a.atr.at(-1)!,rsi=a.rsi3.at(-1)!,adx=a.adx5.at(-1)!;
 const contextSide=b.e50.at(-1)!>b.e99.at(-1)!?1:-1,contextAdx=b.adx5.at(-1)!,legacyQty=.2*(1+config.boost/100)*Math.max(...m.brackets.map(b=>b.leverage))/last.c,legacyStopDistance=(config.boost===50?1:config.boost===20?.65:.5)/Math.max(round(legacyQty,m.step),round(Math.max(m.minimum,m.minNotional/last.c),m.step,true));
 const recovery=arm==='inverse'?rsiRecovery(bars,a.rsi3):null,anchor=recovery?.extreme??(sig===1?last.l:last.h),structuralDistance=Math.max(atr*.8,last.c*.001,sig*(last.c-anchor)+atr*.15);
 let legacyTargetDistance=0,reason:string|undefined;
 try{legacyTargetDistance=sig*(supportedTargetZone(bars,last.c,sig,atr,m.tick,context).target-last.c)}catch(e){reason=e instanceof Error?e.message:'Sin zona confirmada'}
 const evidence:V2Evidence={logicRevision:arm==='normal'?'ricardo-original-adx-rsi-v1':CODEX_REVISION,profile:arm==='normal'?'Ricardo':'Codex RSI',marketSource:m.marketSource||'binance-server',signalClose:last.c,strategy,signalSide:sig,signalTime:last.t,rsi,adx,atr,ema50:a.e50.at(-1)!,ema99:a.e99.at(-1)!,ema200:a.e200.at(-1)!,contextSide,contextAdx,spread:m.spread,observedAt:m.observedAt,legacyStopDistance,legacyTargetDistance};
 let targetDistance=legacyTargetDistance;
 if(arm==='normal'){
  const gate=v2NormalGate(bars,context,m.frames,strategy,sig as 1|-1);evidence.normalConfluence=gate.confluence;evidence.normalFrames=gate.frames;
  if(!gate.accepted)reason=gate.reason;
 }else{
  const contextRegime=emaRegime(context,b);evidence.contextStrong=contextRegime.strong;evidence.setupTime=recovery?.setupTime;evidence.setupExtreme=anchor;evidence.recoveryBars=recovery?.recoveryBars;
  const expectedEntry=m.mark*(1+sig*(config.slip+m.spread/2));
  targetDistance=sig*(expectedEntry-last.c)+netBracketTarget(expectedEntry,last.c-sig*structuralDistance,sig,config.fee,config.slip+m.spread/2,1.5,m.tick);
  if(!reason&&legacyTargetDistance<targetDistance)reason='La zona no deja 1,5:1 neto para RSI técnico';
  if(!reason&&contextRegime.strong&&contextAdx>=25&&contextRegime.side===-sig)reason='Tendencia fuerte de 15m contraria';
  evidence.filterChecks=[{name:'Zona confirmada con 1,5:1 neto',passed:legacyTargetDistance>=targetDistance&&!reason?.includes('zona')},{name:'Sin tendencia fuerte de 15m contraria',passed:!(contextRegime.strong&&contextAdx>=25&&contextRegime.side===-sig)},{name:'Spread máximo 0,10%',passed:m.spread<=.001}];
 }
 if(!reason&&m.spread>.001)reason='Spread superior a 0,10%';
 evidence.plannedStop=last.c-sig*structuralDistance;evidence.plannedTarget=last.c+sig*targetDistance;
 return {side:sig as 1|-1,stopDistance:arm==='normal'?legacyStopDistance:structuralDistance,targetDistance,evidence,reason};
}

export function v2Fund(t:V2Trade,m:V2Market,through:number){for(const f of m.funding.filter(f=>f.time>t.fundingThrough&&f.time>=t.openedAt!&&f.time<=through)){t.funding+=-t.side*t.qty!*f.mark*f.rate;t.fundingThrough=f.time}}
export function v2Close(r:V2Round,t:V2Trade,m:V2Market,bar:Candle,sl:boolean,tp:boolean){
 const c=r.config,slip=c.slip+t.evidence.spread/2;const raw=sl?(t.side===1?Math.min(bar.o,t.stop!):Math.max(bar.o,t.stop!)):(t.side===1?Math.max(bar.o,t.target!):Math.min(bar.o,t.target!));
 t.exitCandle=bar;t.status='closed';t.closedAt=bar.t+60000;t.rawExit=raw;t.exit=raw*(1-t.side*slip);t.gross=t.side*(t.exit-t.entry!)*t.qty!;t.fees=(t.entry!+t.exit)*t.qty!*c.fee;t.net=t.gross-t.fees+t.funding;t.heldMs=t.closedAt-t.openedAt!;t.resultR=t.risk?t.net/t.risk:undefined;t.ambiguous=sl&&tp;t.reason=sl&&tp?'SL y TP en la misma vela: SL conservador; excluida de la comparación válida':sl?'Stop simulado':'Objetivo simulado';

}
export function processV2Market(r:V2Round,m:V2Market,now=Date.now(),discover=true){
 if(r.codexRevision!==CODEX_REVISION){r.policyChanges??=[];r.policyChanges.push({time:now,arm:'inverse',revision:CODEX_REVISION,previous:r.codexRevision??'codex-rsi-structural-net15-v1'});r.codexRevision=CODEX_REVISION;for(const key of Object.keys(r.seen))if(key.startsWith('inverse:'))delete r.seen[key];for(const key of Object.keys(r.scanner||{}))if(key.startsWith('inverse:'))delete r.scanner![key]}
 const c=r.config,minutes=m.minutes.filter(b=>b.t+60000<=now).sort((a,b)=>a.t-b.t);
 // Replay only candles after the scheduled next-minute entry. The signal was already fixed.
 for(const t of r.trades.filter(t=>t.symbol===m.symbol&&['pending','open'].includes(t.status))){
  if(t.status==='pending'){
   const bar=minutes.find(b=>b.t===t.scheduledAt);if(!bar)continue;
   const metrics=v2Metrics(r,t.arm),fillSlip=c.slip+t.evidence.spread/2,entry=bar.o*(1+t.side*fillSlip);
   const target=round(t.evidence.plannedTarget!,m.tick,t.side===-1);

   const available=Math.max(0,metrics.equity-metrics.margin);
   let sizing:ReturnType<typeof v2MaximumSize>;
   try{sizing=v2MaximumSize({price:entry,available,baseMargin:c.baseMargin,boost:c.boost,step:m.step,minimum:m.minimum,minNotional:m.minNotional,fee:c.fee,slip:fillSlip,brackets:m.brackets})}catch(e){t.status='skipped';t.reason=e instanceof Error?e.message:'Saldo insuficiente';r.scanner??={};r.scanner[`${t.arm}:${m.symbol}:${t.strategy}`]={arm:t.arm,symbol:m.symbol,strategy:t.strategy,time:now,candleTime:t.signalTime,status:'filtered',reason:t.reason};continue}
   const quantity=sizing.quantity,margin=sizing.margin,stop=t.arm==='normal'?crossLossStop(entry,quantity,t.side,m.tick,c.boost===50?1:c.boost===20?.65:.5):round(t.evidence.plannedStop!,m.tick,t.side===-1),risk=-quantity*netAt(entry,stop,t.side,c.fee,fillSlip),reward=quantity*netAt(entry,target,t.side,c.fee,fillSlip);
   let failure='';if(t.side*(entry-stop)<=0||t.side*(target-entry)<=0||stop<=0||target<=0)failure='Niveles inválidos';else if(Math.abs(entry-(t.evidence.signalClose??entry))/t.evidence.atr>1.25)failure='Entrada alejada más de 1,25 ATR de la señal';else if(reward<.005)failure='El objetivo no deja US$0,005 netos';else if(t.arm==='inverse'&&reward/risk<1.5)failure='R:R neto inferior a 1,5 al ejecutar';else if(metrics.open>=c.maxPositions)failure='Cupo completo';
   t.evidence.netRR=reward/risk;


   if(failure){t.status='skipped';t.reason=failure;r.scanner??={};r.scanner[`${t.arm}:${m.symbol}:${t.strategy}`]={arm:t.arm,symbol:m.symbol,strategy:t.strategy,time:now,candleTime:t.signalTime,status:'filtered',reason:failure};r.decisions.push({id:t.id+':execution',time:now,arm:t.arm,symbol:m.symbol,strategy:t.strategy,accepted:false,reason:failure,evidence:t.evidence});continue}
   t.evidence.executionRevision='next-minute-fixed-target-exact-costs-v1';
   t.filters={step:m.step,minimum:m.minimum,minNotional:m.minNotional,tick:m.tick};
   Object.assign(t,{leverage:sizing.leverage,minimumAdjusted:sizing.minimumAdjusted,maintenanceRate:sizing.maintenanceRate,maintenanceOffset:sizing.maintenanceOffset,leverageSource:m.leverageSource||'account-server',status:'open',openedAt:bar.t,entry,rawEntry:bar.o,qty:quantity,stop,target,margin,risk,lastBar:bar.t-60000,lastMark:entry,reason:'Simulación activa'});
  }
  for(const bar of minutes.filter(b=>b.t>(t.lastBar??0))){
   if(bar.t!==(t.lastBar??0)+60000){t.reason='Faltan velas consecutivas; pendiente de recuperar';break}
   const sl=t.side===1?bar.l<=t.stop!:bar.h>=t.stop!,tp=t.side===1?bar.h>=t.target!:bar.l<=t.target!;
   const observedNet=netAt(t.entry!,bar.c,t.side,c.fee,c.slip+t.evidence.spread/2)*t.qty!+t.funding;t.peakNet=Math.max(t.peakNet??observedNet,observedNet);t.worstNet=Math.min(t.worstNet??observedNet,observedNet);
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

  for(const strategy of (arm==='normal'?v2NormalChoices(m.primary).map(x=>x.strategy).filter(id=>strategyIds.normal.includes(id)):strategyIds.inverse)){
   const key=`${arm}:${m.symbol}:${strategy}`;const previousScan=r.scanner?.[key];if(r.seen[key]===last.t&&(arm==='normal'||previousScan?.status==='no-signal')){r.scanner??={};if(!r.scanner[key]){const checks=strategySignal(m.primary,strategy,arm);r.scanner[key]={arm,symbol:m.symbol,strategy,time:now,candleTime:last.t,status:checks.side?'filtered':'no-signal',reason:checks.side?'Vela ya evaluada; esperando un nuevo cierre':checks.checks.filter(check=>!check.ok).map(check=>check.label).join(' · ')||'Sin señal al cierre de esta vela'}}continue;}r.seen[key]=last.t;
   let candidate:ReturnType<typeof v2Candidate>;r.scanner??={};
   try{candidate=v2Candidate(m,arm,strategy,c)}catch(e){r.scanner[key]={arm,symbol:m.symbol,strategy,time:now,candleTime:last.t,status:'filtered',reason:e instanceof Error?e.message:'Estructura pendiente'};continue;}if(!candidate){const checks=strategySignal(m.primary,strategy,arm).checks;r.scanner[key]={arm,symbol:m.symbol,strategy,time:now,candleTime:last.t,status:'no-signal',reason:checks.filter(check=>!check.ok).map(check=>check.label).join(' · ')||'Sin señal al cierre de esta vela'};continue;}
   const setupKey=candidate.evidence.setupTime?`${key}:setup:${candidate.evidence.setupTime}`:undefined;
   if(setupKey&&(r.seen[setupKey]||r.trades.some(t=>t.arm==='inverse'&&t.symbol===m.symbol&&t.strategy===strategy&&t.status!=='skipped'&&(t.evidence.setupTime??t.signalTime)===candidate!.evidence.setupTime))){r.scanner[key]={arm,symbol:m.symbol,strategy,time:now,candleTime:last.t,status:'filtered',reason:'Esta recuperación RSI ya generó una entrada; esperando un cruce nuevo'};continue;}
   const unresolved=r.trades.some(t=>t.arm===arm&&t.status==='open'&&(t.lastBar??0)<Math.floor(now/60000)*60000-60000);
   const metrics=v2Metrics(r,arm),reason=candidate.reason||(unresolved?'Valoración o velas pendientes en el perfil':undefined)||(metrics.open+metrics.pending>=c.maxPositions?'Cupo reservado completo':undefined);
   r.scanner[key]={arm,symbol:m.symbol,strategy,time:now,candleTime:last.t,status:reason?'filtered':'accepted',reason:reason||'Señal aceptada; pendiente del siguiente minuto'};
   const id=`${r.id}:${key}:${last.t}`,evidence=candidate.evidence;
   if(arm==='normal'||!reason||previousScan?.reason!==reason||previousScan.candleTime!==last.t)r.decisions.push({id:id+':evaluation:'+now,time:now,arm,symbol:m.symbol,strategy,accepted:!reason,reason:reason||'Señal aceptada; entrada al abrir el siguiente minuto',evidence});
   if(reason){if(unresolved||metrics.open+metrics.pending>=c.maxPositions)delete r.seen[key];continue;}
   if(setupKey)r.seen[setupKey]=now;
   r.trades.push({id,arm,symbol:m.symbol,strategy,side:candidate.side,signalTime:last.t,scheduledAt:(Math.floor(now/60000)+1)*60000,status:'pending',createdAt:now,plannedStopDistance:candidate.stopDistance,plannedTargetDistance:candidate.targetDistance,funding:0,fundingThrough:0,reason:'Esperando apertura del siguiente minuto',evidence});break;
  }
 }
}
