import {PNL_PERIOD_START} from './pnl-period';
import {excludedRealClose} from './real-history-exclusions';
import type {RealEntryEvidence} from './real-journal';
import type {SwingSourceRound} from './swing-normal-source';
/** Use shared evidence of the first real inverse entry; never use a device's cache date. */
export function swingHistoryStart(entries:RealEntryEvidence[],round?:SwingSourceRound):number|null{
 const times=entries.filter(e=>e.entryMotor==='swing-inverse').map(e=>e.openedAt);
 for(const copy of Object.values(round?.copies||{})){if(copy.status==='opened'&&copy.orderId){const trade=round?.trades.find(t=>t.id===copy.sourceId);times.push(trade?.openedAt??copy.time)}}
 const valid=times.filter(t=>Number.isFinite(t)&&t>0);return valid.length?Math.min(...valid):null;
}
/** Restored from the first included close of the owner's supplied mobile export (inclusive).
 * This is the recovered report boundary, not an inferred bot entry time. No journal required.
 */
export const RECOVERED_PRIMARY_SWING_HISTORY_START=1792638496043;
export function accountHistoryStart(profile:'primary'|'secondary',entries:RealEntryEvidence[],round?:SwingSourceRound,connectedAt?:number):number|null{
 if(profile==='primary')return RECOVERED_PRIMARY_SWING_HISTORY_START;
 return swingHistoryStart(entries,round)??(Number.isFinite(connectedAt)&&Number(connectedAt)>0?Number(connectedAt):null);
}
export type RealHistoryRow={id:string;symbol:string;realizedPnl:number;time:number;tradeId:string};
/** One source for the table and its balloon. Realized P&L rows are gross, not net income. */
export function realHistoryView(input:RealHistoryRow[]|null|undefined,dayStart:number,afterTime:number|null=PNL_PERIOD_START){
 if(afterTime===null||!Array.isArray(input))return {rows:null,total:null,today:null,count:null};
 const rows=[...new Map(input.filter(row=>row.time>afterTime&&!excludedRealClose(row.symbol,row.time,row.tradeId)).map(row=>[row.id,row])).values()].sort((a,b)=>b.time-a.time);
 if(rows.some(row=>!Number.isFinite(row.realizedPnl)||!Number.isFinite(row.time)))return {rows:null,total:null,today:null,count:null};
 return {rows,total:rows.reduce((sum,row)=>sum+row.realizedPnl,0),today:rows.filter(row=>row.time>=dayStart).reduce((sum,row)=>sum+row.realizedPnl,0),count:rows.length};
}
