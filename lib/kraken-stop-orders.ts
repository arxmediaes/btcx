// Read formats differ from the send-order "stp" code; also retain verified IDs.
export function isKrakenStop(order:any,knownIds:string[]=[]):boolean{
 const type=String(order?.orderType||order?.type||'').toLowerCase();
 return ['stp','stop','stop_loss','stop-loss','trailing_stop','trailing-stop'].includes(type)||knownIds.includes(String(order?.order_id||''))||(/^hyrule-/.test(String(order?.cliOrdId||''))&&/-sl$/.test(String(order?.cliOrdId||'')));
}
