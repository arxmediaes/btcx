// Independent of the last displayed order. Never clear an in-flight order lock.
export function realCycleAction(enabled:boolean,locked:boolean,count:number|undefined,maximum:number,hasTimer:boolean){
 if(!enabled)return 'off';
 if(locked)return 'wait';
 if(count===undefined)return 'read';
 if(count>=maximum)return 'full';
 return hasTimer?'scheduled':'scan';
}
// A failed reservation must yield to other due entries during its retry delay.
export function readyRealReservation<T extends {scheduledAt:number}>(pending:Record<string,T>,occupied:Set<string>,cooldowns:Record<string,number>,now:number){
 return Object.entries(pending).filter(([coin,p])=>!occupied.has(coin)&&p.scheduledAt<=now&&now<=p.scheduledAt+60000&&!(cooldowns[coin]>now)).sort((a,b)=>a[1].scheduledAt-b[1].scheduledAt)[0];
}
export function realReservationLeadWait(pending:Record<string,{scheduledAt:number}>,occupied:Set<string>,now:number){
 const next=Object.entries(pending).filter(([coin,p])=>!occupied.has(coin)&&p.scheduledAt>now).map(([,p])=>p.scheduledAt-now).sort((a,b)=>a-b)[0];
 return next!==undefined&&next<=8000?Math.max(50,next):0;
}
// Visit each eligible symbol before retrying the highest-ranked one.
export function nextRealScanCandidate<T extends {symbol:string}>(candidates:T[],pool:string[],cursor:number){
 for(let offset=0;offset<pool.length;offset++){
  const index=(cursor+offset)%pool.length,candidate=candidates.find(row=>row.symbol===pool[index]);
  if(candidate)return {candidate,cursor:(index+1)%pool.length};
 }
 return {candidate:undefined,cursor};
}
export function scalpTargetCap(stopDistance:number,price:number,atr1m:number,structureRoom:number){
 return Math.min(stopDistance*.35,price*.002,atr1m>0?atr1m*2:Infinity,structureRoom>0?structureRoom*.8:Infinity);
}

// Real execution structure: targets stay before the nearest recent range edge.
export function realScalpTargetPlan(stopDistance:number,price:number,atrPrimary:number,atr1m:number,structureRoom:number,tick:number){
 const buffer=Math.max(tick,atr1m*.15);
 const structuralCap=structureRoom>0?Math.max(0,structureRoom-buffer):Infinity;
 const cap=Math.min(stopDistance*.85,price*.006,atrPrimary*2.5,structuralCap);
 const preferred=Math.min(cap,Math.max(atrPrimary,atr1m*1.5,stopDistance*.5));
 return {cap,preferred};
}
