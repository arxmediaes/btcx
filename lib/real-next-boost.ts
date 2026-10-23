// Optional size bump, rounded down so contract lots respect the selected percentage and available margin.
export function boostedNextQuantity(quantity:number,step:number,maximum:number,percent:20|50=20){
 if(![quantity,step,maximum].every(Number.isFinite)||quantity<=0||step<=0||maximum<quantity)return quantity;
 const boosted=Math.floor((Math.min(quantity*(1+percent/100),maximum)+step*1e-9)/step)*step;
 return Math.max(quantity,Number(boosted.toFixed(12)));
}

export function boostedLossBudget(boost20=false,boost50=false){return boost50?1:boost20?.65:.50;}
