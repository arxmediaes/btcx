import {coordinatedBinanceFetch,assertBinanceReadAllowed} from './binance-read-coordinator';
import {RADAR_COINS,ms,type Candle} from './engine';
import type {V2Market,V2Round} from './binance-v2';
import type {V2Bracket} from './binance-v2-sizing';
const base='https://fapi.binance.com';
let publicBackoffUntil=0;
const publicCache=new Map<string,{until:number;read:Promise<any>}>();
async function json(path:string){assertBinanceReadAllowed();const now=Date.now();if(now<publicBackoffUntil)throw Error(`Binance limita las consultas; nuevo intento en ${Math.ceil((publicBackoffUntil-now)/1000)} s`);const cached=publicCache.get(path);if(cached&&cached.until>now)return cached.read;const interval=new URLSearchParams(path.split('?')[1]||'').get('interval'),ttl=path.includes('fundingRate')?30000:interval?Math.min(10000,ms(interval)-now%ms(interval)):2000;const request=(async()=>{const response=await coordinatedBinanceFetch(base+path,{cache:'no-store',signal:AbortSignal.timeout(7000)});if(response.status===429||response.status===418)publicBackoffUntil=Date.now()+Math.max(60000,Number(response.headers.get('Retry-After')||60)*1000);if(!response.ok)throw Error(`Binance Futures HTTP ${response.status}`);return response.json() as Promise<any>})();if(publicCache.size>500)for(const [key,value] of publicCache)if(value.until<=now)publicCache.delete(key);publicCache.set(path,{until:now+ttl,read:request});try{return await request}catch(error){if(publicCache.get(path)?.read===request)publicCache.delete(path);throw error}}

let cache:{at:number;symbols:any[]}|undefined;
let instrumentRead:Promise<any[]>|undefined;
async function instruments(read=json){if(cache&&Date.now()-cache.at<300000)return cache.symbols;if(!instrumentRead)instrumentRead=(async()=>{const data=await read('/fapi/v1/exchangeInfo');if(!Array.isArray(data.symbols))throw Error('Reglas de contratos pendientes');cache={at:Date.now(),symbols:data.symbols};return data.symbols})().finally(()=>{instrumentRead=undefined});return instrumentRead}

const candles=(rows:any[]):Candle[]=>{if(!Array.isArray(rows))throw Error('Velas inválidas');const bars=rows.map(x=>({t:Number(x[0]),o:Number(x[1]),h:Number(x[2]),l:Number(x[3]),c:Number(x[4]),v:Number(x[5])}));if(bars.some(b=>!Object.values(b).every(Number.isFinite)||Math.min(b.o,b.h,b.l,b.c)<=0||b.h<Math.max(b.o,b.c)||b.l>Math.min(b.o,b.c)))throw Error('Velas incompletas');return bars};
export async function readV2Market(symbol:string,r:Pick<V2Round,'version'|'trades'>,now=Date.now(),analyze=true,brackets:V2Bracket[]=[],leverageSource='account-server',read=json):Promise<V2Market>{
 if(!/^[A-Z0-9]+USDT$/.test(symbol))throw Error('Símbolo inválido');
 const fast=r.version==='binance-v2-normal-fast-1',swing=r.version.startsWith('binance-v2-paired-swing-'),primaryTf=swing?'1h':'3m',contextTf=swing?'4h':'15m';
 const active=r.trades.filter(t=>t.symbol===symbol&&['open','pending'].includes(t.status)),from=active.length?Math.min(...active.map(t=>t.status==='pending'?t.scheduledAt:(t.lastBar??t.openedAt!)+60000)):now-180000;
 const extraTfs=analyze&&(r.version==='binance-v2-paired-normal-3'||r.version==='binance-v3-ricardo-rsi-1'||r.version==='binance-v4-paired-stops-1'||fast)?['1m','5m','1h','4h','1d']:analyze&&swing?['1d']:fast&&active.length?['1m']:[];
 const [rules,primary,context,minutes,book,mark,funding,extras]=await Promise.all([instruments(read),analyze?read(`/fapi/v1/klines?symbol=${symbol}&interval=${primaryTf}&limit=500`):Promise.resolve([]),analyze?read(`/fapi/v1/klines?symbol=${symbol}&interval=${contextTf}&limit=500`):Promise.resolve([]),read(`/fapi/v1/klines?symbol=${symbol}&interval=1m&startTime=${Math.max(0,from)}&limit=300`),(analyze||fast&&active.length)?read(`/fapi/v1/ticker/bookTicker?symbol=${symbol}`):Promise.resolve({bidPrice:1,askPrice:1,time:now}),read(`/fapi/v1/premiumIndex?symbol=${symbol}`),active.length?read(`/fapi/v1/fundingRate?symbol=${symbol}&startTime=${Math.max(0,Math.min(...active.map(t=>t.openedAt??t.scheduledAt)))}&limit=1000`):Promise.resolve([]),Promise.all(extraTfs.map(async tf=>[tf,await read(`/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=500`)] as const))]);
 const i=rules.find((x:any)=>x.symbol===symbol&&x.status==='TRADING'&&x.contractType==='PERPETUAL');if(!i)throw Error('Contrato no disponible');const lot=i.filters.find((f:any)=>f.filterType==='MARKET_LOT_SIZE'&&Number(f.stepSize)>0)||i.filters.find((f:any)=>f.filterType==='LOT_SIZE'),notional=i.filters.find((f:any)=>['MIN_NOTIONAL','NOTIONAL'].includes(f.filterType)),price=i.filters.find((f:any)=>f.filterType==='PRICE_FILTER');
 const bid=Number(book.bidPrice),ask=Number(book.askPrice),markPrice=Number(mark.markPrice),step=Number(lot?.stepSize),minimum=Number(lot?.minQty),minNotional=Number(notional?.notional??notional?.minNotional),tick=Number(price?.tickSize);
 if(![bid,ask,markPrice,step,minimum,minNotional,tick].every(v=>Number.isFinite(v)&&v>0)||ask<bid||Math.abs(now-Number(mark.time))>15000||Math.abs(now-Number(book.time))>15000)throw Error('Precios o filtros incompletos/antiguos');
 if(!Array.isArray(funding)||funding.length>=1000)throw Error('Financiación incompleta');const events=funding.map((f:any)=>({time:Number(f.fundingTime),rate:Number(f.fundingRate),mark:Number(f.markPrice)}));if(events.some(f=>!Object.values(f).every(Number.isFinite)||f.mark<=0))throw Error('Financiación sin precio verificable');
 if(!brackets.length)throw Error('Apalancamiento de esta moneda pendiente de confirmar en Binance');
 return {frames:Object.fromEntries(extras.map(([tf,rows])=>[tf,candles(rows).filter(b=>b.t+ms(tf)<=now)])),brackets,leverageSource,symbol,observedAt:now,primary:candles(primary).filter(b=>b.t+ms(primaryTf)<=now),context:candles(context).filter(b=>b.t+ms(contextTf)<=now),minutes:candles(minutes),step,minimum,minNotional,tick,mark:markPrice,spread:(ask-bid)/((ask+bid)/2),funding:events};
}

// Identical plan for the browser reader and server processor; both arms share each snapshot.
export function v2MarketPlan(r:V2Round){
 const pool=RADAR_COINS.map(s=>s+'USDT'),activeTrades=r.trades.filter(t=>['open','pending'].includes(t.status)),active=[...new Set([...activeTrades].sort((a,b)=>(a.lastBar??a.scheduledAt)-(b.lastBar??b.scheduledAt)).map(t=>t.symbol))];
 const batch:string[]=[];let nextCursor=r.cursor;
 if(r.running){for(let offset=0;offset<pool.length&&batch.length<6;offset++){const index=(r.cursor+offset)%pool.length,symbol=pool[index],vacant=(r.version==='binance-v2-normal-fast-1'?['normal'] as const:['normal','inverse'] as const).some(arm=>!activeTrades.some(t=>t.arm===arm&&t.symbol===symbol));nextCursor=(index+1)%pool.length;if(vacant)batch.push(symbol)}}
 return {pool,batch,nextCursor,symbols:[...new Set([...active,...batch])]};
}
export function validateV2BrowserMarket(raw:any,symbol:string,now:number,brackets:V2Bracket[],leverageSource:string,primaryInterval=180000,contextInterval=900000):V2Market{
 if(!raw||raw.symbol!==symbol||!Number.isFinite(raw.observedAt)||Math.abs(now-raw.observedAt)>15000)throw Error('Lectura del navegador antigua o inválida');
 for(const key of ['mark','step','minimum','minNotional','tick'])if(!Number.isFinite(raw[key])||raw[key]<=0)throw Error('Filtros/precio del navegador inválidos');
 if(!Number.isFinite(raw.spread)||raw.spread<0||raw.spread>1)throw Error('Spread del navegador inválido');
 const cleanBars=(rows:any,interval:number,max:number,closed:boolean)=>{if(raw.compact&&Array.isArray(rows))rows=rows.map((x:any)=>Array.isArray(x)&&x.length===6?{t:x[0],o:x[1],h:x[2],l:x[3],c:x[4],v:x[5]}:null);if(!Array.isArray(rows)||rows.length>max)throw Error('Velas del navegador incompletas');let prior=-1;return rows.map((b:any)=>{if(!b||!['t','o','h','l','c','v'].every(k=>Number.isFinite(b[k]))||b.t%interval!==0||b.t<=prior||b.t>now||Math.min(b.o,b.h,b.l,b.c)<=0||b.v<0||b.h<Math.max(b.o,b.c,b.l)||b.l>Math.min(b.o,b.c)||closed&&b.t+interval>now)throw Error('Vela del navegador inválida');prior=b.t;return {t:b.t,o:b.o,h:b.h,l:b.l,c:b.c,v:b.v}})};
 if(!Array.isArray(raw.funding)||raw.funding.length>=1000)throw Error('Financiación del navegador incompleta');
 const funding=raw.funding.map((f:any)=>{if(!f||!['time','rate','mark'].every(k=>Number.isFinite(f[k]))||f.mark<=0||f.time>now)throw Error('Financiación del navegador inválida');return {time:f.time,rate:f.rate,mark:f.mark}});
 if(!brackets.length)throw Error('Apalancamiento pendiente');
 return {symbol,observedAt:raw.observedAt,brackets,leverageSource,frames:Object.fromEntries(Object.entries(raw.frames||{}).filter(([tf])=>['1m','5m','1h','4h','1d'].includes(tf)).map(([tf,rows])=>[tf,cleanBars(rows,ms(tf),500,true)])),primary:cleanBars(raw.primary,primaryInterval,500,true),context:cleanBars(raw.context,contextInterval,500,true),minutes:cleanBars(raw.minutes,60000,1500,false),step:raw.step,minimum:raw.minimum,minNotional:raw.minNotional,tick:raw.tick,mark:raw.mark,spread:raw.spread,funding,marketSource:'binance-browser'};
}
export async function readV2BrowserMarkets(r:V2Round,brackets:Record<string,V2Bracket[]>,leverageSource='account-browser'){
 const now=Date.now(),{batch,symbols}=v2MarketPlan(r);
 const results=await Promise.allSettled(symbols.map(s=>readV2Market(s,r,now,r.running&&batch.includes(s),brackets[s]||[],leverageSource)));
 return {markets:results.flatMap(result=>result.status==='fulfilled'?[{...result.value,marketSource:'binance-browser'}]:[]),errors:results.flatMap((result,i)=>result.status==='rejected'?[`${symbols[i]}: ${result.reason instanceof Error?result.reason.message:'sin datos del navegador'}`]:[])};
}
