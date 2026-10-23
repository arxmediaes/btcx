import {V2_DEFAULT,swingNormalCandidates,swingArmLevels,swingPairPlan,type V2Evidence,type V2Market} from './binance-v2-swing';
import {validateNormalMotorLevels} from './real-entry-motor';
import {verifyRealStop} from './verify-real-stop';
export type SwingReservation={symbol:string;strategy:string;side:1|-1;signalTime:number;scheduledAt:number;evidence:V2Evidence;source?:{id:string;quantity:number;leverage:number;stop:number;target:number;rawEntry:number;openedAt:number;boost:0|20|50}};
export const swingSignalKey=(r:Pick<SwingReservation,'symbol'|'strategy'|'signalTime'>)=>`${r.symbol}:${r.strategy}:${r.signalTime}`;
export function discoverSwingNormal(m:V2Market,boost:0|20|50,used:(key:string)=>boolean,now=Date.now()):SwingReservation|null{
 const last=m.primary.at(-1);if(!last||last.t+3600000>now||now-(last.t+3600000)>3600000||Math.abs(now-m.observedAt)>15000)return null;
 const picked=swingNormalCandidates(m,{...V2_DEFAULT,boost}).find(({candidate})=>candidate&&!candidate.reason);
 if(picked&&used(swingSignalKey({symbol:m.symbol,strategy:picked.option.strategy,signalTime:last.t})))return null;
 return picked?.candidate?{symbol:m.symbol,strategy:picked.option.strategy,side:picked.candidate.side,signalTime:last.t,scheduledAt:(Math.floor(now/60000)+1)*60000,evidence:picked.candidate.evidence}:null;
}
export function assertSwingWindow(r:SwingReservation,now:number){
 if(now<r.scheduledAt||now>=r.scheduledAt+60000||r.signalTime+3600000>now||now-(r.signalTime+3600000)>3600000)throw Error('Reserva swing fuera de su minuto de entrada; esperar una señal nueva.');
}
export function assertSwingVacant(symbol:string,positions:{symbol:string}[],orders:unknown[],conditionals:unknown[],maxPositions:number){
 if(positions.some(p=>p.symbol.replace(/\//g,'')===symbol)||orders.length||conditionals.length)throw Error(`${symbol}: activo ocupado por otra posición u orden; entrada omitida sin modificarla.`);
 if(positions.length>=maxPositions)throw Error('Cupo real completo; no se modifica ninguna posición.');
}
export function planSwingInverse(m:V2Market,r:SwingReservation,available:number,boost:0|20|50,fee:number,now=Date.now()){
 assertSwingWindow(r,now);
 const e=r.evidence;
 if(m.symbol!==r.symbol||Math.abs(now-m.observedAt)>15000||e.signalTime!==r.signalTime||e.signalSide!==r.side||e.strategy!==r.strategy)throw Error('La reserva swing no corresponde al mercado o la señal.');
 const source=r.source;
 const shared=source?null:swingPairPlan(m,{...V2_DEFAULT,boost,fee},r.side,e,m.mark,available,available);
 let sizing=shared?.sizing;
 const levels=swingArmLevels(r.side,source?.stop??shared!.stop,source?.target??shared!.target,'inverse');validateNormalMotorLevels(m.symbol,m.mark,levels.side,levels);if(m.executionMark!==undefined)validateNormalMotorLevels(m.symbol,m.executionMark,levels.side,levels);
 if(source){
  if(!source.id||source.openedAt!==r.scheduledAt||source.stop!==e.plannedStop||source.target!==e.plannedTarget||![source.quantity,source.leverage,source.rawEntry].every(n=>Number.isFinite(n)&&n>0))throw Error('Entrada simulada de origen incompleta o alterada.');
  const quantity=source.quantity,leverage=source.leverage,notional=quantity*m.mark,slip=V2_DEFAULT.slip+m.spread/2;
  if(quantity<m.minimum||Math.abs(quantity/m.step-Math.round(quantity/m.step))>1e-6||notional+1e-9<m.minNotional)throw Error('La cantidad normal simulada no cumple el mínimo real actual; no se aumenta ni cambia.');
  if(!m.brackets.some(b=>leverage<=b.leverage&&notional>=b.floor&&notional<b.cap))throw Error('Apalancamiento simulado incompatible con el tramo real actual.');
  const cost=notional*(1/leverage+2*fee+slip);if(cost>available+1e-9)throw Error('Saldo real insuficiente para copiar la cantidad simulada y sus costes.');
  sizing={quantity,leverage,margin:notional/leverage,cost,allocation:.2*(1+source.boost/100),minimumLot:quantity,minimumAdjusted:quantity*source.rawEntry/leverage>.2*(1+source.boost/100),maintenanceRate:0,maintenanceOffset:0};
 }
 // No rounding or risk-budget replacement: these are the simulation's absolute barriers.
 for(const value of [levels.stop,levels.target])if(Math.abs(value/m.tick-Math.round(value/m.tick))>1e-5)throw Error('Los niveles fijos no coinciden con el tick actual.');
 return {...sizing!,...levels};
}
/** Exchange adapters are injected so the entire submission path can be tested offline. */
export async function executeSwingInverse(input:{reservation:SwingReservation;market:V2Market;available:number;boost:0|20|50;fee:number;maxPositions:number;positionSide?:'LONG'|'SHORT'},io:{now:()=>number;enabled:()=>boolean;used:()=>boolean;consume:()=>void;vacancy:()=>Promise<{positions:{symbol:string}[];orders:unknown[];conditionals:unknown[];available?:number}>;refreshMarket?:()=>Promise<V2Market>;leverage:(n:number)=>Promise<{leverage:number}>;entry:(side:1|-1,qty:number)=>Promise<{quantity:number;price:number;orderId:string|number}>;filled:(fill:{quantity:number;price:number;orderId:string|number},plan:ReturnType<typeof planSwingInverse>)=>void;protection:(kind:'sl'|'tp',side:1|-1,qty:number,price:number)=>Promise<number>;orders:()=>Promise<any[]>;emergency:(quantity:number)=>Promise<void>}){
 const r=input.reservation;let market=input.market,available=input.available;
 if(io.refreshMarket&&Math.abs(io.now()-market.observedAt)>15000)market=await io.refreshMarket();
 let plan=planSwingInverse(market,r,available,input.boost,input.fee,io.now());
 const guard=()=>{assertSwingWindow(r,io.now());if(!io.enabled()||io.used())throw Error('Búsqueda pausada o señal ya utilizada.');};
 guard();let state=await io.vacancy();assertSwingVacant(r.symbol,state.positions,state.orders,state.conditionals,input.maxPositions);guard();
 const confirmed=await io.leverage(plan.leverage);if(confirmed.leverage!==plan.leverage)throw Error('Apalancamiento no confirmado; no se envió una entrada.');
 state=await io.vacancy();assertSwingVacant(r.symbol,state.positions,state.orders,state.conditionals,input.maxPositions);guard();
 available=state.available??available;
 if(io.refreshMarket)market=await io.refreshMarket();
 const refreshed=planSwingInverse(market,r,available,input.boost,input.fee,io.now());
 if(refreshed.quantity!==plan.quantity||refreshed.leverage!==confirmed.leverage)throw Error('La cotización cambió el tamaño o apalancamiento; no se envía una cantidad distinta de la simulada.');
 plan=refreshed;guard();
 // Persist before sending: an ambiguous network response must never trigger a second entry.
 io.consume();const fill=await io.entry(plan.side,plan.quantity);
 if(!(fill.quantity>0)||!(fill.price>0))throw Error('Ejecución no confirmada; búsqueda detenida. Revisa Binance antes de activar otra vez.');
 io.filled(fill,plan);
 try{
  validateNormalMotorLevels(r.symbol,fill.price,plan.side,plan);
  const sl=await io.protection('sl',plan.side,fill.quantity,plan.stop),tp=await io.protection('tp',plan.side,fill.quantity,plan.target),orders=await io.orders();
  const verify={symbol:r.symbol,side:(plan.side===1?'SELL':'BUY') as 'SELL'|'BUY',quantity:fill.quantity,tick:input.market.tick,positionSide:input.positionSide};
  verifyRealStop(orders,{...verify,id:sl,stop:plan.stop});verifyRealStop(orders,{...verify,id:tp,stop:plan.target,type:'TAKE_PROFIT_MARKET'});
  return {...fill,...plan,stopOrderId:sl,targetOrderId:tp};
 }catch(error){
  try{await io.emergency(fill.quantity)}catch{throw Error('Protección o cierre de emergencia sin confirmar. Revisa inmediatamente la posición Swing Inversa en Binance.');}
  throw Error(`La nueva entrada inversa se cerró por fallo de protección: ${error instanceof Error?error.message:'SL/TP no confirmado'}`);
 }
}
