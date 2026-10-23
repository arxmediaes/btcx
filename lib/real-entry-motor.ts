import {signal,type Candle} from './engine';
import {v2NormalChoices,v2NormalGate} from './binance-v2-normal';
export type RealEntryMotor='legacy'|'impulso-rsi';
export type RealMotorEvent={time:number;symbol:string;strategy:string;stage:string;reason:string;signalTime?:number;scheduledAt?:number;target?:number};
export function appendRealMotorEvent(events:RealMotorEvent[],event:RealMotorEvent){
 const last=events.at(-1);if(last&&last.symbol===event.symbol&&last.strategy===event.strategy&&last.stage===event.stage&&last.reason===event.reason&&last.signalTime===event.signalTime&&event.time-last.time<30000)return events;
 return [...events,event].slice(-100);
}
export const REAL_ENTRY_MOTOR_KEY='hyrule-real-entry-motor-v1';
export const IMPULSO_RSI_IDS=['adx','rsi'] as const;
export const isImpulsoRsiStrategy=(id:string)=>IMPULSO_RSI_IDS.some(strategy=>strategy===id);
export function impulsoRsiChoices(primary:Candle[]){return v2NormalChoices(primary).filter(x=>isImpulsoRsiStrategy(x.strategy))}
// Pure entry validation. This module has no exchange credentials or order functions.
export function validateImpulsoRsi(frames:Record<string,Candle[]>,strategy:string,side:1|-1,now=Date.now()){
 if(!isImpulsoRsiStrategy(strategy))throw Error('Motor Impulso + RSI: estrategia fuera de la selección permitida.');
 const primary=frames['3m']||[],context=frames['15m']||[];
 if(primary.length<210||context.length<210)throw Error('Motor Impulso + RSI: faltan 210 velas cerradas de 3m y 15m.');
 if(primary.some(b=>b.t+180000>now)||context.some(b=>b.t+900000>now))throw Error('Motor Impulso + RSI: no se usan velas sin cerrar.');
 if(now-(primary.at(-1)!.t+180000)>180000||now-(context.at(-1)!.t+900000)>900000)throw Error('Motor Impulso + RSI: señal o contexto antiguos.');
 if(signal(primary,strategy).side!==side)throw Error('Motor Impulso + RSI: la señal principal ya no confirma esta dirección.');
 const gate=v2NormalGate(primary,context,Object.fromEntries(Object.entries(frames).filter(([tf])=>tf!=='3m'&&tf!=='15m')),strategy,side);
 if(!gate.accepted)throw Error('Motor Impulso + RSI: '+gate.reason);
 return gate;
}

/** Try the same ordered strategies as Ricardo; a rejected first choice must not hide the next. */
export function selectImpulsoRsiCandidate(frames:Record<string,Candle[]>,now=Date.now(),alreadyUsed:(strategy:string,signalTime:number)=>boolean=()=>false){
 let lastError:unknown;
 for(const choice of impulsoRsiChoices(frames['3m']||[])){
  if(!choice.signal.side||alreadyUsed(choice.strategy,frames['3m'].at(-1)?.t||0))continue;
  try{const side=choice.signal.side as 1|-1;return {strategy:choice.strategy,side,gate:validateImpulsoRsi(frames,choice.strategy,side,now)}}catch(error){lastError=error}
 }
 throw lastError||Error('Sin señal de impulso o RSI confirmada');
}

import {v2Candidate,V2_DEFAULT,type V2Market,type V2Evidence} from './binance-v3';
import {v2MaximumSize} from './binance-v2-sizing';
import {crossLossStop} from './real-stop-plan';
import {netAt} from './paper-bracket-math';
export const REAL_MOTOR_ACTIVATION='impulso-rsi-parity-v2';
function rejectedPlan(message:string){return Object.assign(Error(message),{discardSignal:true})}
/** Discovery uses the complete paper candidate, including target structure and spread. */
export function selectImpulsoRsiMarketCandidate(m:V2Market,boost:0|20|50,alreadyUsed:(strategy:string,signalTime:number)=>boolean=()=>false,rejected:(strategy:string,signalTime:number,reason:string)=>void=()=>{}){
 let lastError:unknown;
 const frames={'3m':m.primary,'15m':m.context,...m.frames};
 for(const choice of impulsoRsiChoices(m.primary)){
  if(!choice.signal.side||alreadyUsed(choice.strategy,m.primary.at(-1)?.t||0))continue;
  try{
   const side=choice.signal.side as 1|-1,gate=validateImpulsoRsi(frames,choice.strategy,side,m.observedAt),candidate=v2Candidate(m,'normal',choice.strategy,{...V2_DEFAULT,boost});
   if(!candidate||candidate.reason)throw Error(candidate?.reason||'Sin señal normal confirmada');
   return {strategy:choice.strategy,side,gate,evidence:candidate.evidence};
  }catch(error){lastError=error;rejected(choice.strategy,m.primary.at(-1)!.t,error instanceof Error?error.message:'Señal descartada')}
 }
 throw lastError||Error('Sin señal de impulso o RSI confirmada');
}
export function validateNormalMotorLevels(symbol:string,entry:number,side:1|-1,levels:{stop:number;target:number}){
 const price=(n:number)=>Number.isFinite(n)?String(Number(n.toPrecision(10))):'sin confirmar';
 if(![entry,levels.stop,levels.target].every(n=>Number.isFinite(n)&&n>0))throw rejectedPlan(`${symbol}: precio de entrada, SL o TP sin confirmar. Se descarta esta señal sin enviar una orden.`);
 if(side*(entry-levels.stop)<=0)throw rejectedPlan(`${symbol}: el SL ${price(levels.stop)} no queda del lado de pérdida de la entrada ${price(entry)}. Se descarta esta señal sin enviar una orden.`);
 if(side*(levels.target-entry)<=0)throw rejectedPlan(`${symbol}: el precio de entrada ${price(entry)} ya alcanzó o superó el TP fijo ${price(levels.target)}. Esta señal ya no tiene recorrido; se descarta y la búsqueda continúa.`);
}
export function normalMotorLevels(entry:number,quantity:number,side:1|-1,target:number,tick:number,boost:0|20|50){return {stop:crossLossStop(entry,quantity,side,tick,boost===50?1:boost===20?.65:.5),target:Number(((side===-1?Math.ceil(target/tick-1e-8):Math.floor(target/tick+1e-8))*tick).toPrecision(12))}}
/** Same candidate, sizing and exit equations as the Ricardo simulation. Price is the executable entry estimate. */
export function planImpulsoRsiExecution(m:V2Market,strategy:string,side:1|-1,available:number,boost:0|20|50,fee:number,slip:number,reservedEvidence?:V2Evidence){
 validateImpulsoRsi({'3m':m.primary,'15m':m.context,...m.frames},strategy,side,m.observedAt);
 if(reservedEvidence&&(reservedEvidence.strategy!==strategy||reservedEvidence.signalSide!==side||reservedEvidence.signalTime!==m.primary.at(-1)?.t))throw rejectedPlan('La reserva no corresponde a esta señal; se descarta sin enviar una orden.');
 const config={...V2_DEFAULT,boost,fee,slip},candidate=reservedEvidence?{side,evidence:reservedEvidence,reason:undefined}:v2Candidate(m,'normal',strategy,config);
 if(!candidate||candidate.side!==side)throw Error('Sin señal normal confirmada');if(candidate.reason)throw Error(candidate.reason);
 const fillSlip=slip+m.spread/2,sizing=v2MaximumSize({price:m.mark,available,baseMargin:.2,boost,step:m.step,minimum:m.minimum,minNotional:m.minNotional,fee,slip:fillSlip,brackets:m.brackets}),levels=normalMotorLevels(m.mark,sizing.quantity,side,candidate.evidence.plannedTarget!,m.tick,boost),reward=netAt(m.mark,levels.target,side,fee,fillSlip)*sizing.quantity;
 validateNormalMotorLevels(m.symbol,m.mark,side,levels);
 if(Math.abs(m.mark-candidate.evidence.signalClose!)/candidate.evidence.atr>1.25)throw rejectedPlan('Entrada alejada más de 1,25 ATR de la señal; se descarta y la búsqueda continúa.');
 if(!Number.isFinite(reward)||reward<.005)throw rejectedPlan('El objetivo no deja US$0,005 netos; se descarta y la búsqueda continúa.');
 return {...sizing,...levels,net:reward,fillSlip,evidence:candidate.evidence};
}
export function realMotorSignalUsed(entries:{symbol:string;strategy:string;signalTime:number;entryMotor?:string}[],symbol:string,strategy:string,signalTime:number){return entries.some(e=>e.entryMotor==='impulso-rsi'&&e.symbol.replace(/\/?USDT$/i,'')===symbol.replace(/\/?USDT$/i,'')&&e.strategy===strategy&&e.signalTime===signalTime)}
