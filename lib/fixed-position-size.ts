// User reference: US$2 for ten positions. Balance only limits affordability.
export const BASE_POSITION_MARGIN=.20;
export function fixedPositionSize(input:{price:number;available:number;leverage:number;step:number;minimumQty:number;rate:number;slipRate:number;boostPercent?:20|50}){
 const {price,available,leverage,step,minimumQty,rate,slipRate}=input;
 if(![price,available,leverage,step,minimumQty,rate,slipRate].every(Number.isFinite)||price<=0||available<=0||leverage<1||step<=0||minimumQty<=0||rate<0||slipRate<0||input.boostPercent!==undefined&&![20,50].includes(input.boostPercent))throw Error('Datos incompletos para calcular el margen fijo.');
 const allocation=BASE_POSITION_MARGIN*(1+(input.boostPercent??0)/100);
 // Only exceed the selected allocation when the venue's smallest valid lot requires it.
 const costPerUnit=price*(1/leverage+2*rate+slipRate);
 const minimumLot=Number((Math.ceil(Math.max(minimumQty,step)/step-1e-8)*step).toPrecision(12));
 const selectedQuantity=Number((Math.floor((allocation*leverage/price+step*1e-8)/step)*step).toPrecision(12));
 const minimumAdjusted=selectedQuantity<minimumLot;
 const desiredQuantity=Math.max(selectedQuantity,minimumLot);
 const affordableQuantity=Number((Math.floor((available/costPerUnit+step*1e-8)/step)*step).toPrecision(12));
 const quantity=Math.min(desiredQuantity,affordableQuantity);
 if(quantity<minimumLot||quantity<=0||quantity*costPerUnit>available+1e-9)throw Error('El saldo disponible no cubre el lote mínimo de esta moneda y sus costes. Se buscará otra entrada.');
 return {quantity,margin:quantity*price/leverage,cost:quantity*costPerUnit,allocation,minimumAdjusted};
}
