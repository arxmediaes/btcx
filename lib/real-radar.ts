import {coordinatedBinanceFetch,assertBinanceReadAllowed} from './binance-read-coordinator';
export function mergeRadarRows<T extends {t:number}>(previous:T[],next:T[],intervalMs:number,now:number){
 const usable=(rows:T[])=>rows.length>=65&&now-rows.at(-1)!.t<=intervalMs*2+30000;
 return usable(next)?next:usable(previous)?previous:[];
}
export async function readFuturesRadar(symbol:string,interval:string,limit=160):Promise<any[]>{
 assertBinanceReadAllowed();
 const parse=async(url:string,proxy:boolean)=>{const r=await coordinatedBinanceFetch(url,{cache:'no-store',signal:AbortSignal.timeout(7000)});let data:any;try{data=await r.json()}catch{throw Object.assign(Error(`Binance Futures respondió HTTP ${r.status} sin JSON válido`),{status:r.status,endpoint:'/fapi/v1/klines'})}if(!r.ok)throw Object.assign(Error(data.error||data.msg||`HTTP ${r.status}`),{status:r.status,code:data.code,endpoint:'/fapi/v1/klines'});const rows=proxy?data.data:data;if(!Array.isArray(rows)||rows.length<65)throw Error('Binance no devolvió suficientes velas');return rows};
 try{return await parse(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,false)}catch(error){
  const e=error as {status?:number;code?:number;responseReason?:string};
  if(e.status===429||e.status===418||e.code===-1003)throw error;
  if(e.status&&e.status!==403&&e.status!==451&&e.responseReason!=='invalid-json'&&e.responseReason!=='body-read')throw error;
  try{return await parse(`/api/market?market=futures&symbol=${symbol}&interval=${interval}&limit=${limit}`,true)}catch(fallbackError){if(e.status===403||e.status===451)throw error;if(e.responseReason)throw Error(`${symbol} ${interval}: ${error instanceof Error?error.message:'Lectura incompleta'} El respaldo de Futures tampoco pudo confirmar las velas.`);throw fallbackError}
 }
}
