export type IncomeRow={symbol?:string;incomeType:string;income:string;asset:string;time:number;tranId?:string|number;tradeId?:string};
export const incomeKey=(row:IncomeRow)=>`${row.incomeType}:${row.tranId??`${row.symbol}:${row.tradeId}:${row.time}:${row.income}`}`;
export async function collectIncomePages(read:(page:number)=>Promise<unknown>):Promise<IncomeRow[]>{
  const rows=new Map<string,IncomeRow>();
  for(let page=1;;page++){
    const batch=await read(page);
    if(!Array.isArray(batch))throw Error('Historial de ingresos inválido.');
    const before=rows.size;
    for(const row of batch){if(!row||!Number.isFinite(Number(row.time))||!Number.isFinite(Number(row.income)))throw Error('Registro de ingreso inválido.');rows.set(incomeKey(row),row)}
    if(batch.length<1000)return [...rows.values()];
    if(rows.size===before)throw Error('Binance repitió una página; no se pudo verificar el historial completo.');
  }
}
export function incomeBreakdown(rows:IncomeRow[],afterTime:number){
  let realized=0,commission=0,funding=0,adjustments=0;
  for(const row of new Map(rows.map(row=>[incomeKey(row),row])).values()){
    if(Number(row.time)<=afterTime||row.asset!=='USDT')continue;
    const amount=Number(row.income);if(!Number.isFinite(amount))continue;
    if(row.incomeType==='REALIZED_PNL')realized+=amount;
    else if(row.incomeType==='COMMISSION')commission+=amount;
    else if(row.incomeType==='FUNDING_FEE')funding+=amount;
    else if(['INSURANCE_CLEAR','REFERRAL_KICKBACK','COMMISSION_REBATE','API_REBATE'].includes(row.incomeType))adjustments+=amount;
  }
  return {realized,commission,funding,adjustments,net:realized+commission+funding+adjustments};
}
export function verifiedIncome(rows:PromiseSettledResult<unknown>,baseline:number,projectStart:number,queryStart:number){
  if(rows.status!=='fulfilled'||!Array.isArray(rows.value))return {status:'incomplete' as const,breakdown:null};
  if(!baseline||queryStart>projectStart)return {status:'baseline-or-coverage-missing' as const,breakdown:null};
  return {status:'verified' as const,breakdown:incomeBreakdown(rows.value,baseline)};
}
