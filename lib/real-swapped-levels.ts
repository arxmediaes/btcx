export function normalRealLevels(entry:number,side:1|-1,stopDistance:number,structuralTarget:number,tick:number){
 if(![entry,stopDistance,structuralTarget,tick].every(Number.isFinite)||entry<=0||stopDistance<=0||tick<0)throw Error('Niveles de protección inválidos.');
 const round=(price:number,up:boolean)=>tick>0?Number(((up?Math.ceil(price/tick-1e-8):Math.floor(price/tick+1e-8))*tick).toPrecision(12)):price;
 return {stop:round(entry-side*stopDistance,side===-1),target:round(structuralTarget,side===-1)};
}
