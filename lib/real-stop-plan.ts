export const MAX_SCALP_STOP_RATIO=.02;
export function planRealStop(price:number,desiredDistance:number,maxLeverage:number,scalp:boolean,maximumCrossed=false){
 const ratio=desiredDistance/price;
 if(![price,desiredDistance,maxLeverage].every(Number.isFinite)||price<=0||desiredDistance<=0||maxLeverage<1)throw Error('No se pudo calcular un stop-loss válido.');
 if(scalp&&ratio>MAX_SCALP_STOP_RATIO)throw Error(`La estructura necesita un SL de ${(ratio*100).toFixed(2)}%, por encima del máximo de 2,00%. Se buscará otra moneda sin recortar su protección.`);
 if(maximumCrossed)return {leverage:Math.max(1,Math.floor(maxLeverage)),distance:desiredDistance};
 const leverage=Math.max(1,Math.min(maxLeverage,Math.floor(.55/ratio))),buffer=Math.max(.003,Math.min(.04,.65/leverage)),distance=Math.min(desiredDistance,price*buffer*.9);
 if(distance<desiredDistance*.95)throw Error('El margen de apalancamiento calculado no permite conservar el SL estructural.');
 return {leverage,distance};
}

export const CROSS_LOSS_USD=.50;
export function crossLossStop(entry:number,quantity:number,side:1|-1,tick:number,lossBudget=CROSS_LOSS_USD){
 if(![entry,quantity,tick,lossBudget].every(Number.isFinite)||entry<=0||quantity<=0||tick<=0||lossBudget<=0||lossBudget>100||![1,-1].includes(side))throw Error('No se puede calcular el SL de pérdida solicitado.');
 const raw=entry-side*lossBudget/quantity;
 const stop=Number(((side===1?Math.ceil(raw/tick-1e-10):Math.floor(raw/tick+1e-10))*tick).toFixed(12));
 if(!(stop>0&&side*(entry-stop)>0&&side*(entry-stop)*quantity<=lossBudget+1e-8))throw Error('El tamaño o tick no permiten un SL de pérdida solicitado.');
 return stop;
}
