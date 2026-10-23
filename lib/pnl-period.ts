import {incomeBreakdown,IncomeRow} from './real-income';

// Reinicio de métricas solicitado para la prueba de Impulso + RSI.
// Los registros anteriores permanecen archivados; el saldo y las posiciones no se alteran.
export const KRAKEN_PNL_PERIOD_START=Date.parse('2026-10-12T19:25:27-03:00');
export const PNL_PERIOD_START=Date.parse('2026-10-16T13:59:51-03:00');
export function santiagoDayStart(now=Date.now()){
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 let start=Date.parse(date+'T00:00:00Z');
 for(let i=0;i<3;i++){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Santiago',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(start);const value=(type:string)=>Number(parts.find(p=>p.type===type)?.value||0);const delta=value('hour')*3600000+value('minute')*60000+value('second')*1000;if(!delta)break;start+=delta>43200000?86400000-delta:-delta;}
 return start;
}
export function periodPnl(result:PromiseSettledResult<unknown>,queryStart:number,now=Date.now()){
 if(result.status!=='fulfilled'||!Array.isArray(result.value)||queryStart>PNL_PERIOD_START)return {pnlPeriodStart:PNL_PERIOD_START,pnlPeriodNet:null,pnlTodayNet:null};
 const rows=result.value as IncomeRow[];
 return {pnlPeriodStart:PNL_PERIOD_START,pnlPeriodNet:incomeBreakdown(rows,PNL_PERIOD_START).net,pnlTodayNet:incomeBreakdown(rows,Math.max(PNL_PERIOD_START,santiagoDayStart(now)-1)).net};
}
