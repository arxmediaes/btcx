import type {RealEntryEvidence} from './real-journal';
export type SwingLivePosition={symbol:string;side:string;quantity:number;entryPrice:number;markPrice?:number;unrealizedProfit:number;leverage?:number|null;liquidationPrice?:number|null};
export function swingPositionRows(entries:RealEntryEvidence[],positions:SwingLivePosition[]){
 return positions.flatMap(position=>{
  const entry=[...entries].reverse().find(e=>e.entryMotor==='swing-inverse'&&e.symbol===position.symbol&&e.side===position.side&&!e.outcome?.closedAt);
  if(!entry)return [];
  const price=entry.outcome?.confirmedEntry??entry.entry,quantity=Math.abs(position.quantity);
  const attribution=quantity<=entry.quantity+1e-8&&Math.abs(position.entryPrice-price)/price<.00001;
  return [{position,entry,attribution,partial:attribution&&quantity<entry.quantity-1e-8}];
 });
}
export function swingSummary(entries:RealEntryEvidence[],positions:SwingLivePosition[],dayStart:number){
 const rows=entries.filter(e=>e.entryMotor==='swing-inverse'),closed=rows.filter(e=>e.outcome?.status==='verified'),open=swingPositionRows(rows,positions),verified=open.filter(r=>r.attribution);
 return {rows,closed,open,floating:verified.reduce((s,r)=>s+r.position.unrealizedProfit,0),net:closed.reduce((s,e)=>s+(e.outcome?.net??0),0),today:closed.filter(e=>(e.outcome?.closedAt??0)>=dayStart).reduce((s,e)=>s+(e.outcome?.net??0),0),wins:closed.filter(e=>(e.outcome?.net??0)>0).length};
}
