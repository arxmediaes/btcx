import type {RealEntryEvidence} from './real-journal';
import {swingSummary,type SwingLivePosition} from './swing-position-view';
import {summarizeOpenPnl} from './floating-pnl';
/** Motor identity supplies the baseline: include every real inverse entry, never prior account P&L. */
export function swingProfitView(entries:RealEntryEvidence[],positions:SwingLivePosition[],dayStart:number){
 const unique=[...new Map(entries.filter(e=>e.entryMotor==='swing-inverse').map(e=>[e.id,e])).values()];
 const valid=unique.map(e=>e.outcome?.status==='verified'&&(!Number.isFinite(e.outcome.net)||!Number.isFinite(e.outcome.closedAt))?{...e,outcome:{...e.outcome,status:'unmatched' as const}}:e);
 const stats=swingSummary(valid,positions,dayStart),attributed=stats.open.filter(r=>r.attribution).map(r=>r.position),summary=summarizeOpenPnl(attributed);
 return {...stats,positions:attributed,count:summary.count,best:summary.best,startedAt:unique.length?Math.min(...unique.map(e=>e.openedAt)):null};
}
