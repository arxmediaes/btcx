export const SCALP_NET_GOAL=0.05;
export function scalpNet(quantity:number,entry:number,target:number,rate:number,slipRate:number){return quantity*(Math.abs(target-entry)-(entry+target)*rate-entry*slipRate)};
export function netTargetDistance(quantity:number,entry:number,side:1|-1,rate:number,slipRate:number,goal=SCALP_NET_GOAL){return (goal/quantity+entry*(2*rate+slipRate))/(1-side*rate)};
export function sizeRealScalp(input:{price:number;side:1|-1;available:number;slots:number;leverage:number;step:number;minimumQty:number;previousQty:number;targetCap:number;rate:number;slipRate:number;requireNetGoal?:boolean}){
 const {price,side,available,slots,leverage,step,minimumQty,previousQty,targetCap,rate,slipRate}=input;
 const costPerUnit=price*(1/leverage+2*rate+slipRate);
 const floor=(n:number)=>Number((Math.floor((n+step*1e-8)/step)*step).toPrecision(12));
 const ceil=(n:number)=>Number((Math.ceil((n-step*1e-8)/step)*step).toPrecision(12));
 if(![price,available,leverage,step,minimumQty,previousQty,targetCap,rate,slipRate,slots].every(Number.isFinite)||price<=0||available<=0||step<=0||leverage<=0||minimumQty<=0||rate<0||slipRate<0)throw Error('Binance no devolvió datos válidos para calcular el margen.');
 const minimum=ceil(minimumQty),minimumCost=minimum*costPerUnit,usableBudget=available*.9;
 if(minimumCost>usableBudget+1e-9)throw Error(`Saldo insuficiente para el mínimo real: necesita $${minimumCost.toFixed(3)} con costes; disponible $${available.toFixed(3)} (utilizable $${usableBudget.toFixed(3)}). Se buscará una moneda con menor mínimo.`);
 // Slots are a preferred allocation, not a reason to reject an affordable minimum.
 const preferredBudget=available*Math.min(.40,.95/Math.max(1,slots));
 const slotBudget=Math.min(usableBudget,Math.max(preferredBudget,minimumCost));
 const maximumQty=Math.max(minimum,floor(slotBudget/costPerUnit)),reservationAdjusted=minimumCost>preferredBudget;

 const netPerUnit=targetCap*(1-side*rate)-price*(2*rate+slipRate);
 if(netPerUnit<=0)throw Error('Sin entrada: antes del máximo o mínimo reciente no hay recorrido suficiente para cubrir comisión y deslizamiento. Espera una nueva estructura; aumentar el tamaño no mejora ese margen.');
 if(input.requireNetGoal){
  const quantity=Math.max(minimum,ceil(SCALP_NET_GOAL/netPerUnit)),requiredCost=quantity*costPerUnit;
  if(requiredCost>usableBudget+1e-9)throw Error(`Para buscar $${SCALP_NET_GOAL.toFixed(2)} netos se necesitan $${requiredCost.toFixed(2)} de margen y costes; quedan $${usableBudget.toFixed(2)} dentro del presupuesto. Buscando otra estructura.`);
  return {quantity,slotBudget:requiredCost,maximumQty:floor(usableBudget/costPerUnit),netGoal:SCALP_NET_GOAL,reservationAdjusted:requiredCost>preferredBudget,minimumCost,targetDistance:netTargetDistance(quantity,price,side,rate,slipRate,SCALP_NET_GOAL)};
 }
 const netGoal=Math.min(SCALP_NET_GOAL,maximumQty*netPerUnit*.75);
 if(netGoal<.005)throw Error('El TP corto no deja al menos $0,005 netos estimados con el saldo disponible.');
 const requiredQty=ceil(netGoal/netPerUnit);
 const quantity=Math.min(maximumQty,Math.max(minimum,requiredQty,ceil(previousQty*1.35)));
 return {quantity,slotBudget,maximumQty,netGoal,reservationAdjusted,minimumCost,targetDistance:netTargetDistance(quantity,price,side,rate,slipRate,netGoal)};
}
