// Debe coincidir con el radar real de lib/engine.ts. La lista anterior
// rechazaba con HTTP 400 las 10 monedas añadidas al MultiAuto.
import {MARKET_COINS} from '../../../lib/engine';
const coins=MARKET_COINS.map(coin=>coin+'USDT');
const intervals=['1m','3m','5m','15m','1h','4h','1d','1w'];
const okxBars:Record<string,string>={'1m':'1m','3m':'3m','5m':'5m','15m':'15m','1h':'1H','4h':'4H','1d':'1Dutc','1w':'1W'};
const jsonHeaders={'Cache-Control':'public, max-age=2, stale-while-revalidate=15'};
function okxInstrument(symbol:string){return `${symbol.replace(/USDT$/,'')}-USDT-SWAP`}
function okxToKlines(rows:any[]){return rows.map(row=>[Number(row[0]),row[1],row[2],row[3],row[4],row[5]]).reverse()}
function okxToTicker(rows:any[]){return rows.filter(row=>coins.includes(`${String(row.instId||'').split('-')[0]}USDT`)).map(row=>{const symbol=`${String(row.instId).split('-')[0]}USDT`,last=Number(row.last||0),open=Number(row.open24h||last),change=open?((last-open)/open)*100:0;return{symbol,lastPrice:String(last),priceChangePercent:String(change),quoteVolume:String(row.volCcy24h||row.vol24h||0),closeTime:Number(row.ts||Date.now())}})}
async function fetchJson(url:string,timeout=10000){const response=await fetch(url,{signal:AbortSignal.timeout(timeout),headers:{accept:'application/json'}});if(!response.ok)throw Error(`HTTP ${response.status}`);return response.json()}
export async function GET(req:Request){
 const params=new URL(req.url).searchParams,type=params.get('type')||'klines',symbol=params.get('symbol')||'BTCUSDT',interval=params.get('interval')||'1m';
 if(!(coins.includes(symbol)||(params.get('market')==='futures'&&/^[A-Z0-9]{2,15}USDT$/.test(symbol)))||!intervals.includes(interval)||!['klines','ticker'].includes(type))return Response.json({error:'Parámetro inválido'},{status:400});
 const requestedLimit=Number(params.get('limit')||500),limit=Number.isFinite(requestedLimit)?Math.min(1500,Math.max(1,Math.floor(requestedLimit))):500;
 const startParam=params.get('startTime'),endParam=params.get('endTime'),requestedStart=Number(startParam||0),requestedEnd=Number(endParam||0),hasStart=Boolean(startParam)&&Number.isFinite(requestedStart)&&requestedStart>=0,hasEnd=Boolean(endParam)&&Number.isFinite(requestedEnd)&&requestedEnd>0,startTime=hasStart?Math.floor(requestedStart):0,endTime=hasEnd?Math.floor(requestedEnd):0;
 const klineParams=new URLSearchParams({symbol,interval,limit:String(limit)});if(hasStart)klineParams.set('startTime',String(startTime));if(hasEnd)klineParams.set('endTime',String(endTime));
 const historicalRequest=type==='klines'&&(hasStart||limit>500);const responseHeaders=historicalRequest?{'Cache-Control':'public, max-age=300, stale-while-revalidate=1800'}:jsonHeaders;
 const providers:{name:string;run:()=>Promise<any>}[]=[
  {name:'Binance USDⓈ-M Futures',run:()=>type==='ticker'?fetchJson('https://fapi.binance.com/fapi/v1/ticker/24hr') :fetchJson(`https://fapi.binance.com/fapi/v1/klines?${klineParams.toString()}`,params.get('market')==='futures'?4500:10000)},
  {name:'Binance datos públicos · respaldo',run:()=>type==='ticker'?fetchJson(`https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(coins))}`,12000):fetchJson(`https://data-api.binance.vision/api/v3/klines?${klineParams.toString()}`,12000)},
  {name:'OKX swaps · respaldo',run:async()=>{if(type==='ticker')return okxToTicker(await fetchJson('https://www.okx.com/api/v5/market/tickers?instType=SWAP',12000).then((x:any)=>x.data||[]));const result=await fetchJson(`https://www.okx.com/api/v5/market/candles?instId=${okxInstrument(symbol)}&bar=${okxBars[interval]}&limit=300`,12000);return okxToKlines(result.data||[])}},
 ];
 const failures:string[]=[];
 for(const provider of (params.get('market')==='futures'?providers.slice(0,1):providers)){try{const data=await provider.run(),filtered=type==='ticker'?data.filter((x:any)=>coins.includes(x.symbol)):data;if(!Array.isArray(filtered)||(!filtered.length&&!(params.get('market')==='futures'&&historicalRequest)))throw Error('Sin datos');return Response.json({source:provider.name,receivedAt:Date.now(),data:filtered},{headers:responseHeaders})}catch(error){failures.push(`${provider.name}: ${error instanceof Error?error.message:'error'}`)}}
 return Response.json({error:'No hay un proveedor de mercado disponible desde esta conexión.',providers:failures},{status:503,headers:{'Cache-Control':'no-store'}});
}
