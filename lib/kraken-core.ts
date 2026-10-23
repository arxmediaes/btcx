import {normalizeLossPause,type LossPause} from './loss-pause';
import {Candle,Mode,STRATEGIES,indicators,emaRegime,signal,ms} from './engine';
import {marketPulse} from './pulse';
import {multiTimeframeAnalysis} from './multiframe';
import {quickScalpReady,scalpContinuationSide} from './real-entry-gate';
import {krakenScalpTarget} from './kraken-scalp-target';
import {supportedTargetZone} from './real-target-zone';
import {normalRealLevels} from './real-swapped-levels';
import {crossLossStop,planRealStop} from './real-stop-plan';
import {boostedLossBudget} from './real-next-boost';
import {krakenMarginQuantity} from './kraken-margin-sizing';
import {scalpNet} from './real-scalp-sizing';

export type KrakenSettings={lossPause?:LossPause;maxPositions:number;marginMode:'CROSSED'|'ISOLATED';mode:Mode;timeframe:string;immediate:boolean;scalpX?:boolean;nextBoost?:boolean;boost50?:boolean};
export const defaultKrakenSettings:KrakenSettings={maxPositions:5,marginMode:'CROSSED',mode:'scalp',timeframe:'3m',immediate:false};
export function krakenSettings(raw:any):KrakenSettings{return {lossPause:normalizeLossPause(raw?.lossPause),boost50:raw?.boost50===true,nextBoost:raw?.boost50!==true&&raw?.nextBoost===true,maxPositions:Math.max(1,Math.min(15,Math.round(Number(raw?.maxPositions)||5))),scalpX:raw?.scalpX===true,marginMode:raw?.scalpX!==true&&raw?.marginMode==='ISOLATED'?'ISOLATED':'CROSSED',mode:raw?.scalpX!==true&&raw?.mode==='swing'?'swing':'scalp',timeframe:raw?.scalpX===true?'3m':['1m','3m','5m','15m','1h','4h'].includes(raw?.timeframe)?raw.timeframe:'3m',immediate:raw?.immediate===true};}
export type KrakenInstrument={symbol:string;base:string;type:string;quote:string;tickSize:number;contractSize:number;contractValueTradePrecision:number;tradeable:boolean;postOnly?:boolean;restricted?:boolean;minimumTradeSize?:number;isExpired?:boolean;maxPositionSize:number;marginLevels:any[];retailMarginLevels?:any[];marginSchedules?:Record<string,Record<string,any[]>>};
export const krakenCoin=(symbol:string)=>symbol.replace(/^PF_/,'').replace(/USD$/,'').replace(/^XBT$/,'BTC');
export function krakenStep(instrument:KrakenInstrument){const precision=instrument.contractValueTradePrecision;if(!Number.isInteger(precision)||precision<0||precision>12)throw Error('Kraken no confirmó la precisión del contrato.');return 10**-precision;}
// Kraken official Multi-M Min Lot specifications, verified 2026-10-11:
// https://support.kraken.com/articles/4844359082772-linear-multi-collateral-derivatives-contract-specifications
// Only use this compatibility table if the live precision still agrees.
const documentedMinLots:Record<string,number>={OP:1,ARB:1,INJ:.1,AVAX:.01,SEI:1,APT:.1,FIL:.1,ADA:1,BCH:.01,SUI:1,NEAR:1,DOGE:1,HBAR:1,TAO:.01,LINK:.1,ATOM:.1,WIF:1,ENA:1,WLD:1,CRV:1,PENDLE:.1,AAVE:.01,UNI:.1,RUNE:1,TIA:.1,JUP:1,PYTH:1,GALA:1,SAND:1};
export function krakenMinimumQuantity(i:KrakenInstrument){
 const step=krakenStep(i);
 if(i.minimumTradeSize!==undefined&&i.minimumTradeSize!==null){
  const minimum=Number(i.minimumTradeSize);
  if(!Number.isFinite(minimum)||minimum<=0)throw Error('Kraken devolvió un tamaño mínimo inválido.');
  return Math.max(minimum,step);
 }
 const documented=documentedMinLots[krakenCoin(i.symbol)];
 if(!linearInstrument(i)||!documented||Math.abs(documented-step)>step*1e-8)throw Error('Kraken no confirmó el lote mínimo; las especificaciones necesitan revisión.');
 return documented;
}
export function linearInstrument(i:KrakenInstrument){return /^PF_[A-Z0-9]+USD$/.test(i.symbol)&&i.type==='flexible_futures'&&i.quote==='USD'&&i.contractSize===1&&i.tradeable&&!i.isExpired&&!i.postOnly&&!i.restricted;}
export function conservativeLeverage(i:KrakenInstrument,notional=0){
 // Authenticated /trading/instruments supplies this account's applicable schedule.
 const groups=[i.marginLevels].filter((x):x is any[]=>Array.isArray(x)&&x.length>0);
 if(!groups.length)throw Error('Kraken no confirmó los límites de margen.');
 const rates=groups.map(levels=>levels.filter(x=>Number(x.numNonContractUnits??x.contracts??0)<=notional).sort((a,b)=>Number(b.numNonContractUnits??b.contracts??0)-Number(a.numNonContractUnits??a.contracts??0))[0]?.initialMargin).map(Number);
 if(rates.some(x=>!Number.isFinite(x)||x<=0||x>1))throw Error('Límites de margen inválidos.');
 return Math.max(1,Math.floor(1/Math.max(...rates)));
}
export function aggregateKrakenCandles(rows:Candle[],tf:string,now=Date.now()){
 const duration=ms(tf),unique=[...new Map(rows.map(x=>[x.t,x])).values()].sort((a,b)=>a.t-b.t);
 if(tf!=='3m')return unique;
 const buckets=new Map<number,Candle[]>();for(const c of unique){const t=Math.floor(c.t/duration)*duration;buckets.set(t,[...(buckets.get(t)||[]),c]);}
 return [...buckets.entries()].filter(([t,b])=>b[0].t===t&&b.every((c,j)=>c.t===t+j*60000)&&(t+duration>now||b.length===3)).map(([t,b])=>({t,o:b[0].o,h:Math.max(...b.map(c=>c.h)),l:Math.min(...b.map(c=>c.l)),c:b.at(-1)!.c,v:b.reduce((s,c)=>s+c.v,0)}));
}
export function krakenBudget(actualAvailable:number,reservedMargin=0){return Math.max(0,Math.min(actualAvailable,40-Math.max(0,reservedMargin)));}
export function krakenLossStop(entry:number,quantity:number,side:1|-1,tick:number,lossBudget=.50){return crossLossStop(entry,quantity,side,tick,lossBudget);}

export type KrakenPlan={id:string;createdAt:number;symbol:string;coin:string;side:1|-1;strategy:string;quantity:number;entry:number;stop:number;target:number;leverage:number;marginMode:'CROSSED'|'ISOLATED';mode:Mode;timeframe:string;confluence:number;fomo:number;netGoal:number;reason:string;independent:boolean;settings:KrakenSettings;crossLossBudget?:number;feeRate:number;slipRate:number};
export function buildKrakenPlan(input:{instrument:KrakenInstrument;frames:Record<string,Candle[]>;mark:number;available:number;positions:number;settings:KrakenSettings;independent?:boolean;requestedSide?:1|-1;shortTarget?:boolean;history?:Array<{strategy:string;net:number;notional:number}>;now?:number}):KrakenPlan{
 const {instrument:i,mark,settings}=input,available=krakenBudget(input.available),now=input.now??Date.now();
 if(!linearInstrument(i))throw Error('Contrato perpetuo USD no disponible en Kraken.');
 if(!(mark>0&&available>0))throw Error('Kraken no confirmó precio y margen disponible.');
 if(!input.independent&&input.positions>=settings.maxPositions)throw Error('Cupo automático completo.');
 const contextTf=settings.scalpX?'5m':settings.mode==='scalp'?'15m':'4h',tf=settings.scalpX?'3m':settings.mode==='scalp'&&settings.timeframe==='1m'?'3m':settings.timeframe,frames=Object.fromEntries(Object.entries(input.frames).map(([k,v])=>[k,v.filter(c=>c.t+ms(k)<=now)])),primary=frames[tf]||[],minute=frames['1m']||[],context=frames[contextTf]||[];
 if(primary.length<65||context.length<65||now-(primary.at(-1)?.t||0)>ms(tf)*2+30000)throw Error('Faltan velas cerradas recientes para analizar.');
 const pulse=marketPulse(primary,context,contextTf),a=indicators(primary),ma=minute.length>=65?indicators(minute):null;
 const candidates=STRATEGIES.map(st=>{const sig=signal(primary,st.id).side,fast=minute.length>=65?signal(minute,st.id).side:0,continuation=st.id==='ema'&&ma?scalpContinuationSide(minute.at(-1)!.c,ma.e50.at(-1)!,ma.e50.at(-4)!,ma.atr.at(-1)!,ma.rsi3.at(-1)!):0;const primaryContinuation=settings.immediate&&settings.mode==='scalp'&&st.id==='ema'?scalpContinuationSide(primary.at(-1)!.c,a.e50.at(-1)!,a.e50.at(-4)!,a.atr.at(-1)!,a.rsi3.at(-1)!):0;const side=sig||primaryContinuation||fast||continuation;const memory=(input.history||[]).filter(x=>x.strategy===st.id&&Number.isFinite(x.net)&&x.notional>0);const bonus=memory.length>=10?Math.max(-2,Math.min(2,memory.reduce((s,x)=>s+x.net/x.notional,0)/memory.length*1000)):0;return {strategy:st.id,side:side as 1|-1|0,sig,fast,continuation,primaryContinuation,bonus};}).filter(c=>c.side&&(!input.requestedSide||c.side===input.requestedSide));
 candidates.sort((x,y)=>(Number(y.sig!==0)*3+Number(y.side===pulse.bias)*2+y.bonus)-(Number(x.sig!==0)*3+Number(x.side===pulse.bias)*2+x.bonus));
 const rejected:string[]=[];
 for(const candidate of candidates){
  const side=candidate.side as 1|-1,multi=multiTimeframeAnalysis(frames,settings.mode,candidate.strategy,tf),regime=emaRegime(context,indicators(context)),contextOpposes=regime.strong&&regime.side===-side,frameAgreement=multi.frames.filter(f=>f.direction===side).length/Math.max(1,multi.frames.length),historical=emaRegime(primary,a);
  const window=primary.slice(-240),slices=[window.slice(-80),window.slice(-160,-80),window.slice(-240,-160)].filter(rows=>rows.length>=65),historySides=slices.map(rows=>{const ind=indicators(rows),r=emaRegime(rows,ind),diff=rows.at(-1)!.c-rows[0].c,atr=ind.atr.at(-1)!;return r.strong?r.side:diff>atr*.8?1:diff<-atr*.8?-1:0}).filter(v=>v!==0),agreement=historySides.length?historySides.filter(v=>v===side).length/historySides.length:0,aligned=(historical.side||historySides.at(-1)||0)===side||agreement>=.5,higher=multi.frames.filter(f=>['1h','4h','1d','1w'].includes(f.tf)),higherAligned=higher.length?higher.filter(f=>f.direction===side).length/higher.length:0;
  const confluence=Math.min(100,(aligned?24:Math.round(agreement*18))+Math.round(frameAgreement*24)+Math.round(higherAligned*12)+(multi.bias===side?16:multi.bias===0?8:0)+(pulse.bias===side?16:pulse.bias===0?8:0)+(candidate.sig===side?8:candidate.sig===0?4:0)),medium=frames[settings.scalpX?'5m':'15m']||[],mediumRegime=medium.length>=65?emaRegime(medium,indicators(medium)):null,mediumConflict=settings.mode==='scalp'&&!!mediumRegime?.strong&&mediumRegime.side===-side;
  const continuation= settings.mode==='scalp'&&!!ma&&scalpContinuationSide(minute.at(-1)!.c,ma.e50.at(-1)!,ma.e50.at(-4)!,ma.atr.at(-1)!,ma.rsi3.at(-1)!)===side;
  const quick=settings.mode==='scalp'&&quickScalpReady({primaryCount:primary.length,contextCount:medium.length,primaryConfirmed:candidate.sig===side,minuteConfirmed:candidate.fast===side,continuationConfirmed:continuation,pulseOpposes:pulse.bias===-side,contextOpposes:mediumConflict,confluence,fomo:pulse.fomo.score});
  const balanced=settings.immediate&&frameAgreement>=.15&&multi.confidence>=20&&pulse.fomo.score<95&&confluence>=20,hard=!!(pulse as any).contradiction&&!aligned&&(pulse.fomo.score>=80||multi.agreement<50)&&!balanced,scalp=settings.mode==='scalp',quality=primary.length>=35&&multi.frames.length>=1&&(scalp||!hard)&&pulse.fomo.score<95&&multi.confidence>=(scalp?20:44)&&(confluence>=(scalp?20:48)||historical.strong&&aligned&&confluence>=(scalp?25:45)||balanced);
  const continuationReady=settings.immediate&&settings.mode==='scalp'&&candidate.primaryContinuation===side&&continuation&&!mediumConflict&&pulse.bias!==-side&&confluence>=35&&pulse.fomo.score<75&&Math.abs(primary.at(-1)!.c-a.e50.at(-1)!)<=a.atr.at(-1)!;
  const ready=continuationReady||quick||quality&&!mediumConflict&&medium.length>=65&&(candidate.sig===side||!scalp&&settings.immediate&&pulse.bias===side&&candidate.sig!==-side);
  if(!ready){rejected.push(mediumConflict?'contexto contrario':pulse.bias===-side?'impulso contrario':candidate.sig!==side&&!continuationReady?'confirmación 3m pendiente':'calidad insuficiente');continue;}
  const atr=Number(a.atr.at(-1)),tick=i.tickSize;if(!(atr>0&&tick>0))throw Error('Kraken no confirmó volatilidad y tick.');
  if(Math.abs(mark-primary.at(-1)!.c)>atr*1.25)throw Error('La señal se alejó del precio; esperamos otra entrada.');
  const recent=primary.slice(-48),local=primary.slice(-5),buffer=Math.max(atr*.15,mark*.0002,tick),stopDistance=Math.max(atr*.6,mark*.001,side===1?mark-(Math.min(...local.map(c=>c.l))-buffer):Math.max(...local.map(c=>c.h))+buffer-mark);
  const stopPlan=planRealStop(mark,stopDistance,conservativeLeverage(i,settings.scalpX?0:available*100),settings.mode==='scalp',!!settings.scalpX&&settings.marginMode==='CROSSED'),structuralTarget=supportedTargetZone(primary,mark,side,atr,tick,medium).target;
  const feeRate=.0005,slipRate=.0002,breakEven=mark*(2*feeRate+slipRate)/(1-side*feeRate),targetCap=settings.mode==='scalp'?krakenScalpTarget(mark,side,structuralTarget,atr,tick,feeRate,slipRate).distance:side*(structuralTarget-mark);
  if(targetCap<=0)throw Error('No hay recorrido antes del máximo o mínimo reciente.');
  const step=krakenStep(i);if(!(Number(i.minimumTradeSize)>0))throw Error('Kraken no confirmó el tamaño mínimo de tu cuenta.');
  const sizing=krakenMarginQuantity({price:mark,available,slots:Math.max(1,settings.maxPositions-input.positions),leverage:stopPlan.leverage,step,minimumQty:Number(i.minimumTradeSize),rate:feeRate,slipRate,boostPercent:settings.boost50?50:settings.nextBoost?20:undefined});
  const quantity=sizing.quantity;
  if(quantity*mark*(1/stopPlan.leverage+2*feeRate+slipRate)>available+1e-9)throw Error('El margen y los costes superan el presupuesto autorizado.');
  if(quantity>i.maxPositionSize)throw Error('El tamaño supera el límite del contrato.');if(settings.scalpX&&stopPlan.leverage>conservativeLeverage(i,quantity*mark))throw Error('El tamaño requiere otro tramo de margen de Kraken; se buscará una entrada compatible con el máximo autorizado.');
  // Scalp sizes against the rounded near target; swing retains its structural target.
  const crossLossBudget=boostedLossBudget(!!settings.nextBoost,!!settings.boost50),levels=normalRealLevels(mark,side,stopPlan.distance,mark+side*targetCap,tick),stop=settings.marginMode==='ISOLATED'?levels.stop:krakenLossStop(mark,quantity,side,tick,crossLossBudget),target=levels.target,netGoal=scalpNet(quantity,mark,target,feeRate,slipRate);
  if(side*(target-mark)<=0||netGoal<=0)throw Error('El objetivo no cubre los costes estimados.');
  return {id:crypto.randomUUID(),createdAt:now,symbol:i.symbol,coin:krakenCoin(i.symbol),side,strategy:candidate.strategy,quantity,entry:mark,stop,target,leverage:stopPlan.leverage,marginMode:settings.marginMode,mode:settings.mode,timeframe:tf,confluence,fomo:pulse.fomo.score,netGoal,reason:`${sizing.minimumAdjusted?`Lote mínimo de Kraken · margen estimado US$${sizing.margin.toFixed(4)} · `:''}Dirección normal · ${candidate.strategy.toUpperCase()} · ${pulse.label} · zona repetida o giro confirmado · ${settings.mode==='scalp'?'TP cercano con tamaño calculado · ':''}contexto ${contextTf}`,independent:!!input.independent,settings,crossLossBudget,feeRate,slipRate};
 }
 throw Error(!candidates.length?'Sin señal ni continuación confirmada en 3m.':rejected.includes('contexto contrario')?'El contexto '+contextTf+' se opone a la entrada.':rejected.includes('impulso contrario')?'El impulso de 3m se opone a la entrada.':rejected.includes('confirmación 3m pendiente')?'Esperando confirmación de 3m; el disparo de 1m no decide la dirección.':'La lectura no supera los filtros de calidad y FOMO.');
}

export async function krakenSignature(payload:string,endpointPath:string,secret:string,nonce=''){
 const bytes=Uint8Array.from(atob(secret),c=>c.charCodeAt(0)),hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload+nonce+endpointPath)),key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-512'},false,['sign']),signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,hash));return btoa(String.fromCharCode(...signature));
}
