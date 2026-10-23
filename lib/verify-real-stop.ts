export function verifyRealStop(orders:any[],input:{symbol:string;id:number;side:'BUY'|'SELL';positionSide?:string;quantity:number;stop:number;tick:number;type?:'STOP_MARKET'|'TAKE_PROFIT_MARKET'}){
 const order=orders.find(o=>Number(o.algoId)===input.id&&o.symbol===input.symbol);
 if(!Number.isFinite(input.id)||input.id<=0||!order||![Number(order.triggerPrice),Number(order.quantity)].every(Number.isFinite)||order.orderType!==(input.type??'STOP_MARKET')||order.side!==input.side||(input.positionSide&&order.positionSide!==input.positionSide)||Math.abs(Number(order.triggerPrice)-input.stop)>input.tick/2||Math.abs(Number(order.quantity)-input.quantity)>1e-8||order.workingType!=='MARK_PRICE')throw Error('Binance aún no confirmó el SL completo con el precio y cantidad calculados. Revisa las órdenes de la posición; no se repetirá la entrada.');
 return order;
}
