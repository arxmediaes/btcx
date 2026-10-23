import {excludedRealClose,excludedRealEntry} from './real-history-exclusions';
import type {RealEntryEvidence} from './real-journal';
export type RealFill={id:string;orderId:string;symbol:string;side:string;positionSide:string;qty:string;price:string;realizedPnl:string;commission:string;commissionAsset:string;time:number};
export type RealOutcome={status:'excluded'|'verified'|'open'|'unmatched'|'ambiguous'|'fees-unverified';reason?:string;gross?:number;commission?:number;net?:number;confirmedEntry?:number;closedAt?:number;tradeIds?:string[]};
/** Binance REST uses numeric IDs; retain exact strings and reject already-rounded IDs. */
export function normalizeRealFills(value:unknown):RealFill[]{
 if(!Array.isArray(value))throw Error('Historial de ejecuciones inválido.');
 const id=(v:unknown)=>{if(typeof v==='number'&&!Number.isSafeInteger(v))throw Error('ID de ejecución sin precisión verificable.');const text=String(v??'');if(!/^\d+$/.test(text))throw Error('ID de ejecución inválido.');return BigInt(text).toString()};
 return value.map(row=>{if(!row||typeof row!=='object')throw Error('Ejecución incompleta.');return {...row,id:id(row.id),orderId:id(row.orderId)} as RealFill});
}
export function reconcileEntry(entry:RealEntryEvidence,fills:RealFill[]):RealOutcome{
 if(typeof entry.orderId==='number'&&!Number.isSafeInteger(entry.orderId))return{status:'unmatched',reason:'ID antiguo perdió precisión; no se atribuye por aproximación'};
 let normalized:RealFill[];try{normalized=normalizeRealFills(fills)}catch(error){return {status:'unmatched',reason:error instanceof Error?error.message:'Ejecuciones inválidas'}}
 const rows=[...new Map(normalized.filter(f=>f.symbol===entry.symbol).map(f=>[f.id,f])).values()].sort((a,b)=>a.time-b.time|| (BigInt(a.id)<BigInt(b.id)?-1:1));
 const opening=rows.filter(f=>f.orderId===String(entry.orderId));
 if(!opening.length)return{status:'unmatched',reason:'Ejecuciones de entrada pendientes'};
 const side=entry.side==='LONG'?'BUY':'SELL',position=opening[0].positionSide;
 if(opening.some(f=>f.side!==side||Number(f.realizedPnl)!==0))return{status:'ambiguous',reason:'Entrada mezclada con cierre o reversión'};
 const quantity=opening.reduce((s,f)=>s+Number(f.qty),0),epsilon=Math.max(1e-9,quantity*1e-7);
 if(!(quantity>0))return{status:'unmatched'};
 let remaining=quantity;const exits:RealFill[]=[];
 for(const f of rows){if(f.time<opening[0].time||f.positionSide!==position||f.orderId===String(entry.orderId))continue;
  if(f.side===side)return{status:'ambiguous',reason:'Otra entrada mezcló la posición antes de cerrar'};
  const qty=Number(f.qty);if(!(qty>0)||qty>remaining+epsilon)return{status:'ambiguous',reason:'El cierre incluye cantidad ajena a esta ficha'};
  exits.push(f);remaining-=qty;if(remaining<=epsilon)break;
 }
 if(remaining>epsilon)return{status:'open'};
 if(exits.some(f=>excludedRealClose(f.symbol,f.time,f.id)))return{status:'excluded',reason:'Cierre accidental excluido por el usuario; no se usa para aprender',closedAt:exits.at(-1)!.time,tradeIds:[...opening,...exits].map(f=>f.id)};
 const all=[...opening,...exits];if(all.some(f=>f.commissionAsset!=='USDT'||!Number.isFinite(Number(f.commission))))return{status:'fees-unverified',reason:'Comisión requiere conversión verificable'};
 const gross=exits.reduce((s,f)=>s+Number(f.realizedPnl),0),commission=all.reduce((s,f)=>s+Number(f.commission),0);
 if(!Number.isFinite(gross))return{status:'unmatched'};
 return{status:'verified',gross,commission,net:gross-commission,confirmedEntry:opening.reduce((s,f)=>s+Number(f.qty)*Number(f.price),0)/quantity,closedAt:exits.at(-1)!.time,tradeIds:all.map(f=>f.id)};
}
export const executionPolicy=(e:RealEntryEvidence)=>e.reason.includes('Entrada contraria al consenso')?'inverse':'follow';
export function strategyMemory(entries:RealEntryEvidence[],strategy:string,mode:string,coin?:string,tf?:string,policy:'follow'|'inverse'='follow'){
 const pool=entries.filter(e=>e.strategy===strategy&&e.mode===mode&&executionPolicy(e)===policy&&!excludedRealEntry(e)&&e.outcome?.status==='verified');
 const local=pool.filter(e=>e.symbol===coin&&e.timeframe===tf),sample=local.length>=10?local:pool;
 const mean=sample.length?sample.reduce((s,e)=>s+(e.outcome!.net||0)/Math.max(e.quantity*e.entry,1e-9),0)/sample.length:0;
 return {n:sample.length,bonus:Math.max(-2,Math.min(2,mean*1000))*sample.length/(sample.length+20)};
}
