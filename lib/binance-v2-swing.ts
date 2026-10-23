import {v2MaximumSize,type V2Bracket} from './binance-v2-sizing';
import {Candle,indicators,signal,emaRegime} from './engine';
import {v2NormalChoices} from './binance-v2-normal';

import {netAt,netBracketTarget} from './paper-bracket-math';
import {supportedTargetZone} from './real-target-zone';
export type V2Arm='normal'|'inverse';
export type V2Config={capital:number;fee:number;slip:number;baseMargin:number;boost:0|20|50;leverage:number;maxPositions:number;rr:number};
export const V2_DEFAULT:V2Config={capital:10,fee:.0005,slip:.0002,baseMargin:.2,boost:0,leverage:0,maxPositions:15,rr:2};
export const V2_VERSION='binance-v2-paired-swing-2';
export type V2Market={executionMark?:number;frames?:Record<string,Candle[]>;marketSource?:string;brackets:V2Bracket[];leverageSource?:string;symbol:string;observedAt:number;primary:Candle[];context:Candle[];minutes:Candle[];step:number;minimum:number;minNotional:number;tick:number;mark:number;spread:number;funding:{time:number;rate:number;mark:number}[]};
export type V2Evidence={rulesRevision?:string;primaryTimeframe?:string;contextTimeframe?:string;plannedStop?:number;plannedTarget?:number;netRR?:number;stopBasis?:string;structuralPivot?:number;atrFloor?:number;zoneTarget?:number;requiredTargetDistance?:number;availableNetRR?:number;filterChecks?:{name:string;passed:boolean}[];normalConfluence?:number;normalFrames?:{tf:string;direction:number;signal:number;rsi3:number;adx5:number;confidence:number}[];marketSource?:string;signalClose?:number;strategy:string;signalSide:1|-1;signalTime:number;rsi:number;adx:number;atr:number;ema50:number;ema99:number;ema200:number;contextSide:number;contextAdx:number;spread:number;observedAt:number;legacyStopDistance:number;legacyTargetDistance:number};
export type V2Trade={pairId?:string;id:string;arm:V2Arm;symbol:string;strategy:string;side:1|-1;signalTime:number;scheduledAt:number;status:'pending'|'open'|'closed'|'skipped';createdAt:number;plannedStopDistance:number;plannedTargetDistance:number;openedAt?:number;closedAt?:number;entry?:number;rawEntry?:number;exit?:number;rawExit?:number;qty?:number;stop?:number;target?:number;margin?:number;risk?:number;leverage?:number;minimumAdjusted?:boolean;maintenanceRate?:number;maintenanceOffset?:number;leverageSource?:string;lastBar?:number;lastMark?:number;funding:number;fundingThrough:number;filters?:{step:number;minimum:number;minNotional:number;tick:number};exitCandle?:Candle;gross?:number;fees?:number;net?:number;ambiguous?:boolean;reason:string;evidence:V2Evidence};
export type V2Scan={arm:V2Arm;symbol:string;strategy:string;time:number;candleTime:number;status:'no-signal'|'filtered'|'accepted';reason:string};
export type V2Round={previousRoundId?:string;startRepair?:string;scanRules?:string;historyRefs?:{key:string;kind:'trades'|'decisions';count:number}[];scanner?:Record<string,V2Scan>;schema:1;version:string;id:string;createdAt:number;startedAt:number;running:boolean;config:V2Config;cursor:number;trades:V2Trade[];decisions:{id:string;time:number;arm:V2Arm;symbol:string;strategy:string;accepted:boolean;reason:string;evidence:V2Evidence}[];seen:Record<string,number>;lastTick?:number;lastMarketSource?:string;lastMarketAt?:number;lastError?:string};
const round=(v:number,step:number,up=false)=>Number(((up?Math.ceil(v/step-1e-8):Math.floor(v/step+1e-8))*step).toPrecision(12));

export function v2Config(raw:Partial<V2Config>):V2Config{
 const c={...V2_DEFAULT,...raw};
 for(const k of Object.keys(V2_DEFAULT) as (keyof V2Config)[])if(!Number.isFinite(c[k]))throw Error('Configuración incompleta.');
 if(c.capital!==10||c.fee<0||c.fee>.005||c.slip<0||c.slip>.01||c.baseMargin!==.2||![0,20,50].includes(c.boost)||c.leverage!==0||!Number.isInteger(c.maxPositions)||c.maxPositions<1||c.maxPositions>15||c.rr!==2)throw Error('V2 usa US$10 por perfil y el máximo confirmado por contrato.');
 return c;
}
export function createV2Round(config:Partial<V2Config>,now=Date.now()):V2Round{return {schema:1,version:V2_VERSION,id:crypto.randomUUID(),createdAt:now,startedAt:now,running:false,config:v2Config(config),cursor:0,trades:[],decisions:[],seen:{}}}
export function v2Metrics(r:V2Round,arm:V2Arm){
 const all=r.trades.filter(t=>t.arm===arm),closed=all.filter(t=>t.status==='closed'),resolved=closed.filter(t=>!t.ambiguous),open=all.filter(t=>t.status==='open'),pending=all.filter(t=>t.status==='pending');
 const pnl=closed.reduce((s,t)=>s+(t.net||0),0),validNet=resolved.reduce((s,t)=>s+(t.net||0),0),floating=open.reduce((s,t)=>s+netAt(t.entry!,t.lastMark??t.entry!,t.side,r.config.fee,r.config.slip+t.evidence.spread/2)*t.qty!+t.funding,0);
 let equity=r.config.capital,peak=equity,maxDrawdown=0;for(const t of [...closed].sort((a,b)=>a.closedAt!-b.closedAt!)){equity+=t.net!;peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,peak-equity)}
 const wins=resolved.filter(t=>t.net!>0),losses=resolved.filter(t=>t.net!<0),profit=wins.reduce((s,t)=>s+t.net!,0),loss=-losses.reduce((s,t)=>s+t.net!,0);
 return {closed:closed.length,valid:resolved.length,ambiguous:closed.length-resolved.length,open:open.length,pending:pending.length,pnl,validNet,floating,equity:r.config.capital+pnl+floating,winRate:resolved.length?wins.length/resolved.length*100:null,profitFactor:loss?profit/loss:null,expectancy:resolved.length?validNet/resolved.length:null,fees:closed.reduce((s,t)=>s+(t.fees||0),0),funding:all.reduce((s,t)=>s+t.funding,0),maxDrawdown,margin:open.reduce((s,t)=>s+t.margin!,0),risk:open.reduce((s,t)=>s+t.risk!,0)};
}
export function swingPivot(bars:Candle[],entry:number,side:1|-1,atr:number,tick:number){
 const recent=bars.slice(-24),pivots=recent.filter((b,i)=>i>=2&&i<recent.length-2&&
  (side===1?[recent[i-2],recent[i-1],recent[i+1],recent[i+2]].every(n=>b.l<n.l):[recent[i-2],recent[i-1],recent[i+1],recent[i+2]].every(n=>b.h>n.h)))
  .map(b=>side===1?b.l:b.h).filter(value=>side*(entry-value)>Math.max(tick,atr*.15));
 if(pivots.length)return {pivot:side===1?Math.max(...pivots):Math.min(...pivots),basis:'pivote-1h-confirmado-2-velas',invalid:false};
 const last=bars.at(-1);if(!last)throw Error('Falta la vela de señal para el SL');
 const pivot=side===1?last.l:last.h;return {pivot,basis:'extremo-vela-senal-1h',invalid:side*(entry-pivot)<=0};
}
export function swingLevels(entry:number,side:1|-1,atr:number,pivot:number,zone:number,tick:number,fee:number,slip:number){
 if(![entry,atr,pivot,zone,tick,fee,slip].every(Number.isFinite)||entry<=0||atr<=0||tick<=0)throw Error('Estructura swing incompleta');
 const distance=Math.max(1.5*atr,side*(entry-pivot)+.15*atr);
 if(distance>4*atr)throw Error('La estructura requiere un SL superior a 4 ATR; esperar un retroceso');
 const stop=round(entry-side*distance,tick,side===-1),risk=-netAt(entry,stop,side,fee,slip);
 const targetDistance=netBracketTarget(entry,stop,side,fee,slip,2.25,tick);
 const target=round(entry+side*targetDistance,tick,side===1),reward=netAt(entry,target,side,fee,slip);
 const plan={entry,stop,target,pivot,zone,atrFloor:1.5,requiredTargetDistance:netBracketTarget(entry,stop,side,fee,slip,2,tick),availableNetRR:reward/risk};
 if(stop<=0||target<=0||side*(target-entry)<=0||reward/risk<2)throw Object.assign(Error('R:R swing neto inferior a 2'),{plan});

 return {stop,target,netRR:reward/risk,riskDistance:risk,plan};
}
export function v2Candidate(m:V2Market,arm:V2Arm,strategy:string,config:V2Config):{side:1|-1;stopDistance:number;targetDistance:number;evidence:V2Evidence;reason?:string}|null{
 const bars=m.primary,context=m.context;if(bars.length<210||context.length<210)return null;
 const sig=signal(bars,strategy).side;if(!sig)return null;
 const a=indicators(bars),b=indicators(context),last=bars.at(-1)!,atr=a.atr.at(-1)!,rsi=a.rsi3.at(-1)!,adx=a.adx5.at(-1)!,contextSide=b.e50.at(-1)!>b.e99.at(-1)!?1:-1,contextAdx=b.adx5.at(-1)!;
 const daily=m.frames?.['1d'],d=daily&&daily.length>=210?indicators(daily):null,dailySide=d?(d.e50.at(-1)!>d.e99.at(-1)!?1:-1):0;
 const expectedEntry=m.mark*(1+sig*(config.slip+m.spread/2)),structure=swingPivot(bars,expectedEntry,sig as 1|-1,atr,m.tick),pivot=structure.pivot;
 let levels,plan:any,zoneTarget:number|undefined,reason:string|undefined=structure.invalid?'El precio ya invalidó el extremo de la vela de señal':undefined;
 // Nearby structure is recorded as an obstacle, not a hard profit cap.
 // Prior exports rejected 75/78 setups through that cap before any live paper entry.
 try{zoneTarget=supportedTargetZone(context,expectedEntry,sig as 1|-1,b.atr.at(-1)!,m.tick,daily||[]).target}catch{}
 if(!reason)try{levels=swingLevels(expectedEntry,sig as 1|-1,atr,pivot,zoneTarget??expectedEntry+sig*atr*10,m.tick,config.fee,config.slip+m.spread/2);plan=levels.plan}catch(e){reason=e instanceof Error?e.message:'Niveles swing pendientes';plan=(e as {plan?:unknown})?.plan}

 const filterChecks=[{name:'Recorrido neto mínimo 2:1',passed:!reason},{name:'ADX de 1h mínimo 20',passed:adx>=20},{name:'Sin tendencia fuerte de 4h contraria',passed:!(contextAdx>=25&&emaRegime(context,b).strong&&contextSide!==sig)},{name:'Sin tendencia diaria fuerte contraria',passed:!(dailySide===-sig&&d!.adx5.at(-1)!>=25)},{name:'Spread máximo 0,10%',passed:m.spread<=.001}];
 if(!reason)reason=filterChecks.find(check=>!check.passed)?.name;
 const stopDistance=levels?Math.abs(last.c-levels.stop):atr,targetDistance=levels?Math.abs(levels.target-last.c):0;
 const evidence:V2Evidence={rulesRevision:'swing-volatility-target-v5',primaryTimeframe:'1h',contextTimeframe:'4h',stopBasis:structure.basis,structuralPivot:pivot,atrFloor:1.5,zoneTarget,requiredTargetDistance:plan?.requiredTargetDistance,availableNetRR:plan?.availableNetRR,filterChecks,plannedStop:levels?.stop??plan?.stop,plannedTarget:levels?.target??plan?.target,netRR:levels?.netRR,marketSource:m.marketSource||'binance-server',signalClose:last.c,strategy,signalSide:sig as 1|-1,signalTime:last.t,rsi,adx,atr,ema50:a.e50.at(-1)!,ema99:a.e99.at(-1)!,ema200:a.e200.at(-1)!,contextSide,contextAdx,spread:m.spread,observedAt:m.observedAt,legacyStopDistance:stopDistance,legacyTargetDistance:targetDistance};
 return {side:sig as 1|-1,stopDistance,targetDistance,evidence,reason};
}
/** Shared by the paired simulator and the real inverse adapter. Absolute barriers never move. */
export function swingArmLevels(side:1|-1,stop:number,target:number,arm:V2Arm){
 return {side:(arm==='normal'?side:-side) as 1|-1,stop:arm==='normal'?stop:target,target:arm==='normal'?target:stop};
}
export function swingNormalCandidates(m:V2Market,c:V2Config){
 return v2NormalChoices(m.primary).filter(x=>['adx','rsi','sweep'].includes(x.strategy)).map(option=>({option,candidate:option.signal.side?v2Candidate(m,'normal',option.strategy,c):null}));
}
/** Single pair plan: real inverse uses the hypothetical normal fill, never a normal order. */
export function swingPairPlan(m:V2Market,c:V2Config,side:1|-1,evidence:V2Evidence,rawEntry:number,normalAvailable:number,inverseAvailable:number){
 const slip=c.slip+evidence.spread/2,entry=rawEntry*(1+side*slip),oppositeEntry=rawEntry*(1-side*slip);
   const sizing=v2MaximumSize({price:entry,available:normalAvailable,baseMargin:c.baseMargin,boost:c.boost,step:m.step,minimum:m.minimum,minNotional:m.minNotional,fee:c.fee,slip,brackets:m.brackets}),qty=sizing.quantity;
   const stop=evidence.plannedStop!,target=evidence.plannedTarget!;if(!Number.isFinite(stop)||!Number.isFinite(target))throw Error('Niveles swing sin confirmar');
   // Target is fixed at the signal; the next-minute fill must still leave the same edge as V1.
   if(side*(target-entry)<=0||Math.abs((entry-(evidence.signalClose||entry))/evidence.atr)>1.25)throw Error('La entrada se alejó de la señal normal');
   const netRisk=-qty*netAt(entry,stop,side,c.fee,slip),netReward=qty*netAt(entry,target,side,c.fee,slip);if(netReward/netRisk<2)throw Error('La apertura ya no permite 2:1 neto con los niveles fijados');
   if(qty*oppositeEntry+1e-9<m.minNotional)throw Error('El lote de la normal no cumple el mínimo en el lado inverso; pareja omitida');
   const inverseCost=qty*oppositeEntry*(1/sizing.leverage+2*c.fee+slip);if(inverseCost>inverseAvailable+1e-9)throw Error('Saldo de la inversa insuficiente para copiar el tamaño normal; pareja omitida');
 for(const arm of ['normal','inverse'] as const){const ownEntry=arm==='normal'?entry:oppositeEntry,levels=swingArmLevels(side,stop,target,arm);if(levels.side*(ownEntry-levels.stop)<=0||levels.side*(levels.target-ownEntry)<=0)throw Error('El spread no permite invertir los mismos niveles');}
 return {sizing,qty,stop,target,slip,entry,oppositeEntry};
}
export function v2Fund(t:V2Trade,m:V2Market,through:number){for(const f of m.funding.filter(f=>f.time>t.fundingThrough&&f.time>=t.openedAt!&&f.time<=through)){t.funding+=-t.side*t.qty!*f.mark*f.rate;t.fundingThrough=f.time}}
export function v2Close(r:V2Round,t:V2Trade,m:V2Market,bar:Candle,sl:boolean,tp:boolean){
 const c=r.config,slip=c.slip+t.evidence.spread/2;const raw=sl?(t.side===1?Math.min(bar.o,t.stop!):Math.max(bar.o,t.stop!)):(t.side===1?Math.max(bar.o,t.target!):Math.min(bar.o,t.target!));
 t.exitCandle=bar;t.status='closed';t.closedAt=bar.t+60000;t.rawExit=raw;t.exit=raw*(1-t.side*slip);t.gross=t.side*(t.exit-t.entry!)*t.qty!;t.fees=(t.entry!+t.exit)*t.qty!*c.fee;t.net=t.gross-t.fees+t.funding;t.ambiguous=sl&&tp;t.reason=sl&&tp?'SL y TP en la misma vela: SL conservador; excluida de la comparación válida':sl?'Stop simulado':'Objetivo simulado';

}
export function processV2Market(r:V2Round,m:V2Market,now=Date.now(),discover=true,openCurrentMinute=false){
 if(r.scanRules!=='swing-volatility-target-v5'){r.scanRules='swing-volatility-target-v5';r.seen={}}
 const c=r.config,minutes=m.minutes.filter(b=>b.t+60000<=now).sort((a,b)=>a.t-b.t);
 // A single normal decision opens both legs atomically, with identical quantity and barriers.
 for(const normal of r.trades.filter(t=>t.symbol===m.symbol&&t.arm==='normal'&&t.status==='pending')){
  const inverse=r.trades.find(t=>t.pairId===normal.pairId&&t.arm==='inverse');if(!inverse||inverse.status!=='pending')throw Error('Pareja incompleta; no se abrió ningún lado');
  const bar=(openCurrentMinute?m.minutes.filter(b=>b.t<=now):minutes).find(b=>b.t===normal.scheduledAt);if(!bar)continue;
  try{
   const a=v2Metrics(r,'normal'),b=v2Metrics(r,'inverse');
   if(Math.max(a.open,b.open)>=c.maxPositions)throw Error('Cupo completo en la pareja');
   const {sizing,qty,stop,target,slip,entry,oppositeEntry}=swingPairPlan(m,c,normal.side,normal.evidence,bar.o,a.equity-a.margin,b.equity-b.margin);
   for(const t of [normal,inverse]){const ownEntry=t.arm==='normal'?entry:oppositeEntry,{stop:ownStop,target:ownTarget}=swingArmLevels(normal.side,stop,target,t.arm);if(t.side*(ownEntry-ownStop)<=0||t.side*(ownTarget-ownEntry)<=0)throw Error('El spread no permite invertir los mismos niveles');}
   for(const t of [normal,inverse]){const ownEntry=t.arm==='normal'?entry:oppositeEntry,{stop:ownStop,target:ownTarget}=swingArmLevels(normal.side,stop,target,t.arm);Object.assign(t,{status:'open',openedAt:bar.t,entry:ownEntry,rawEntry:bar.o,qty,stop:ownStop,target:ownTarget,margin:qty*ownEntry/sizing.leverage,risk:-qty*netAt(ownEntry,ownStop,t.side,c.fee,slip),leverage:sizing.leverage,minimumAdjusted:sizing.minimumAdjusted,leverageSource:m.leverageSource,lastBar:bar.t-60000,lastMark:bar.o,filters:{step:m.step,minimum:m.minimum,minNotional:m.minNotional,tick:m.tick},reason:'Pareja simulada: decisión de la normal'})}
  }catch(error){const failure=error instanceof Error?error.message:'No se pudo abrir la pareja';for(const t of [normal,inverse]){t.status='skipped';t.reason=failure}r.scanner??={};r.scanner[`normal:${m.symbol}:${normal.strategy}`]={arm:'normal',symbol:m.symbol,strategy:normal.strategy,time:now,candleTime:normal.signalTime,status:'filtered',reason:failure};r.decisions.push({id:normal.id+':execution:'+now,time:now,arm:'normal',symbol:m.symbol,strategy:normal.strategy,accepted:false,reason:failure,evidence:normal.evidence})}
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
 const last=m.primary.at(-1);if(!last||now-(last.t+3600000)>3600000)return;
 if(r.trades.some(t=>t.symbol===m.symbol&&['pending','open'].includes(t.status)))return;
 r.scanner??={};
 const choices=swingNormalCandidates(m,c),options=choices.map(x=>x.option);
 for(const {option,candidate} of choices){const key=`normal:${m.symbol}:${option.strategy}`;
  const reason=candidate?.reason||(!candidate?option.signal.checks.filter(x=>!x.ok).map(x=>x.label).join(' · ')||'Sin señal normal confirmada':'');
  r.scanner[key]={arm:'normal',symbol:m.symbol,strategy:option.strategy,time:now,candleTime:last.t,status:!candidate?'no-signal':reason?'filtered':'accepted',reason:reason||'Candidata normal; la inversa solo la copia'};
  if(candidate&&reason&&r.seen[key+':rejected']!==last.t){r.seen[key+':rejected']=last.t;r.decisions.push({id:`${r.id}:${key}:${last.t}:${candidate.evidence.rulesRevision}:rejected`,time:now,arm:'normal',symbol:m.symbol,strategy:option.strategy,accepted:false,reason,evidence:candidate.evidence})}
 }
 const picked=options.find(option=>r.scanner?.[`normal:${m.symbol}:${option.strategy}`]?.status==='accepted');if(!picked?.signal.side)return;
 const key=`normal:${m.symbol}:${picked.strategy}`;if(r.seen[key]===last.t||r.trades.some(t=>t.arm==='normal'&&t.symbol===m.symbol&&t.strategy===picked.strategy&&t.signalTime===last.t&&t.status!=='skipped'))return;r.seen[key]=last.t;
 const candidate=v2Candidate(m,'normal',picked.strategy,c);if(!candidate)return;
 const normal=v2Metrics(r,'normal'),inverse=v2Metrics(r,'inverse'),unresolved=r.trades.some(t=>t.status==='open'&&(t.lastBar??0)<Math.floor(now/60000)*60000-60000),reason=candidate.reason||(unresolved?'Valoración pendiente en una posición de la pareja':undefined)||(Math.max(normal.open+normal.pending,inverse.open+inverse.pending)>=c.maxPositions?'Cupo reservado de parejas completo':undefined);
 const pairId=`${r.id}:${m.symbol}:${picked.strategy}:${last.t}`,evidence=candidate.evidence;
 r.scanner[key]={...r.scanner[key],status:reason?'filtered':'accepted',reason:reason||'Pareja aceptada; apertura común del siguiente minuto'};
 r.decisions.push({id:pairId+':evaluation:'+now,time:now,arm:'normal',symbol:m.symbol,strategy:picked.strategy,accepted:!reason,reason:reason||'Normal decide; inversa replica con dirección contraria',evidence});
 if(reason){if(unresolved||reason==='Cupo reservado de parejas completo')delete r.seen[key];return;}
 for(const arm of ['normal','inverse'] as const)r.trades.push({pairId,id:`${pairId}:${arm}`,arm,symbol:m.symbol,strategy:picked.strategy,side:arm==='normal'?candidate.side:-candidate.side as 1|-1,signalTime:last.t,scheduledAt:(Math.floor(now/60000)+1)*60000,status:'pending',createdAt:now,plannedStopDistance:candidate.stopDistance,plannedTargetDistance:candidate.targetDistance,funding:0,fundingThrough:0,reason:'Esperando apertura común de la pareja',evidence});
}
