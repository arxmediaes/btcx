export function profitableCloserTarget(input:{entry:number;quantity:number;target:number;side:1|-1;tick:number;percent:number;entryCosts:number;rate:number;slipRate:number}){
 const {entry,quantity,target,side,tick,percent,entryCosts,rate,slipRate}=input;
 if(!Object.values(input).every(Number.isFinite)||entry<=0||quantity<=0||tick<=0||percent<=0||percent>=100||entryCosts<0||rate<0||rate>=1||slipRate<0||side*(target-entry)<=0)throw Error('Datos inválidos para acercar TP.');
 const totalCost=entryCosts+quantity*entry*slipRate+.001,minimum=(quantity*entry+side*totalCost)/(quantity*(1-side*rate)),safe=minimum+side*tick*2,requested=entry+(target-entry)*(1-percent/100),raw=side===1?Math.max(requested,safe):Math.min(requested,safe),price=Number(((side===1?Math.ceil(raw/tick-1e-8):Math.floor(raw/tick+1e-8))*tick).toPrecision(12));
 const net=quantity*side*(price-entry)-entryCosts-quantity*price*rate-quantity*entry*slipRate;
 if(net<=0||side*(target-price)<=tick*.5)throw Error('El TP actual ya está cerca del mínimo rentable; no se puede acercar más después de costes.');
 return {target:price,net,requestedPercent:percent,actualPercent:(1-Math.abs(price-entry)/Math.abs(target-entry))*100,limited:Math.abs(price-requested)>tick*1.01};
}
