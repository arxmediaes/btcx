// Near target, always inside the already validated structural boundary.
export function krakenScalpTarget(entry:number,side:1|-1,structuralTarget:number,atr:number,tick:number,rate:number,slipRate:number){
 if(![entry,structuralTarget,atr,tick,rate,slipRate].every(Number.isFinite)||entry<=0||atr<=0||tick<=0)throw Error('Datos insuficientes para el TP cercano.');
 const room=side*(structuralTarget-entry),breakEven=entry*(2*rate+slipRate)/(1-side*rate);
 const preferred=Math.max(atr*.75,breakEven*1.5+tick*2),distance=Math.min(room,entry*.003,preferred);
 const raw=entry+side*distance,target=Number(((side===1?Math.floor(raw/tick+1e-8):Math.ceil(raw/tick-1e-8))*tick).toPrecision(12)),actualDistance=side*(target-entry);
 if(actualDistance<=breakEven||actualDistance>room+tick*1e-8)throw Error('El TP cercano no deja recorrido suficiente después de costes.');
 return {target,distance:actualDistance};
}
