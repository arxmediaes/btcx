export type LossPause={until:number;consumedThrough:number};
export type ClosedResult={id:string;closedAt:number;net:number|null;verified:boolean};
export const LOSS_PAUSE_MS=60*60*1000;
export function normalizeLossPause(raw:any):LossPause{return {until:Number.isFinite(Number(raw?.until))?Math.max(0,Number(raw.until)):0,consumedThrough:Number.isFinite(Number(raw?.consumedThrough))?Math.max(0,Number(raw.consumedThrough)):0};}
export function evaluateLossPause(rows:ClosedResult[],raw:LossPause,now:number):LossPause{
 const previous=normalizeLossPause(raw);if(previous.until>now)return previous;
 const closed=[...new Map(rows.filter(r=>Number.isFinite(r.closedAt)&&r.closedAt>previous.consumedThrough).map(r=>[r.id,r])).values()].sort((a,b)=>b.closedAt-a.closedAt||b.id.localeCompare(a.id));
 if(closed.length>=3&&closed.slice(0,3).every(r=>r.verified&&r.net!==null&&Number.isFinite(r.net)&&r.net<0))return {until:now+LOSS_PAUSE_MS,consumedThrough:closed[0].closedAt};
 return previous;
}
export function lossPauseStatus(rows:ClosedResult[],raw:LossPause|undefined,now:number,ready:boolean,enabled=true){
 const current=normalizeLossPause(raw),guard=enabled&&ready?evaluateLossPause(rows,current,now):current;
 return {current,guard,blocked:enabled&&(!ready||guard.until>now),remaining:enabled?Math.max(0,guard.until-now):0};
}
// A newly armed night session counts closes from this moment, not old losses.
export function startLossPauseSession(now:number):LossPause{return {until:0,consumedThrough:now};}
