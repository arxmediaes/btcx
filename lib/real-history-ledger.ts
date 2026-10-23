import type {RealHistoryRow} from './real-history-view';
/** Merge exact closures, never sum two representations of the same fill. Later sources may correct downwards. */
export function mergeRealHistory(...sources:Array<RealHistoryRow[]|null|undefined>):RealHistoryRow[]|null{
 const available=sources.filter((rows):rows is RealHistoryRow[]=>Array.isArray(rows));if(!available.length)return null;
 const rows=new Map<string,RealHistoryRow>();
 for(const source of available)for(const raw of source){
  if(!raw||typeof raw.id!=='string'||!raw.id||typeof raw.symbol!=='string'||!raw.symbol||!Number.isFinite(raw.realizedPnl)||!Number.isFinite(raw.time)||raw.time<=0)throw Error('Registro de cierre inválido.');
  const symbol=raw.symbol.replace(/\/?USDT$/i,'').toUpperCase(),tradeId=String(raw.tradeId??'');
  const key=tradeId&&tradeId!=='—'?symbol+':'+tradeId:raw.id;
  rows.set(key,{...raw,symbol,tradeId});
 }
 return [...rows.values()].sort((a,b)=>b.time-a.time);
}
export function historyRecoveryFor(raw:unknown,userId:string,profile:'primary'|'secondary',accountKey:string){
 if(typeof raw!=='string'||!raw)return null;let data:any;try{data=JSON.parse(raw)}catch{throw Error('Respaldo de historial inválido.')}
 if(data.ownerUserId!==userId||data.profile!==profile||data.accountKey!==accountKey)return null;
 if(!Number.isFinite(data.start)||!Number.isFinite(data.readAt)||!Array.isArray(data.rows)||!data.rows.length)throw Error('Respaldo de historial incompleto.');
 const rows=mergeRealHistory(data.rows)!;if(rows.some(r=>r.time<=data.start||r.time>data.readAt))throw Error('Fechas del respaldo inválidas.');
 return {accountKey,scopeStart:data.start,readAt:data.readAt,rows};
}
