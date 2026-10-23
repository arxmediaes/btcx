export type CleanupOrder={algoId?:number;symbol:string;orderType?:string;side?:string;positionSide?:string;reduceOnly?:boolean;closePosition?:boolean};
type Position={symbol:string};
const symbolKey=(symbol:string)=>symbol.replace(/\//g,'').toUpperCase();
export function isClosingProtection(order:CleanupOrder,knownIds:number[]=[]){
 if(!Number.isSafeInteger(order.algoId)||Number(order.algoId)<=0||!order.symbol)return false;
 if(!/^(STOP|STOP_MARKET|TAKE_PROFIT|TAKE_PROFIT_MARKET|TRAILING_STOP_MARKET)$/.test(order.orderType||''))return false;
 return order.reduceOnly===true||order.closePosition===true||knownIds.includes(order.algoId!)||order.positionSide==='LONG'&&order.side==='SELL'||order.positionSide==='SHORT'&&order.side==='BUY';
}
/** Cancel individually, only after fresh account evidence that the entire symbol is flat.
 * Capture IDs before cancellation so new protection is never swept into a bulk DELETE. */
export async function cleanupFlatBinanceProtections(input:{readOrders:()=>Promise<CleanupOrder[]>;readPositions:()=>Promise<Position[]>;cancel:(id:number)=>Promise<unknown>;knownIds?:number[];symbol?:string}){
 const orders=await input.readOrders();if(!Array.isArray(orders))throw Error('Binance no confirmó las órdenes condicionales.');
 const candidates=orders.filter(o=>(!input.symbol||symbolKey(o.symbol)===symbolKey(input.symbol))&&isClosingProtection(o,input.knownIds));
 const attempted:number[]=[];
 for(const order of candidates){
  const positions=await input.readPositions();if(!Array.isArray(positions))throw Error('Binance no confirmó las posiciones.');
  if(positions.some(p=>symbolKey(p.symbol)===symbolKey(order.symbol)))continue;
  attempted.push(order.algoId!);
  try{await input.cancel(order.algoId!)}catch{/* Verify below; a failed cancellation remains eligible on the next sweep. */}
 }
 if(!attempted.length)return {removed:0,pending:0};
 const remaining=await input.readOrders();if(!Array.isArray(remaining))throw Error('Cancelación enviada; falta verificar las órdenes pendientes.');
 const pending=attempted.filter(id=>remaining.some(o=>o.algoId===id));
 return {removed:attempted.length-pending.length,pending:pending.length};
}
