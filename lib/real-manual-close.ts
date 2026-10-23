type Position={symbol:string;side:string;quantity:number;stopOrderId?:number|null;targetOrderId?:number|null};
type Snapshot={positionMode?:'ONE_WAY'|'HEDGE';account:{positions:Position[]}};
/** Never cancel protection or report success on an acknowledgement alone. */
export async function verifiedManualClose<S extends Snapshot,R>(input:{symbol:string;side:string;read:()=>Promise<S>;send:(order:{symbol:string;side:'BUY'|'SELL';quantity:number;positionSide?:'LONG'|'SHORT'})=>Promise<R>;cancel:(id:number)=>Promise<unknown>;updated:(snapshot:S)=>void}){
 const before=await input.read();input.updated(before);
 const position=before.account.positions.find(p=>p.symbol===input.symbol&&p.side===input.side);
 if(!position||!(Math.abs(Number(position.quantity))>0))throw Error('La posición seleccionada ya no está abierta. No se envió otra orden.');
 if(!['LONG','SHORT'].includes(position.side)||!before.positionMode)throw Error('Binance no confirmó el lado y el modo de posición. Actualiza antes de cerrar.');
 const quantity=Math.abs(Number(position.quantity));if(!Number.isFinite(quantity))throw Error('Binance no confirmó una cantidad válida.');
 const result=await input.send({symbol:input.symbol,side:position.side==='LONG'?'SELL':'BUY',quantity,positionSide:before.positionMode==='HEDGE'?position.side as 'LONG'|'SHORT':undefined});
 let after:S;try{after=await input.read()}catch{throw Error('Orden de cierre enviada, pero la lectura de confirmación falló. Actualiza y verifica antes de volver a cerrar; las protecciones se conservaron.');}
 input.updated(after);
 if(after.account.positions.some(p=>p.symbol===input.symbol&&p.side===input.side&&Math.abs(Number(p.quantity))>0))throw Error('El cierre no está completo: queda cantidad abierta. Las protecciones se conservaron. Revisa la cantidad actual antes de cerrar el remanente.');
 const cleanup=await Promise.allSettled([...new Set([position.stopOrderId,position.targetOrderId].filter((id):id is number=>typeof id==='number'&&Number.isFinite(id)&&id>0))].map(input.cancel));
 return {result,after,quantity,cleanupPending:cleanup.some(r=>r.status==='rejected')};
}
