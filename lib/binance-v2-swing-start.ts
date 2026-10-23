export const SWING_START_REPAIR='swing-start-repair-20261015';
export function prepareSwingStart(r:{startRepair?:string;running:boolean;trades:{status:string}[]}){
 if(r.startRepair===SWING_START_REPAIR)return false;
 r.startRepair=SWING_START_REPAIR;
 if(!r.trades.some(t=>t.status==='open'||t.status==='closed'))r.running=true;
 return true;
}
