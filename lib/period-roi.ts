import {PNL_PERIOD_START} from './pnl-period';
import {IncomeRow,incomeBreakdown,incomeKey} from './real-income';
export function periodRoi(result:PromiseSettledResult<unknown>,queryStart:number,account:any){
 const missing={roiPeriodPercent:null,roiPeriodCapital:null,roiPeriodStatus:'incomplete'};
 if(result.status!=='fulfilled'||!Array.isArray(result.value)||queryStart>PNL_PERIOD_START)return missing;
 const assets=Array.isArray(account.assets)?account.assets:[];
 if(assets.some((a:any)=>a.asset!=='USDT'&&Math.abs(Number(a.walletBalance||0))>1e-8))return {...missing,roiPeriodStatus:'multiple-assets'};
 const wallet=Number(assets.find((a:any)=>a.asset==='USDT')?.walletBalance??account.totalWalletBalance);
 const rows=[...new Map((result.value as IncomeRow[]).map(r=>[incomeKey(r),r])).values()].filter(r=>Number(r.time)>PNL_PERIOD_START&&r.asset==='USDT');
 if(!Number.isFinite(wallet)||rows.some(r=>!Number.isFinite(Number(r.income))))return missing;
 const capital=wallet-rows.reduce((n,r)=>n+Number(r.income),0),net=incomeBreakdown(rows,PNL_PERIOD_START).net;
 if(!(capital>0))return {...missing,roiPeriodStatus:'initial-capital-missing'};
 return {roiPeriodCapital:capital,roiPeriodPercent:net/capital*100,roiPeriodStatus:'reconstructed'};
}
